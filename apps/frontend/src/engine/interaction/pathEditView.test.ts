import { describe, expect, it } from 'vitest';
import { HANDLE_CAP, anchorDrawPlan, hitPathEditor, viewOf } from './pathEditView';
import { allAnchors, anchorIndexOf } from '../model/anchorIndex';
import type { BezierGeometry, CompoundGeometry } from '../model/schema';

const square: BezierGeometry = {
  kind: 'bezier',
  closed: true,
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 0, cp1x: 30, cp1y: -30, cp2x: 70, cp2y: -30 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
};

function field(n: number): CompoundGeometry {
  const subpaths: BezierGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % 50) * 8;
    const y = Math.floor(i / 50) * 8;
    subpaths.push({
      kind: 'bezier',
      closed: true,
      segments: [
        { x, y },
        { x: x + 3, y, cp1x: x + 1, cp1y: y - 1, cp2x: x + 2, cp2y: y - 1 },
        { x: x + 3, y: y + 3 },
        { x, y: y + 3 },
      ],
    });
  }
  return { kind: 'compound', subpaths };
}

describe('viewOf', () => {
  it('shows handles for a few picked anchors and none past the cap', () => {
    const few = viewOf(square, [{ sub: 0, index: 1 }]);
    expect(few.bearers.size).toBe(3);
    const geo = field(20);
    const many = viewOf(geo, allAnchors(anchorIndexOf(geo)).slice(0, HANDLE_CAP + 1));
    expect(many.bearers.size).toBe(0);
  });

  it('draws a box only around two or more points with extent', () => {
    expect(viewOf(square, [{ sub: 0, index: 0 }]).box).toBeNull();
    expect(viewOf(square, [{ sub: 0, index: 0 }, { sub: 0, index: 2 }]).box).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('hitPathEditor', () => {
  it('prefers a shown handle, then an anchor, then the outline', () => {
    const view = viewOf(square, [{ sub: 0, index: 1 }]);
    expect(hitPathEditor(view, { x: 71, y: -29 }, 1)).toEqual({ kind: 'handle', ref: { sub: 0, index: 1 }, side: 'in' });
    expect(hitPathEditor(view, { x: 99, y: 1 }, 1)).toEqual({ kind: 'anchor', ref: { sub: 0, index: 1 } });
    expect(hitPathEditor(view, { x: 100, y: 50 }, 1)).toMatchObject({ kind: 'segment', sub: 0, curve: 1 });
    expect(hitPathEditor(view, { x: 50, y: 50 }, 1)).toEqual({ kind: 'none' });
  });

  it('gives the box its grips, rotation zone and body', () => {
    const view = viewOf(square, [
      { sub: 0, index: 0 },
      { sub: 0, index: 2 },
    ]);
    // The box is drawn 8px outside the points, so its corner is at (108, 108).
    expect(hitPathEditor(view, { x: 108, y: 108 }, 1)).toEqual({ kind: 'scale', handle: 'se' });
    expect(hitPathEditor(view, { x: 120, y: 120 }, 1)).toEqual({ kind: 'rotate', handle: 'se' });
    expect(hitPathEditor(view, { x: 50, y: 50 }, 1)).toEqual({ kind: 'body' });
  });

  it('answers in well under a millisecond on 2,000 anchors', () => {
    const geo = field(500);
    const view = viewOf(geo, allAnchors(anchorIndexOf(geo)));
    expect(view.index.count).toBe(2000);
    const t0 = performance.now();
    for (let k = 0; k < 500; k++) hitPathEditor(view, { x: (k * 13) % 400, y: (k * 7) % 80 }, 0.5, { segments: false });
    expect((performance.now() - t0) / 500).toBeLessThan(1);
  });
});

describe('anchorDrawPlan', () => {
  it('draws one anchor per crowded screen cell and reports density', () => {
    const geo = field(500);
    const view = viewOf(geo, []);
    const n = view.index.count;
    // Zoomed far out: everything within a few pixels.
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sx[i] = view.index.xs[i] * 0.05;
      sy[i] = view.index.ys[i] * 0.05;
    }
    const plan = anchorDrawPlan(view, sx, sy);
    expect(plan.drawn).toBeLessThan(n / 4);
    expect(plan.dense).toBe(true);
    // At 400% every anchor has a cell of its own.
    const zoomed = (a: Float64Array) => a.map((v) => v * 4);
    const full = anchorDrawPlan(view, zoomed(view.index.xs), zoomed(view.index.ys));
    expect(full.drawn).toBe(n);
    expect(full.dense).toBe(false);
  });
});
