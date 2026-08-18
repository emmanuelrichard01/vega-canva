import { describe, it, expect } from 'vitest';
import { buildPreview, previewPolygonPoints } from './boardPreview';
import type { AnyNode } from './schema';

const node = (over: Record<string, unknown>): AnyNode => ({
  id: 'n', type: 'shape', x: 0, y: 0, width: 200, height: 200,
  rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0, hidden: false,
  appearance: { fill: [{ type: 'solid', color: '#F3A024' }] },
  ...over,
} as unknown as AnyNode);

/**
 * The cover drew anything it did not recognise as a filled rectangle, so a
 * board holding one star had a thumbnail that was a solid block of the star's
 * colour — a picture of nothing. The summary has to carry enough for the
 * renderer to draw the actual silhouette.
 */
describe('board preview — shapes that are not boxes', () => {
  it('carries a star with its point count and waist', () => {
    const p = buildPreview([node({ geometry: { kind: 'star', points: 5, innerRatio: 0.45 } })], () => '#F3A024')!;
    expect(p.items[0].s).toBe('star');
    expect(p.items[0].p).toBe(5);
    expect(p.items[0].ir).toBe(0.45);
  });

  it('carries a polygon with its side count', () => {
    const p = buildPreview([node({ geometry: { kind: 'polygon', points: 6 } })], () => '#000')!;
    expect(p.items[0].s).toBe('polygon');
    expect(p.items[0].p).toBe(6);
  });

  it('marks an open shape so it is stroked rather than filled', () => {
    // A line drawn as a filled box becomes the one thing it can never be.
    for (const kind of ['line', 'arrow']) {
      const p = buildPreview([node({ geometry: { kind } })], () => '#000')!;
      expect(p.items[0].s).toBe('line');
    }
  });

  it('leaves a rectangle and an ellipse alone', () => {
    const rect = buildPreview([node({ geometry: { kind: 'rect' } })], () => '#000')!;
    expect(rect.items[0].s).toBeUndefined();
    const ell = buildPreview([node({ geometry: { kind: 'ellipse' } })], () => '#000')!;
    expect(ell.items[0].o).toBe(1);
    expect(ell.items[0].s).toBeUndefined();
  });
});

describe('previewPolygonPoints', () => {
  /**
   * The bug this exists for: every shape that was not an ellipse, a route, a
   * text node or a frame fell through to a filled rectangle, so a board
   * holding one star had a thumbnail that was a solid block. The renderer is
   * JSX and nobody looks at a thumbnail before shipping, so the arithmetic
   * lives in this module where it can simply be asserted.
   */
  it('gives a five-pointed star ten vertices, alternating between two radii', () => {
    const pts = previewPolygonPoints({ s: 'star', p: 5, ir: 0.4 }, 0, 0, 100, 100);
    expect(pts).toHaveLength(10);

    const radius = ([x, y]: [number, number]) => Math.hypot(x - 50, y - 50);
    // Outer vertices reach the box; inner ones sit at the stored ratio.
    expect(radius(pts[0])).toBeCloseTo(50, 4);
    expect(radius(pts[1])).toBeCloseTo(20, 4);
    expect(radius(pts[2])).toBeCloseTo(50, 4);

    // Not a block: a five-pointed star's silhouette is nothing like its box.
    const corner = pts.some(([x, y]) => x < 1 && y < 1);
    expect(corner).toBe(false);
  });

  it('starts at twelve o\u2019clock, where the shape tool draws it', () => {
    const [first] = previewPolygonPoints({ s: 'polygon', p: 3 }, 0, 0, 100, 100);
    expect(first[0]).toBeCloseTo(50, 4);
    expect(first[1]).toBeCloseTo(0, 4);
  });

  it('gives a polygon one vertex per side and no inner radius', () => {
    const pts = previewPolygonPoints({ s: 'polygon', p: 6, ir: 0.2 }, 0, 0, 80, 80);
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(Math.hypot(p[0] - 40, p[1] - 40)).toBeCloseTo(40, 4);
  });

  it('follows a non-square box rather than forcing a circle', () => {
    const pts = previewPolygonPoints({ s: 'polygon', p: 4 }, 0, 0, 100, 20);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 4);
  });

  it('survives a shape with too few sides or a nonsense inner ratio', () => {
    expect(previewPolygonPoints({ s: 'polygon', p: 1 }, 0, 0, 10, 10)).toHaveLength(3);
    const pts = previewPolygonPoints({ s: 'star', p: 5, ir: 0 }, 0, 0, 100, 100);
    // Clamped away from zero, so the star has an interior rather than collapsing.
    expect(Math.hypot(pts[1][0] - 50, pts[1][1] - 50)).toBeGreaterThan(0);
  });
});
