import { describe, expect, it } from 'vitest';
import { alignmentSnap, snapToObjects, spacingSnap, type Box } from './smartGuides';

const box = (x: number, y: number, width = 100, height = 100): Box => ({ x, y, width, height });

describe('alignmentSnap', () => {
  it('does nothing without candidates or tolerance', () => {
    expect(alignmentSnap(box(0, 0), [], 8)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(alignmentSnap(box(0, 0), [box(3, 0)], 0)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('pulls a near-miss left edge onto the one it nearly matched', () => {
    const result = alignmentSnap(box(203, 500), [box(200, 0)], 8);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(0);
  });

  it('leaves a miss outside the tolerance alone', () => {
    expect(alignmentSnap(box(220, 500), [box(200, 0)], 8).dx).toBe(0);
  });

  it('decides each axis independently', () => {
    // The ordinary case when placing something into a layout: lined up with
    // one thing across and a different thing down.
    const result = alignmentSnap(box(202, 401), [box(200, 0), box(900, 400)], 8);
    expect(result.dx).toBe(-2);
    expect(result.dy).toBe(-1);
  });

  it('snaps to the nearest candidate, not the first in the list', () => {
    // Array order is document order. Taking the first match snaps to whatever
    // happens to be earliest in the document rather than to what you are next
    // to on screen.
    const result = alignmentSnap(box(105, 0), [box(100, 0), box(106, 0)]  , 8);
    expect(result.dx).toBe(1);
  });

  it('matches centres, not only edges', () => {
    // Deliberately a case where *only* the centres are within reach: moving
    // spans 200..300 (centre 250), candidate spans 148..348 (centre 248). No
    // pair of edges is anywhere near.
    const result = alignmentSnap(box(200, 0, 100), [box(148, 400, 200)], 8);
    expect(result.dx).toBe(-2);
    expect(result.guides.some((g) => g.kind === 'centre')).toBe(true);
  });

  it('matches a right edge against a left edge', () => {
    // Butting one object against another is alignment too.
    const result = alignmentSnap(box(198, 0, 100), [box(300, 0)], 8);
    expect(result.dx).toBe(2);
  });

  it('draws a guide spanning both objects, not the whole screen', () => {
    // The line is the explanation for the jump; it has to be visibly about
    // these two things.
    const result = alignmentSnap(box(203, 900, 100, 50), [box(200, 100, 100, 50)], 8);
    const guide = result.guides.find((g) => g.orientation === 'vertical')!;
    expect(guide.position).toBe(200);
    expect(guide.from).toBe(100);
    expect(guide.to).toBe(950);
  });

  it('keeps every candidate tied at the same position', () => {
    // Lining up with three things at once is exactly when the feedback
    // matters most; showing one guide would hide it.
    const result = alignmentSnap(box(203, 0, 100, 10), [box(200, 100, 100, 10), box(200, 800, 100, 10)], 8);
    const guide = result.guides.find((g) => g.orientation === 'vertical')!;
    expect(guide.from).toBe(0);
    expect(guide.to).toBe(810);
  });

  it('reports the guide at the candidate position, not the pre-snap one', () => {
    const result = alignmentSnap(box(195, 0), [box(200, 0)], 8);
    expect(result.guides.find((g) => g.orientation === 'vertical')!.position).toBe(200);
  });
});

describe('spacingSnap', () => {
  it('needs something on both sides', () => {
    expect(spacingSnap(box(300, 0), [box(0, 0)], 20)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(spacingSnap(box(300, 0), [], 20)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('centres the gap between two neighbours', () => {
    // before: 0..100, after: 500..600, moving is 100 wide.
    // Free space 300, so an even gap is 150 and the target x is 250.
    const result = spacingSnap(box(240, 0), [box(0, 0), box(500, 0)], 20);
    expect(result.dx).toBe(10);
  });

  it('leaves it alone when the correction is too large to be intended', () => {
    expect(spacingSnap(box(120, 0), [box(0, 0), box(500, 0)], 20).dx).toBe(0);
  });

  it('ignores objects on a different row', () => {
    // Two objects nowhere near the moving one have no meaningful horizontal
    // gap with it, and including them turns this into noise.
    expect(spacingSnap(box(240, 0), [box(0, 900), box(500, 900)], 20).dx).toBe(0);
  });

  it('refuses when the object does not fit between them', () => {
    expect(spacingSnap(box(105, 0), [box(0, 0), box(150, 0)], 40).dx).toBe(0);
  });

  it('marks both gaps, so the two distances can be compared', () => {
    const result = spacingSnap(box(240, 0), [box(0, 0), box(500, 0)], 20);
    const spacing = result.guides.filter((g) => g.kind === 'spacing');
    expect(spacing).toHaveLength(2);
    expect(spacing[0].gap).toBe(150);
    expect(spacing[0].to - spacing[0].from).toBe(150);
    expect(spacing[1].to - spacing[1].from).toBe(150);
  });
});

describe('snapToObjects', () => {
  it('prefers alignment over spacing on the same axis', () => {
    // Both are available: the object could line up with the left neighbour's
    // top edge, or sit evenly between the two. Lining up is the stronger
    // statement and the one people expect.
    const candidates = [box(0, 0), box(500, 0)];
    const result = snapToObjects(box(240, 3), candidates, 20);
    expect(result.dy).toBe(-3);
    // The vertical correction came from alignment, so no spacing guide should
    // be marking a vertical gap. A spacing guide for a *horizontal* gap is
    // drawn horizontally, which is why this checks the gap's own extent rather
    // than the line's orientation — the two are deliberately different words.
    const verticalGaps = result.guides.filter((g) => g.kind === 'spacing' && g.orientation === 'vertical');
    expect(verticalGaps).toHaveLength(0);
  });

  it('falls back to spacing on an axis with no alignment', () => {
    const result = snapToObjects(box(240, 0), [box(0, 0), box(500, 0)], 20);
    expect(result.dx).toBe(10);
    expect(result.guides.some((g) => g.kind === 'spacing')).toBe(true);
  });

  it('returns nothing when nothing is close', () => {
    expect(snapToObjects(box(5000, 5000), [box(0, 0), box(500, 0)], 8)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
  });
});
