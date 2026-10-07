import { describe, expect, it } from 'vitest';
import { countSelectionUnits, placeInBox, placeParagraph, selectionBox } from './selectionTransform';

const node = (x: number, y: number, width: number, height: number, rotation = 0) => ({
  x, y, width, height, rotation,
});

describe('selectionBox', () => {
  it('is the box every object fits inside', () => {
    expect(selectionBox([node(10, 20, 30, 40), node(50, 0, 10, 10)])).toEqual({
      x: 10, y: 0, width: 50, height: 60,
    });
  });

  it('is the object itself for a selection of one', () => {
    expect(selectionBox([node(5, 5, 20, 10)])).toEqual({ x: 5, y: 5, width: 20, height: 10 });
  });

  it('is null for nothing, rather than an empty box at the origin', () => {
    // An empty box at 0,0 would put the proxy somewhere real and let a gesture
    // start against a selection that does not exist.
    expect(selectionBox([])).toBeNull();
  });

  it('contains rotated members of a multi-selection as drawn', () => {
    // A 100x20 bar turned 90° about its centre (50, 10) spans x 40..60, y -40..60.
    const box = selectionBox([node(0, 0, 100, 20, 90), node(200, 0, 10, 10)])!;
    expect(box.x).toBeCloseTo(40);
    expect(box.y).toBeCloseTo(-40);
    expect(box.height).toBeCloseTo(100);
    expect(box.x + box.width).toBeCloseTo(210);
  });

  it('keeps a single rotated object unrotated, since the proxy carries its angle', () => {
    expect(selectionBox([node(0, 0, 100, 20, 90)])).toEqual({ x: 0, y: 0, width: 100, height: 20 });
  });

  it('ignores an object with no finite position', () => {
    expect(selectionBox([node(NaN, 0, 10, 10), node(0, 0, 10, 10)])).toEqual({
      x: 0, y: 0, width: 10, height: 10,
    });
  });
});

describe('placeInBox', () => {
  const from = { x: 0, y: 0, width: 100, height: 100 };

  it('leaves an untouched selection exactly where it was', () => {
    // The identity case, and the one that matters most: a gesture that has not
    // moved yet must not nudge anything. Every drift bug starts here.
    const start = node(10, 20, 30, 40, 15);
    expect(placeInBox(start, from, from, 0)).toEqual({
      x: 10, y: 20, width: 30, height: 40, rotation: 15,
    });
  });

  it('scales a single object to the box it was dragged to', () => {
    const start = node(0, 0, 100, 100);
    const to = { x: 0, y: 0, width: 250, height: 50 };
    expect(placeInBox(start, from, to, 0)).toMatchObject({
      x: 0, y: 0, width: 250, height: 50,
    });
  });

  it('keeps each object at its own fraction of the box', () => {
    /**
     * The property that makes a multi-object resize need no special case: an
     * object at the far corner stays at the far corner, and one at the centre
     * stays at the centre.
     */
    const far = node(90, 90, 10, 10);
    const to = { x: 0, y: 0, width: 200, height: 200 };
    const out = placeInBox(far, from, to, 0);
    expect(out.width).toBe(20);
    expect(out.x + out.width).toBeCloseTo(200, 6);
  });

  it('carries the box\'s move as well as its size', () => {
    const start = node(0, 0, 50, 50);
    const to = { x: 300, y: -80, width: 50, height: 50 };
    expect(placeInBox(start, from, to, 0)).toMatchObject({ x: 300, y: -80 });
  });

  it('turns the selection as one rigid thing', () => {
    // Two objects turned 90° about the box centre swap their positions rather
    // than each spinning where it stands.
    const a = node(0, 0, 20, 20);
    const out = placeInBox(a, from, from, 90);
    expect(out.rotation).toBe(90);
    // (10,10) about (50,50) by 90° -> (90,10)
    expect(out.x + out.width / 2).toBeCloseTo(90, 6);
    expect(out.y + out.height / 2).toBeCloseTo(10, 6);
  });

  it('adds the turn to the object\'s own angle', () => {
    expect(placeInBox(node(0, 0, 10, 10, 30), from, from, 45).rotation).toBe(75);
  });

  it('survives a selection with no width to divide by', () => {
    // A hairline, or a connector whose ends coincide. Dividing by zero would
    // put the object at NaN, which Konva draws as nothing at all.
    const flat = { x: 0, y: 0, width: 0, height: 100 };
    const out = placeInBox(node(0, 0, 0, 50), flat, { x: 5, y: 0, width: 0, height: 100 }, 0);
    expect(Number.isFinite(out.x) && Number.isFinite(out.width)).toBe(true);
  });

  it('gives a positive size for a handle dragged past its opposite edge', () => {
    // Konva reports a negative box when you pull a handle through the far side.
    // A negative width would flip every renderer's arithmetic downstream.
    const to = { x: 0, y: 0, width: -80, height: 100 };
    expect(placeInBox(node(0, 0, 100, 100), from, to, 0).width).toBe(80);
  });
});

describe('placeParagraph', () => {
  it('keeps the top-left the gesture drew and takes the height from the layout', () => {
    /**
     * A paragraph's height is not what the drag asked for -- it falls out of the
     * re-wrap. Placing it by the centre, which is right for every other type,
     * split the extra lines between the top and the bottom and grew the column
     * upwards into whatever was above it.
     */
    const placed = { x: 40, y: 60, width: 200, height: 200, rotation: 0 };
    expect(placeParagraph(placed, { width: 200, height: 84 })).toEqual({
      x: 40, y: 60, width: 200, height: 84, rotation: 0,
    });
  });

  it('leaves the angle alone', () => {
    const placed = { x: 0, y: 0, width: 10, height: 10, rotation: 22 };
    expect(placeParagraph(placed, { width: 10, height: 30 }).rotation).toBe(22);
  });
});

describe('countSelectionUnits', () => {
  const objects: any = {
    a: { id: 'a', parentId: 'g1' },
    b: { id: 'b', parentId: 'g1' },
    c: { id: 'c' },
    f: { id: 'f', type: 'frame' },
    k1: { id: 'k1', parentId: 'f' },
    k2: { id: 'k2', parentId: 'f' },
  };
  const groups: any = { g1: { id: 'g1' } };
  const order = Object.keys(objects);

  it('counts a whole group as one', () => {
    expect(countSelectionUnits(order, objects, groups, ['a', 'b'])).toBe(1);
    expect(countSelectionUnits(order, objects, groups, ['a', 'b', 'c'])).toBe(2);
  });

  it('counts half a group as its members', () => {
    expect(countSelectionUnits(order, objects, groups, ['a', 'c'])).toBe(2);
  });

  it('counts a frame as one, however much of it is also selected', () => {
    expect(countSelectionUnits(order, objects, groups, ['f'])).toBe(1);
    expect(countSelectionUnits(order, objects, groups, ['f', 'k1', 'k2', 'c'])).toBe(2);
  });
});
