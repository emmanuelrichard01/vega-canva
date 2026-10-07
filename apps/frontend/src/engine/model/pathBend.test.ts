import { describe, expect, it } from 'vitest';
import { bendSegment } from './pathBend';
import { cubicAt, toCubics, fromAnchors } from './pathGeometry';
import type { BezierGeometry } from './schema';

const straight: BezierGeometry = fromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0 }], false);

describe('bendSegment', () => {
  it('moves the grabbed point to the pointer', () => {
    const bent = bendSegment(straight, 0, 0.5, { x: 50, y: 40 });
    const p = cubicAt(toCubics(bent)[0], 0.5);
    expect(p.x).toBeCloseTo(50, 5);
    expect(p.y).toBeCloseTo(40, 5);
  });

  it('follows the pointer off-centre too', () => {
    const bent = bendSegment(straight, 0, 0.3, { x: 20, y: -25 });
    const p = cubicAt(toCubics(bent)[0], 0.3);
    expect(p.x).toBeCloseTo(20, 5);
    expect(p.y).toBeCloseTo(-25, 5);
  });

  it('leaves the anchors where they are', () => {
    const bent = bendSegment(straight, 0, 0.5, { x: 50, y: 40 });
    expect(bent.segments[0]).toMatchObject({ x: 0, y: 0 });
    expect(bent.segments[1]).toMatchObject({ x: 100, y: 0 });
  });

  it('is a no-op when the pointer is where the curve already is', () => {
    const bent = bendSegment(straight, 0, 0.5, { x: 50, y: 0 });
    const p = cubicAt(toCubics(bent)[0], 0.25);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('keeps a smooth anchor smooth on the neighbouring curve', () => {
    // Three anchors, the middle one smooth with collinear handles.
    const geo = fromAnchors(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0, inX: 80, inY: 0, outX: 120, outY: 0 },
        { x: 200, y: 0 },
      ],
      false
    );
    const bent = bendSegment(geo, 1, 0.5, { x: 150, y: 50 });
    const cubics = toCubics(bent);
    // The incoming handle of the middle anchor is the second curve's c2 of the
    // first curve; it must stay opposite the outgoing handle.
    const inH = { x: cubics[0].c2x - 100, y: cubics[0].c2y };
    const outH = { x: cubics[1].c1x - 100, y: cubics[1].c1y };
    const cross = inH.x * outH.y - inH.y * outH.x;
    expect(Math.abs(cross)).toBeLessThan(1e-6);
    expect(inH.x * outH.x + inH.y * outH.y).toBeLessThan(0);
  });

  it('bends the closing curve of a closed path', () => {
    const tri = fromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], true);
    const bent = bendSegment(tri, 2, 0.5, { x: 0, y: 60 });
    const p = cubicAt(toCubics(bent)[2], 0.5);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(60, 5);
  });
});
