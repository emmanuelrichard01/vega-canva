import { describe, expect, it } from 'vitest';
import { shapeToPath } from '../shapeToPath';
import { contourBounds, contourData, flattenPath, subpathsOf } from '../pathGeometry';
import { roughShape } from '../roughShape';
import { shapeLabelBox } from './labelBox';
import { keyLayout } from './contours';
import { paramHandles, handlePosition } from './paramHandles';
import type { ShapeGeometry, ShapeNode } from '../schema';
import { normalizeNode } from '../../document/normalize';
import { placedSize } from '../../../components/workspace/shapeCatalog';

const key = (w: number, h: number, dials: Partial<ShapeGeometry> = {}, appearance: Record<string, unknown> = {}) =>
  ({ id: 'key-1', geometry: { kind: 'key', ...dials }, width: w, height: h, appearance }) as unknown as Pick<
    ShapeNode,
    'geometry' | 'width' | 'height' | 'appearance'
  > & { id: string };

const SIZES: Array<[number, number]> = [
  [24, 24],
  [48, 48],
  [140, 140],
  [200, 120],
  [300, 60],
  [80, 260],
];

describe('the key', () => {
  it.each(SIZES)('fills a %ix%i box', (w, h) => {
    for (const teeth of [2, 3, 4]) {
      for (const bowRatio of [0.3, 0.4, 0.5]) {
        const b = contourBounds(shapeToPath(key(w, h, { teeth, bowRatio })));
        const tol = Math.max(0.5, w * 0.004);
        expect(b.x).toBeCloseTo(0, 0);
        expect(b.y).toBeCloseTo(0, 0);
        expect(Math.abs(b.width - w), `${w}x${h} width`).toBeLessThan(tol);
        expect(Math.abs(b.height - h), `${w}x${h} height`).toBeLessThan(tol);
      }
    }
  });

  it('is a closed outline with a hole in its bow', () => {
    const subs = subpathsOf(shapeToPath(key(140, 140)));
    expect(subs).toHaveLength(2);
    for (const s of subs) expect(s.closed).toBe(true);
    // The hole lies inside the outer contour's bounds and is much smaller.
    const outer = contourBounds(subs[0]);
    const hole = contourBounds(subs[1]);
    expect(hole.x).toBeGreaterThan(outer.x);
    expect(hole.y).toBeGreaterThan(outer.y);
    expect(hole.width).toBeLessThan(outer.width * 0.2);
  });

  it('keeps the bow a true circle at any aspect', () => {
    for (const [w, h] of [
      [140, 140],
      [260, 90],
      [90, 260],
    ]) {
      const k = keyLayout(w, h, 0.4);
      const ring = flattenPath(subpathsOf(shapeToPath(key(w, h)))[0]);
      // Every point of the outline on the far side of the bow, away from the
      // blade, sits on one radius.
      const far = ring.filter((p) => (p.x - k.cx) * k.ux + (p.y - k.cy) * k.uy < -k.r * 0.2);
      expect(far.length).toBeGreaterThan(4);
      for (const p of far) expect(Math.hypot(p.x - k.cx, p.y - k.cy) / k.r, `${w}x${h}`).toBeCloseTo(1, 1);
    }
  });

  it('cuts as many teeth as it is asked for, and the hole grows with its dial', () => {
    const corners = (teeth: number) => flattenPath(subpathsOf(shapeToPath(key(140, 140, { teeth })))[0]).length;
    expect(corners(2)).toBeLessThan(corners(3));
    expect(corners(3)).toBeLessThan(corners(4));
    const hole = (innerRatio: number) => contourBounds(subpathsOf(shapeToPath(key(140, 140, { innerRatio })))[1]).width;
    expect(hole(0.1)).toBeLessThan(hole(0.2));
    expect(hole(0.2)).toBeLessThan(hole(0.4));
  });

  it('is drawn the same way every time', () => {
    expect(contourData(shapeToPath(key(140, 140)))).toBe(contourData(shapeToPath(key(140, 140))));
    const a = roughShape(key(140, 140, {}, { sketch: 'medium' }), true);
    const b = roughShape(key(140, 140, {}, { sketch: 'medium' }), true);
    expect(a).toEqual(b);
  });

  it('sketches, hole and all', () => {
    const sketch = roughShape(key(140, 140, {}, { sketch: 'medium', fillStyle: 'hachure' }), true);
    expect(sketch.outline.length).toBeGreaterThan(0);
    expect(sketch.fill.length).toBeGreaterThan(0);
    // One closed region per contour: the outline and the hole.
    expect(sketch.silhouette.match(/M/g)?.length).toBe(2);
  });

  it('puts its label inside the box and clear of the key', () => {
    for (const [w, h] of SIZES.slice(2)) {
      const b = shapeLabelBox(key(w, h));
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(w + 0.01);
      expect(b.y + b.height).toBeLessThanOrEqual(h + 0.01);
      expect(b.width * b.height, `${w}x${h}`).toBeGreaterThan(w * h * 0.04);
    }
  });

  it('places square, which lays it on the diagonal', () => {
    const size = placedSize('key');
    expect(size.width).toBe(size.height);
    const k = keyLayout(size.width, size.height, 0.4);
    const degrees = (Math.atan2(k.uy, -k.ux) * 180) / Math.PI;
    expect(degrees).toBeGreaterThan(40);
    expect(degrees).toBeLessThan(55);
  });

  it('offers a knob on the hole', () => {
    const [hole] = paramHandles('key');
    expect(hole.field).toBe('innerRatio');
    const k = keyLayout(140, 140, 0.4);
    const at = handlePosition({ kind: 'key', innerRatio: 0.2 } as ShapeGeometry, hole, 140, 140);
    // On the bow, beyond the hole's centre on the side away from the blade.
    expect(Math.hypot(at.x - k.cx, at.y - k.cy)).toBeLessThan(k.r);
  });

  it('survives the document boundary with its dials clamped, under each of its names', () => {
    for (const alias of ['key', 'auth_key', 'authentication_key']) {
      const stored = normalizeNode({ id: 'x', type: 'shape', x: 0, y: 0, width: 100, height: 100, geometry: { kind: alias, teeth: 9, bowRatio: 2 } }) as ShapeNode;
      expect(stored.geometry.kind).toBe('key');
      expect(stored.geometry.teeth).toBe(4);
      expect(stored.geometry.bowRatio).toBe(0.5);
    }
  });
});
