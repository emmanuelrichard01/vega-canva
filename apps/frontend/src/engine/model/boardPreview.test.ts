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

/**
 * A line's run, not a rule across its box.
 *
 * The cover drew every line as one horizontal stroke from the left of its box
 * to the right. That is wrong twice: a line running corner to corner came out
 * flat, and a line with a **profile** — wavy, zigzag, curved, or the coil —
 * lost the entire thing that makes it that profile. A board of loops had a
 * thumbnail of plain rules, which is a confidently wrong picture rather than a
 * simplified one.
 */
describe('board preview — lines carry the shape they draw', () => {
  const line = (geometry: Record<string, unknown>) =>
    node({
      geometry: { kind: 'line', ...geometry },
      appearance: { stroke: { color: '#B45309', width: 2 } },
    });

  /** The stored polyline as [x, y] pairs. */
  const runOf = (item: { l?: number[] }) => {
    const flat = item.l ?? [];
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
    return pairs;
  };

  it('marks a line as a line rather than a filled box', () => {
    const p = buildPreview([line({})], () => '#B45309')!;
    expect(p.items[0].s).toBe('line');
  });

  it('stores a straight line as its two endpoints', () => {
    const p = buildPreview([line({})], () => '#B45309')!;
    expect(runOf(p.items[0]).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * The defect this exists to hold shut. A coil doubles back on itself, so its
   * run cannot be a function of position — which is exactly what a single
   * horizontal rule is.
   */
  it('stores a coil as a run that actually loops', () => {
    const p = buildPreview([line({ lineProfile: 'coil', lineWaves: 4 })], () => '#B45309')!;
    const run = runOf(p.items[0]);

    expect(run.length).toBeGreaterThan(8);
    // It must double back somewhere, or it is not a loop.
    const backtracks = run.filter(([x], i) => i > 0 && x < run[i - 1][0] - 1e-9).length;
    expect(backtracks).toBeGreaterThan(0);
  });

  it('stores a wavy line as a run that leaves the straight path', () => {
    const p = buildPreview([line({ lineProfile: 'wavy', lineWaves: 5 })], () => '#B45309')!;
    const run = runOf(p.items[0]);
    const ys = run.map(([, y]) => y);
    // A flat rule would have one y value; a wave has a spread.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.01);
  });

  it('draws a straight profile as fewer points than a coil', () => {
    // Storage is the reason the run is sampled down; a plain line must not pay
    // for a feature it is not using.
    const straight = buildPreview([line({})], () => '#B45309')!;
    const coil = buildPreview([line({ lineProfile: 'coil', lineWaves: 6 })], () => '#B45309')!;
    expect(runOf(straight.items[0]).length).toBeLessThan(runOf(coil.items[0]).length);
  });

  it('keeps a stored run within the normalised box', () => {
    // Everything else in a summary is 0..1 against the board's bounds, and the
    // renderer maps it with the same arithmetic. A run outside that draws
    // outside the card.
    const p = buildPreview([line({ lineProfile: 'coil', lineWaves: 3 })], () => '#B45309')!;
    for (const [x, y] of runOf(p.items[0])) {
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(1.5);
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThanOrEqual(1.5);
    }
  });

  it('caps how many points it will store', () => {
    const p = buildPreview([line({ lineProfile: 'coil', lineWaves: 40 })], () => '#B45309')!;
    // Sampled down: a forty-loop coil is several hundred points and this goes
    // into localStorage for every line on every board.
    expect(runOf(p.items[0]).length).toBeLessThanOrEqual(64);
  });
});
