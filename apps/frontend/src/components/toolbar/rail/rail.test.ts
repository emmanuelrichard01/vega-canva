import { describe, expect, it } from 'vitest';
import { normalizeNode } from '../../../engine/document/normalize';
import type { AnyNode } from '../../../engine/model/schema';
import { fitVerbs, RAIL_CONTROL_CAP, type RailVerb } from './verbs';
import { chromeFromTokens, chromeInset, DEFAULT_HEADER_H, EDGE_MARGIN, freeStrip, readPx } from './railBounds';
import { railSubjectOf } from './subject';
import { inferGap, inferRowGap, inferRows, layoutRows, tidySelection } from './tidy';

const box = (id: string, x: number, y: number, w = 100, h = 60, extra: Record<string, unknown> = {}): AnyNode =>
  normalizeNode({ id, type: 'shape', x, y, width: w, height: h, geometry: { kind: 'rect' }, ...extra });

/** Apply patches to a copy, so assertions read positions after the tidy. */
function applied(nodes: AnyNode[], patches: { id: string; changes: Record<string, unknown> }[]) {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));
  for (const p of patches) Object.assign(byId.get(p.id)!, p.changes);
  return byId;
}

describe('fitVerbs', () => {
  const verb = (id: string, controls = 1): RailVerb => ({ id, controls, node: null });

  it('keeps verbs in priority order while they fit', () => {
    const kept = fitVerbs([verb('a'), verb('b'), verb('c')], 2).map((v) => v.id);
    expect(kept).toEqual(['a', 'b']);
  });

  it('skips a verb too wide for what is left, and keeps a narrower one after it', () => {
    const kept = fitVerbs([verb('a'), verb('wide', 2), verb('c')], 2).map((v) => v.id);
    expect(kept).toEqual(['a', 'c']);
  });

  it('keeps nothing when there is no budget', () => {
    expect(fitVerbs([verb('a')], 0)).toEqual([]);
  });

  it('caps at nine controls', () => {
    expect(RAIL_CONTROL_CAP).toBe(9);
  });
});

describe('railSubjectOf', () => {
  it('tells a line from a shape, and a pencil stroke from a pen path', () => {
    expect(railSubjectOf(box('r', 0, 0))).toBe('shape');
    expect(railSubjectOf(normalizeNode({ id: 'l', type: 'shape', geometry: { kind: 'line' } }))).toBe('line');
    expect(
      railSubjectOf(normalizeNode({ id: 'f', type: 'path', geometry: { kind: 'freehand', points: [0, 0, 10, 10] } }))
    ).toBe('freehand');
  });
});

describe('placement bounds', () => {
  const viewport = { width: 1440, height: 900 };
  const chrome = { headerH: 48, dockH: 112, insetLeft: 288, insetRight: 288 };

  it('stands under the header and above the dock, from the tokens', () => {
    const b = freeStrip(chrome, viewport, true);
    expect(b.top).toBe(48 + EDGE_MARGIN);
    expect(b.bottom).toBe(900 - 112 - EDGE_MARGIN);
    expect(b.left).toBe(288 + 4);
    expect(b.right).toBe(1440 - 288 - 4);
  });

  it('follows the dock when a shelf raises it', () => {
    const low = freeStrip({ ...chrome, dockH: 64 }, viewport, true);
    const high = freeStrip({ ...chrome, dockH: 112 }, viewport, true);
    expect(low.bottom - high.bottom).toBe(48);
  });

  it('keeps only the margin when the chrome is hidden', () => {
    const b = freeStrip(chrome, viewport, false);
    expect(b.top).toBe(EDGE_MARGIN);
    expect(b.bottom).toBe(900 - EDGE_MARGIN);
  });

  it('reads token lengths and falls back on anything unreadable', () => {
    expect(readPx('112px', 64)).toBe(112);
    expect(readPx(' 44px ', 48)).toBe(44);
    expect(readPx('', 48)).toBe(48);
    expect(readPx('auto', 48)).toBe(48);
    expect(readPx(null, 48)).toBe(48);
  });

  it('measures how far a panel reaches, never less than the margin', () => {
    expect(chromeInset({ left: 0, right: 288, width: 288, height: 800 }, 'left', 1440)).toBe(288);
    expect(chromeInset({ left: 1152, right: 1440, width: 288, height: 800 }, 'right', 1440)).toBe(288);
    expect(chromeInset({ left: 0, right: 0, width: 0, height: 0 }, 'left', 1440)).toBe(EDGE_MARGIN);
    expect(chromeInset(null, 'right', 1440)).toBe(EDGE_MARGIN);
  });

  const measured = { insetLeft: 300, insetRight: 280 };
  const none = { insetTop: null, insetLeft: null, insetRight: null, headerH: null };

  it('stands below --inset-top, falling back to --header-h and then the default', () => {
    expect(chromeFromTokens({ ...none, insetTop: 56, headerH: 0 }, measured).headerH).toBe(56);
    expect(chromeFromTokens({ ...none, headerH: 0 }, measured).headerH).toBe(0);
    expect(chromeFromTokens(none, measured).headerH).toBe(DEFAULT_HEADER_H);
  });

  it('takes the sides from --inset-left / --inset-right, measuring only where they are absent', () => {
    const fromTokens = chromeFromTokens({ ...none, insetLeft: 316, insetRight: 0 }, measured);
    expect(fromTokens.insetLeft).toBe(316);
    // A column shrunk to a pill publishes 0; the plain margin is kept.
    expect(fromTokens.insetRight).toBe(EDGE_MARGIN);
    const fromPanels = chromeFromTokens(none, measured);
    expect(fromPanels.insetLeft).toBe(300);
    expect(fromPanels.insetRight).toBe(280);
  });
});

describe('tidy up', () => {
  it('reads rows from vertical centres', () => {
    const nodes = [box('a', 0, 0), box('b', 200, 10), box('c', 0, 200), box('d', 230, 190)];
    const rows = inferRows(nodes).map((r) => r.map((i) => i.node.id));
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps the gap people were already using', () => {
    const rows = inferRows([box('a', 0, 0), box('b', 140, 0), box('c', 280, 0)]);
    expect(inferGap(rows)).toBe(40);
  });

  it('packs each row at one gap and stacks the rows at the same gap', () => {
    const nodes = [box('a', 0, 0), box('b', 170, 12), box('c', 5, 150), box('d', 160, 140)];
    const after = applied(nodes, tidySelection(nodes));
    const gap = inferGap(inferRows(nodes));
    const rowGap = inferRowGap(layoutRows(nodes).bands)!;
    expect(after.get('a')!.x).toBe(0);
    expect(after.get('b')!.x).toBe(100 + gap);
    expect(after.get('c')!.x).toBe(0);
    expect(after.get('d')!.x).toBe(100 + gap);
    // Same height boxes in a row share a top; the second row starts one row gap below the first.
    expect(after.get('a')!.y).toBe(after.get('b')!.y);
    expect(after.get('c')!.y).toBe(after.get('a')!.y + 60 + rowGap);
  });

  it('keeps the spacing of a single column, read from between its rows', () => {
    const nodes = [box('a', 0, 0), box('b', 6, 120), box('c', -4, 240)];
    const after = applied(nodes, tidySelection(nodes));
    const ys = ['a', 'b', 'c'].map((id) => after.get(id)!.y as number).sort((p, q) => p - q);
    expect(ys[1] - ys[0]).toBe(60 + 60);
    expect(ys[2] - ys[1]).toBe(60 + 60);
    // One column: everyone shares a centre line.
    expect(new Set(['a', 'b', 'c'].map((id) => after.get(id)!.x)).size).toBe(1);
  });

  it('does not let a tall item beside a 2x2 group swallow the second row', () => {
    const nodes = [
      box('a', 0, 0),
      box('b', 120, 0),
      box('c', 0, 100),
      box('d', 120, 100),
      box('tall', 260, 0, 100, 160),
    ];
    const { rows, spanners } = layoutRows(nodes);
    expect(rows.map((r) => r.map((i) => i.node.id))).toEqual([
      ['a', 'b', 'tall'],
      ['c', 'd'],
    ]);
    expect(spanners.map((s) => s.item.node.id)).toEqual(['tall']);

    const after = applied(nodes, tidySelection(nodes));
    // The 2x2 stays two rows at the gap between them, and the tall item keeps its column.
    expect(after.get('c')!.y).toBe(100);
    expect(after.get('d')!.y).toBe(100);
    expect(after.get('a')!.y).toBe(0);
    expect(after.get('tall')!.y).toBe(0);
    expect(after.get('tall')!.x).toBeGreaterThan((after.get('b')!.x as number) + 100);
  });

  it('leaves connectors and locked objects where they are', () => {
    const nodes = [box('a', 0, 0), box('b', 300, 0), box('locked', 600, 40, 100, 60, { locked: true })];
    const ids = tidySelection(nodes).map((p) => p.id);
    expect(ids).not.toContain('locked');
  });

  it('does nothing for a single movable object', () => {
    expect(tidySelection([box('a', 0, 0)])).toEqual([]);
  });
});
