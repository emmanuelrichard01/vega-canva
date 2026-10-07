import { describe, expect, it } from 'vitest';
import { shapeLabelBox } from './labelBox';
import { shapeToPath } from '../shapeToPath';
import { flattenPath, subpathsOf } from '../pathGeometry';
import { SHAPE_KIND_VALUES, type Point, type ShapeKind, type ShapeNode } from '../schema';

const node = (kind: ShapeKind, w: number, h: number) =>
  ({ geometry: { kind }, width: w, height: h, appearance: {} }) as unknown as Pick<
    ShapeNode,
    'geometry' | 'width' | 'height' | 'appearance'
  >;

/** Even-odd containment across every contour, the rule the canvas fills by. */
function inside(rings: Point[][], p: Point): boolean {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
  }
  return hit;
}

const CLOSED = SHAPE_KIND_VALUES.filter((k) => k !== 'line' && k !== 'arrow');

/** The label sits over the hole on purpose: the ring and the bore are too thin to hold text. */
const OVER_A_HOLE: ReadonlySet<string> = new Set(['donut', 'gear']);

/** The label sits beside the glyph, on a plate, because nothing on it holds a line of text. */
const BESIDE: ReadonlySet<string> = new Set(['key']);

describe('a label box', () => {
  it.each(CLOSED)('%s stays within its box and has room', (kind) => {
    for (const [w, h] of [
      [160, 110],
      [240, 90],
      [90, 200],
    ]) {
      const b = shapeLabelBox(node(kind, w, h));
      expect(b.x, `${kind} ${w}x${h}`).toBeGreaterThanOrEqual(-0.01);
      expect(b.y, `${kind} ${w}x${h}`).toBeGreaterThanOrEqual(-0.01);
      expect(b.x + b.width, `${kind} ${w}x${h}`).toBeLessThanOrEqual(w + 0.01);
      expect(b.y + b.height, `${kind} ${w}x${h}`).toBeLessThanOrEqual(h + 0.01);
      expect(b.width, `${kind} ${w}x${h} width`).toBeGreaterThan(w * 0.2);
      expect(b.height, `${kind} ${w}x${h} height`).toBeGreaterThan(h * 0.15);
    }
  });

  it.each(CLOSED.filter((k) => !OVER_A_HOLE.has(k) && !BESIDE.has(k)))('%s lies inside the silhouette', (kind) => {
    const [w, h] = [160, 110];
    const b = shapeLabelBox(node(kind, w, h));
    // A box equal to the whole shape is the "lay out over the glyph" answer,
    // which is not a claim about the interior.
    if (b.x === 0 && b.y === 0 && b.width === w && b.height === h) return;
    const rings = subpathsOf(shapeToPath(node(kind, w, h))).map((s) => flattenPath(s));
    const inset = 0.04;
    const samples: Point[] = [
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      { x: b.x + b.width * inset, y: b.y + b.height * inset },
      { x: b.x + b.width * (1 - inset), y: b.y + b.height * inset },
      { x: b.x + b.width * inset, y: b.y + b.height * (1 - inset) },
      { x: b.x + b.width * (1 - inset), y: b.y + b.height * (1 - inset) },
    ];
    for (const p of samples) expect(inside(rings, p), `${kind} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`).toBe(true);
  });

  it.each([...BESIDE])('%s keeps its label clear of the glyph, teeth included', (kind) => {
    for (const [w, h] of [
      [140, 140],
      [160, 110],
      [240, 90],
      [90, 200],
    ]) {
      const b = shapeLabelBox(node(kind as ShapeKind, w, h));
      const rings = subpathsOf(shapeToPath(node(kind as ShapeKind, w, h))).map((s) => flattenPath(s));
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          const p = { x: b.x + (b.width * i) / 8, y: b.y + (b.height * j) / 8 };
          expect(inside(rings, p), ).toBe(false);
        }
      }
    }
  });

  it.each([...BESIDE])('%s keeps its label clear of the glyph, teeth included', (kind) => {
    for (const [w, h] of [
      [140, 140],
      [160, 110],
      [240, 90],
      [90, 200],
    ]) {
      const b = shapeLabelBox(node(kind as ShapeKind, w, h));
      const rings = subpathsOf(shapeToPath(node(kind as ShapeKind, w, h))).map((s) => flattenPath(s));
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          const p = { x: b.x + (b.width * i) / 8, y: b.y + (b.height * j) / 8 };
          expect(inside(rings, p), `${kind} ${w}x${h} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`).toBe(false);
        }
      }
    }
  });

  it('keeps a rectangle label on the whole box, so existing boards lay out unchanged', () => {
    expect(shapeLabelBox(node('rect', 200, 100))).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
});
