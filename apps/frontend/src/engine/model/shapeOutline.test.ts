import { describe, expect, it } from 'vitest';
import {
  pointsAttribute,
  regularPolygonPoints,
  shapeFeaturePaths,
  shapeOutline,
  starPoints,
} from './shapeOutline';
import { shapeToPath } from './shapeToPath';
import { roughShape } from './roughShape';
import { contourBounds, flattenPath, subpathsOf } from './pathGeometry';
import { SHAPE_KIND_VALUES, type ShapeKind, type ShapeNode } from './schema';
import { SHAPE_PARAMS } from './shapeParams';
import { normalizeNode } from '../document/normalize';
import {
  SHAPE_ENTRIES,
  SHAPE_PRESETS,
  presetGeometry,
  type ShapePreset,
} from '../../components/workspace/shapeCatalog';

/**
 * The shape set, held to the properties it kept getting wrong.
 *
 * ## Why this suite is shaped the way it is
 *
 * What it replaces asserted individual coordinates — that a diamond's second
 * point was `(w, h/2)`, that a chevron had six vertices. Those tests all passed
 * against a set in which the seal was a sunburst, the ribbon was a notched box,
 * the key's bow was a diamond and the ring's hole was a lens, because every one
 * of those defects was a *correct* list of points describing the wrong shape.
 * A coordinate test cannot see a missing curve.
 *
 * So this asserts the things that were actually broken, and each one covers the
 * whole set rather than one member:
 *
 *   - every shape fills the box it is given;
 *   - a shape with a hole has a hole, and the hole is round;
 *   - the shape the toolbar draws is the shape the board draws;
 *   - a parametric shape's default is the one number the panel shows.
 */

const box = (kind: ShapeKind, w = 120, h = 90, extra: Record<string, unknown> = {}) =>
  ({
    geometry: { kind, ...extra },
    width: w,
    height: h,
    appearance: {},
  }) as unknown as Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>;

const CLOSED = SHAPE_KIND_VALUES.filter((k) => k !== 'line' && k !== 'arrow');

/**
 * The two kinds whose silhouette is deliberately smaller than their box.
 *
 * Both draw the rest of themselves as strokes reaching the box's edge — a
 * chip's contacts, a monitor's stand — which is how both objects are drawn
 * everywhere. Named here rather than exempted silently, so adding a third is a
 * decision somebody makes on purpose.
 */
const INSET_ON_PURPOSE: ReadonlySet<string> = new Set(['cpu', 'desktop']);

describe('every shape fills its box', () => {
  /**
   * The invariant the whole model rests on, and the one nothing was checking.
   *
   * `width`/`height` are the only bounds this document has, so a shape drawn
   * inside part of its box lies to selection, snapping, culling, export framing
   * and every connector that projects onto its outline. The regular polygons
   * were doing exactly that — inscribed in the box's ellipse, so a triangle used
   * three quarters of its height and a pentagon left a band of air along the
   * bottom that an arrow pointed at would land in.
   */
  it.each(CLOSED.filter((k) => !INSET_ON_PURPOSE.has(k)))('%s', (kind) => {
    for (const [w, h] of [
      [120, 120],
      [200, 80],
      [70, 190],
    ]) {
      const bounds = contourBounds(shapeToPath(box(kind, w, h)));
      // A pixel of slack, which is the flattening tolerance rather than a fudge:
      // `contourBounds` measures a polyline approximation of the curves.
      expect(bounds.x, `${kind} ${w}x${h} left`).toBeCloseTo(0, 0);
      expect(bounds.y, `${kind} ${w}x${h} top`).toBeCloseTo(0, 0);
      expect(bounds.width, `${kind} ${w}x${h} width`).toBeCloseTo(w, 0);
      expect(bounds.height, `${kind} ${w}x${h} height`).toBeCloseTo(h, 0);
    }
  });
});

describe('every shape draws something', () => {
  it.each(CLOSED)('%s produces a closed outline with area', (kind) => {
    const path = shapeToPath(box(kind));
    const points = flattenPath(path);
    expect(points.length, kind).toBeGreaterThan(2);
    for (const p of points) {
      expect(Number.isFinite(p.x), `${kind} has a non-finite x`).toBe(true);
      expect(Number.isFinite(p.y), `${kind} has a non-finite y`).toBe(true);
    }
  });

  it('describes a line as an open run rather than a shape', () => {
    const outline = shapeOutline(box('line'));
    expect(outline.kind).toBe('open');
  });
});

describe('a hole is a hole', () => {
  /**
   * The ring and the gear each carried a hand-written inner contour with its
   * in and out handles swapped end for end, so both drew a **diamond** where a
   * circle was meant. One `ellipseContour(…, 'ccw')` draws every hole now, and
   * this is what says so.
   */
  it.each(['donut', 'gear', 'key', 'user'])('%s has a second contour', (kind) => {
    const path = shapeToPath(box(kind as ShapeKind, 120, 120));
    expect(subpathsOf(path).length).toBeGreaterThan(1);
  });

  it('the ring is round, not a lozenge', () => {
    const path = shapeToPath(box('donut', 120, 120));
    const [, hole] = subpathsOf(path);
    const points = flattenPath(hole);
    const cx = 60;
    const cy = 60;
    const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const min = Math.min(...radii);
    const max = Math.max(...radii);
    // A circle's radius is constant. The swapped-handle version this replaces
    // collapsed to a lens whose extremes differed by more than a third.
    expect(max / min).toBeLessThan(1.01);
  });
});

describe('the toolbar and the board draw the same shape', () => {
  /**
   * Every glyph is rendered from its own catalogue recipe through
   * `shapeToPath`, so the two cannot differ by construction. What can still
   * differ is the *recipe*: a tile whose geometry the document cannot hold, or
   * whose kind the normalizer rewrites, would show one thing and place another.
   * That is the shape the Database bug had — its glyph drew a stack of disks
   * and its recipe made a plain cylinder.
   */
  it.each(SHAPE_ENTRIES.map((e) => e.preset))('%s survives the normalizer intact', (preset) => {
    const recipe = presetGeometry(preset as ShapePreset);
    const node = normalizeNode({
      id: 'x',
      type: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      geometry: recipe,
    }) as ShapeNode;
    expect(node.geometry.kind, `${preset} was rewritten`).toBe(recipe.kind);
    if (recipe.points !== undefined) expect(node.geometry.points).toBe(recipe.points);
  });

  it('offers every kind the document can hold, or names it as a non-preset', () => {
    const offered = new Set<string>(SHAPE_ENTRIES.map((e) => e.geometry.kind));
    const missing = SHAPE_KIND_VALUES.filter((k) => !offered.has(k));
    // Every kind is reachable from a tile. `polygon` is created by three of
    // them at three side counts, which is why a preset list and a kind list are
    // not the same list.
    expect(missing).toEqual([]);
  });

  it('gives every shape exactly one name', () => {
    const labels = SHAPE_ENTRIES.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every preset a sentence to explain itself', () => {
    for (const entry of SHAPE_ENTRIES) {
      expect(entry.hint.length, entry.preset).toBeGreaterThan(8);
    }
  });

  it('files every preset in at least one category', () => {
    const closed = SHAPE_ENTRIES.filter((e) => e.preset !== 'line' && e.preset !== 'arrow');
    for (const entry of closed) {
      expect(SHAPE_PRESETS, `${entry.preset} is in the catalogue and in no category`).toContain(
        entry.preset
      );
    }
  });
});

describe('a parametric shape draws the number its panel shows', () => {
  /**
   * Three of these had drifted: an untouched ring drew a 55% hole under a
   * control reading 50%, an untouched seal drew a 90% scallop under one reading
   * 82%, and a chip made by swapping got six pins where a fresh one got three.
   * Each was a default written down twice.
   */
  it.each(Object.keys(SHAPE_PARAMS) as ShapeKind[])(
    '%s draws the same shape with its dials absent as with them set to the fallback',
    (kind) => {
      const dials = SHAPE_PARAMS[kind]!.params;
      const explicit = Object.fromEntries(dials.map((p) => [p.field, p.fallback]));
      const untouched = contourBounds(shapeToPath(box(kind, 140, 100)));
      const stated = contourBounds(shapeToPath(box(kind, 140, 100, explicit)));
      expect(stated).toEqual(untouched);

      const untouchedFeatures = shapeFeaturePaths(box(kind, 140, 100));
      const statedFeatures = shapeFeaturePaths(box(kind, 140, 100, explicit));
      expect(statedFeatures).toEqual(untouchedFeatures);
    }
  );

  it('holds a value from outside the bounds rather than drawing it', () => {
    const wild = shapeToPath(box('cross', 120, 120, { armRatio: 40 }));
    const capped = shapeToPath(box('cross', 120, 120, { armRatio: 0.8 }));
    expect(contourBounds(wild)).toEqual(contourBounds(capped));
  });
});

describe('shapeFeaturePaths', () => {
  it('draws the same lines in local and in world space', () => {
    for (const kind of CLOSED) {
      const local = shapeFeaturePaths(box(kind), 0, 0);
      const world = shapeFeaturePaths(box(kind), 250, 400);
      expect(world.length, kind).toBe(local.length);
      // Same commands in the same order; only the numbers move.
      for (let i = 0; i < local.length; i++) {
        expect(world[i].replace(/-?[\d.]+/g, '#')).toBe(local[i].replace(/-?[\d.]+/g, '#'));
      }
    }
  });

  it('is empty for the shapes whose silhouette is the whole story', () => {
    for (const kind of ['rect', 'ellipse', 'diamond', 'star', 'heart', 'cloud'] as ShapeKind[]) {
      expect(shapeFeaturePaths(box(kind)), kind).toEqual([]);
    }
  });
});

describe('the kind-level radius', () => {
  /**
   * A phone, a browser window, a chip and an envelope are round-cornered
   * because of what they are. `shapeToPath` used to rebuild the four corners
   * from the stored radius alone, so all four flattened, exported and sketched
   * with square corners while the canvas drew them round.
   */
  it.each(['mobile', 'browser', 'terminal', 'mail', 'wallet'] as ShapeKind[])(
    '%s is rounded with nothing in the document',
    (kind) => {
      const outline = shapeOutline(box(kind, 200, 200));
      expect(outline.kind).toBe('rect');
      if (outline.kind !== 'rect') return;
      expect(Math.min(...outline.radii)).toBeGreaterThan(0);

      // And the real outline agrees: a square-cornered box has four anchors.
      const path = shapeToPath(box(kind, 200, 200));
      expect(subpathsOf(path)[0].segments.length).toBeGreaterThan(4);
    }
  );

  it('lets the document ask for more, never for less', () => {
    const outline = shapeOutline({ ...box('mobile', 200, 200), appearance: { cornerRadius: 90 } });
    if (outline.kind !== 'rect') throw new Error('expected a rect');
    expect(Math.max(...outline.radii)).toBe(90);
  });
});

describe('a sketched shape with a hole', () => {
  /**
   * Every sketcher took one ring, and five kinds are compound. Passing their
   * contours concatenated invents an edge from the end of one to the start of
   * the next: a stray stroke across the drawing, and a false crossing in the
   * shading's scanline that let the hachure run straight through the hole.
   */
  const sketched = (kind: ShapeKind, fillStyle: 'solid' | 'hachure') =>
    roughShape(
      {
        id: 'seed',
        geometry: { kind },
        width: 240,
        height: 240,
        appearance: { sketch: 'medium', fillStyle, stroke: { color: '#000', width: 2 } },
      } as never,
      true
    );

  it.each(['donut', 'gear', 'key', 'user'])('%s is drawn as more than one contour', (kind) => {
    const { outline, silhouette } = sketched(kind as ShapeKind, 'solid');
    // One `M` per contour in the fill boundary; the outline's stroke count is
    // higher because a loop is drawn in several passes.
    expect((silhouette.match(/M/g) ?? []).length).toBeGreaterThan(1);
    expect(outline.length).toBeGreaterThan(0);
  });

  it('shades around the hole rather than through it', () => {
    const ring = sketched('donut', 'hachure').fill;
    const disc = sketched('ellipse', 'hachure').fill;
    const strokes = (d: string) => (d.match(/M/g) ?? []).length;
    // A ring's scanline crosses four edges on most rows and so produces *two*
    // spans where a disc produces one — more strokes, each shorter. Before the
    // passes took contours it produced one span straight across the hole, and
    // so had *fewer* strokes than the disc rather than more.
    expect(strokes(ring)).toBeGreaterThan(strokes(disc));
  });
});

describe('the generators the exporter shares', () => {
  it('starts a polygon at twelve o’clock and runs clockwise', () => {
    const pts = regularPolygonPoints(0, 0, 4, 10, 10);
    expect(pts[0]).toEqual({ x: expect.closeTo(0, 6), y: -10 });
    expect(pts[1].x).toBeGreaterThan(0);
  });

  it('alternates a star’s tips and valleys', () => {
    const pts = starPoints(0, 0, 5, 0.5, 10, 10);
    expect(pts).toHaveLength(10);
    expect(Math.hypot(pts[0].x, pts[0].y)).toBeCloseTo(10, 6);
    expect(Math.hypot(pts[1].x, pts[1].y)).toBeCloseTo(5, 6);
  });

  it('formats a point list for an SVG polygon', () => {
    expect(pointsAttribute([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('1,2 3,4');
  });
});
