import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A line in the SVG file is the line on the board: the same run, the same
 * heads from the same geometry, the same stroke ends and dash, and its label
 * where the canvas puts it.
 */

let objects: Record<string, any> = {};

vi.mock('../../hooks/useStore', () => ({
  useStore: { getState: () => ({ objects, selectedIds: [] }) },
}));
vi.mock('./inlineImages', () => ({
  inlineImageSources: async () => ({ embedded: new Map() }),
  fetchBlob: async () => null,
}));

const { SVGExporter } = await import('./SVGExporter');
const { normalizeNode } = await import('../document/normalize');
const { END_CAP_KINDS, terminateRun } = await import('../model/connectorEnds');
const { runPoints } = await import('../model/lineEnds');
const { lineLabelWorld } = await import('../model/lineLabel');

function line(geometry: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const node = normalizeNode({
    id: 'l1',
    type: 'shape',
    x: 100,
    y: 100,
    width: 300,
    height: 100,
    zIndex: 1,
    geometry: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, ...geometry },
    appearance: { stroke: { color: '#1F2937', width: 4 } },
    ...extra,
  }) as any;
  objects = { [node.id]: node };
  return node;
}

const exportSvg = async () => (await new SVGExporter().export({})) as string;

/** The attributes of the first element with this tag, as written. */
function element(svg: string, tag: string): string {
  const match = svg.match(new RegExp(`<${tag}\\s[^>]*>`));
  return match ? match[0] : '';
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

beforeEach(() => {
  objects = {};
});

describe('line export', () => {
  it('writes one stroke-linecap however the dash and the cap combine', async () => {
    line({}, { appearance: { stroke: { color: '#1F2937', width: 4, dash: [8, 6], cap: 'round' } } });
    const el = element(await exportSvg(), 'line');
    expect(count(el, 'stroke-linecap=')).toBe(1);
    expect(el).toContain('stroke-linecap="round"');
    expect(el).toContain('stroke-dasharray="8 6"');
  });

  it('draws a dotted pattern with round caps, or it would export as nothing', async () => {
    line({}, { appearance: { stroke: { color: '#1F2937', width: 4, dash: [0, 8] } } });
    expect(element(await exportSvg(), 'line')).toContain('stroke-linecap="round"');
  });

  it('keeps the canvas default of butt ends on a plain line', async () => {
    line({});
    expect(element(await exportSvg(), 'line')).toContain('stroke-linecap="butt"');
  });

  for (const kind of END_CAP_KINDS.filter((k) => k !== 'none' && k !== 'circle')) {
    it(`exports the ${kind} head from the canvas's own geometry`, async () => {
      const node = line({ endEnd: kind });
      const svg = await exportSvg();
      const world = runPoints(node).flatMap((p: { x: number; y: number }) => [node.x + p.x, node.y + p.y]);
      const { end } = terminateRun(world, { start: 'none', end: kind, strokeWidth: 4, align: 'inside' });
      const pairs: string[] = [];
      for (let i = 0; i < end!.points!.length; i += 2) {
        pairs.push(`${end!.points![i].toFixed(2)},${end!.points![i + 1].toFixed(2)}`);
      }
      // Filled heads close; open ones stay polylines so a chevron is not a triangle.
      const tag = end!.filled ? 'polygon' : 'polyline';
      expect(svg).toContain(`<${tag} points="${pairs.join(' ')}"`);
    });
  }

  it('exports an elbow as its right-angled route', async () => {
    line({ lineProfile: 'elbow', b: { x: 300, y: 100 } });
    const el = element(await exportSvg(), 'polyline');
    const pts = el
      .match(/points="([^"]+)"/)![1]
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(pts[0][1]).toBeCloseTo(pts[1][1], 6);
    expect(pts[pts.length - 1][1]).toBeCloseTo(pts[pts.length - 2][1], 6);
    expect(el).toContain('stroke-linejoin="round"');
  });

  it('puts the label where the canvas does: along the run, on a plate', async () => {
    // An L whose box centre is nowhere near its middle.
    const node = line(
      { vertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }] },
      { text: 'retry', typography: { fontSize: 24 } }
    );
    const svg = await exportSvg();
    const at = lineLabelWorld(node);
    expect(at).toEqual({ x: 300, y: 100 });
    expect(svg).toContain(`<text x="300" y="100" text-anchor="middle"`);
    expect(svg).toMatch(/<rect [^>]*fill="#FFFFFF" \/><text x="300"/);
    // The connector label's type, not the node's paragraph typography.
    expect(element(svg, 'text')).toContain('font-size="14"');
  });
});
