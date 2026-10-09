import { describe, expect, it } from 'vitest';
import {
  apply,
  boxHandleAt,
  rotationAbout,
  rotationFromDrag,
  scaleFromHandle,
  transformAnchors,
  translation,
} from './pointTransform';
import { toAnchors } from './pathGeometry';
import { reboxedPosition, linearOf } from './rebox';
import type { BezierGeometry, CompoundGeometry } from './schema';

const curve: BezierGeometry = {
  kind: 'bezier',
  closed: false,
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 0, cp1x: 30, cp1y: -20, cp2x: 70, cp2y: -20 },
    { x: 100, y: 100 },
  ],
};

describe('transformAnchors', () => {
  it('moves picked anchors with their handles and leaves the rest', () => {
    const next = transformAnchors(curve, [{ sub: 0, index: 1 }], translation(10, 5)) as BezierGeometry;
    const a = toAnchors(next);
    expect(a[0]).toEqual({ x: 0, y: 0, outX: 30, outY: -20 });
    expect(a[1]).toMatchObject({ x: 110, y: 5, inX: 80, inY: -15 });
    expect(a[2]).toEqual({ x: 100, y: 100 });
  });

  it('rotates a point set about a pivot, handles included', () => {
    const quarter = rotationAbout({ x: 0, y: 0 }, Math.PI / 2);
    const p = apply(quarter, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
    const next = transformAnchors(curve, [{ sub: 0, index: 1 }], quarter);
    const a = toAnchors(next)[1];
    expect(a.x).toBeCloseTo(0, 9);
    expect(a.y).toBeCloseTo(100, 9);
    expect(a.inX).toBeCloseTo(20, 9);
    expect(a.inY).toBeCloseTo(70, 9);
  });

  it('keeps untouched contours as the same objects and the fill rule', () => {
    const compound: CompoundGeometry = { kind: 'compound', fillRule: 'nonzero', subpaths: [curve, curve] };
    const next = transformAnchors(compound, [{ sub: 1, index: 0 }], translation(1, 1)) as CompoundGeometry;
    expect(next.subpaths[0]).toBe(curve);
    expect(next.subpaths[1]).not.toBe(curve);
    expect(next.fillRule).toBe('nonzero');
  });
});

describe('scaleFromHandle', () => {
  const box = { x: 0, y: 0, width: 100, height: 50 };

  it('scales about the opposite corner', () => {
    const s = scaleFromHandle(box, 'se', { x: 100, y: 50 }, { x: 150, y: 100 });
    expect(s.origin).toEqual({ x: 0, y: 0 });
    expect(s.sx).toBeCloseTo(1.5);
    expect(s.sy).toBeCloseTo(2);
    expect(apply(s.matrix, { x: 100, y: 50 })).toEqual({ x: 150, y: 100 });
  });

  it('scales one axis from an edge', () => {
    const s = scaleFromHandle(box, 'e', { x: 100, y: 25 }, { x: 50, y: 80 });
    expect(s.sx).toBeCloseTo(0.5);
    expect(s.sy).toBe(1);
  });

  it('keeps proportions with Shift and scales from the centre with Alt', () => {
    const u = scaleFromHandle(box, 'se', { x: 100, y: 50 }, { x: 200, y: 60 }, { uniform: true });
    expect(u.sx).toBeCloseTo(2);
    expect(u.sy).toBeCloseTo(2);
    const c = scaleFromHandle(box, 'e', { x: 100, y: 25 }, { x: 150, y: 25 }, { fromCentre: true });
    expect(c.origin).toEqual({ x: 50, y: 25 });
    expect(c.sx).toBeCloseTo(2);
  });

  it('cannot scale an axis the box has no extent along', () => {
    const flat = { x: 0, y: 10, width: 100, height: 0 };
    const s = scaleFromHandle(flat, 'se', { x: 100, y: 10 }, { x: 150, y: 40 });
    expect(s.sy).toBe(1);
  });
});

describe('rotation and box handles', () => {
  it('measures a drag about the pivot, snapping to 15° with Shift', () => {
    const free = rotationFromDrag({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 });
    expect((free * 180) / Math.PI).toBeCloseTo(45);
    const snapped = rotationFromDrag({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, 15);
    expect((snapped * 180) / Math.PI).toBeCloseTo(15);
  });

  it('finds scale grips on the box and rotation just outside its corners', () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    expect(boxHandleAt(box, { x: 101, y: 99 }, 5, 20)).toEqual({ kind: 'scale', handle: 'se' });
    expect(boxHandleAt(box, { x: 50, y: -2 }, 5, 20)).toEqual({ kind: 'scale', handle: 'n' });
    expect(boxHandleAt(box, { x: 112, y: 112 }, 5, 20)).toEqual({ kind: 'rotate', handle: 'se' });
    expect(boxHandleAt(box, { x: 50, y: 50 }, 5, 20)).toBeNull();
    expect(boxHandleAt(box, { x: 150, y: 150 }, 5, 20)).toBeNull();
  });
});

describe('reboxedPosition', () => {
  it('is a plain offset for an unturned node', () => {
    expect(reboxedPosition({ x: 10, y: 20, width: 100, height: 50 }, { dx: 5, dy: 6, width: 30, height: 20 })).toEqual({ x: 15, y: 26 });
  });

  it('keeps every point of a turned node where it was on screen', () => {
    const node = { x: 40, y: 30, width: 200, height: 100, rotation: 30, scaleX: 1.5, scaleY: 0.8 };
    const inner = { dx: 20, dy: 10, width: 60, height: 40 };
    const at = reboxedPosition(node, inner);
    const world = (n: typeof node, p: { x: number; y: number }) => {
      const [a, b, c, d] = linearOf(n);
      const ox = p.x - n.width / 2;
      const oy = p.y - n.height / 2;
      return { x: n.x + n.width / 2 + a * ox + c * oy, y: n.y + n.height / 2 + b * ox + d * oy };
    };
    const reboxed = { ...node, x: at.x, y: at.y, width: inner.width, height: inner.height };
    // A point at (35, 22) in the old box is (15, 12) in the new one.
    const before = world(node, { x: 35, y: 22 });
    const after = world(reboxed, { x: 15, y: 12 });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});
