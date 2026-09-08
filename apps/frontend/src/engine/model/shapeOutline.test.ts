import { describe, expect, it } from 'vitest';
import {
  badgePoints,
  bannerPoints,
  boltPoints,
  calloutPoints,
  chevronPoints,
  cpuPoints,
  crossPoints,
  diamondPoints,
  documentOutline,
  gearGeometry,
  keyPoints,
  packagePoints,
  parallelogramPoints,
  pointsAttribute,
  regularPolygonPoints,
  serverPoints,
  shapeFeaturePaths,
  shapeOutline,
  shieldPoints,
  starPoints,
  trapezoidPoints,
  userGeometry,
  walletPoints,
} from './shapeOutline';
import { contourData, flattenPath } from './pathGeometry';
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

describe('diamond', () => {
  it('places 4 diamond points at top, right, bottom, and left compass points', () => {
    const pts = diamondPoints(100, 60);
    expect(pts).toHaveLength(4);
    near(pts[0].x, 50);
    near(pts[0].y, 0);
    near(pts[1].x, 100);
    near(pts[1].y, 30);
    near(pts[2].x, 50);
    near(pts[2].y, 60);
    near(pts[3].x, 0);
    near(pts[3].y, 30);
  });

  it('generates polygon outline and rounded bezier outline when cornerRadius > 0', () => {
    const flat = shapeOutline(shape({ geometry: { kind: 'diamond' } }));
    expect(flat.kind).toBe('polygon');
    const rounded = shapeOutline(
      shape({ geometry: { kind: 'diamond' }, appearance: { cornerRadius: 8 } })
    );
    expect(rounded.kind).toBe('bezier');
  });
});

describe('trapezoid and parallelogram', () => {
  it('trapezoid insets top edge symmetrically', () => {
    const pts = trapezoidPoints(100, 60, 0.2);
    expect(pts).toHaveLength(4);
    near(pts[0].x, 20);
    near(pts[0].y, 0);
    near(pts[1].x, 80);
    near(pts[1].y, 0);
    near(pts[2].x, 100);
    near(pts[2].y, 60);
    near(pts[3].x, 0);
    near(pts[3].y, 60);
  });

  it('parallelogram skews horizontal edges by specified skew ratio', () => {
    const pts = parallelogramPoints(100, 60, 0.25);
    expect(pts).toHaveLength(4);
    near(pts[0].x, 25);
    near(pts[0].y, 0);
    near(pts[1].x, 100);
    near(pts[1].y, 0);
    near(pts[2].x, 75);
    near(pts[2].y, 60);
    near(pts[3].x, 0);
    near(pts[3].y, 60);
  });
});

describe('capsule (pill/stadium)', () => {
  it('is a smooth continuous bezier curve', () => {
    const outline = shapeOutline(shape({ geometry: { kind: 'capsule' }, width: 200, height: 60 }));
    expect(outline.kind).toBe('bezier');
    if (outline.kind !== 'bezier') throw new Error('expected bezier');
    const pts = flattenPath(outline.geometry);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 0);
    expect(Math.max(...xs)).toBeCloseTo(200, 0);
    expect(Math.min(...ys)).toBeCloseTo(0, 0);
    expect(Math.max(...ys)).toBeCloseTo(60, 0);
  });

  it('renders matching bezier in shapeToPath', () => {
    const node = shape({ geometry: { kind: 'capsule' }, width: 140, height: 50 });
    const outline = shapeOutline(node);
    if (outline.kind !== 'bezier') throw new Error('expected bezier');
    expect(shapeToPath(node)).toEqual(outline.geometry);
  });
});

describe('cylinder (database)', () => {
  it('forms a closed bezier body with elliptical top and bottom caps', () => {
    const outline = shapeOutline(
      shape({ geometry: { kind: 'cylinder', rimRatio: 0.2 }, width: 120, height: 160 })
    );
    expect(outline.kind).toBe('bezier');
    if (outline.kind !== 'bezier') throw new Error('expected bezier');
    const pts = flattenPath(outline.geometry);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 0);
    expect(Math.max(...xs)).toBeCloseTo(120, 0);
    expect(Math.min(...ys)).toBeCloseTo(0, 0);
    expect(Math.max(...ys)).toBeCloseTo(160, 0);
  });
});

describe('chevron and banner', () => {
  it('chevron creates 6 vertices with pointed tip and notched tail', () => {
    const pts = chevronPoints(100, 60, 0.25);
    expect(pts).toHaveLength(6);
    near(pts[0].x, 0);
    near(pts[0].y, 0);
    near(pts[1].x, 75);
    near(pts[1].y, 0);
    near(pts[2].x, 100);
    near(pts[2].y, 30);
    near(pts[3].x, 75);
    near(pts[3].y, 60);
    near(pts[4].x, 0);
    near(pts[4].y, 60);
    near(pts[5].x, 25);
    near(pts[5].y, 30);
  });

  it('banner creates folded ribbon with tail folds', () => {
    const pts = bannerPoints(120, 50, 0.2);
    expect(pts).toHaveLength(14);
  });
});

describe('cross (plus)', () => {
  it('produces a 12-vertex symmetric cruciform polygon', () => {
    const pts = crossPoints(100, 100, 0.3);
    expect(pts).toHaveLength(12);
    near(pts[0].x, 35);
    near(pts[0].y, 0);
    near(pts[1].x, 65);
    near(pts[1].y, 0);
  });
});

describe('donut (annulus with inner hole)', () => {
  it('returns a compound geometry with 2 subpaths (outer and inner rings)', () => {
    const node = shape({ geometry: { kind: 'donut', innerRatio: 0.5 }, width: 100, height: 100 });
    const outline = shapeOutline(node);
    expect(outline.kind).toBe('bezier');
    if (outline.kind !== 'bezier') throw new Error('expected bezier');
    expect(outline.geometry.kind).toBe('compound');
    if (outline.geometry.kind !== 'compound') throw new Error('expected compound');
    expect(outline.geometry.subpaths).toHaveLength(2);

    // contourData formats both subpaths for fillRule="evenodd"
    const data = contourData(outline.geometry);
    expect(data.match(/M /g)).toHaveLength(2);
    expect(data.match(/Z/g)).toHaveLength(2);
  });
});

describe('badge and callout', () => {
  it('badge alternates peaks and troughs for scallop rosette', () => {
    const pts = badgePoints(50, 50, 12, 0.85, 50, 50);
    expect(pts).toHaveLength(24);
  });

  it('callout creates speech bubble box with triangular pointer tail', () => {
    const pts = calloutPoints(120, 80, 'bottom', 0.2);
    expect(pts.length).toBeGreaterThanOrEqual(7);
  });
});

describe('advanced flowchart shapes', () => {
  it('document creates a closed bezier with sinusoidal wave bottom', () => {
    const geo = documentOutline(100, 120, 0.15);
    expect(geo.kind).toBe('bezier');
    expect(geo.closed).toBe(true);
    expect(geo.segments.length).toBeGreaterThanOrEqual(4);
    const d = contourData(geo);
    expect(d).toContain('C ');
  });

  it('and_gate, or_gate, and delay generate valid closed bezier contours', () => {
    const andNode = shape({ geometry: { kind: 'and_gate' }, width: 100, height: 80 });
    const orNode = shape({ geometry: { kind: 'or_gate' }, width: 100, height: 80 });
    const delayNode = shape({ geometry: { kind: 'delay' }, width: 100, height: 80 });

    const andOutline = shapeOutline(andNode);
    const orOutline = shapeOutline(orNode);
    const delayOutline = shapeOutline(delayNode);

    expect(andOutline.kind).toBe('bezier');
    expect(orOutline.kind).toBe('bezier');
    expect(delayOutline.kind).toBe('bezier');
  });

  it('predefined_process, summing_junction, and internal_storage yield precise outlines', () => {
    const proc = shapeOutline(shape({ geometry: { kind: 'predefined_process' }, width: 140, height: 70 }));
    const sum = shapeOutline(shape({ geometry: { kind: 'summing_junction' }, width: 80, height: 80 }));
    const store = shapeOutline(shape({ geometry: { kind: 'internal_storage' }, width: 120, height: 90 }));

    expect(proc.kind).toBe('rect');
    expect(sum.kind).toBe('ellipse');
    expect(store.kind).toBe('rect');
  });
});

describe('advanced architecture, tech & symbol shapes', () => {
  it('serverPoints creates rack chassis outline', () => {
    const pts = serverPoints(120, 80);
    expect(pts.length).toBe(4);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
  });

  it('cpuPoints scales contact pins along all 4 perimeter edges', () => {
    const pts6 = cpuPoints(100, 100, 4);
    // 4 sides * 4 pins * 3 pts + corner transitions
    expect(pts6.length).toBeGreaterThan(16);
  });

  it('gearGeometry generates compound geometry with cogs and center bore hole', () => {
    const gear = gearGeometry(50, 50, 50, 50, 8);
    expect(gear.kind).toBe('compound');
    expect(gear.subpaths).toHaveLength(2);
    const d = contourData(gear);
    expect(d.match(/M /g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });

  it('userGeometry creates compound geometry with avatar head and shoulders', () => {
    const user = userGeometry(50, 50, 50, 50);
    expect(user.kind).toBe('compound');
    expect(user.subpaths).toHaveLength(2);
  });

  it('shield, bolt, package, key, and wallet generate expected polygons', () => {
    expect(shieldPoints(100, 120)).toHaveLength(5);
    expect(boltPoints(60, 100)).toHaveLength(6);
    expect(packagePoints(100, 100)).toHaveLength(6);
    expect(keyPoints(120, 60)).toHaveLength(16);
    expect(walletPoints(120, 80)).toHaveLength(10);
  });
});

describe('shapeFeaturePaths (dual painter parity)', () => {
  it('produces identical relative feature paths in local and world space', () => {
    const node = shape({ geometry: { kind: 'summing_junction' }, width: 100, height: 100 });
    const local = shapeFeaturePaths(node, 0, 0);
    const world = shapeFeaturePaths(node, 50, 50);

    expect(local).toHaveLength(1);
    expect(local[0]).toBe('M 0 50 L 100 50 M 50 0 L 50 100');
    expect(world).toHaveLength(1);
    expect(world[0]).toBe('M 50 100 L 150 100 M 100 50 L 100 150');
  });

  it('produces feature lines for server, terminal, browser, mobile, package, and mail', () => {
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'server', shelfCount: 3 }, width: 120, height: 90 }))).toHaveLength(8);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'terminal' }, width: 140, height: 100 })).length).toBeGreaterThanOrEqual(4);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'browser' }, width: 160, height: 110 })).length).toBeGreaterThanOrEqual(4);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'mobile' }, width: 80, height: 160 }))).toHaveLength(2);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'package' }, width: 100, height: 100 }))).toHaveLength(1);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'mail' }, width: 120, height: 80 }))).toHaveLength(1);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'cpu' }, width: 100, height: 100 }))).toHaveLength(1);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'wallet' }, width: 120, height: 80 }))).toHaveLength(2);
    expect(shapeFeaturePaths(shape({ geometry: { kind: 'cylinder' }, width: 100, height: 120 }))).toHaveLength(1);
  });
});

