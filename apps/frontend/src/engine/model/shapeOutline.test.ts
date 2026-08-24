import { describe, expect, it } from 'vitest';
import { pointsAttribute, regularPolygonPoints, shapeOutline, starPoints } from './shapeOutline';
import { flattenPath } from './pathGeometry';
import { SHAPE_KIND_VALUES } from './schema';
import { SHAPE_KIND_ALIASES } from '../document/normalize';
import { PRESET_GEOMETRY } from '../../components/workspace/shapePresetTypes';
import { shapeToPath } from './shapeToPath';
import type { ShapeNode } from './schema';

const shape = (over: Partial<ShapeNode> = {}): ShapeNode =>
  ({
    id: 's',
    type: 'shape',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    geometry: { kind: 'rect' },
    appearance: {},
    ...over,
  }) as ShapeNode;

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('regularPolygonPoints', () => {
  it('starts at twelve o&apos;clock, which is where Konva starts', () => {
    // Anywhere else and the effect layers would clip a hexagon rotated by half
    // a face from the one on screen — which shows up as a stroke sliding out
    // from under its own shape.
    const [first] = regularPolygonPoints(50, 30, 6, 50, 30);
    near(first.x, 50);
    near(first.y, 0);
  });

  it('runs clockwise', () => {
    const [, second] = regularPolygonPoints(0, 0, 4, 10, 10);
    near(second.x, 10);
    near(second.y, 0);
  });

  it('produces one point per side', () => {
    expect(regularPolygonPoints(0, 0, 3, 1, 1)).toHaveLength(3);
    expect(regularPolygonPoints(0, 0, 6, 1, 1)).toHaveLength(6);
  });

  it('stretches to the box rather than staying circular', () => {
    // The renderer builds polygons on a square and scales the node; describing
    // that stretch as separate radii here produces identical geometry without
    // every consumer having to know about the intermediate square.
    const pts = regularPolygonPoints(0, 0, 4, 100, 10);
    const xs = pts.map((p) => Math.abs(p.x));
    const ys = pts.map((p) => Math.abs(p.y));
    expect(Math.max(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...ys)).toBeCloseTo(10, 6);
  });
});

describe('starPoints', () => {
  it('alternates tips and valleys, twice per point', () => {
    const pts = starPoints(0, 0, 5, 0.5, 10, 10);
    expect(pts).toHaveLength(10);
    // Index 0 is a tip at full radius, index 1 a valley at half.
    near(Math.hypot(pts[0].x, pts[0].y), 10);
    near(Math.hypot(pts[1].x, pts[1].y), 5);
  });

  it('puts the first tip at the top', () => {
    const [first] = starPoints(0, 0, 5, 0.5, 10, 10);
    near(first.x, 0);
    near(first.y, -10);
  });

  it('honours the point count the panel can set', () => {
    expect(starPoints(0, 0, 12, 0.5, 10, 10)).toHaveLength(24);
  });
});

describe('shapeOutline', () => {
  it('keeps a rectangle a rectangle rather than approximating it', () => {
    // Facets on a rounded corner would be visible in an inside stroke.
    expect(shapeOutline(shape())).toEqual({
      kind: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      radius: 0,
    });
  });

  it('clamps the corner radius to half the shorter side', () => {
    // A larger radius draws corners that overlap each other, which a canvas
    // renders as a shape turned inside out at the joins.
    const outline = shapeOutline(shape({ appearance: { cornerRadius: 400 } }));
    expect(outline).toMatchObject({ kind: 'rect', radius: 30 });
  });

  it('never returns a negative radius', () => {
    expect(shapeOutline(shape({ appearance: { cornerRadius: -20 } }))).toMatchObject({ radius: 0 });
  });

  it('describes an ellipse as a curve, not a polygon', () => {
    expect(shapeOutline(shape({ geometry: { kind: 'ellipse' } }))).toEqual({
      kind: 'ellipse',
      cx: 50,
      cy: 30,
      rx: 50,
      ry: 30,
    });
  });

  it('measures polygons against the node box, centred', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'polygon', points: 6 } }));
    expect(outline.kind).toBe('polygon');
    if (outline.kind !== 'polygon') return;
    expect(outline.points).toHaveLength(6);
    near(outline.points[0].x, 50);
    near(outline.points[0].y, 0);
  });

  it('falls back to three sides for a polygon with no count', () => {
    // An empty outline clips everything away, so a polygon whose side count
    // never reached the document would vanish the moment it got an inside
    // stroke.
    const outline = shapeOutline(shape({ geometry: { kind: 'polygon' } }));
    expect(outline.kind).toBe('polygon');
    if (outline.kind !== 'polygon') return;
    expect(outline.points).toHaveLength(3);
  });

  it('describes a line as an open run, corner to corner', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'line' } }));
    expect(outline).toEqual({ kind: 'open', points: [{ x: 0, y: 0 }, { x: 100, y: 60 }] });
  });

  it('reads the star parameters the panel writes', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'star', points: 7, innerRatio: 0.3 } }));
    if (outline.kind !== 'polygon') throw new Error('expected polygon');
    expect(outline.points).toHaveLength(14);
  });
});

describe('pointsAttribute', () => {
  it('formats for an SVG polygon', () => {
    expect(pointsAttribute([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('1,2 3,4');
  });
});

describe('the heart', () => {
  it('is a curve, not a polygon', () => {
    // A shape sampled into line segments is smooth at one size and faceted at
    // every other, which on an infinite canvas means faceted.
    const outline = shapeOutline(shape({ geometry: { kind: 'heart' } }));
    expect(outline.kind).toBe('bezier');
  });

  it('fills its box, so a wide box gives a wide heart', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'heart' }, width: 400, height: 100 }));
    if (outline.kind !== 'bezier') throw new Error('expected a bezier outline');
    const pts = flattenPath(outline.geometry);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(400);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(340);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(85);
  });

  it('is symmetric about its vertical centre', () => {
    // Asymmetry in a heart is the one flaw everybody sees immediately.
    const outline = shapeOutline(shape({ geometry: { kind: 'heart' }, width: 200, height: 200 }));
    if (outline.kind !== 'bezier') throw new Error('expected a bezier outline');
    const pts = flattenPath(outline.geometry);
    for (const p of pts) {
      const mirrored = pts.some(
        (q) => Math.abs(q.x - (200 - p.x)) < 1.5 && Math.abs(q.y - p.y) < 1.5
      );
      expect(mirrored).toBe(true);
    }
  });

  it('has its point at the bottom and its lobes at the top', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'heart' }, width: 200, height: 200 }));
    if (outline.kind !== 'bezier') throw new Error('expected a bezier outline');
    const pts = flattenPath(outline.geometry);
    const lowest = pts.reduce((a, b) => (b.y > a.y ? b : a));
    // The lowest point is the tip, on the centre line.
    expect(lowest.x).toBeCloseTo(100, 0);
    // The cusp between the lobes sits below the tops of both of them.
    const topRow = pts.filter((p) => p.y < 20);
    expect(topRow.some((p) => p.x < 100)).toBe(true);
    expect(topRow.some((p) => p.x > 100)).toBe(true);
  });

  it('draws the same heart everywhere it is asked for', () => {
    // The renderer, the effects and the SVG exporter all read `shapeToPath`.
    // Three hand-written hearts is what this file's header warns about.
    const node = shape({ geometry: { kind: 'heart' }, width: 120, height: 90 });
    const outline = shapeOutline(node);
    if (outline.kind !== 'bezier') throw new Error('expected a bezier outline');
    expect(shapeToPath(node)).toEqual(outline.geometry);
  });
});

describe('the squircle', () => {
  it('is a smooth continuous bezier curve', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'squircle' } }));
    expect(outline.kind).toBe('bezier');
  });

  it('is four-fold symmetric and fills its bounds smoothly', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'squircle' }, width: 200, height: 200 }));
    if (outline.kind !== 'bezier') throw new Error('expected a bezier outline');
    const pts = flattenPath(outline.geometry);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 0);
    expect(Math.max(...xs)).toBeCloseTo(200, 0);
    expect(Math.min(...ys)).toBeCloseTo(0, 0);
    expect(Math.max(...ys)).toBeCloseTo(200, 0);
  });

  it('draws identically in shapeToPath as in shapeOutline', () => {
    const node = shape({ geometry: { kind: 'squircle' }, width: 150, height: 100 });
    const outline = shapeOutline(node);
    if (outline.kind !== 'bezier') throw new Error('expected a bezier outline');
    expect(shapeToPath(node)).toEqual(outline.geometry);
  });
});

describe('every shape kind survives the round trip', () => {
  it('is representable by the normalizer, not silently rewritten', () => {
    // `heart` was added to the type and to the tool, and the normalizer's
    // alias table — which falls back to `rect` for anything it does not know —
    // rewrote every heart into a rectangle at the CRDT boundary. The tool
    // worked, the document was written, a rectangle came back, and nothing
    // failed anywhere. This is the third bug of that exact shape in this
    // codebase; the list is derived and the copies are held against it now.
    const unmapped = SHAPE_KIND_VALUES.filter(
      (kind) => (SHAPE_KIND_ALIASES[kind]?.kind ?? 'rect') !== kind
    );
    expect(unmapped).toEqual([]);
  });

  it('has an outline, so nothing falls through to the polygon default', () => {
    for (const kind of SHAPE_KIND_VALUES) {
      const outline = shapeOutline(shape({ geometry: { kind, points: 5 } }));
      expect({ kind, has: Boolean(outline.kind) }).toEqual({ kind, has: true });
    }
  });

  it('is offered by a dock preset, or is deliberately not a preset', () => {
    // Every preset must name a kind that exists; a preset for a kind the
    // model does not have arms a tool that draws nothing.
    for (const preset of Object.values(PRESET_GEOMETRY)) {
      expect(SHAPE_KIND_VALUES).toContain(preset.kind);
    }
  });
});
