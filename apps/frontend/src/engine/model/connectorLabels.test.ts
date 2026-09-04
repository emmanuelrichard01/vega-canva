import { describe, expect, it } from 'vitest';
import {
  estimateLabelSize,
  placeConnectorLabels,
  pointAlong,
  type LabelRequest,
} from './connectorLabels';

/** A horizontal run from (0, y) to (200, y). */
const runAt = (y: number): number[] => [0, y, 200, y];

describe('walking a route', () => {
  it('finds the midpoint of a straight run', () => {
    expect(pointAlong([0, 0, 100, 0], 0.5)).toEqual({ x: 50, y: 0 });
  });

  it('measures by length, not by vertex', () => {
    /**
     * The reason this is arc length. An orthogonal route's segments are wildly
     * uneven — a two-unit stub off a box's edge is one vertex step and a
     * fraction of the run — so stepping by index would cluster every label
     * near whichever end had the most elbows.
     */
    const lopsided = [0, 0, 2, 0, 102, 0];
    expect(pointAlong(lopsided, 0.5)).toEqual({ x: 51, y: 0 });
  });

  it('turns the corner of an L', () => {
    // 100 across then 100 down; halfway is exactly the corner.
    expect(pointAlong([0, 0, 100, 0, 100, 100], 0.5)).toEqual({ x: 100, y: 0 });
  });

  it('clamps outside the run rather than extrapolating', () => {
    expect(pointAlong([0, 0, 100, 0], -1)).toEqual({ x: 0, y: 0 });
    expect(pointAlong([0, 0, 100, 0], 2)).toEqual({ x: 100, y: 0 });
  });

  it('survives a route with no length', () => {
    // Both ends on the same point: a connector between two objects that are
    // stacked. There is nothing to divide by.
    expect(pointAlong([5, 5, 5, 5], 0.5)).toEqual({ x: 5, y: 5 });
    expect(pointAlong([], 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe('sizing a plate', () => {
  it('grows with the word', () => {
    expect(estimateLabelSize('retry').w).toBeGreaterThan(estimateLabelSize('no').w);
  });

  it('never collapses on an empty label', () => {
    expect(estimateLabelSize('').w).toBeGreaterThan(0);
  });
});

describe('placing one label', () => {
  it('puts it in the middle of its run when nothing is in the way', () => {
    const placed = placeConnectorLabels([{ id: 'a', text: 'yes', points: runAt(0) }]);
    expect(placed.get('a')).toMatchObject({ x: 100, y: 0, slot: 0 });
  });

  it('ignores a run with no geometry', () => {
    expect(placeConnectorLabels([{ id: 'a', text: 'yes', points: [1, 2] }]).size).toBe(0);
  });
});

describe('placing labels that would collide', () => {
  /** Two runs stacked close enough that mid-run plates would overlap. */
  const crowded: LabelRequest[] = [
    { id: 'a', text: 'approved', points: runAt(0) },
    { id: 'b', text: 'rejected', points: runAt(6) },
  ];

  it('moves the second one out of the first one\'s way', () => {
    const placed = placeConnectorLabels(crowded);
    const a = placed.get('a')!;
    const b = placed.get('b')!;
    // Top-left anchored, because that is where Konva's Label hangs from.
    const ra = { ...a, ...estimateLabelSize('approved') };
    const rb = { ...b, ...estimateLabelSize('rejected') };
    const hit = ra.x < rb.x + rb.w && rb.x < ra.x + ra.w && ra.y < rb.y + rb.h && rb.y < ra.y + ra.h;
    expect(hit, 'the two plates still overlap').toBe(false);
  });

  it('leaves the first one where it wanted to be', () => {
    // Only the loser moves. Shifting both would make an ordinary two-arrow
    // diagram look arranged-around-a-problem when one label was enough.
    expect(placeConnectorLabels(crowded).get('a')!.slot).toBe(0);
  });

  it('separates a fan of arrows leaving one decision', () => {
    /**
     * The case that motivated this. Three arrows out of one node all put their
     * word at the same fraction of runs that start together, so all three
     * plates landed in the same few pixels.
     */
    const fan: LabelRequest[] = [
      { id: 'a', text: 'yes', points: [0, 0, 100, 0] },
      { id: 'b', text: 'no', points: [0, 0, 100, 4] },
      { id: 'c', text: 'maybe', points: [0, 0, 100, 8] },
    ];
    const placed = placeConnectorLabels(fan);
    const rects = fan.map((f) => {
      const p = placed.get(f.id)!;
      const s = estimateLabelSize(f.text);
      return { x: p.x, y: p.y, w: s.w, h: s.h };
    });
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(hit, `${fan[i].id} overlaps ${fan[j].id}`).toBe(false);
      }
    }
  });

  it('always answers for every label, even with nowhere to go', () => {
    // Ten labels on the same short run cannot all be separated. Every one
    // still gets a position: a word in a poor place beats a missing word.
    const piled = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      text: 'overlapping',
      points: [0, 0, 20, 0],
    }));
    const placed = placeConnectorLabels(piled);
    expect(placed.size).toBe(10);
    for (const p of placed.values()) expect(Number.isFinite(p.x)).toBe(true);
  });
});

describe('the arrangement is a function of the diagram, not of its history', () => {
  it('does not depend on the order the connectors arrive in', () => {
    /**
     * Placement runs on every render. If it depended on document order, a
     * label would jump when an unrelated object was added, and dragging one
     * box would rearrange words on arrows that had not moved.
     */
    const items: LabelRequest[] = [
      { id: 'a', text: 'approved', points: runAt(0) },
      { id: 'b', text: 'rejected', points: runAt(6) },
      { id: 'c', text: 'held', points: runAt(12) },
    ];
    const forward = placeConnectorLabels(items);
    const backward = placeConnectorLabels([...items].reverse());
    for (const { id } of items) {
      expect(backward.get(id)).toEqual(forward.get(id));
    }
  });

  it('gives the same answer twice', () => {
    const items: LabelRequest[] = [
      { id: 'a', text: 'one', points: runAt(0) },
      { id: 'b', text: 'two', points: runAt(5) },
    ];
    expect(placeConnectorLabels(items)).toEqual(placeConnectorLabels(items));
  });
});
