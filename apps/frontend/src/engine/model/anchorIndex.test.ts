import { describe, expect, it } from 'vitest';
import {
  allAnchors,
  anchorIndexOf,
  anchorsInBox,
  boundsOfAnchors,
  contourMates,
  handleBearers,
  nearestAnchor,
} from './anchorIndex';
import { anchorsInRect, anchorNear } from './pathEditing';
import type { BezierGeometry, CompoundGeometry } from './schema';

/** A grid of small closed squares: `cols × rows` contours of four anchors each. */
function glyphField(cols: number, rows: number, pitch = 10): CompoundGeometry {
  const subpaths: BezierGeometry[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * pitch;
      const y = r * pitch;
      subpaths.push({
        kind: 'bezier',
        closed: true,
        segments: [
          { x, y },
          { x: x + 4, y, cp1x: x + 1, cp1y: y - 1, cp2x: x + 3, cp2y: y - 1 },
          { x: x + 4, y: y + 4 },
          { x, y: y + 4 },
        ],
      });
    }
  }
  return { kind: 'compound', subpaths, fillRule: 'nonzero' };
}

describe('anchorIndex', () => {
  const geo = glyphField(25, 20); // 500 contours, 2,000 anchors

  it('flattens every anchor in drawing order', () => {
    const index = anchorIndexOf(geo);
    expect(index.count).toBe(2000);
    expect(allAnchors(index)[5]).toEqual({ sub: 1, index: 1 });
  });

  it('is cached per geometry object', () => {
    expect(anchorIndexOf(geo)).toBe(anchorIndexOf(geo));
  });

  it('picks the nearest anchor within the radius, and nothing outside it', () => {
    const index = anchorIndexOf(geo);
    expect(nearestAnchor(index, { x: 14.6, y: 0.4 }, 2)).toEqual({ sub: 1, index: 1 });
    expect(nearestAnchor(index, { x: 7, y: 7 }, 1)).toBeNull();
  });

  it('agrees with a brute-force scan everywhere', () => {
    const index = anchorIndexOf(geo);
    for (let k = 0; k < 200; k++) {
      const p = { x: (k * 37) % 250, y: (k * 53) % 200 };
      const hit = nearestAnchor(index, p, 3);
      let best: number | null = null;
      for (let i = 0; i < index.count; i++) {
        const d = Math.hypot(index.xs[i] - p.x, index.ys[i] - p.y);
        if (d <= 3 && (best === null || d < best)) best = d;
      }
      if (best === null) expect(hit).toBeNull();
      else {
        expect(hit).not.toBeNull();
        const i = index.offsets[hit!.sub] + hit!.index;
        expect(Math.hypot(index.xs[i] - p.x, index.ys[i] - p.y)).toBeCloseTo(best, 9);
      }
    }
  });

  it('marquees points through the grid, matching the linear rule', () => {
    const index = anchorIndexOf(geo);
    const box = { x: 9, y: -1, width: 12, height: 6 };
    const found = anchorsInBox(index, box);
    // All four anchors of contour 1, and the left two of contour 2.
    expect(found).toHaveLength(6);
    expect(found[0]).toEqual({ sub: 1, index: 0 });
    // A box drawn right-to-left means the same thing.
    expect(anchorsInBox(index, { x: 21, y: 5, width: -12, height: -6 })).toEqual(found);
    expect(anchorsInRect(geo, box)).toEqual(found);
  });

  it('shows handles for picked anchors and their neighbours only', () => {
    const index = anchorIndexOf(geo);
    const bearers = handleBearers(index, [{ sub: 0, index: 0 }]);
    // Anchor 0 of a closed contour: itself, the next and the last.
    expect([...bearers].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });

  it('selects whole contours and measures picked points', () => {
    const index = anchorIndexOf(geo);
    expect(contourMates(index, [{ sub: 3, index: 2 }])).toHaveLength(4);
    expect(boundsOfAnchors(index, contourMates(index, [{ sub: 0, index: 0 }]))).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it('stays under a millisecond per pick at 2,000 anchors', () => {
    const fresh = glyphField(25, 20);
    const t0 = performance.now();
    const index = anchorIndexOf(fresh);
    const build = performance.now() - t0;
    const t1 = performance.now();
    const picks = 1000;
    for (let k = 0; k < picks; k++) anchorNear(fresh, { x: (k * 7) % 250, y: (k * 11) % 200 }, 4);
    const perPick = (performance.now() - t1) / picks;
    expect(index.count).toBe(2000);
    expect(perPick).toBeLessThan(1);
    // Building is once per edit, not per frame; generous for a cold JIT.
    expect(build).toBeLessThan(50);
  });
});
