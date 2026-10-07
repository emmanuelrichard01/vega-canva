import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_THEMES } from './schema';
import { contrastRatio, paperOf, PALETTE_ORDER, stickySizeOf, STICKY_SIZES } from './stickyThemes';
import { fitRich, hasRichMarkup, layoutSticky, parseSticky, safeHref, toggleCheck, type MeasureRun } from './stickyRich';
import { QUICK_STAMPS, STAMP_PLUS_ONE } from './stickyStamps';
import { applyReactionToggle, seedReactions } from '../document/reactions';
import { normalizeReactions } from '../document/normalize';

/** Every character is 0.5em wide, bold a little wider: arithmetic a test can predict. */
const measure: MeasureRun = (text, size, bold) => text.length * size * (bold ? 0.55 : 0.5);
const opts = { lineHeight: 1.4, measure, align: 'center' as const };

describe('the paper palette', () => {
  it('offers every stored theme exactly once', () => {
    expect([...PALETTE_ORDER].sort()).toEqual([...STICKY_THEMES].sort());
  });

  it('keeps ink and footer ink at AA on every paper, on both boards', () => {
    for (const theme of STICKY_THEMES) {
      for (const dark of [false, true]) {
        const p = paperOf(theme, dark);
        expect(contrastRatio(p.bg, p.ink), `${theme} ${dark ? 'dark' : 'light'} ink`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.bg, p.secondaryInk), `${theme} ${dark ? 'dark' : 'light'} footer`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('pulls pastels down a step on a dark board', () => {
    expect(paperOf('yellow', true).bg).not.toBe(paperOf('yellow', false).bg);
  });

  it('names sizes by exact match only', () => {
    for (const s of STICKY_SIZES) expect(stickySizeOf(s.width, s.height)).toBe(s.id);
    expect(stickySizeOf(201, 200)).toBeNull();
  });
});

describe('reading a note', () => {
  it('finds bold, italic and links, leaving unclosed markers as typed', () => {
    const [p] = parseSticky('Ship **today** or *maybe* see https://example.com/a. 2*3');
    expect(p.runs.find((r) => r.bold)?.text).toBe('today');
    expect(p.runs.find((r) => r.italic)?.text).toBe('maybe');
    const link = p.runs.find((r) => r.href);
    expect(link?.text).toBe('https://example.com/a');
    expect(p.runs.map((r) => r.text).join('')).toContain('2*3');
  });

  it('only ever links http and https', () => {
    expect(safeHref('www.vega.it')).toBe('https://www.vega.it/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    const [p] = parseSticky('javascript:alert(1) data:text/html,x');
    expect(p.runs.some((r) => r.href)).toBe(false);
  });

  it('reads checklist lines, and every line in checklist mode', () => {
    const lines = parseSticky('[ ] draft\n[x] review\nplain');
    expect(lines.map((l) => l.check)).toEqual(['todo', 'done', undefined]);
    expect(parseSticky('a\n\nb', { checklist: true }).map((l) => l.check)).toEqual(['todo', undefined, 'todo']);
  });

  it('ticks and unticks an item as a text edit, adding the marker when needed', () => {
    expect(toggleCheck('[ ] draft\nb', 0)).toBe('[x] draft\nb');
    expect(toggleCheck('[x] draft', 0)).toBe('[ ] draft');
    expect(toggleCheck('a\nb', 1)).toBe('a\n[x] b');
    expect(toggleCheck('a', 5)).toBe('a');
  });

  it('keeps the plain path for plain text', () => {
    expect(hasRichMarkup('just a thought')).toBe(false);
    expect(hasRichMarkup('a **b**')).toBe(true);
    expect(hasRichMarkup('[ ] x')).toBe(true);
  });
});

describe('laying a note out', () => {
  it('balances a centred paragraph instead of leaving an orphan', () => {
    // Greedy at 20 characters a line leaves "e" alone on the second line.
    const para = parseSticky('aaaa bbbb cccc dddd e');
    const greedy = layoutSticky(para, { ...opts, width: 100, size: 10, balance: false });
    const balanced = layoutSticky(para, { ...opts, width: 100, size: 10, balance: true });
    expect(balanced.lines).toHaveLength(greedy.lines.length);
    const spread = (l: typeof greedy) => Math.max(...l.lines.map((x) => x.width)) - Math.min(...l.lines.map((x) => x.width));
    expect(spread(balanced)).toBeLessThan(spread(greedy));
  });

  it('centres each line in the box', () => {
    const l = layoutSticky(parseSticky('hi'), { ...opts, width: 100, size: 10, balance: true });
    expect(l.lines[0].x).toBeCloseTo((100 - 10) / 2);
  });

  it('breaks a word wider than the box and says so', () => {
    const l = layoutSticky(parseSticky('supercalifragilistic'), { ...opts, width: 40, size: 10, balance: false });
    expect(l.brokeWord).toBe(true);
    expect(Math.max(...l.lines.map((x) => x.width))).toBeLessThanOrEqual(40);
    expect(l.lines.map((x) => x.runs.map((r) => r.text).join('')).join('')).toBe('supercalifragilistic');
  });

  it('indents checklist items past their box and marks done lines', () => {
    const l = layoutSticky(parseSticky('[x] done item'), { ...opts, align: 'left', width: 200, size: 10, balance: false });
    expect(l.lines[0].check).toBe('done');
    expect(l.lines[0].done).toBe(true);
    expect(l.lines[0].x).toBeGreaterThan(0);
  });

  it('fits the largest size that does not overflow or break a word', () => {
    const para = parseSticky('Onboarding plan');
    const size = fitRich(para, { width: 100, height: 100 }, opts, 8, 60);
    const at = layoutSticky(para, { ...opts, width: 100, size, balance: false });
    const bigger = layoutSticky(para, { ...opts, width: 100, size: size + 1, balance: false });
    expect(at.height).toBeLessThanOrEqual(100);
    expect(at.brokeWord).toBe(false);
    expect(bigger.height > 100 || bigger.brokeWord).toBe(true);
  });

  it('settles a paragraph smaller than three words', () => {
    const box = { width: 160, height: 140 };
    const few = fitRich(parseSticky('Ship it'), box, opts, 8, 60);
    const many = fitRich(parseSticky('A much longer thought that needs to wrap across several lines to fit'), box, opts, 8, 60);
    expect(few).toBeGreaterThan(many);
  });
});

describe('stamps', () => {
  function pair() {
    const a = new Y.Doc();
    const node = new Y.Map<unknown>();
    a.transact(() => {
      node.set('id', 's1');
      seedReactions(node);
      a.getMap<Y.Map<unknown>>('objects').set('s1', node);
    });
    const b = new Y.Doc();
    const sync = () => {
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    };
    sync();
    const nb = b.getMap<Y.Map<unknown>>('objects').get('s1')!;
    const read = (n: Y.Map<unknown>) => normalizeReactions((n.toJSON() as { reactions?: unknown }).reactions);
    return { na: node, nb, sync, read };
  }

  it('offers thumbs up, +1, love and star first', () => {
    expect(QUICK_STAMPS.slice(0, 4)).toEqual(['👍', STAMP_PLUS_ONE, '❤️', '⭐']);
  });

  it('keeps both of two people stamping +1 at the same moment', () => {
    const { na, nb, sync, read } = pair();
    applyReactionToggle(na, STAMP_PLUS_ONE, 'ada');
    applyReactionToggle(nb, STAMP_PLUS_ONE, 'bo');
    sync();
    expect(read(na)[STAMP_PLUS_ONE]?.sort()).toEqual(['ada', 'bo']);
    expect(read(nb)).toEqual(read(na));
  });

  it('holds one stamp per person per kind, and taking yours back leaves theirs', () => {
    const { na, nb, sync, read } = pair();
    applyReactionToggle(na, '⭐', 'ada');
    applyReactionToggle(nb, '⭐', 'bo');
    sync();
    applyReactionToggle(na, '⭐', 'ada');
    sync();
    expect(read(nb)['⭐']).toEqual(['bo']);
  });

  it('stamps any emoji, not only the quick set', () => {
    const { na, read } = pair();
    applyReactionToggle(na, '🦄', 'ada');
    expect(read(na)['🦄']).toEqual(['ada']);
  });
});
