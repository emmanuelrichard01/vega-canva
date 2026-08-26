import { describe, expect, it } from 'vitest';
import {
  addVertex,
  beginSession,
  commitPoints,
  endsRun,
  nextVertex,
  previewPoints,
  undoVertex,
} from './polylineSession';

const at = (x: number, y: number) => ({ x, y });

/** A session that has had these points placed, in order. */
const run = (...points: Array<[number, number]>) =>
  points
    .slice(1)
    .reduce((session, [x, y]) => addVertex(session, at(x, y)), beginSession(at(points[0][0], points[0][1])));

describe('placing vertices', () => {
  it('starts with the point that was clicked', () => {
    expect(beginSession(at(10, 20)).points).toEqual([at(10, 20)]);
  });

  it('adds without mutating what it was given', () => {
    const first = beginSession(at(0, 0));
    const second = addVertex(first, at(10, 0));
    expect(first.points).toHaveLength(1);
    expect(second.points).toEqual([at(0, 0), at(10, 0)]);
  });

  it('copies the point rather than holding the caller’s object', () => {
    const pointer = { x: 5, y: 5 };
    const session = addVertex(beginSession(at(0, 0)), pointer);
    pointer.x = 999;
    expect(session.points[1]).toEqual(at(5, 5));
  });
});

describe('nextVertex', () => {
  it('is the pointer when nothing is held', () => {
    expect(nextVertex(beginSession(at(0, 0)), at(37, 11), false)).toEqual(at(37, 11));
  });

  it('constrains from the last vertex, not from where the run began', () => {
    /**
     * What makes a constrained polyline draw as a series of clean angles
     * rather than a fan radiating from the first click.
     */
    const session = addVertex(beginSession(at(0, 0)), at(100, 0));
    const snapped = nextVertex(session, at(140, 3), true);
    expect(snapped.y).toBeCloseTo(0, 6);
    expect(snapped.x).toBeGreaterThan(100);
  });

  it('keeps the reach of the drag, only changing its direction', () => {
    const session = beginSession(at(0, 0));
    const snapped = nextVertex(session, at(100, 10), true);
    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(100, 10), 6);
  });
});

describe('endsRun', () => {
  it('is true for a second click on the last vertex', () => {
    const session = run([0, 0], [100, 0]);
    expect(endsRun(session, at(100, 0), 1)).toBe(true);
  });

  it('tolerates a click that wobbles a couple of pixels', () => {
    // A click that moves two pixels between press and release is still a click.
    expect(endsRun(run([0, 0], [100, 0]), at(103, 2), 1)).toBe(true);
  });

  it('is false anywhere else', () => {
    expect(endsRun(run([0, 0], [100, 0]), at(140, 0), 1)).toBe(false);
  });

  it('measures in screen pixels, so zoom does not change the gesture', () => {
    /**
     * Invariant 9. A world-unit threshold finishes the line at one zoom and
     * places a duplicate vertex at another -- the same bug the alt-duplicate
     * slop and the pen's handle drag both had.
     */
    const session = run([0, 0], [100, 0]);
    const sixWorldUnitsAway = at(106, 0);
    // Six world units is six screen pixels at 1:1 and sixty at 10x.
    expect(endsRun(session, sixWorldUnitsAway, 1)).toBe(true);
    expect(endsRun(session, sixWorldUnitsAway, 10)).toBe(false);
  });
});

describe('undoVertex', () => {
  it('takes the last corner back', () => {
    // A misplaced corner is the likeliest thing to happen while drawing one,
    // and abandoning the whole line is a punishment for a two-pixel slip.
    expect(undoVertex(run([0, 0], [10, 0], [20, 0])).points).toEqual([at(0, 0), at(10, 0)]);
  });

  it('never empties the run', () => {
    // Nothing has a drawing for a run with no points; Escape is how you mean
    // "abandon this".
    const one = beginSession(at(0, 0));
    expect(undoVertex(one)).toBe(one);
  });
});

describe('previewPoints', () => {
  it('shows the run with the pointer on the end of it', () => {
    /**
     * One derivation: what is drawn and what is committed come from the same
     * list, so the line cannot land somewhere other than where it was drawn.
     */
    expect(previewPoints(run([0, 0], [10, 0]), at(20, 5))).toEqual([
      at(0, 0), at(10, 0), at(20, 5),
    ]);
  });

  it('drops the pointer when it has left the canvas', () => {
    expect(previewPoints(run([0, 0], [10, 0]), null)).toEqual([at(0, 0), at(10, 0)]);
  });
});

describe('commitPoints', () => {
  it('gives back the run', () => {
    expect(commitPoints(run([0, 0], [10, 0], [10, 10]), 1)).toEqual([
      at(0, 0), at(10, 0), at(10, 10),
    ]);
  });

  it('drops the duplicate that finishing the line produces', () => {
    /**
     * The ordinary way to end a run is a click on its last vertex, which would
     * otherwise store a final segment with no direction -- an end cap pointing
     * at nothing, and a bend that divides by zero.
     */
    const session = addVertex(run([0, 0], [100, 0]), at(100, 0));
    expect(commitPoints(session, 1)).toEqual([at(0, 0), at(100, 0)]);
  });

  it('refuses a run that never went anywhere', () => {
    expect(commitPoints(beginSession(at(0, 0)), 1)).toBeNull();
    expect(commitPoints(addVertex(beginSession(at(0, 0)), at(1, 1)), 1)).toBeNull();
  });

  it('keeps a genuine short segment at high zoom', () => {
    // Three world units apart is a mistake at 1:1 and a deliberate detail at
    // 8x. The screen-pixel threshold is what tells them apart.
    expect(commitPoints(run([0, 0], [3, 0]), 8)).toEqual([at(0, 0), at(3, 0)]);
    expect(commitPoints(run([0, 0], [3, 0]), 1)).toBeNull();
  });
});
