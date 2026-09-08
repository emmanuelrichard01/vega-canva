import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The adapter, not the arithmetic.
 *
 * `smartGuides` is tested on its own. What is worth pinning here is everything
 * this module adds around it: which objects are offered as candidates, the
 * zoom-relative tolerance, the modifier that suppresses the whole thing, and
 * the re-entrancy guard — all of which are decisions rather than formulas, and
 * all of which are invisible from the pure tests.
 */

const camera = { zoom: 1, viewport: { minX: -1000, minY: -1000, maxX: 3000, maxY: 3000 } };
let objects: Record<string, any> = {};
let modifierHeld = false;

vi.mock('../CameraSystem', () => ({
  cameraSystem: {
    get zoom() {
      return camera.zoom;
    },
    getViewportBounds: () => camera.viewport,
  },
}));

vi.mock('../../hooks/useStore', () => ({
  useStore: { getState: () => ({ objects }) },
}));

/**
 * `guides` reaches the real Y.Doc, which reaches the provider and `window`.
 * The adapter only needs to know *whether* there are guides, so the module is
 * stubbed rather than the whole document stack being stood up in a unit test.
 */
let guides: Array<{ axis: 'x' | 'y'; position: number }> = [];

vi.mock('../document/guides', () => ({
  readGuides: () => guides,
}));

vi.mock('./gridSnap', () => ({
  gridSnap: {
    get isModifierHeld() {
      return modifierHeld;
    },
  },
}));

const { snapDraggedBox, clearSnapGuides } = await import('./objectSnap');
const { guideState } = await import('./guideState');

const node = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'shape',
  x,
  y,
  width: 100,
  height: 100,
  ...extra,
});

beforeEach(() => {
  camera.zoom = 1;
  camera.viewport = { minX: -1000, minY: -1000, maxX: 3000, maxY: 3000 };
  modifierHeld = false;
  objects = {};
  guides = [];
  clearSnapGuides();
});

describe('snapDraggedBox', () => {
  it('pulls the dragged box onto a neighbour and publishes the guide', () => {
    objects = { a: node('a', 200, 0) };
    const result = snapDraggedBox('moving', { x: 203, y: 500, width: 100, height: 100 });
    expect(result.x).toBe(200);
    expect(guideState.getSnapshot()).toHaveLength(1);
  });

  it('never snaps an object to itself', () => {
    objects = { moving: node('moving', 200, 0) };
    expect(snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 }).x).toBe(203);
  });

  it('excludes the rest of a multi-object drag', () => {
    // Everything moving together keeps its relative arrangement, so aligning
    // to a sibling would fight the gesture rather than help it.
    objects = { a: node('a', 200, 0), b: node('b', 400, 0) };
    const result = snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 }, ['a']);
    expect(result.x).toBe(203);
  });

  it('ignores hidden objects and comment pins', () => {
    objects = {
      hidden: node('hidden', 200, 0, { hidden: true }),
      pin: node('pin', 200, 0, { type: 'comment', width: 32, height: 32 }),
    };
    expect(snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 }).x).toBe(203);
  });

  it('ignores objects outside the viewport', () => {
    // Snapping to something you cannot see is a jump whose explanation is
    // drawn off-screen, which is worse than not snapping.
    objects = { far: node('far', 200, 0) };
    camera.viewport = { minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 };
    expect(snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 }).x).toBe(203);
  });

  it('measures its tolerance in screen pixels, not world units', () => {
    objects = { a: node('a', 200, 0) };
    const drag = () => snapDraggedBox('moving', { x: 240, y: 0, width: 100, height: 100 }).x;

    // Deliberately asserting *whether* it snaps rather than where. The same 40
    // world units is a long way at 100% and a few pixels at 10%, which is the
    // whole point; which anchor pair wins at 10% is `smartGuides`' business
    // and is pinned by its own tests.
    camera.zoom = 1;
    expect(drag()).toBe(240);

    clearSnapGuides();
    camera.zoom = 0.1;
    expect(drag()).not.toBe(240);
  });

  it('folds an object scale into the box it aligns against', () => {
    // A scaled object's *visible* box is what a person lines things up with.
    objects = { a: node('a', 0, 0, { scaleX: 2 }) };
    const result = snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 });
    expect(result.x).toBe(200); // right edge of `a` is 0 + 100 * 2
  });

  it('does nothing at all while the modifier is held', () => {
    objects = { a: node('a', 200, 0) };
    snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 });
    expect(guideState.getSnapshot().length).toBeGreaterThan(0);

    modifierHeld = true;
    const result = snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 });
    expect(result.x).toBe(203);
    // The guides go with it: a line still on screen would promise a snap that
    // is no longer happening.
    expect(guideState.getSnapshot()).toHaveLength(0);
  });

  it('returns its own last answer unchanged, so a re-entrant call cannot oscillate', () => {
    // Konva may call `dragBoundFunc` again with the position this returned.
    // Landing on one candidate can bring another into range, and the two can
    // trade the object back and forth forever inside a single frame.
    objects = { a: node('a', 200, 0), b: node('b', 204, 0) };
    const first = snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 });
    const second = snapDraggedBox('moving', { ...first, width: 100, height: 100 });
    expect(second).toEqual(first);
  });

  it('forgets the last answer when the drag ends', () => {
    objects = { a: node('a', 200, 0) };
    const first = snapDraggedBox('moving', { x: 203, y: 500, width: 100, height: 100 });
    expect(first.x).toBe(200);

    clearSnapGuides();

    // A fresh drag starting exactly where the last one finished has to be
    // measured against the board as it is *now*. Still holding the previous
    // answer would pin the object to a neighbour that has since moved.
    objects = { b: node('b', 204, 0) };
    const second = snapDraggedBox('moving', { x: first.x, y: 500, width: 100, height: 100 });
    expect(second.x).toBe(204);
  });

  it('snaps to a ruler guide, which is the most deliberate target there is', () => {
    // Somebody put it there on purpose, so it pulls like any other edge.
    guides = [{ axis: 'x', position: 200 }];
    expect(snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 }).x).toBe(200);
  });

  it('lets a horizontal guide correct only the vertical', () => {
    // A `y` guide is a horizontal line: it says nothing about x, and a guide
    // that nudged both axes would be a guide you could not aim with.
    guides = [{ axis: 'y', position: 400 }];
    const result = snapDraggedBox('moving', { x: 203, y: 403, width: 100, height: 100 });
    expect(result.y).toBe(400);
    expect(result.x).toBe(203);
  });

  it('clears the guides when nothing is in range', () => {
    objects = { a: node('a', 200, 0) };
    snapDraggedBox('moving', { x: 203, y: 0, width: 100, height: 100 });
    expect(guideState.getSnapshot().length).toBeGreaterThan(0);

    snapDraggedBox('moving', { x: 900, y: 900, width: 100, height: 100 });
    expect(guideState.getSnapshot()).toHaveLength(0);
  });

  it('snaps against visible grid column edges', () => {
    objects = {
      g: {
        id: 'g',
        type: 'grid',
        x: 100,
        y: 100,
        width: 600,
        height: 400,
        grid: {
          spec: {
            kind: 'columns',
            x: 100,
            y: 100,
            width: 600,
            height: 400,
            columns: 4,
            rows: 1,
            gutterX: 16,
            gutterY: 16,
            margin: 0,
            variation: 0,
            seed: 1,
          },
          style: {
            shapes: ['rect'],
            palette: ['#000'],
            colorMode: 'solid',
            radius: 0,
            strokeColor: 'transparent',
            strokeWidth: 0,
            opacity: 1,
            seed: 1,
          },
        },
      },
    };

    const snapped = snapDraggedBox('moving', { x: 103, y: 50, width: 50, height: 50 });
    expect(snapped.x).toBe(100);
  });
});

describe('guideState', () => {
  it('hands back a stable empty snapshot', () => {
    // `useSyncExternalStore` compares snapshots by identity; a fresh `[]` on
    // every read is an infinite render loop, not an inefficiency.
    clearSnapGuides();
    expect(guideState.getSnapshot()).toBe(guideState.getSnapshot());
  });

  it('coalesces a burst of sets into one notification', async () => {
    // The writer is Konva's drag loop, which can call this several times
    // before the browser paints. The overlay only needs the last one.
    const seen = vi.fn();
    const stop = guideState.subscribe(seen);

    const guide = (position: number) =>
      [{ orientation: 'vertical' as const, position, from: 0, to: 100, kind: 'edge' as const }];
    guideState.set(guide(10));
    guideState.set(guide(20));
    guideState.set(guide(30));
    // Nothing yet: notifying from inside a Konva layout callback re-enters the
    // drag machinery, which is why this is deferred at all.
    expect(seen).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(guideState.getSnapshot()[0].position).toBe(30);

    // An identical set schedules nothing.
    guideState.set(guide(30));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveBeenCalledTimes(1);

    stop();
  });
});
