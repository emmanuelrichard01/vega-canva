import { describe, it, expect } from 'vitest';
import {
  assignSlots,
  cellIndexAt,
  coverCrop,
  canHoldContent,
  clampZoom,
  freeCellsFrom,
  gridLocalPoint,
  MIN_SLOT_SIZE,
  normalizeSlot,
  nudgeFocus,
  parkedCell,
  SLOT_MAX_ZOOM,
  slotBox,
  sourceBoxForSlot,
  zoomAtPoint,
} from './gridSlot';
import type { StyledCell } from './gridStyle';

const cell = (index: number, x: number, y: number, width = 100, height = 100): StyledCell => ({
  index,
  x,
  y,
  width,
  height,
  row: 0,
  col: 0,
  weight: 1,
  shape: 'rect',
  // An arbitrary fixture value. `StyledCell` requires a fill and nothing here
  // renders, so this is not a design-system colour and is not meant to be one.
  fill: '#000000',
  radius: 0,
});

describe('coverCrop', () => {
  it('takes a centred band of a source wider than the module', () => {
    // 400x200 source into a square module: keep the full height, half the width.
    const crop = coverCrop({ width: 100, height: 100 }, { width: 400, height: 200 });
    expect(crop).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });

  it('takes a centred band of a source taller than the module', () => {
    const crop = coverCrop({ width: 100, height: 100 }, { width: 200, height: 400 });
    expect(crop).toEqual({ x: 0, y: 100, width: 200, height: 200 });
  });

  it('crops nothing when the aspects already agree', () => {
    const crop = coverCrop({ width: 50, height: 25 }, { width: 800, height: 400 });
    expect(crop).toEqual({ x: 0, y: 0, width: 800, height: 400 });
  });

  it('produces a window whose aspect is the module, not the source', () => {
    // The property that actually matters: a covered picture is never stretched.
    for (const natural of [
      { width: 1920, height: 1080 },
      { width: 640, height: 480 },
      { width: 300, height: 1200 },
      { width: 1000, height: 1001 },
    ]) {
      const crop = coverCrop({ width: 160, height: 90 }, natural)!;
      expect(crop.width / crop.height).toBeCloseTo(160 / 90, 10);
    }
  });

  it('never asks for pixels the bitmap does not have', () => {
    for (const natural of [
      { width: 1920, height: 1080 },
      { width: 300, height: 1200 },
      { width: 17, height: 5 },
    ]) {
      const crop = coverCrop({ width: 120, height: 200 }, natural)!;
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(natural.width + 1e-9);
      expect(crop.y + crop.height).toBeLessThanOrEqual(natural.height + 1e-9);
    }
  });

  it('centres the trim, so equal amounts come off both sides', () => {
    const crop = coverCrop({ width: 100, height: 100 }, { width: 500, height: 100 })!;
    expect(crop.x).toBeCloseTo(500 - (crop.x + crop.width), 10);
  });

  it('returns null rather than a degenerate window when a size is unusable', () => {
    // Every one of these reaches a denominator somewhere if it is not caught.
    expect(coverCrop({ width: 100, height: 100 }, { width: 0, height: 100 })).toBeNull();
    expect(coverCrop({ width: 100, height: 100 }, { width: 100, height: 0 })).toBeNull();
    expect(coverCrop({ width: 0, height: 100 }, { width: 100, height: 100 })).toBeNull();
    expect(coverCrop({ width: 100, height: 0 }, { width: 100, height: 100 })).toBeNull();
    expect(coverCrop({ width: 100, height: 100 }, { width: NaN, height: 100 })).toBeNull();
    expect(
      coverCrop({ width: 100, height: 100 }, { width: undefined as never, height: 100 })
    ).toBeNull();
  });
});

describe('coverCrop with a focus and a zoom', () => {
  // A 400x200 source in a square module: the base window is the middle 200x200,
  // so there is exactly 200px of horizontal travel and none vertically.
  const square = { width: 100, height: 100 };
  const wide = { width: 400, height: 200 };

  it('centres when no focus is given, exactly as before', () => {
    expect(coverCrop(square, wide, {})).toEqual(coverCrop(square, wide));
  });

  it('moves the window towards the focal point', () => {
    const left = coverCrop(square, wide, { focus: { x: 0.25, y: 0.5 } })!;
    const right = coverCrop(square, wide, { focus: { x: 0.75, y: 0.5 } })!;
    expect(left.x).toBeLessThan(right.x);
    // 0.25 of 400 is x=100, and the window is 200 wide, so its centre clamps
    // to 100 exactly — the left edge of the source.
    expect(left.x).toBe(0);
    expect(right.x).toBe(200);
  });

  it('never runs off the source, however extreme the focus', () => {
    /**
     * The failure this prevents is nasty and intermittent: Canvas2D draws
     * *transparent* pixels for a crop that reaches outside the bitmap, so the
     * picture gets a soft edge that shows at some sizes and not others.
     */
    for (const fx of [-5, -0.1, 0, 0.5, 1, 1.4, 99]) {
      for (const zoom of [1, 2, 3.7, SLOT_MAX_ZOOM]) {
        const w = coverCrop(square, wide, { focus: { x: fx, y: fx }, zoom })!;
        expect(w.x).toBeGreaterThanOrEqual(-1e-9);
        expect(w.y).toBeGreaterThanOrEqual(-1e-9);
        expect(w.x + w.width).toBeLessThanOrEqual(wide.width + 1e-9);
        expect(w.y + w.height).toBeLessThanOrEqual(wide.height + 1e-9);
      }
    }
  });

  it('shows less of the picture as the zoom goes up', () => {
    const out = coverCrop(square, wide, { zoom: 1 })!;
    const inn = coverCrop(square, wide, { zoom: 2 })!;
    expect(inn.width).toBeCloseTo(out.width / 2, 9);
    expect(inn.height).toBeCloseTo(out.height / 2, 9);
  });

  it('keeps the module’s aspect at every zoom, so nothing stretches', () => {
    for (const zoom of [1, 1.5, 4, SLOT_MAX_ZOOM]) {
      const w = coverCrop({ width: 160, height: 90 }, { width: 1000, height: 1000 }, { zoom })!;
      expect(w.width / w.height).toBeCloseTo(160 / 90, 9);
    }
  });

  it('refuses to zoom out past a plain cover', () => {
    // Below 1 the window would be larger than the source can fill.
    expect(coverCrop(square, wide, { zoom: 0.2 })).toEqual(coverCrop(square, wide, { zoom: 1 }));
  });

  it('ignores a focus that is not a number rather than producing NaN', () => {
    const w = coverCrop(square, wide, { focus: { x: NaN, y: undefined as never } })!;
    expect(w).toEqual(coverCrop(square, wide));
  });
});

describe('clampZoom', () => {
  it('brings a stored value into range', () => {
    expect(clampZoom(0)).toBe(SLOT_MAX_ZOOM > 1 ? 1 : 1);
    expect(clampZoom(100)).toBe(SLOT_MAX_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it('treats anything unusable as a plain cover', () => {
    expect(clampZoom(undefined)).toBe(1);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom('3')).toBe(1);
  });
});

describe('nudgeFocus', () => {
  const square = { width: 100, height: 100 };
  const wide = { width: 400, height: 200 };

  it('pushes the picture the way the arrow points', () => {
    /**
     * The sign, which is the one thing here that cannot be caught by looking at
     * the code and is immediately obvious when using it. Nudging the picture
     * **right** must reveal more of its **left**, so the window travels left.
     */
    const before = coverCrop(square, wide)!;
    const focus = nudgeFocus(square, wide, {}, 10, 0)!;
    const after = coverCrop(square, wide, { focus })!;
    expect(after.x).toBeLessThan(before.x);
  });

  it('moves the window by the world distance, measured in source pixels', () => {
    // Window is 200 source px across a 100-unit module, so one unit of nudge is
    // two source pixels; ten units is twenty.
    const focus = nudgeFocus(square, wide, {}, -10, 0)!;
    const after = coverCrop(square, wide, { focus })!;
    expect(after.x).toBeCloseTo(coverCrop(square, wide)!.x + 20, 6);
  });

  it('nudges the same visible distance whatever the bitmap’s resolution', () => {
    const small = { width: 400, height: 200 };
    const huge = { width: 4000, height: 2000 };
    const shift = (natural: { width: number; height: number }) => {
      const focus = nudgeFocus(square, natural, {}, -10, 0)!;
      const w = coverCrop(square, natural, { focus })!;
      // As a fraction of the window, which is what the eye sees.
      return (w.x - coverCrop(square, natural)!.x) / w.width;
    };
    expect(shift(small)).toBeCloseTo(shift(huge), 9);
  });

  it('stops at the edge of the picture instead of running past it', () => {
    let fit: { focus?: { x: number; y: number } } = {};
    for (let i = 0; i < 200; i++) fit = { focus: nudgeFocus(square, wide, fit, 10, 0)! };
    const w = coverCrop(square, wide, fit)!;
    expect(w.x).toBe(0);
  });

  it('moves on the first press back from an edge', () => {
    /**
     * The bug this pins: reading the *stored* focus rather than the clamped
     * window means a focus driven far past the edge has to be walked all the
     * way back before anything moves, so the control ignores a run of presses
     * and then abruptly starts working.
     */
    const pinned = { focus: { x: -50, y: 0.5 } };
    const focus = nudgeFocus(square, wide, pinned, -10, 0)!;
    const after = coverCrop(square, wide, { focus })!;
    expect(after.x).toBeGreaterThan(0);
  });

  it('does not move an axis that has no travel', () => {
    // A 400x200 source in a 2:1 module covers exactly: nothing is trimmed, so
    // there is nowhere to pan and a nudge must be a no-op rather than a jump.
    const exact = { width: 200, height: 100 };
    const before = coverCrop(exact, wide)!;
    const focus = nudgeFocus(exact, wide, {}, 10, 10)!;
    expect(coverCrop(exact, wide, { focus })).toEqual(before);
  });

  it('returns null when there is nothing to measure against', () => {
    expect(nudgeFocus(square, { width: 0, height: 0 }, {}, 1, 0)).toBeNull();
    expect(nudgeFocus({ width: 0, height: 0 }, wide, {}, 1, 0)).toBeNull();
  });
});

describe('canHoldContent', () => {
  it('judges the module, not the kind of grid it came from', () => {
    /**
     * The rule that answers "which grids does this work for" without a list of
     * grid kinds anywhere. At the default 600x400 this excludes exactly one
     * kind — orbit, whose modules are 22 units across — and a *large* orbit
     * grid's modules pass, which a hardcoded list could never get right.
     */
    expect(canHoldContent({ width: 22, height: 22 })).toBe(false);
    expect(canHoldContent({ width: 120, height: 120 })).toBe(true);
  });

  it('takes the smaller side, so a sliver is not admitted by its length', () => {
    // A baseline grid's strips are long and shallow; it is the shallow half
    // that decides whether a picture is visible in one.
    expect(canHoldContent({ width: 600, height: 8 })).toBe(false);
    expect(canHoldContent({ width: 600, height: MIN_SLOT_SIZE })).toBe(true);
  });
});

describe('parkedCell', () => {
  const grid = { width: 600, height: 400 };

  it('waits below the grid, never on top of it', () => {
    // The whole reason parking moves things: left in place they overlap
    // whatever the new arrangement drew.
    for (const i of [0, 3, 11]) {
      expect(parkedCell(i, grid).y).toBeGreaterThan(grid.height);
    }
  });

  it('lays a row out left to right, then wraps', () => {
    const first = parkedCell(0, grid);
    const second = parkedCell(1, grid);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);

    const wrapped = parkedCell(6, grid);
    expect(wrapped.x).toBe(first.x);
    expect(wrapped.y).toBeGreaterThan(first.y);
  });

  it('gives every waiting item the same size, whatever the count', () => {
    // A strip whose items resized as more arrived would reflow the whole row
    // on every change.
    const sizes = [0, 1, 5, 6, 20].map((i) => parkedCell(i, grid).width);
    expect(new Set(sizes).size).toBe(1);
  });

  it('stays a usable size for a very small or very large grid', () => {
    expect(parkedCell(0, { width: 40, height: 40 }).width).toBeGreaterThanOrEqual(24);
    expect(parkedCell(0, { width: 20000, height: 400 }).width).toBeLessThanOrEqual(140);
  });

  it('never overlaps its neighbour', () => {
    const a = parkedCell(0, grid);
    const b = parkedCell(1, grid);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  });
});

describe('slotBox', () => {
  const grid = { x: 1000, y: 500, width: 300, height: 300 };

  it('carries a module out of grid-local space into world space', () => {
    expect(slotBox(grid, { x: 10, y: 20, width: 80, height: 60 })).toEqual({
      x: 1010,
      y: 520,
      width: 80,
      height: 60,
      rotation: 0,
    });
  });

  it('hands the picture the grid’s own rotation', () => {
    const box = slotBox({ ...grid, rotation: 37 }, { x: 10, y: 20, width: 80, height: 60 });
    expect(box.rotation).toBe(37);
  });

  it('turns a module about the grid’s centre, not its corner', () => {
    // The centre module of a 300x300 grid is the fixed point of any rotation.
    const centre = { x: 100, y: 100, width: 100, height: 100 };
    const still = slotBox({ ...grid, rotation: 90 }, centre);
    expect(still.x).toBeCloseTo(1100, 9);
    expect(still.y).toBeCloseTo(600, 9);
  });

  it('rotates a corner module a quarter turn to where the next corner was', () => {
    const topLeft = { x: 0, y: 0, width: 100, height: 100 };
    const turned = slotBox({ ...grid, rotation: 90 }, topLeft);
    // Top-left module of a square grid, turned 90 degrees, lands where the
    // top-right module was: same centre, so the same top-left corner.
    expect(turned.x).toBeCloseTo(1200, 9);
    expect(turned.y).toBeCloseTo(500, 9);
  });

  it('keeps the module’s size whatever the rotation', () => {
    const box = slotBox({ ...grid, rotation: 137 }, { x: 10, y: 20, width: 80, height: 60 });
    expect(box.width).toBe(80);
    expect(box.height).toBe(60);
  });
});

describe('gridLocalPoint', () => {
  const grid = { x: 1000, y: 500, width: 300, height: 300 };

  it('subtracts the grid’s corner for an unrotated grid', () => {
    expect(gridLocalPoint(grid, { x: 1040, y: 560 })).toEqual({ x: 40, y: 60 });
  });

  it('undoes exactly what slotBox did, at any angle', () => {
    /**
     * The property that matters: a picture placed into a module and a pointer
     * dropped onto that module have to agree about which module it is. They are
     * the two directions of one conversion, so they are tested as a round trip
     * rather than as two independent sums that happen to look right.
     */
    for (const rotation of [0, 15, 90, 180, -37.5]) {
      const cell = { x: 40, y: 60, width: 80, height: 80 };
      const box = slotBox({ ...grid, rotation }, cell);
      // The world centre of the module, taken back into grid-local space,
      // must be the module's own centre.
      const worldCentre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const local = gridLocalPoint({ ...grid, rotation }, worldCentre);
      expect(local.x).toBeCloseTo(cell.x + cell.width / 2, 9);
      expect(local.y).toBeCloseTo(cell.y + cell.height / 2, 9);
    }
  });
});

describe('cellIndexAt', () => {
  const cells = [cell(0, 0, 0), cell(1, 120, 0), cell(2, 0, 120), cell(3, 120, 120)];

  it('finds the module a point is inside', () => {
    expect(cellIndexAt(cells, { x: 50, y: 50 })).toBe(0);
    expect(cellIndexAt(cells, { x: 150, y: 50 })).toBe(1);
    expect(cellIndexAt(cells, { x: 150, y: 150 })).toBe(3);
  });

  it('gives a gutter drop to the module it is nearest', () => {
    // x=110 is in the 20px gutter between columns, but closer to the first.
    expect(cellIndexAt(cells, { x: 108, y: 50 })).toBe(0);
    expect(cellIndexAt(cells, { x: 115, y: 50 })).toBe(1);
  });

  it('gives a drop outside the modules to the nearest one rather than nothing', () => {
    // A grid with a margin: a drop in the margin still means something.
    expect(cellIndexAt(cells, { x: -40, y: -40 })).toBe(0);
    expect(cellIndexAt(cells, { x: 400, y: 400 })).toBe(3);
  });

  it('tests a sector against its own silhouette, not its bounding box', () => {
    /**
     * Two ring sectors sharing one bounding box, which is the arrangement a
     * radial grid actually produces — the boxes of neighbouring sectors overlap
     * heavily, so a box test answers with whichever happens to be first in the
     * list and is wrong for half the ring.
     *
     * These two split the same box along its diagonal, so every point in it
     * belongs to exactly one of them and a box test cannot tell them apart.
     */
    const upperLeft: StyledCell = {
      ...cell(7, 0, 0, 100, 100),
      outline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    };
    const lowerRight: StyledCell = {
      ...cell(8, 0, 0, 100, 100),
      outline: [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    };
    const cells = [upperLeft, lowerRight];
    // A box test returns 7 for both of these, because 7 is listed first.
    expect(cellIndexAt(cells, { x: 20, y: 20 })).toBe(7);
    expect(cellIndexAt(cells, { x: 80, y: 80 })).toBe(8);
  });

  it('returns null only when there are no modules', () => {
    expect(cellIndexAt([], { x: 0, y: 0 })).toBeNull();
  });
});

describe('assignSlots', () => {
  it('fills modules in reading order', () => {
    const { placed, overflow } = assignSlots(4, ['a', 'b', 'c']);
    expect(placed).toEqual([
      { imageId: 'a', cell: 0 },
      { imageId: 'b', cell: 1 },
      { imageId: 'c', cell: 2 },
    ]);
    expect(overflow).toEqual([]);
  });

  it('skips modules that are already taken rather than overwriting them', () => {
    const { placed } = assignSlots(5, ['a', 'b'], new Set([0, 2]));
    expect(placed).toEqual([
      { imageId: 'a', cell: 1 },
      { imageId: 'b', cell: 3 },
    ]);
  });

  it('reports the pictures it could not place', () => {
    const { placed, overflow } = assignSlots(2, ['a', 'b', 'c', 'd']);
    expect(placed).toHaveLength(2);
    expect(overflow).toEqual(['c', 'd']);
  });

  it('reports every picture when the grid is already full', () => {
    const { placed, overflow } = assignSlots(2, ['a', 'b'], new Set([0, 1]));
    expect(placed).toEqual([]);
    expect(overflow).toEqual(['a', 'b']);
  });

  it('never places two pictures in one module', () => {
    const { placed } = assignSlots(6, ['a', 'b', 'c', 'd'], new Set([1]));
    const cells = placed.map((p) => p.cell);
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells).not.toContain(1);
  });

  it('handles a grid with no modules without looping', () => {
    const { placed, overflow } = assignSlots(0, ['a', 'b']);
    expect(placed).toEqual([]);
    expect(overflow).toEqual(['a', 'b']);
  });
});

describe('freeCellsFrom', () => {
  it('takes free modules in reading order from the one aimed at', () => {
    expect(freeCellsFrom(6, new Set(), 2)).toEqual([2, 3, 4, 5, 0, 1]);
  });

  it('wraps round rather than stopping at the end', () => {
    // The failure this prevents: dropping six photographs on the last module of
    // an empty six-module grid must fill it, not place one and discard five.
    expect(freeCellsFrom(6, new Set(), 5)).toHaveLength(6);
  });

  it('skips modules that already hold a picture', () => {
    expect(freeCellsFrom(6, new Set([3, 0]), 2)).toEqual([2, 4, 5, 1]);
  });

  it('returns nothing when every module is taken', () => {
    expect(freeCellsFrom(3, new Set([0, 1, 2]), 1)).toEqual([]);
  });

  it('never returns a module twice', () => {
    const cells = freeCellsFrom(9, new Set([4]), 7);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('survives a start index outside the grid', () => {
    expect(freeCellsFrom(4, new Set(), 99)).toEqual([3, 0, 1, 2]);
    expect(freeCellsFrom(4, new Set(), -5)).toEqual([0, 1, 2, 3]);
  });

  it('handles a grid with no modules', () => {
    expect(freeCellsFrom(0, new Set(), 0)).toEqual([]);
  });
});

describe('normalizeSlot', () => {
  it('takes a well-formed slot', () => {
    expect(normalizeSlot({ gridId: 'g1', cell: 3 })).toEqual({ gridId: 'g1', cell: 3 });
  });

  it('rejects anything that could not name a module', () => {
    expect(normalizeSlot(undefined)).toBeUndefined();
    expect(normalizeSlot(null)).toBeUndefined();
    expect(normalizeSlot({})).toBeUndefined();
    expect(normalizeSlot({ gridId: '', cell: 0 })).toBeUndefined();
    expect(normalizeSlot({ gridId: 'g1' })).toBeUndefined();
    expect(normalizeSlot({ gridId: 'g1', cell: -1 })).toBeUndefined();
    expect(normalizeSlot({ gridId: 'g1', cell: NaN })).toBeUndefined();
    expect(normalizeSlot({ gridId: 'g1', cell: '2' })).toBeUndefined();
  });

  it('floors a fractional index rather than rejecting the slot', () => {
    expect(normalizeSlot({ gridId: 'g1', cell: 2.7 })).toEqual({ gridId: 'g1', cell: 2 });
  });

  it('stores no framing for a picture nobody has framed', () => {
    // The common case by a wide margin, and it should cost nothing on the wire.
    const slot = normalizeSlot({ gridId: 'g1', cell: 0, focus: { x: 0.5, y: 0.5 }, zoom: 1 })!;
    expect(slot).toEqual({ gridId: 'g1', cell: 0 });
  });

  it('keeps a framing that says something', () => {
    expect(normalizeSlot({ gridId: 'g1', cell: 0, focus: { x: 0.2, y: 0.9 }, zoom: 2 })).toEqual({
      gridId: 'g1',
      cell: 0,
      focus: { x: 0.2, y: 0.9 },
      zoom: 2,
    });
  });

  it('drags a nonsense framing back into range rather than dropping the slot', () => {
    // A slot with a bad focus is still a slot; losing the picture out of the
    // grid because a number was wrong would be a far worse answer than centring.
    expect(normalizeSlot({ gridId: 'g1', cell: 1, focus: { x: 9, y: -9 }, zoom: 1000 })).toEqual({
      gridId: 'g1',
      cell: 1,
      focus: { x: 1, y: 0 },
      zoom: SLOT_MAX_ZOOM,
    });
  });
});

describe('zoomAtPoint', () => {
  const SQUARE = { width: 100, height: 100 };
  const WIDE = { width: 400, height: 200 };

  /** Where a fraction of the module lands in the source, at a given fit. */
  const sourceUnder = (fit: Parameters<typeof coverCrop>[2], ax: number, ay: number) => {
    const w = coverCrop(SQUARE, WIDE, fit)!;
    return { x: w.x + ax * w.width, y: w.y + ay * w.height };
  };

  it('holds the point under the pointer still', () => {
    /**
     * The whole reason the anchor exists. Zooming about the centre pushes the
     * thing you are zooming towards off the edge, so you enlarge, pan it back,
     * and enlarge again. One gesture instead of two alternating ones.
     */
    const anchor = { x: 0.25, y: 0.75 };
    const before = sourceUnder(undefined, anchor.x, anchor.y);
    const next = zoomAtPoint(SQUARE, WIDE, undefined, 2, anchor)!;
    const after = sourceUnder(next, anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('holds it on the way back out too', () => {
    const anchor = { x: 0.8, y: 0.2 };
    const zoomed = zoomAtPoint(SQUARE, WIDE, undefined, 3, anchor)!;
    const before = sourceUnder(zoomed, anchor.x, anchor.y);
    const back = zoomAtPoint(SQUARE, WIDE, zoomed, 1.5, anchor)!;
    expect(sourceUnder(back, anchor.x, anchor.y).x).toBeCloseTo(before.x, 6);
  });

  it('is a round trip from the centre, which is the one anchor that cannot drift', () => {
    const centre = { x: 0.5, y: 0.5 };
    const there = zoomAtPoint(SQUARE, WIDE, undefined, 4, centre)!;
    const back = zoomAtPoint(SQUARE, WIDE, there, 1, centre)!;
    expect(back.zoom).toBe(1);
    expect(back.focus!.x).toBeCloseTo(0.5, 6);
    expect(back.focus!.y).toBeCloseTo(0.5, 6);
  });

  it('never asks for a window off the edge of the picture', () => {
    // An anchor in the corner of a picture already against that corner cannot
    // hold its point still, and must not try: pixels past the edge of a bitmap
    // are transparent, which `coverCrop` documents as the bug worth never
    // having again.
    for (const anchor of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]) {
      const fit = zoomAtPoint(SQUARE, WIDE, { focus: anchor, zoom: 1 }, 6, anchor)!;
      const w = coverCrop(SQUARE, WIDE, fit)!;
      expect(w.x).toBeGreaterThanOrEqual(-1e-9);
      expect(w.y).toBeGreaterThanOrEqual(-1e-9);
      expect(w.x + w.width).toBeLessThanOrEqual(WIDE.width + 1e-9);
      expect(w.y + w.height).toBeLessThanOrEqual(WIDE.height + 1e-9);
    }
  });

  it('clamps the zoom rather than trusting the caller', () => {
    expect(zoomAtPoint(SQUARE, WIDE, undefined, 9999, { x: 0.5, y: 0.5 })!.zoom).toBe(SLOT_MAX_ZOOM);
    expect(zoomAtPoint(SQUARE, WIDE, undefined, 0.1, { x: 0.5, y: 0.5 })!.zoom).toBe(1);
  });

  it('declines a picture with no dimensions rather than dividing by them', () => {
    expect(zoomAtPoint(SQUARE, { width: 0, height: 0 }, undefined, 2, { x: 0.5, y: 0.5 })).toBeNull();
  });
});

describe('sourceBoxForSlot', () => {
  const BOX = { x: 40, y: 60, width: 100, height: 100 };
  const WIDE = { width: 400, height: 200 };

  it('places the whole picture so the part on show lands on the module', () => {
    /**
     * The property the ghost depends on. If this is off by anything at all the
     * faint picture visibly fails to line up with the bright one, and the
     * expression still reads as correct in source, which is why it is pinned
     * here rather than left to the eye.
     */
    const window = coverCrop({ width: 100, height: 100 }, WIDE)!;
    const source = sourceBoxForSlot(BOX, WIDE, window)!;
    const scale = source.width / WIDE.width;

    expect(source.x + window.x * scale).toBeCloseTo(BOX.x, 6);
    expect(source.y + window.y * scale).toBeCloseTo(BOX.y, 6);
    expect(window.width * scale).toBeCloseTo(BOX.width, 6);
    expect(window.height * scale).toBeCloseTo(BOX.height, 6);
  });

  it('grows the ghost as the framing zooms in', () => {
    const at = (zoom: number) =>
      sourceBoxForSlot(BOX, WIDE, coverCrop({ width: 100, height: 100 }, WIDE, { zoom }))!;
    expect(at(4).width).toBeCloseTo(at(1).width * 4, 6);
  });

  it('is null when there is nothing to place', () => {
    expect(sourceBoxForSlot(BOX, WIDE, null)).toBeNull();
    expect(sourceBoxForSlot(BOX, { width: 0, height: 0 }, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });
});
