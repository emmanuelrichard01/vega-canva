import { describe, expect, it } from 'vitest';
import { computeContentBounds, frameExportBounds, EXPORT_PADDING } from './bounds';
import { normalizeNode } from '../document/normalize';
import type { AnyNode } from '../model/schema';

/**
 * What an export frames to.
 *
 * These bounds decide what ends up in the file, so an under-reported box is not
 * a cosmetic problem — it is an object the user can see on the board and cannot
 * find in the PNG. The case that was actually wrong is the rotated one: this
 * module carried its own bounds loop that read position and scale and ignored
 * rotation and skew, while the spatial index used a version that handled all
 * three.
 */

function node(partial: Record<string, unknown>): AnyNode {
  return normalizeNode({ type: 'shape', ...partial });
}

/** Objects keyed by id, the shape `computeContentBounds` reads. */
function docOf(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

describe('computeContentBounds', () => {
  it('wraps a single node with the standard padding', () => {
    const objects = docOf(node({ id: 'a', x: 100, y: 200, width: 50, height: 40 }));
    expect(computeContentBounds(objects)).toEqual({
      x: 100 - EXPORT_PADDING,
      y: 200 - EXPORT_PADDING,
      width: 50 + EXPORT_PADDING * 2,
      height: 40 + EXPORT_PADDING * 2,
    });
  });

  it('takes zero padding literally rather than falling back to the default', () => {
    const objects = docOf(node({ id: 'a', x: 0, y: 0, width: 100, height: 100 }));
    expect(computeContentBounds(objects, undefined, 0)).toEqual({
      x: 0, y: 0, width: 100, height: 100,
    });
  });

  it('spans every node in the document', () => {
    const objects = docOf(
      node({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
      node({ id: 'b', x: 500, y: 300, width: 100, height: 100 })
    );
    const b = computeContentBounds(objects, undefined, 0);
    expect(b).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });

  /**
   * The defect this file exists to hold shut.
   *
   * A 100×20 bar rotated 90° about its centre occupies a 20×100 box. Measuring
   * the unrotated rectangle instead reports 100×20, so the ends of the bar —
   * the parts that stick out furthest once it is turned — are outside the box
   * the exporter crops to, and they are missing from the file.
   */
  it('grows the box to contain a rotated node', () => {
    const objects = docOf(node({ id: 'a', x: 0, y: 0, width: 100, height: 20, rotation: 90 }));
    const b = computeContentBounds(objects, undefined, 0);
    expect(b.width).toBeCloseTo(20, 6);
    expect(b.height).toBeCloseTo(100, 6);
    // Rotation is about the centre, so the centre must not move.
    expect(b.x + b.width / 2).toBeCloseTo(50, 6);
    expect(b.y + b.height / 2).toBeCloseTo(10, 6);
  });

  it('grows the box to contain a sheared node', () => {
    const upright = computeContentBounds(
      docOf(node({ id: 'a', x: 0, y: 0, width: 100, height: 100 })),
      undefined,
      0
    );
    const sheared = computeContentBounds(
      docOf(node({ id: 'a', x: 0, y: 0, width: 100, height: 100, skewX: 30 })),
      undefined,
      0
    );
    expect(sheared.width).toBeGreaterThan(upright.width);
  });

  it('accounts for scale', () => {
    const objects = docOf(node({ id: 'a', x: 0, y: 0, width: 100, height: 50, scaleX: 2, scaleY: 3 }));
    const b = computeContentBounds(objects, undefined, 0);
    expect(b.width).toBe(200);
    expect(b.height).toBe(150);
  });

  it('treats a flip as extent, not as a negative box', () => {
    // `scaleX: -1` mirrors in place. A signed width would produce a box with a
    // negative dimension, which every downstream consumer reads as empty.
    const objects = docOf(node({ id: 'a', x: 0, y: 0, width: 100, height: 50, scaleX: -1 }));
    const b = computeContentBounds(objects, undefined, 0);
    expect(b.width).toBe(100);
    expect(b.height).toBe(50);
  });

  it('leaves hidden objects out of the frame', () => {
    const objects = docOf(
      node({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
      node({ id: 'ghost', x: 5000, y: 5000, width: 100, height: 100, hidden: true })
    );
    const b = computeContentBounds(objects, undefined, 0);
    expect(b.width).toBe(100);
  });

  it('measures only the named subset when given ids', () => {
    const objects = docOf(
      node({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
      node({ id: 'b', x: 900, y: 0, width: 100, height: 100 })
    );
    expect(computeContentBounds(objects, ['a'], 0).width).toBe(100);
  });

  it('ignores ids that are not in the document', () => {
    const objects = docOf(node({ id: 'a', x: 0, y: 0, width: 100, height: 100 }));
    expect(computeContentBounds(objects, ['a', 'gone'], 0).width).toBe(100);
  });

  it('falls back to a usable box for an empty document', () => {
    // Zero-sized bounds would make the canvas allocation fail and the export
    // come back blank, which is a worse answer than a small empty image.
    expect(computeContentBounds({}, undefined, 0)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('falls back when every object is hidden', () => {
    const objects = docOf(node({ id: 'a', x: 0, y: 0, width: 10, height: 10, hidden: true }));
    const b = computeContentBounds(objects, undefined, 0);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });

  it('never returns a degenerate box for a zero-sized node', () => {
    const objects = docOf(node({ id: 'a', x: 10, y: 10, width: 0, height: 0 }));
    const b = computeContentBounds(objects, undefined, 0);
    expect(b.width).toBeGreaterThanOrEqual(1);
    expect(b.height).toBeGreaterThanOrEqual(1);
  });
});

describe('frameExportBounds', () => {
  /**
   * A frame declares a size and that size is the point of it. Measuring its
   * contents instead would make a "1080 × 1080" frame export at some other
   * size every time something inside it moved.
   */
  it('is the frame rectangle exactly, with no padding', () => {
    expect(frameExportBounds({ x: 40, y: 60, width: 1080, height: 1080 })).toEqual({
      x: 40, y: 60, width: 1080, height: 1080,
    });
  });

  it('never returns a zero dimension', () => {
    const b = frameExportBounds({ x: 0, y: 0, width: 0, height: 0 });
    expect(b.width).toBeGreaterThanOrEqual(1);
    expect(b.height).toBeGreaterThanOrEqual(1);
  });
});
