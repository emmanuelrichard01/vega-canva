import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sketch system end to end: which objects are sketched (the board's mode
 * and each object's override), that a drawing is the same on the canvas and in
 * the exported file, and that every fill style stays inside the shape it
 * shades.
 */

let objects: Record<string, unknown> = {};

vi.mock('../../hooks/useStore', () => ({
  useStore: { getState: () => ({ objects, selectedIds: [] }) },
}));
vi.mock('../export/inlineImages', () => ({
  inlineImageSources: async () => ({ embedded: new Map() }),
  fetchBlob: async () => null,
}));

const { SVGExporter } = await import('../export/SVGExporter');
const { normalizeNode } = await import('../document/normalize');
const { roughLineCaps, roughShape } = await import('./roughShape');
const { roughPencil, roughStickyPaper } = await import('./roughNodes');
const { FILL_STYLES, SHADING_DENSITIES, SKETCH_LEVELS, asRings, seedFrom, shapeFill } = await import('./rough');
const { shapeOutline } = await import('./shapeOutline');
const { flattenPath, subpathsOf } = await import('./pathGeometry');
const { boardSketchFor, lookPatch, parseBoardSketch, resolveSketch, sketchPatch, sketchSource } = await import(
  './roughMode'
);
type ShapeNode = import('./schema').ShapeNode;
type Point = import('./schema').Point;

// ---------------------------------------------------------------- helpers

/** Every absolute point a path visits (M/L/C/Q pairs, relative `l` resolved). */
function pathPoints(d: string): Point[] {
  const out: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  for (const [, cmd, body] of d.matchAll(/([MLCQZmlcqz])([^MLCQZmlcqz]*)/g)) {
    const nums = (body.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      cur = cmd === 'l' ? { x: cur.x + nums[i], y: cur.y + nums[i + 1] } : { x: nums[i], y: nums[i + 1] };
      out.push(cur);
    }
  }
  return out;
}

/** Even-odd point-in-polygon over several rings, so a hole counts as outside. */
function inside(rings: readonly (readonly Point[])[], p: Point): boolean {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
  }
  return hit;
}

function shape(id: string, kind: string, appearance: Record<string, unknown> = {}, size = { w: 180, h: 120 }): ShapeNode {
  return normalizeNode({
    id,
    type: 'shape',
    x: 40,
    y: 30,
    width: size.w,
    height: size.h,
    zIndex: 1,
    geometry: { kind },
    appearance: { fill: [{ type: 'solid', color: '#ffd166' }], stroke: { color: '#1f2937', width: 2 }, ...appearance },
  }) as ShapeNode;
}

/** The contours a shape's shading is clipped against, as `roughShape` builds them. */
function ringsOf(node: ShapeNode): Point[][] {
  const outline = shapeOutline(node);
  if (outline.kind === 'bezier') return subpathsOf(outline.geometry).map((sub) => flattenPath(sub));
  if (outline.kind === 'polygon') return [outline.points];
  if (outline.kind === 'ellipse') {
    return [
      Array.from({ length: 96 }, (_, i) => {
        const t = (i / 96) * Math.PI * 2;
        return { x: outline.cx + Math.cos(t) * outline.rx, y: outline.cy + Math.sin(t) * outline.ry };
      }),
    ];
  }
  return [
    [
      { x: 0, y: 0 },
      { x: node.width, y: 0 },
      { x: node.width, y: node.height },
      { x: 0, y: node.height },
    ],
  ];
}

// ---------------------------------------------------------------- the rules

describe('which objects are sketched', () => {
  it('follows the board unless the object says otherwise', () => {
    expect(resolveSketch({}, null)).toBeUndefined();
    expect(resolveSketch({}, 'heavy')).toBe('heavy');
    expect(resolveSketch({ sketch: 'light' }, 'heavy')).toBe('light');
    expect(resolveSketch({ sketch: 'light' }, null)).toBe('light');
    expect(resolveSketch({ sketchClean: true }, 'heavy')).toBeUndefined();
    expect(resolveSketch(undefined, 'medium')).toBe('medium');
  });

  it('lets a pinned level win over a stale Clean', () => {
    expect(resolveSketch({ sketch: 'medium', sketchClean: true }, 'heavy')).toBe('medium');
    expect(sketchSource({ sketch: 'medium', sketchClean: true }, 'heavy')).toBe('pinned');
  });

  it('names where the look comes from', () => {
    expect(sketchSource({}, null)).toBe('none');
    expect(sketchSource({}, 'light')).toBe('board');
    expect(sketchSource({ sketchClean: true }, 'light')).toBe('clean');
    expect(sketchSource({ sketch: 'heavy' }, 'light')).toBe('pinned');
  });

  it('reaches diagram objects and leaves pencil strokes, text and media alone', () => {
    for (const type of ['shape', 'connector', 'sticky', 'table', 'chart']) expect(boardSketchFor(type, 'medium')).toBe('medium');
    for (const type of ['path', 'text', 'image', 'icon', 'frame']) expect(boardSketchFor(type, 'medium')).toBeNull();
    expect(boardSketchFor('shape', null)).toBeNull();
  });

  it('reads only a real level off the board, so junk metadata draws crisp', () => {
    expect(parseBoardSketch('heavy')).toBe('heavy');
    for (const junk of ['', 'off', 'HEAVY', 3, null, undefined, {}]) expect(parseBoardSketch(junk)).toBeNull();
  });

  it('writes both fields on every override, so they never contradict', () => {
    expect(sketchPatch('clean', 'medium')).toEqual({ sketch: undefined, sketchClean: true });
    // On a crisp board Clean is just the absence of a level: no stray flag stored.
    expect(sketchPatch('clean', null)).toEqual({ sketch: undefined, sketchClean: undefined });
    expect(sketchPatch('follow', 'medium')).toEqual({ sketch: undefined, sketchClean: undefined });
    expect(sketchPatch('heavy', null)).toEqual({ sketch: 'heavy', sketchClean: undefined });
  });

  it('turns the look on without disturbing a pinned level, and off only when on', () => {
    expect(lookPatch('sketch', { sketch: 'heavy' }, 'light')).toBeNull();
    expect(lookPatch('sketch', {}, 'light')).toBeNull();
    expect(lookPatch('sketch', { sketchClean: true }, 'light')).toEqual({ sketch: undefined, sketchClean: undefined });
    expect(lookPatch('sketch', {}, null)).toEqual({ sketch: 'medium', sketchClean: undefined });
    expect(lookPatch('clean', {}, null)).toBeNull();
    expect(lookPatch('clean', {}, 'light')).toEqual({ sketch: undefined, sketchClean: true });
  });
});

// ---------------------------------------------------------------- stability

describe('a drawing is seeded, so it is the same drawing everywhere', () => {
  beforeEach(() => {
    objects = {};
  });

  const KINDS = ['rect', 'ellipse', 'star', 'heart', 'cylinder', 'cloud', 'donut', 'diamond', 'document'];

  it('exports the strokes the canvas draws, for every kind and fill style', async () => {
    for (const kind of KINDS) {
      for (const fillStyle of FILL_STYLES) {
        objects = {};
        const node = shape(`n-${kind}-${fillStyle}`, kind, { sketch: 'medium', fillStyle, sketchSeed: 3 });
        objects[node.id] = node;
        const svg = await new SVGExporter().export({ format: 'svg' } as never);
        // What the canvas builds: `ShapeRenderer` passes `hasFill && !open` and the resolved level.
        const canvas = roughShape(node, true, 'medium');
        expect(svg, `${kind} ${fillStyle} outline`).toContain(`d="${canvas.outline}"`);
        if (canvas.fill) expect(svg, `${kind} ${fillStyle} shading`).toContain(`d="${canvas.fill}"`);
        if (canvas.features) expect(svg, `${kind} features`).toContain(`d="${canvas.features}"`);
        if (fillStyle === 'solid') expect(svg, `${kind} silhouette`).toContain(`d="${canvas.silhouette}"`);
      }
    }
  });

  it('survives a save and reload: the stored document draws the same strokes', () => {
    const node = shape('reload', 'cloud', { sketch: 'heavy', fillStyle: 'crosshatch', sketchSeed: 2 });
    const reloaded = normalizeNode(JSON.parse(JSON.stringify(node))) as ShapeNode;
    expect(roughShape(reloaded, true)).toEqual(roughShape(node, true));
  });

  it('ignores paint: a colour change never redraws the hand', () => {
    const a = shape('paint', 'rect', { sketch: 'medium', fillStyle: 'hachure' });
    const b = shape('paint', 'rect', {
      sketch: 'medium',
      fillStyle: 'hachure',
      fill: [{ type: 'solid', color: '#06d6a0' }],
      stroke: { color: '#ef476f', width: 2 },
    });
    expect(roughShape(b, true)).toEqual(roughShape(a, true));
  });

  it('draws a board-sketched object exactly as if the level were pinned', () => {
    const pinned = shape('same', 'heart', { sketch: 'light', fillStyle: 'dots' });
    // The same node with no level of its own, as the renderer sees it on a sketched board.
    const following = { ...pinned, appearance: { ...pinned.appearance, sketch: undefined } } as ShapeNode;
    expect(roughShape(following, true, 'light')).toEqual(roughShape(pinned, true));
    expect(roughShape(following, true).outline).toBe('');
  });

  it('redraws on request and only then', () => {
    const first = roughShape(shape('redraw', 'rect', { sketch: 'medium' }), true);
    const again = roughShape(shape('redraw', 'rect', { sketch: 'medium' }), true);
    const next = roughShape(shape('redraw', 'rect', { sketch: 'medium', sketchSeed: 1 }), true);
    expect(again).toEqual(first);
    expect(next.outline).not.toBe(first.outline);
  });

  it('draws a sticky\'s paper the same way every time, and redraws it on request', () => {
    const note = { id: 'sticky-1', width: 200, height: 200 };
    const a = roughStickyPaper(note, 'medium');
    expect(roughStickyPaper(note, 'medium')).toEqual(a);
    expect(roughStickyPaper({ ...note, appearance: { sketchSeed: 0 } }, 'medium')).toEqual(a);
    expect(roughStickyPaper({ ...note, appearance: { sketchSeed: 4 } }, 'medium').outline).not.toBe(a.outline);
    expect(a.silhouette.endsWith('Z')).toBe(true);
  });

  it('draws a pencil stroke the same way every time, from its own seed', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ x: i * 6, y: Math.sin(i / 4) * 20 }));
    const stroke = { id: 'pencil-1', geometry: { points, strokeSize: 6 } };
    const a = roughPencil(stroke, 'heavy');
    expect(roughPencil(stroke, 'heavy')).toEqual(a);
    expect(a.nib).toBeCloseTo(3.96);
    expect(roughPencil({ ...stroke, appearance: { sketchSeed: 1 } }, 'heavy').d).not.toBe(a.d);
    expect(roughPencil({ ...stroke, geometry: { points: [points[0]], strokeSize: 6 } }, 'heavy').d).toBe('');
  });

  it('keeps the original drawing for every object that never asked for a redraw', () => {
    // Variant 0 and absent are the id's own seed, so no existing board changes.
    const caps = roughLineCaps(shape('line-1', 'arrow', { sketch: 'medium' }, { w: 200, h: 0 }), 'medium');
    const capsZero = roughLineCaps(shape('line-1', 'arrow', { sketch: 'medium', sketchSeed: 0 }, { w: 200, h: 0 }), 'medium');
    expect(capsZero).toEqual(caps);
    expect(seedFrom('line-1')).toBe(seedFrom('line-1'));
  });
});

describe('the export draws the objects the canvas draws', () => {
  beforeEach(() => {
    objects = {};
  });
  const exportSvg = () => new SVGExporter().export({ format: 'svg' } as never);

  it('exports a sketched arrow with its hand-drawn heads', async () => {
    const node = normalizeNode({
      ...shape('arrow-x', 'arrow', { sketch: 'medium' }, { w: 240, h: 0 }),
      geometry: { kind: 'arrow', endEnd: 'triangle' },
    }) as ShapeNode;
    objects[node.id] = node;
    const svg = await exportSvg();
    const caps = roughLineCaps(node, 'medium');
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) expect(svg).toContain(`d="${cap}"`);
  });

  it('fills a gradient shape through the drawn silhouette', async () => {
    const node = shape('grad', 'rect', {
      sketch: 'medium',
      fill: [{ type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] }],
    });
    objects[node.id] = node;
    const svg = await exportSvg();
    expect(svg).toContain(`d="${roughShape(node, true, 'medium').silhouette}"`);
    expect(svg).toMatch(/fill="url\(#/);
  });

  it('exports a sketched sticky as its hand-cut paper', async () => {
    const node = normalizeNode({
      id: 'st-x', type: 'sticky', x: 10, y: 10, width: 160, height: 120, zIndex: 1, text: 'hi', theme: 'yellow',
      appearance: { sketch: 'heavy' },
    }) as never as { id: string; width: number; height: number; appearance?: { sketchSeed?: number } };
    objects['st-x'] = node;
    const svg = await exportSvg();
    const paper = roughStickyPaper(node, 'heavy');
    expect(svg).toContain(`d="${paper.silhouette}"`);
    expect(svg).toContain(`d="${paper.outline}"`);
  });

  it('exports a sketched pencil stroke from its centreline, and a plain one as its outline', async () => {
    const points = [{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 80, y: 0 }, { x: 120, y: 30 }];
    const make = (id: string, appearance: Record<string, unknown>) =>
      normalizeNode({
        id, type: 'path', x: 0, y: 0, width: 120, height: 30, zIndex: 1,
        geometry: { kind: 'freehand', points, strokeSize: 6, svgPath: 'M0 0L10 10Z' },
        appearance: { stroke: { color: '#111111', width: 2 }, ...appearance },
      }) as never as { id: string; geometry: { points: { x: number; y: number }[]; strokeSize: number }; appearance?: { sketchSeed?: number } };
    const sketched = make('pen-1', { sketch: 'medium' });
    objects['pen-1'] = sketched;
    expect(await exportSvg()).toContain(`d="${roughPencil(sketched, 'medium').d}"`);
    objects = {};
    objects['pen-2'] = make('pen-2', {});
    expect(await exportSvg()).toContain('d="M0 0L10 10Z"');
  });
});

describe('a sketched arrow keeps its head', () => {
  it('draws one hand-drawn marker per end, where the crisp markers sit', () => {
    const node = shape('arrow-1', 'arrow', { sketch: 'medium' }, { w: 240, h: 0 });
    const withHeads = normalizeNode({ ...node, geometry: { ...node.geometry, endStart: 'circle', endEnd: 'triangle' } }) as ShapeNode;
    const caps = roughLineCaps(withHeads, 'medium');
    expect(caps).toHaveLength(2);
    const [start, end] = caps.map((d) => pathPoints(d));
    const mean = (ps: Point[]) => ps.reduce((s, p) => s + p.x, 0) / ps.length;
    expect(mean(start)).toBeLessThan(40);
    expect(mean(end)).toBeGreaterThan(200);
    expect(roughLineCaps(withHeads, undefined)).toEqual([]);
    // A closed shape has no ends to mark.
    expect(roughLineCaps(shape('box', 'rect', { sketch: 'medium' }), 'medium')).toEqual([]);
  });

  it('redraws the heads with the rest of the drawing', () => {
    const base = normalizeNode({
      ...shape('arrow-2', 'arrow', { sketch: 'medium' }, { w: 240, h: 0 }),
      geometry: { kind: 'arrow', endEnd: 'triangle' },
    }) as ShapeNode;
    const redrawn = normalizeNode({ ...base, appearance: { ...base.appearance, sketchSeed: 5 } }) as ShapeNode;
    expect(roughLineCaps(redrawn, 'medium')).not.toEqual(roughLineCaps(base, 'medium'));
  });
});

// ---------------------------------------------------------------- bounds

describe('every fill style stays inside the shape it shades', () => {
  const CASES: Array<[string, { w: number; h: number }]> = [
    ['rect', { w: 180, h: 120 }],
    ['ellipse', { w: 220, h: 90 }],
    ['star', { w: 160, h: 160 }],
    ['donut', { w: 160, h: 160 }],
    ['heart', { w: 140, h: 120 }],
    ['rect', { w: 24, h: 18 }],
  ];

  for (const [kind, size] of CASES) {
    it(`${kind} ${size.w}x${size.h}`, () => {
      for (const style of FILL_STYLES) {
        if (style === 'solid') continue;
        for (const level of SKETCH_LEVELS) {
          for (const density of SHADING_DENSITIES) {
            const node = shape(`b-${kind}`, kind, { sketch: level, fillStyle: style, shadingDensity: density }, size);
            const rings = ringsOf(node);
            const d = shapeFill(asRings(rings), { seed: 9, style, level, density });
            const points = pathPoints(d);
            const tag = `${kind} ${style} ${level} ${density}`;
            if (size.w > 40) expect(points.length, tag).toBeGreaterThan(0);

            // Strokes may run slightly past the edge, as a hand does, but
            // never far: a bow and an end wobble, at most a few units.
            const slack = 6;
            for (const p of points) {
              expect(p.x, tag).toBeGreaterThanOrEqual(-slack);
              expect(p.y, tag).toBeGreaterThanOrEqual(-slack);
              expect(p.x, tag).toBeLessThanOrEqual(size.w + slack);
              expect(p.y, tag).toBeLessThanOrEqual(size.h + slack);
            }

            // A dot is a mark, not a stroke: every one lands inside, and none
            // in a hole.
            if (style === 'dots') {
              const dots = points.filter((_, i) => i % 2 === 0);
              const outside = dots.filter((p) => !inside(rings, p));
              expect(outside.length, `${tag}: ${outside.length} of ${dots.length} dots outside`).toBe(0);
            }
          }
        }
      }
    });
  }

  it('shades around a hole, never across it', () => {
    const node = shape('hole', 'donut', { sketch: 'medium', fillStyle: 'hachure' }, { w: 200, h: 200 });
    const rings = ringsOf(node);
    expect(rings.length).toBeGreaterThan(1);
    const d = shapeFill(asRings(rings), { seed: 4, style: 'hachure', level: 'medium' });
    // Each stroke's midpoint (start and end of its cubic) sits in the band, not the hole.
    const strokes = d.split('M').filter(Boolean).map((s) => pathPoints(`M${s}`));
    let inHole = 0;
    for (const st of strokes) {
      const a = st[0];
      const b = st[st.length - 1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!inside(rings, mid)) inHole += 1;
    }
    expect(strokes.length).toBeGreaterThan(10);
    expect(inHole).toBe(0);
  });
});
