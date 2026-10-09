import { describe, expect, it } from 'vitest';
import { estimateTextHeight, isPlaceholder, layoutNodes, layoutSlide, PLACEHOLDER_OPACITY, PROMPTS, SLIDE_LAYOUTS } from './layouts';
import { contrastOf, DECK_THEMES, themePatches, themeOfFrame } from './themes';
import type { AnyNode, FrameNode } from '../model/schema';

const BOXES = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: -500, y: 2400, width: 1440, height: 1080 },
];

type Node = Record<string, unknown> & { type: string; x: number; y: number; width: number; height: number };

describe('slide layouts', () => {
  it('builds all nine, each in every theme', () => {
    expect(SLIDE_LAYOUTS.map((l) => l.id)).toHaveLength(9);
    for (const theme of DECK_THEMES) for (const l of SLIDE_LAYOUTS) expect(layoutNodes(l.id, BOXES[0], theme).length).toBeGreaterThan(0);
  });

  it('keeps everything inside the slide, so the frame owns and never clips it', () => {
    for (const box of BOXES) {
      for (const l of SLIDE_LAYOUTS) {
        for (const n of layoutNodes(l.id, box, DECK_THEMES[0]) as Node[]) {
          expect(n.x, `${l.id} ${String(n.title)}`).toBeGreaterThanOrEqual(box.x);
          expect(n.y, `${l.id} ${String(n.title)}`).toBeGreaterThanOrEqual(box.y);
          expect(n.x + n.width, `${l.id} ${String(n.title)}`).toBeLessThanOrEqual(box.x + box.width);
          expect(n.y + n.height, `${l.id} ${String(n.title)}`).toBeLessThanOrEqual(box.y + box.height);
        }
      }
    }
  });

  it('never stacks two blocks of text on top of one another', () => {
    for (const l of SLIDE_LAYOUTS) {
      const texts = (layoutNodes(l.id, BOXES[0], DECK_THEMES[1]) as Node[]).filter((n) => n.type === 'text' && n.text !== '“');
      for (let i = 0; i < texts.length; i++)
        for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i];
          const b = texts[j];
          const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(w > 0 && h > 0, `${l.id}: "${String(a.text)}" over "${String(b.text)}"`).toBe(false);
        }
    }
  });

  it('sets quiet placeholders when given nothing, and real text when given content', () => {
    const empty = layoutNodes('title', BOXES[0], DECK_THEMES[2]) as Node[];
    const prompts = empty.filter((n) => isPlaceholder(n as never));
    expect(prompts.map((n) => n.text)).toEqual([PROMPTS.title, PROMPTS.subtitle, PROMPTS.footer]);
    expect(prompts.every((n) => n.opacity === PLACEHOLDER_OPACITY)).toBe(true);

    const filled = layoutNodes('title', BOXES[0], DECK_THEMES[2], { title: 'Vega', subtitle: 'Seed round', footer: 'Ada · May' }) as Node[];
    expect(filled.some((n) => isPlaceholder(n as never))).toBe(false);
    expect(filled.find((n) => n.title === 'Title')?.text).toBe('Vega');
    expect(filled.every((n) => n.opacity === undefined)).toBe(true);
  });

  it('puts the frame first, so what it holds joins it when created', () => {
    const nodes = layoutSlide('content', BOXES[0], DECK_THEMES[0], 'Agenda');
    expect(nodes[0].type).toBe('frame');
    expect(nodes[0].title).toBe('Agenda');
    expect(nodes[0].preset).toBe('slide');
  });

  it('only treats exact prompts as placeholders', () => {
    expect(isPlaceholder({ type: 'text', text: PROMPTS.body })).toBe(true);
    expect(isPlaceholder({ type: 'text', text: `${PROMPTS.body}!` })).toBe(false);
    expect(isPlaceholder({ type: 'shape', text: PROMPTS.body })).toBe(false);
  });

  it('estimates more height for more words', () => {
    expect(estimateTextHeight('a b c', 32, 1.5, 1000)).toBeLessThan(estimateTextHeight('word '.repeat(80), 32, 1.5, 1000));
    expect(estimateTextHeight('one\ntwo\nthree', 32, 1.5, 1000) % 8).toBe(0);
  });
});

describe('deck themes', () => {
  it('keep every ink legible on the page and on cards', () => {
    for (const t of DECK_THEMES) {
      for (const ground of [t.page, t.surface]) {
        expect(contrastOf(t.ink, ground), `${t.id} ink`).toBeGreaterThanOrEqual(4.5);
        expect(contrastOf(t.muted, ground), `${t.id} muted`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastOf(t.onAccent, t.accent), `${t.id} on accent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('move a slide from one theme to another, role for role', () => {
    const [graphite, paper] = DECK_THEMES;
    const nodes = layoutSlide('big-number', BOXES[0], graphite, 'Growth', { number: '3.2×', label: 'Net revenue retention', context: 'Up from 1.9×' });
    const frame = { ...nodes[0], appearance: nodes[0].appearance } as unknown as FrameNode;
    expect(themeOfFrame(frame)?.id).toBe('graphite');
    const patches = themePatches(paper, frame, nodes.slice(1) as unknown as AnyNode[]);
    const byId = new Map(patches.map((p) => [p.id, p.changes]));
    expect((byId.get(frame.id)?.appearance as { fill: Array<{ color: string }> }).fill[0].color).toBe(paper.page);
    const number = nodes.find((n) => n.title === 'Number')!;
    const label = nodes.find((n) => n.title === 'Label')!;
    const context = nodes.find((n) => n.title === 'Context')!;
    const type = (id: unknown) => byId.get(String(id))?.typography as { color: string; fontFamily: string };
    expect(type(number.id).color).toBe(paper.accent);
    expect(type(number.id).fontFamily).toBe(paper.display.family);
    expect(type(label.id).color).toBe(paper.ink);
    expect(type(label.id).fontFamily).toBe(paper.body.family);
    expect(type(context.id).color).toBe(paper.muted);
  });

  it('rescue a hand-picked colour only when it would no longer read', () => {
    const studio = DECK_THEMES[2];
    const frame = { id: 'f', type: 'frame', appearance: { fill: [{ type: 'solid', color: '#123456' }] } } as unknown as FrameNode;
    const readable = { id: 'a', type: 'text', typography: { fontSize: 24, color: '#7C2D12' } } as unknown as AnyNode;
    const lost = { id: 'b', type: 'text', typography: { fontSize: 24, color: '#F8FAFC' } } as unknown as AnyNode;
    const out = new Map(themePatches(studio, frame, [readable, lost]).map((p) => [p.id, p.changes.typography as { color: string }]));
    expect(out.get('a')!.color).toBe('#7C2D12');
    expect(out.get('b')!.color).toBe(studio.ink);
  });
});
