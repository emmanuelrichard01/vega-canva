import { describe, expect, it } from 'vitest';
import { shapeToPath } from './shapeToPath';
import { roughShape } from './roughShape';
import type { BezierGeometry } from './schema';

/**
 * Per-corner radii reach the real outline.
 *
 * `shapeOutline` collapses the four to their largest, because it describes a
 * shape as a *kind* and its vocabulary has one number in it. That is right for
 * the clips and hit regions it feeds and wrong for `shapeToPath`, which is the
 * function that produces the outline everything else is built from — flatten,
 * the booleans, and the **sketch**, which flattens this path to draw a
 * hand-drawn box.
 *
 * The symptom was that setting one corner of a sketched rectangle rounded all
 * four, and setting three of them to zero did nothing at all.
 */

const rect = (cornerRadius?: number | [number, number, number, number], extra = {}) => ({
  id: 'r1',
  geometry: { kind: 'rect' as const },
  width: 200,
  height: 100,
  appearance: { cornerRadius, ...extra },
});

const asBezier = (node: Parameters<typeof shapeToPath>[0]): BezierGeometry => {
  const geo = shapeToPath(node);
  if (geo.kind === 'compound') throw new Error('expected single contour');
  return geo;
};

/** Every anchor that sits exactly on a named corner, i.e. a *square* one. */
const squareCorners = (geo: BezierGeometry, w: number, h: number) => {
  const at = (x: number, y: number) =>
    geo.segments.some((s) => Math.abs(s.x - x) < 0.001 && Math.abs(s.y - y) < 0.001);
  return { tl: at(0, 0), tr: at(w, 0), br: at(w, h), bl: at(0, h) };
};

describe('a rectangle keeps the corners it was given', () => {
  it('is four anchors when every corner is square', () => {
    const geo = asBezier(rect(0));
    expect(geo.segments).toHaveLength(4);
    expect(squareCorners(geo, 200, 100)).toEqual({ tl: true, tr: true, br: true, bl: true });
  });

  it('is eight anchors when every corner is round', () => {
    // Two per corner: where the straight edge stops, and where the next starts.
    expect(asBezier(rect(12)).segments).toHaveLength(8);
  });

  it('rounds only the corner it was asked to', () => {
    /**
     * The bug, stated as a test. `[30, 0, 0, 0]` came through `shapeOutline`
     * as `max(30,0,0,0)` — a rectangle with four 30-unit corners.
     */
    const geo = asBezier(rect([30, 0, 0, 0]));
    const corners = squareCorners(geo, 200, 100);
    expect(corners.tl).toBe(false);
    expect(corners.tr).toBe(true);
    expect(corners.br).toBe(true);
    expect(corners.bl).toBe(true);
  });

  it('keeps a square corner as one anchor, not two coincident ones', () => {
    // Emitting the pair would put two anchors and two zero-length handles at
    // the same point: a degenerate curve that renders as a corner and edits as
    // a trap in the path editor.
    const geo = asBezier(rect([30, 0, 0, 0]));
    expect(geo.segments).toHaveLength(5);
  });

  it('rounds each corner by its own amount', () => {
    const geo = asBezier(rect([10, 20, 30, 40]));
    // Where each arc leaves the top edge says what that corner's radius was.
    const onTopEdge = geo.segments
      .filter((s) => Math.abs(s.y) < 0.001)
      .map((s) => s.x)
      .sort((a, b) => a - b);
    expect(onTopEdge[0]).toBeCloseTo(10, 6); // top-left
    expect(onTopEdge[1]).toBeCloseTo(180, 6); // top-right, 200 - 20
  });

  it('fits a pair against the edge they share rather than capping each alone', () => {
    /**
     * `min(r, w/2, h/2)` is right for a uniform radius and too strict once the
     * four differ: what competes is a pair sharing an edge. Capping each corner
     * independently gives a shape whose corners are individually legal and
     * whose edges have negative length.
     */
    const geo = asBezier(rect([40, 0, 0, 0], {}));
    const onTop = geo.segments.filter((s) => Math.abs(s.y) < 0.001).map((s) => s.x);
    // 40 fits on a 200-wide top edge whose other corner is square.
    expect(Math.min(...onTop)).toBeCloseTo(40, 6);
  });

  it('closes', () => {
    expect(asBezier(rect([10, 0, 10, 0])).closed).toBe(true);
  });
});

describe('the sketch draws what the corners say', () => {
  const sketched = (cornerRadius?: number | [number, number, number, number]) =>
    ({
      id: 'sk',
      geometry: { kind: 'rect' },
      width: 200,
      height: 100,
      appearance: { sketch: 'medium' as const, cornerRadius },
    }) as unknown as Parameters<typeof roughShape>[0];

  it('draws one rounded corner differently from four', () => {
    // The visible half of the bug: a sketched rectangle flattens `shapeToPath`
    // to draw its hand-drawn outline, so a collapsed radius rounded all four.
    const one = roughShape(sketched([30, 0, 0, 0]), false).outline;
    const all = roughShape(sketched(30), false).outline;
    expect(one).not.toBe(all);
    expect(one.length).toBeGreaterThan(0);
  });

  it('draws a square-cornered box differently again', () => {
    expect(roughShape(sketched([30, 0, 0, 0]), false).outline).not.toBe(
      roughShape(sketched(0), false).outline,
    );
  });

  it('is still stable for a given set of corners', () => {
    // Per-corner radii must not cost the seeded stability the sketch depends on.
    expect(roughShape(sketched([30, 4, 12, 0]), false).outline).toBe(
      roughShape(sketched([30, 4, 12, 0]), false).outline,
    );
  });
});
