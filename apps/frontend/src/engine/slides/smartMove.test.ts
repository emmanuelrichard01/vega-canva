import { describe, expect, it } from 'vitest';
import { easeInOut, lerpRect, matchSlides, relativeBox, sameProportion, smartMoveFrame, type MoveNode } from './smartMove';

const A = { x: 0, y: 0, width: 1920, height: 1080 };
const B = { x: 3000, y: 500, width: 1920, height: 1080 };

const node = (id: string, extra: Partial<MoveNode>): MoveNode => ({ id, type: 'shape', x: 0, y: 0, width: 100, height: 50, ...extra });

describe('which objects travel', () => {
  it('pairs by layer name first, even when the words changed', () => {
    const plan = matchSlides(
      A,
      [node('t1', { type: 'text', title: 'Title', text: 'Problem', x: 160, y: 140 })],
      B,
      [node('t2', { type: 'text', title: 'Title', text: 'Solution', x: 3160, y: 900 })]
    );
    expect(plan.pairs.map((p) => [p.a.id, p.b.id])).toEqual([['t1', 't2']]);
    expect(plan.leaving).toEqual([]);
    expect(plan.entering).toEqual([]);
  });

  it('pairs by the same words, then the same picture, then the same look', () => {
    const plan = matchSlides(
      A,
      [
        node('w1', { text: 'Revenue  grew', x: 100 }),
        node('i1', { type: 'image', src: 'blob:logo' }),
        node('s1', { appearance: { fill: [{ type: 'solid', color: '#4F46E5' }] }, geometry: { kind: 'ellipse' } }),
        node('gone', { text: 'Only here' }),
      ],
      B,
      [
        node('w2', { text: 'revenue grew', x: 3100 }),
        node('i2', { type: 'image', src: 'blob:logo', x: 4000 }),
        node('s2', { appearance: { fill: [{ type: 'solid', color: '#4f46e5' }] }, geometry: { kind: 'ellipse' }, x: 3500 }),
        node('new', { text: 'Only there' }),
      ]
    );
    expect(Object.fromEntries(plan.pairs.map((p) => [p.a.id, p.b.id]))).toEqual({ w1: 'w2', i1: 'i2', s1: 's2' });
    expect(plan.leaving.map((n) => n.id)).toEqual(['gone']);
    expect(plan.entering.map((n) => n.id)).toEqual(['new']);
  });

  it('never pairs text by look alone, nor moves connectors', () => {
    const plan = matchSlides(
      A,
      [node('a', { type: 'text', text: 'One thing' }), node('c1', { type: 'connector' })],
      B,
      [node('b', { type: 'text', text: 'Another thing' }), node('c2', { type: 'connector' })]
    );
    expect(plan.pairs).toEqual([]);
    expect(plan.leaving.map((n) => n.id)).toEqual(['a']);
  });

  it('pairs several objects with one key in reading order, so a list stays a list', () => {
    const bullet = (id: string, y: number, dx = 0) => node(id, { title: 'Bullet', y, x: dx });
    const plan = matchSlides(A, [bullet('a3', 300), bullet('a1', 100), bullet('a2', 200)], B, [bullet('b2', 820, 3000), bullet('b1', 720, 3000)]);
    expect(plan.pairs.map((p) => [p.a.id, p.b.id])).toEqual([
      ['a1', 'b1'],
      ['a2', 'b2'],
    ]);
    expect(plan.leaving.map((n) => n.id)).toEqual(['a3']);
  });

  it('measures each end in its own slide, so slides can sit anywhere on the board', () => {
    const plan = matchSlides(A, [node('a', { title: 'Logo', x: 960, y: 540 })], B, [node('b', { title: 'Logo', x: 3000 + 960, y: 500 + 540 })]);
    expect(plan.pairs[0].from).toEqual(plan.pairs[0].to);
    expect(relativeBox({ x: 960, y: 540, width: 192, height: 108 }, A)).toEqual({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 });
  });

  it('only moves between slides of the same shape', () => {
    expect(sameProportion(A, B)).toBe(true);
    expect(sameProportion(A, { x: 0, y: 0, width: 1440, height: 1080 })).toBe(false);
  });
});

describe('how they travel', () => {
  it('eases in and out, from exactly the start to exactly the end', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    expect(easeInOut(-1)).toBe(0);
  });

  it('interpolates position and size together', () => {
    expect(lerpRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 20, width: 30, height: 10 }, 0.5)).toEqual({ x: 5, y: 10, width: 20, height: 10 });
  });

  it('starts as the old slide and ends as the new one', () => {
    const plan = matchSlides(A, [node('a', { title: 'Card', x: 0, y: 0 })], B, [node('b', { title: 'Card', x: 3960, y: 1040, width: 200 })]);
    const start = smartMoveFrame(plan, 0);
    const end = smartMoveFrame(plan, 1);
    expect(start.page).toEqual({ from: 1, to: 0 });
    expect(end.page).toEqual({ from: 0, to: 1 });
    expect(start.sprites[0].box).toEqual(plan.pairs[0].from);
    expect(end.sprites[0].box).toEqual(plan.pairs[0].to);
    expect([start.sprites[0].from, start.sprites[0].to]).toEqual([1, 0]);
    expect([end.sprites[0].from, end.sprites[0].to]).toEqual([0, 1]);
    // The traveller's two looks swap across the middle of the move, not at its ends.
    const mid = smartMoveFrame(plan, 0.5);
    expect(mid.sprites[0].from).toBeCloseTo(0.5);
  });
});
