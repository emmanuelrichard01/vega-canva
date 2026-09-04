import { describe, expect, it } from 'vitest';
import { isCanonical, normalizeNode } from './normalize';
import { MATERIAL_IDS } from '../../utils/behaviorSystem';
import type { ShapeNode, StickyNode, TextNode, PathNode, ImageNode, AudioNode } from '../model/schema';

/**
 * These fixtures are real pre-v2 node shapes, taken from what the old tools
 * actually persisted — not from what the old schema *claimed* they persisted.
 * That divergence is the entire reason this layer exists.
 */

describe('normalizeNode — legacy shapes', () => {
  it('maps a legacy shape node onto geometry + appearance', () => {
    const legacy = {
      id: 'a1',
      type: 'shape',
      x: 260,
      y: -140,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      zIndex: 1785009520064,
      createdBy: 'guest',
      createdAt: 1785009520064,
      content: { shapeType: 'rect', fill: '#e9a81c', stroke: '#625b5b', width: 120, height: 100 },
      locked: false,
    };

    const node = normalizeNode(legacy) as ShapeNode;

    expect(node.type).toBe('shape');
    // Size was only ever in `content` here.
    expect(node.width).toBe(120);
    expect(node.height).toBe(100);
    expect(node.geometry.kind).toBe('rect');
    expect(node.appearance.fill?.[0]).toEqual({ type: 'solid', color: '#e9a81c' });
    expect(node.appearance.stroke?.color).toBe('#625b5b');
    expect(node.hidden).toBe(false);
    // No legacy carrier survives.
    expect((node as unknown as Record<string, unknown>).content).toBeUndefined();
  });

  describe('star geometry', () => {
    const starOf = (geometry: Record<string, unknown>) =>
      (normalizeNode({ id: 'st1', type: 'shape', x: 0, y: 0, width: 10, height: 10, geometry }) as ShapeNode)
        .geometry;

    it('defaults to a five-pointed star at half depth', () => {
      expect(starOf({ kind: 'star' })).toEqual({ kind: 'star', points: 5, innerRatio: 0.5 });
    });

    it('keeps values inside the range', () => {
      expect(starOf({ kind: 'star', points: 9, innerRatio: 0.3 })).toEqual({
        kind: 'star', points: 9, innerRatio: 0.3,
      });
    });

    it('clamps degenerate point counts rather than drawing them', () => {
      // Two points is a pair of crossed spikes, not a star, and there is no
      // way back to a sane value from the control once it is stored.
      expect(starOf({ kind: 'star', points: 2 }).points).toBe(3);
      expect(starOf({ kind: 'star', points: 0 }).points).toBe(3);
      expect(starOf({ kind: 'star', points: -8 }).points).toBe(3);
      expect(starOf({ kind: 'star', points: 5000 }).points).toBe(60);
    });

    it('rounds a fractional point count', () => {
      expect(starOf({ kind: 'star', points: 6.7 }).points).toBe(7);
    });

    it('clamps a degenerate inner radius', () => {
      // Zero draws lines to the centre; above 1 turns the star inside out.
      expect(starOf({ kind: 'star', innerRatio: 0 }).innerRatio).toBe(0.05);
      expect(starOf({ kind: 'star', innerRatio: -3 }).innerRatio).toBe(0.05);
      expect(starOf({ kind: 'star', innerRatio: 4 }).innerRatio).toBe(1);
    });

    it('falls back for non-finite values', () => {
      expect(starOf({ kind: 'star', points: NaN, innerRatio: Infinity })).toEqual({
        kind: 'star', points: 5, innerRatio: 0.5,
      });
    });

    it('keeps the count on a polygon and drops the ratio', () => {
      // `points` is now shared: it is a star's point count and a polygon's
      // side count, which is one quantity with one control. `innerRatio` is
      // still star-only, and carrying it on a hexagon would be a field
      // nothing reads — the thing this pass exists to remove.
      expect(starOf({ kind: 'hexagon', points: 9, innerRatio: 0.2 })).toEqual({
        kind: 'polygon',
        points: 9,
      });
    });

    it('clamps a polygon to a side count that can be drawn', () => {
      // Two sides is a degenerate line and one is a point; past sixty a
      // polygon is the ellipse primitive with more work.
      expect(starOf({ kind: 'polygon', points: 1 })).toEqual({ kind: 'polygon', points: 3 });
      expect(starOf({ kind: 'polygon', points: 999 })).toEqual({ kind: 'polygon', points: 60 });
    });

    it('takes the named preset as a fallback, not an override', () => {
      // A document that says `triangle` and stores six sides was edited after
      // it was created, and the edit is the more recent statement of intent.
      expect(starOf({ kind: 'triangle' })).toEqual({ kind: 'polygon', points: 3 });
      expect(starOf({ kind: 'triangle', points: 6 })).toEqual({ kind: 'polygon', points: 6 });
      expect(starOf({ kind: 'octagon' })).toEqual({ kind: 'polygon', points: 8 });
    });

    it('gives an arrow a head and a line none', () => {
      // Ends are `EndCapKind` now, the same vocabulary a connector uses — a
      // line and a connector are both a run with two ends, and which tool drew
      // it should not decide which heads are available.
      expect(starOf({ kind: 'arrow' })).toEqual({ kind: 'arrow', endStart: 'none', endEnd: 'arrow' });
      expect(starOf({ kind: 'line' })).toEqual({ kind: 'line', endStart: 'none', endEnd: 'none' });
      // A stored head outranks the kind's default, so a line given one keeps it.
      expect(starOf({ kind: 'line', arrowEnd: true })).toMatchObject({ endEnd: 'arrow' });
      // And the legacy booleans still map across, so old boards are unchanged.
      expect(starOf({ kind: 'line', arrowStart: true })).toMatchObject({ endStart: 'arrow' });
      // A richer stored style wins over the boolean it supersedes.
      expect(starOf({ kind: 'line', endEnd: 'diamond' })).toMatchObject({ endEnd: 'diamond' });
    });
  });

  describe('stroke dash', () => {
    const strokeOf = (stroke: unknown) =>
      (normalizeNode({ id: 's1', type: 'shape', x: 0, y: 0, width: 10, height: 10, appearance: { stroke } }) as ShapeNode)
        .appearance.stroke;

    it('keeps a valid pattern and a valid cap', () => {
      expect(strokeOf({ color: '#000', width: 2, dash: [6, 4], cap: 'round' })).toEqual({
        color: '#000',
        width: 2,
        dash: [6, 4],
        cap: 'round',
      });
    });

    it('drops a pattern containing a non-finite or negative segment', () => {
      // `setLineDash` throws on these, and one bad entry from a corrupt
      // document would take down the whole render rather than this outline.
      for (const dash of [[6, NaN], [6, -2], [Infinity], [6, '4']]) {
        expect(strokeOf({ color: '#000', width: 2, dash })?.dash).toBeUndefined();
      }
    });

    it('drops an empty and an all-zero pattern', () => {
      // An all-zero pattern is an invisible line, not a dash.
      expect(strokeOf({ color: '#000', width: 2, dash: [] })?.dash).toBeUndefined();
      expect(strokeOf({ color: '#000', width: 2, dash: [0, 0] })?.dash).toBeUndefined();
    });

    it('keeps a zero-length segment when something else in the pattern is drawn', () => {
      // This is exactly how a dotted line is spelled.
      expect(strokeOf({ color: '#000', width: 2, dash: [0, 4] })?.dash).toEqual([0, 4]);
    });

    it('rejects a cap it does not recognise, without dropping the stroke', () => {
      const stroke = strokeOf({ color: '#000', width: 2, cap: 'triangle' });
      expect(stroke?.color).toBe('#000');
      expect(stroke?.cap).toBeUndefined();
    });

    it('never writes an undefined dash key into the normalized value', () => {
      // A literal `undefined` nested inside `appearance` survives `toJSON()`
      // and defeats the `?? fallback` reads downstream.
      const stroke = strokeOf({ color: '#000', width: 2 });
      expect(Object.hasOwn(stroke!, 'dash')).toBe(false);
      expect(Object.hasOwn(stroke!, 'cap')).toBe(false);
    });
  });

  it('reads size from geometry when content has none', () => {
    const node = normalizeNode({
      id: 'a2', type: 'shape', x: 0, y: 0,
      geometry: { kind: 'ellipse', width: 190, height: 120, cornerRadius: 8 },
    }) as ShapeNode;

    expect(node.width).toBe(190);
    expect(node.height).toBe(120);
    expect(node.geometry.kind).toBe('ellipse');
    // cornerRadius is a paint concern in the canonical model.
    expect(node.appearance.cornerRadius).toBe(8);
  });

  it('gives the legacy "polygon" kind three sides', () => {
    // The old "polygon" tool always drew a 3-sided RegularPolygon, and the
    // name now means a real polygon with a side count. A document written by
    // that tool has to keep the shape it had.
    const node = normalizeNode({ id: 'a3', type: 'shape', content: { shapeType: 'polygon' } }) as ShapeNode;
    expect(node.geometry).toEqual({ kind: 'polygon', points: 3 });
  });

  it('treats the legacy "circle" kind as an ellipse', () => {
    const node = normalizeNode({ id: 'a4', type: 'shape', geometry: { kind: 'circle' } }) as ShapeNode;
    expect(node.geometry.kind).toBe('ellipse');
  });

  it('splits legacy text styling into orthogonal typography fields', () => {
    const node = normalizeNode({
      id: 'b1',
      type: 'text',
      width: 200,
      height: 40,
      content: {
        text: 'Hello',
        color: '#111827',
        fontFamily: 'Inter',
        fontSize: 28,
        // Weight encoded in the free-form style string, the old way.
        fontStyle: 'bold italic',
        textDecoration: 'underline',
        // The UI wrote `textAlign`; the renderer read `align`.
        textAlign: 'right',
        lineHeight: 1.6,
        letterSpacing: 2,
      },
    }) as TextNode;

    expect(node.text).toBe('Hello');
    expect(node.typography.fontWeight).toBe(700);
    expect(node.typography.italic).toBe(true);
    expect(node.typography.underline).toBe(true);
    expect(node.typography.align).toBe('right');
    expect(node.typography.fontSize).toBe(28);
    expect(node.typography.letterSpacing).toBe(2);
  });

  it('prefers a numeric fontWeight over the style string', () => {
    const node = normalizeNode({
      id: 'b2', type: 'text', content: { fontWeight: 400, fontStyle: 'italic' },
    }) as TextNode;
    expect(node.typography.fontWeight).toBe(400);
    expect(node.typography.italic).toBe(true);
  });

  it('discards placeholder strings that were persisted as real content', () => {
    for (const placeholder of ['Double click to edit', 'Write something...', 'Add comment...']) {
      const node = normalizeNode({ id: 'c', type: 'text', content: { text: placeholder } }) as TextNode;
      expect(node.text).toBe('');
    }
  });

  it('lifts sticky theme, author and reactions out of appearance/metadata', () => {
    const node = normalizeNode({
      id: 'd1',
      type: 'sticky',
      width: 200,
      height: 200,
      text: 'stale top-level text',
      content: { text: 'the edited text', fontSize: 22 },
      appearance: { theme: 'mint' },
      metadata: {
        authorId: '3298301619',
        authorName: 'Emmanuel',
        authorColor: '#EF4444',
        reactions: { '👍': 2 },
        tags: ['x'],
        pinned: true,
      },
    }) as StickyNode;

    // content.text wins: that is where the editor committed, while the
    // renderer read the stale top-level field.
    expect(node.text).toBe('the edited text');
    expect(node.theme).toBe('mint');
    expect(node.fontSize).toBe(22);
    expect(node.author).toEqual({ id: '3298301619', name: 'Emmanuel', color: '#EF4444' });
    // A legacy bare count carries no idea who reacted, so it is preserved as
    // synthetic reactors rather than discarded: the tally a room already had
    // survives, and no real author id can collide with these.
    expect(node.reactions).toEqual({ '👍': ['legacy:👍:0', 'legacy:👍:1'] });
    expect(node.pinned).toBe(true);
    expect(node.tags).toEqual(['x']);
  });

  it('keeps a modern reaction list as it is, minus duplicates', () => {
    const node = normalizeNode({
      id: 'd3',
      type: 'sticky',
      reactions: { '👍': ['u1', 'u2', 'u1'], '🎉': ['u3'] },
    }) as StickyNode;
    expect(node.reactions).toEqual({ '👍': ['u1', 'u2'], '🎉': ['u3'] });
  });

  it('drops reaction entries that carry nothing usable', () => {
    const node = normalizeNode({
      id: 'd4',
      type: 'sticky',
      reactions: { '👍': [], '🎉': 0, '🔥': null, '💡': 'nope' },
    }) as StickyNode;
    expect(node.reactions).toEqual({});
  });

  it('bounds a corrupt reaction count instead of building a huge array', () => {
    const node = normalizeNode({
      id: 'd5',
      type: 'sticky',
      reactions: { '👍': 1e9 },
    }) as StickyNode;
    expect(node.reactions['👍']).toHaveLength(99);
  });

  it('falls back to yellow for an unknown sticky theme', () => {
    const node = normalizeNode({ id: 'd2', type: 'sticky', appearance: { theme: 'chartreuse' } }) as StickyNode;
    expect(node.theme).toBe('yellow');
  });

  it('resolves the asset URL from either assetId or content.url', () => {
    const fromAssetId = normalizeNode({ id: 'e1', type: 'image', assetId: 'https://cdn/x.png' }) as ImageNode;
    const fromContent = normalizeNode({ id: 'e2', type: 'image', content: { url: 'https://cdn/y.png' } }) as ImageNode;
    // assetId is authoritative when the two disagree — that mismatch is what
    // left images pointing at a dead blob: URL after upload.
    const both = normalizeNode({
      id: 'e3', type: 'image', assetId: 'https://cdn/real.png', content: { url: 'blob:stale' },
    }) as ImageNode;

    expect(fromAssetId.src).toBe('https://cdn/x.png');
    expect(fromContent.src).toBe('https://cdn/y.png');
    expect(both.src).toBe('https://cdn/real.png');
  });

  it('maps bezier and freehand paths onto discriminated geometry', () => {
    const bezier = normalizeNode({
      id: 'f1', type: 'path',
      segments: [{ x: 0, y: 0 }, { x: 10, y: 10, cp1x: 2, cp1y: 2, cp2x: 8, cp2y: 8 }],
      closed: true,
    }) as PathNode;

    const freehand = normalizeNode({
      id: 'f2', type: 'path',
      content: { svgPath: 'M0 0 L5 5', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], strokeSize: 8 },
    }) as PathNode;

    expect(bezier.geometry.kind).toBe('bezier');
    expect(bezier.geometry.kind === 'bezier' && bezier.geometry.closed).toBe(true);
    expect(freehand.geometry.kind).toBe('freehand');
    expect(freehand.geometry.kind === 'freehand' && freehand.geometry.strokeSize).toBe(8);
  });

  it('carries audio duration, waveform and author across', () => {
    const node = normalizeNode({
      id: 'g1', type: 'audio', assetId: 'data:audio/webm;base64,AAA',
      durationMs: 4200, waveform: [0.1, 0.9, 'bad' as unknown as number],
      metadata: { authorName: 'Ada', authorColor: '#10B981', authorId: '7' },
    }) as AudioNode;

    expect(node.durationMs).toBe(4200);
    // Non-numeric samples are dropped rather than reaching the renderer.
    expect(node.waveform).toEqual([0.1, 0.9]);
    expect(node.author.name).toBe('Ada');
  });

  it('translates visible:false into hidden:true', () => {
    expect(normalizeNode({ id: 'h1', type: 'shape', visible: false }).hidden).toBe(true);
    expect(normalizeNode({ id: 'h2', type: 'shape', visible: true }).hidden).toBe(false);
  });

  it('carries a chosen material through, and leaves it absent when unset', () => {
    expect(normalizeNode({ id: 'm1', type: 'sticky', material: 'stone' }).material).toBe('stone');
    // Absent means "this type's default", which is what keeps documents written
    // before materials existed behaving exactly as they did.
    expect(normalizeNode({ id: 'm2', type: 'sticky' }).material).toBeUndefined();
    expect(normalizeNode({ id: 'm3', type: 'sticky', material: 42 }).material).toBeUndefined();
  });

  it('drops a material name the simulation does not know', () => {
    // The schema types this as `MaterialId`, so letting an arbitrary string
    // through would hand every consumer a value the type says cannot exist.
    // Absent is the honest answer: the node falls back to its type's default
    // rather than carrying a name nothing can look up.
    expect(normalizeNode({ id: 'm4', type: 'sticky', material: 'adamantium' }).material).toBeUndefined();
    expect(normalizeNode({ id: 'm5', type: 'sticky', material: 'Stone' }).material).toBeUndefined();
    // Every real one still survives.
    for (const id of MATERIAL_IDS) {
      expect(normalizeNode({ id: `m-${id}`, type: 'sticky', material: id }).material, id).toBe(id);
    }
  });

  it('maps the legacy artboard type onto frame', () => {
    expect(normalizeNode({ id: 'i1', type: 'artboard' }).type).toBe('frame');
  });
});

describe('normalizeNode — totality', () => {
  it('never throws and always yields usable bounds for degenerate input', () => {
    const inputs: unknown[] = [
      {}, null, undefined, { type: 'nonsense' },
      { id: 'z', type: 'shape', x: NaN, y: Infinity, width: -5, height: 'wide' },
      { id: 'z2', type: 'text', content: null },
      { id: 'z3', type: 'path', segments: 'not-an-array' },
      { id: 'z4', type: 'sticky', metadata: 'not-an-object' },
    ];

    for (const input of inputs) {
      const node = normalizeNode(input);
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
      expect(typeof node.hidden).toBe('boolean');
      expect(typeof node.opacity).toBe('number');
    }
  });

  it('is idempotent — normalizing a canonical node changes nothing', () => {
    const fixtures = [
      { id: 'a', type: 'shape', content: { shapeType: 'star', fill: '#fff', width: 50, height: 60 } },
      { id: 'b', type: 'sticky', appearance: { theme: 'sky' }, content: { text: 'hi', fontSize: 18 } },
      { id: 'c', type: 'text', content: { text: 'x', fontStyle: 'bold', textAlign: 'center' } },
      { id: 'd', type: 'path', segments: [{ x: 1, y: 1 }], closed: false },
      { id: 'e', type: 'image', assetId: 'u' },
      { id: 'f', type: 'audio', assetId: 'u', durationMs: 10 },
    ];

    for (const fixture of fixtures) {
      const once = normalizeNode(fixture);
      const twice = normalizeNode(once);
      // createdAt/updatedAt default to Date.now() only when absent; once
      // stamped they must be stable.
      expect(twice).toEqual(once);
    }
  });

  it('reports canonical output as canonical', () => {
    const legacy = { id: 'a', type: 'sticky', appearance: { theme: 'pink' }, content: { text: 'q' } };
    expect(isCanonical(legacy)).toBe(false);
    expect(isCanonical(normalizeNode(legacy))).toBe(true);
  });

  it('preserves and clamps lineProfile, lineWaves, and lineAmplitude on open shapes', () => {
    const node = normalizeNode({
      id: 'l1',
      type: 'shape',
      geometry: {
        kind: 'line',
        lineProfile: 'coil',
        lineWaves: 12,
        lineAmplitude: 1.8,
      },
    }) as ShapeNode;

    expect(node.geometry.lineProfile).toBe('coil');
    expect(node.geometry.lineWaves).toBe(12);
    expect(node.geometry.lineAmplitude).toBe(1.8);
  });
});


/**
 * The chart spec survives the boundary intact.
 *
 * Invariant 3 says every read passes through `normalizeNode`, which means a
 * field the normalizer does not copy **does not exist** downstream, whatever
 * the schema declares. That is not theoretical: the first version of
 * `normalizeChartSpec` copied twelve fields while `ChartSpec` grew to about
 * thirty, and the twenty it dropped included `functions` — where every plot's
 * formulae live. Function, parametric, polar, implicit, contour, slope-field
 * and vector-field charts all drew their axes correctly and drew no curve at
 * all, because the formulae had been thrown away one layer earlier.
 *
 * A round trip is the only test that scales here. Asserting field by field
 * means the assertions rot exactly as the normalizer did; asserting that a
 * fully-populated spec comes back unchanged fails the moment somebody adds a
 * field to `ChartSpec` and forgets the branch.
 */
describe('a chart spec survives normalization', () => {
  const full = {
    kind: 'function' as const,
    categories: ['a', 'b'],
    series: [{ name: 'S', values: [1, null, 3], color: '#123456' }],
    title: 'A title',
    titleSize: 22,
    showLegend: false,
    showGrid: false,
    showValues: true,
    includeZero: false,
    yMin: -5,
    yMax: 12,
    yScale: 'log' as const,
    valuePrefix: '$',
    valueSuffix: 'ms',
    decimals: 2,
    innerRadius: 0.42,
    buckets: 14,
    curved: true,
    sort: 'valueDesc' as const,
    reference: { value: 7, label: 'Target', color: '#EF4444' },
    functions: [{ source: 'sin(x)', color: '#00FF00' }, { source: 'cos(x)', hidden: true }],
    xMin: -3,
    xMax: 9,
    samples: 420,
    equalAxes: true,
    showRoots: true,
    showExtrema: true,
    fillArea: true,
    showDerivative: true,
    riemann: { n: 24, mode: 'midpoint' as const },
    yPlotMin: -2,
    yPlotMax: 6,
    resolution: 96,
    levels: 11,
  };

  it('keeps every field a chart can carry', () => {
    const node = normalizeNode({ id: 'c1', type: 'chart', chart: full }) as { chart: typeof full };
    // Compared whole rather than key by key, so a field added to the schema
    // and forgotten in the normalizer fails here.
    expect(node.chart).toEqual(full);
  });

  it('keeps the formulae, which is the field whose loss drew empty plots', () => {
    const node = normalizeNode({
      id: 'c2',
      type: 'chart',
      chart: { kind: 'polarPlot', categories: [], series: [], functions: [{ source: 'cos(2a)' }] },
    }) as { chart: { functions?: unknown[] } };
    expect(node.chart.functions).toEqual([{ source: 'cos(2a)' }]);
  });

  it('drops a formula with no readable source rather than keeping an empty row', () => {
    const node = normalizeNode({
      id: 'c3',
      type: 'chart',
      chart: { kind: 'function', categories: [], series: [], functions: [{ color: '#fff' }] },
    }) as { chart: { functions?: unknown[] } };
    expect(node.chart.functions).toBeUndefined();
  });

  it('refuses values it cannot trust, rather than passing them through', () => {
    const node = normalizeNode({
      id: 'c4',
      type: 'chart',
      chart: {
        kind: 'bar',
        categories: [],
        series: [],
        yMin: Number.NaN,
        titleSize: 'big',
        yScale: 'sideways',
        riemann: { n: 5, mode: 'diagonal' },
        reference: { label: 'no value' },
      },
    }) as unknown as { chart: Record<string, unknown> };

    expect(node.chart.yMin).toBeUndefined();
    expect(node.chart.titleSize).toBeUndefined();
    expect(node.chart.yScale).toBeUndefined();
    expect(node.chart.riemann).toBeUndefined();
    expect(node.chart.reference).toBeUndefined();
  });
});
