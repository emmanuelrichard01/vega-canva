import { describe, it, expect } from 'vitest';
import { planGridReflow, planSlotRelease } from './gridReflow';
import { normalizeRecipe } from './gridNode';
import { DEFAULT_TYPOGRAPHY, type GridNode, type ImageNode, type TextNode } from '../model/schema';

/**
 * A 2x2 modular grid with no gutter and no margin, so its modules are exactly
 * four 100x100 squares in reading order and every expectation below can be a
 * number rather than a re-derivation of the layout.
 */
function grid(over: Partial<GridNode> = {}, spec: Record<string, unknown> = {}): GridNode {
  const width = (over.width as number) ?? 200;
  const height = (over.height as number) ?? 200;
  return {
    id: 'g1',
    type: 'grid',
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 1,
    locked: false,
    hidden: false,
    createdBy: 'u1',
    createdAt: 0,
    updatedAt: 0,
    grid: normalizeRecipe(
      {
        spec: {
          kind: 'modular',
          rows: 2,
          columns: 2,
          gutterX: 0,
          gutterY: 0,
          margin: 0,
          variation: 0,
          ...spec,
        },
        style: {},
      },
      width,
      height
    ),
    ...over,
  } as GridNode;
}

function image(over: Partial<ImageNode> = {}): ImageNode {
  return {
    id: 'i1',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 2,
    locked: false,
    hidden: false,
    createdBy: 'u1',
    createdAt: 0,
    updatedAt: 0,
    src: 'blob:x',
    appearance: {},
    naturalWidth: 400,
    naturalHeight: 200,
    gridSlot: { gridId: 'g1', cell: 0 },
    ...over,
  } as ImageNode;
}

/** The patch for one id, flattened for readability in the expectations. */
const changesFor = (patches: { id: string; changes: Record<string, unknown> }[], id: string) =>
  patches.find((p) => p.id === id)?.changes;

/**
 * The picture as it ends up, once the plan has been applied.
 *
 * Assertions go through this rather than reading the patch directly, because a
 * patch deliberately carries **only what changed** — so a module that happens
 * to be the size the picture already was produces no `width` key, and a test
 * written against the keys would be asserting the fixture rather than the
 * behaviour. Where the picture ends up is the thing that matters and the thing
 * a reader wants to see.
 */
const settle = (img: ImageNode, patches: { id: string; changes: Record<string, unknown> }[]) =>
  ({ ...img, ...(changesFor(patches, img.id) ?? {}) }) as ImageNode;

describe('planGridReflow', () => {
  it('puts a picture on the module its slot names', () => {
    const img = image({ gridSlot: { gridId: 'g1', cell: 3 } });
    const landed = settle(img, planGridReflow(grid(), [img]));
    expect(landed).toMatchObject({ x: 100, y: 100, width: 100, height: 100 });
  });

  it('carries the grid’s own position into the picture’s box', () => {
    const img = image({ gridSlot: { gridId: 'g1', cell: 1 } });
    const landed = settle(img, planGridReflow(grid({ x: 1000, y: -400 }), [img]));
    expect(landed).toMatchObject({ x: 1100, y: -400 });
  });

  it('writes nothing at all when everything already matches', () => {
    /**
     * The property the whole design rests on. Every client observes every
     * change and runs this; if an already-correct grid produced writes, each
     * one would be a change the others observe, and a two-person room would
     * never go quiet.
     */
    const settled = image({
      gridSlot: { gridId: 'g1', cell: 2 },
      x: 0,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      crop: { x: 100, y: 0, width: 200, height: 200 },
      appearance: { cornerRadius: 0 },
    });
    expect(planGridReflow(grid(), [settled])).toEqual([]);
  });

  it('re-covers a picture when the grid changes proportions', () => {
    // 400x200 grid, 2x2, so each module is 200x100 — twice as wide as before.
    const img = image({ gridSlot: { gridId: 'g1', cell: 0 } });
    const landed = settle(img, planGridReflow(grid({ width: 400, height: 200 }), [img]));
    expect(landed).toMatchObject({ width: 200, height: 100 });
    // A 400x200 source into a 200x100 module: the aspects agree, so nothing is
    // trimmed — and the crop must say so rather than keeping the old window.
    expect(landed.crop).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it('does not stretch a picture when the grid is dragged wider', () => {
    // The failure this exists to stop: resize without re-cropping means the
    // module changes shape and the source window does not.
    const img = image({ gridSlot: { gridId: 'g1', cell: 0 } });
    const landed = settle(img, planGridReflow(grid({ width: 600, height: 200 }), [img]));
    expect(landed.crop!.width / landed.crop!.height).toBeCloseTo(landed.width / landed.height, 9);
  });

  it('leaves the crop alone while the bitmap’s natural size is still unknown', () => {
    const patches = planGridReflow(grid(), [
      image({ naturalWidth: undefined, naturalHeight: undefined }),
    ]);
    const changes = changesFor(patches, 'i1') ?? {};
    expect('crop' in changes).toBe(false);
  });

  it('takes the module’s corner radius', () => {
    const rounded = grid();
    const img = image();
    const landed = settle(
      img,
      planGridReflow(
        { ...rounded, grid: { ...rounded.grid, style: { ...rounded.grid.style, radius: 12 } } },
        [img]
      )
    );
    expect(landed.appearance).toMatchObject({ cornerRadius: 12 });
  });

  it('parks a picture whose module is gone, and never releases it', () => {
    /**
     * The rule that makes browsing arrangements safe. Module counts run from
     * one (manuscript) to thirty-six (orbit) across the kinds, so trying them
     * is a gesture that repeatedly asks nine pictures to fit into four — and it
     * must not cost anyone their photographs.
     */
    const shrunk = grid({}, { rows: 1, columns: 1 });
    const patches = planGridReflow(shrunk, [
      image({ id: 'kept', gridSlot: { gridId: 'g1', cell: 0 } }),
      image({ id: 'orphan', gridSlot: { gridId: 'g1', cell: 3 }, x: 55, y: 66 }),
    ]);
    const orphan = changesFor(patches, 'orphan')!;
    expect(orphan).not.toHaveProperty('gridSlot');
    // Moved into the waiting strip, which is below the grid.
    expect(orphan.y as number).toBeGreaterThan(200);
  });

  it('brings parked content home when the modules come back', () => {
    /**
     * The round trip is the whole point: cycle away from an arrangement and
     * back, and the board must be as you left it. The old behaviour released
     * on the way out, so the return journey found nothing to bring back.
     */
    const nine = [0, 1, 2, 3].map((cell) =>
      image({ id: `i${cell}`, gridSlot: { gridId: 'g1', cell }, crop: undefined })
    );

    // Away: a 1x1 grid parks three of the four.
    const away = planGridReflow(grid({}, { rows: 1, columns: 1 }), nine);
    const parked = nine.map((n) => settle(n, away));
    expect(parked.every((n) => n.gridSlot)).toBe(true);

    // And back: every one of them is on the module it started on.
    const home = planGridReflow(grid(), parked);
    const restored = parked.map((n) => settle(n, home));
    expect(restored.map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [100, 0],
      [0, 100],
      [100, 100],
    ]);
  });

  it('lays parked content out in a stable order, so every client agrees', () => {
    /**
     * Every client runs this and writes only differences. If the strip's order
     * depended on the order the nodes happened to arrive in, two clients would
     * compute two layouts and overwrite each other forever.
     */
    const shrunk = grid({}, { rows: 1, columns: 1 });
    const a = image({ id: 'a', gridSlot: { gridId: 'g1', cell: 3 } });
    const b = image({ id: 'b', gridSlot: { gridId: 'g1', cell: 1 } });
    const forwards = planGridReflow(shrunk, [a, b]);
    const backwards = planGridReflow(shrunk, [b, a]);
    expect(changesFor(forwards, 'a')).toEqual(changesFor(backwards, 'a'));
    expect(changesFor(forwards, 'b')).toEqual(changesFor(backwards, 'b'));
    // And ordered by the module they came from, so the strip keeps their
    // arrangement: b was in module 1, so it waits ahead of a.
    expect(settle(b, forwards).x).toBeLessThan(settle(a, forwards).x);
  });

  it('ignores a picture whose slot names a different grid', () => {
    const patches = planGridReflow(grid(), [
      image({ id: 'mine', gridSlot: { gridId: 'g1', cell: 0 } }),
      image({ id: 'theirs', gridSlot: { gridId: 'g2', cell: 0 }, x: 9999, y: 9999 }),
    ]);
    expect(changesFor(patches, 'theirs')).toBeUndefined();
  });

  it('ignores a picture that is in no grid at all', () => {
    const patches = planGridReflow(grid(), [image({ gridSlot: undefined, x: 9999 })]);
    expect(patches).toEqual([]);
  });

  it('turns pictures with the grid, about the grid’s centre', () => {
    const img = image({ gridSlot: { gridId: 'g1', cell: 0 } });
    const landed = settle(img, planGridReflow(grid({ rotation: 90 }), [img]));
    // Module 0 is the top-left of a 200x200 grid; a quarter turn about the
    // centre puts it where the top-right module was.
    expect(landed.x).toBeCloseTo(100, 9);
    expect(landed.y).toBeCloseTo(0, 9);
    expect(landed.rotation).toBe(90);
  });

  it('handles every module of a full grid in one plan', () => {
    const images = [0, 1, 2, 3].map((cell) =>
      image({ id: `i${cell}`, gridSlot: { gridId: 'g1', cell } })
    );
    const patches = planGridReflow(grid(), images);
    const landed = images.map((img) => settle(img, patches));
    expect(landed.map((i) => [i.x, i.y])).toEqual([
      [0, 0],
      [100, 0],
      [0, 100],
      [100, 100],
    ]);
  });
});

describe('planGridReflow with a caption', () => {
  function caption(over: Partial<TextNode> = {}): TextNode {
    return {
      ...image(),
      type: 'text',
      id: 't1',
      text: 'Hello',
      typography: DEFAULT_TYPOGRAPHY,
      resize: 'fixed',
      naturalWidth: undefined,
      naturalHeight: undefined,
      crop: undefined,
      ...over,
    } as unknown as TextNode;
  }

  it('gives a caption the module’s box, like a picture', () => {
    const text = caption({ gridSlot: { gridId: 'g1', cell: 3 } });
    const patches = planGridReflow(grid(), [text]);
    expect({ ...text, ...(changesFor(patches, 't1') ?? {}) }).toMatchObject({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
  });

  it('never writes a crop for a caption', () => {
    /**
     * There is no source to cover. A crop on a text node is meaningless, and
     * writing one would be a field the renderer ignores — the dead-capability
     * shape invariant 6 exists to stop.
     */
    const patches = planGridReflow(grid({ width: 400 }), [caption()]);
    expect(changesFor(patches, 't1') ?? {}).not.toHaveProperty('crop');
  });

  it('pins a caption to a fixed box so it cannot grow out of its module', () => {
    // An auto-height caption would outgrow the module on the third line and be
    // dragged back by the next reflow — the box fighting the typing.
    const patches = planGridReflow(grid(), [caption({ resize: 'height' })]);
    expect(changesFor(patches, 't1')).toMatchObject({ resize: 'fixed' });
  });

  it('leaves a settled caption alone', () => {
    const settled = caption({
      gridSlot: { gridId: 'g1', cell: 2 },
      x: 0,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      resize: 'fixed',
    });
    expect(planGridReflow(grid(), [settled])).toEqual([]);
  });

  it('parks a caption whose module is gone, exactly as it does a picture', () => {
    const shrunk = grid({}, { rows: 1, columns: 1 });
    const patches = planGridReflow(shrunk, [caption({ gridSlot: { gridId: 'g1', cell: 3 } })]);
    const changes = changesFor(patches, 't1')!;
    expect(changes).not.toHaveProperty('gridSlot');
    expect(changes.y as number).toBeGreaterThan(200);
  });
});

describe('planGridReflow honours a stored framing', () => {
  it('re-covers around the focal point rather than re-centring on it', () => {
    /**
     * The whole reason `focus` is stored as an intent rather than as the crop
     * it produced: a module that changes shape must keep the framing a person
     * chose, and the only thing that survives an aspect change is the point.
     */
    const framed = image({
      gridSlot: { gridId: 'g1', cell: 0, focus: { x: 0.9, y: 0.5 } },
      crop: undefined,
    });
    const centred = image({ id: 'i2', gridSlot: { gridId: 'g1', cell: 1 }, crop: undefined });
    const patches = planGridReflow(grid(), [framed, centred]);
    const a = changesFor(patches, 'i1')!.crop as { x: number };
    const b = changesFor(patches, 'i2')!.crop as { x: number };
    expect(a.x).toBeGreaterThan(b.x);
  });

  it('keeps the framing when the grid is merely moved', () => {
    const framed = image({
      gridSlot: { gridId: 'g1', cell: 0, focus: { x: 0.9, y: 0.5 }, zoom: 2 },
      crop: undefined,
    });
    const still = planGridReflow(grid(), [framed]);
    const moved = planGridReflow(grid({ x: 500, y: 500 }), [framed]);
    expect(changesFor(moved, 'i1')!.crop).toEqual(changesFor(still, 'i1')!.crop);
  });
});

describe('planSlotRelease', () => {
  it('releases every picture belonging to a grid that was deleted', () => {
    const patches = planSlotRelease(new Set(['g1']), [
      image({ id: 'a', gridSlot: { gridId: 'g1', cell: 0 } }),
      image({ id: 'b', gridSlot: { gridId: 'g1', cell: 1 } }),
    ]);
    expect(patches).toEqual([
      { id: 'a', changes: { gridSlot: undefined } },
      { id: 'b', changes: { gridSlot: undefined } },
    ]);
  });

  it('leaves pictures in other grids alone', () => {
    const patches = planSlotRelease(new Set(['g1']), [
      image({ id: 'a', gridSlot: { gridId: 'g2', cell: 0 } }),
      image({ id: 'b', gridSlot: undefined }),
    ]);
    expect(patches).toEqual([]);
  });

  it('does nothing when no grid was deleted', () => {
    // Guards the case that matters most: this must never be called
    // speculatively, and an empty set must be cheap and inert.
    expect(planSlotRelease(new Set(), [image()])).toEqual([]);
  });
});
