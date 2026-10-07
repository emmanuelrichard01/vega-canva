import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A connector in the SVG file is the connector on the board: the same route,
 * the same trim under its markers, and, sketched, the same strokes from the
 * same seeds.
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
const { routeBoard } = await import('../model/connectorRouter/routeBoard');
const { attachLookup, boxLookup } = await import('../model/connectorTargets');
const { connectorCaps, trimRunForCaps } = await import('../model/connectorEnds');
const { sketchedCap, sketchedRun } = await import('../model/connectorSketch');
const { autoLabelKey, autoLabelRequests, labelCentre, labelsOf } = await import('../model/connectorLabelLayout');
const { publishConnectorLabel, resetConnectorLabels, slotFor } = await import('../model/connectorLabelStore');

function add(raw: Record<string, unknown>) {
  const node = normalizeNode(raw) as any;
  objects[node.id] = node;
  return node;
}

function board(connector: Record<string, unknown>) {
  add({ id: 'a', type: 'shape', x: 0, y: 0, width: 100, height: 60, zIndex: 1, geometry: { kind: 'rect' } });
  add({ id: 'b', type: 'shape', x: 500, y: 0, width: 100, height: 60, zIndex: 2, geometry: { kind: 'rect' } });
  add({ id: 'block', type: 'shape', x: 230, y: -40, width: 80, height: 140, zIndex: 3, geometry: { kind: 'rect' } });
  return add({
    id: 'c1', type: 'connector', x: 0, y: 0, width: 1, height: 1, zIndex: 4,
    from: { nodeId: 'a', port: 'right' }, to: { nodeId: 'b', port: 'left' },
    routing: 'orthogonal', avoid: true, endEnd: 'triangle',
    ...connector,
  });
}

/** What the canvas draws for the run and the end marker, built the canvas's way. */
function canvasDrawing(node: any) {
  const route = routeBoard(objects, { boxOf: boxLookup(objects), attachOf: attachLookup(objects) }).get(node.id)!;
  const world = route.points.flatMap((p: any) => [p.x, p.y]);
  const width = node.appearance?.stroke?.width || 2;
  const caps = connectorCaps(world, { start: node.endStart, end: node.endEnd, strokeWidth: width, scale: node.endScale });
  const trimmed = trimRunForCaps(world, [], caps.start?.inset ?? 0, caps.end?.inset ?? 0);
  const run: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < trimmed.flat.length; i += 2) run.push({ x: trimmed.flat[i], y: trimmed.flat[i + 1] });
  const spec = {
    id: node.id,
    sketchSeed: node.appearance?.sketchSeed,
    level: node.appearance.sketch,
    width,
    curved: route.curved,
    dashed: (node.appearance?.stroke?.dash?.length ?? 0) > 0,
  };
  return { route, run: sketchedRun(run, spec), cap: sketchedCap(caps.end, 'end', caps.size, spec) };
}

beforeEach(() => {
  objects = {};
});

describe('connectors in the SVG export', () => {
  it('takes the routed path around an obstacle, not a straight line through it', async () => {
    board({});
    const svg = (await new SVGExporter().export({})) as string;
    const route = routeBoard(objects, { boxOf: boxLookup(objects), attachOf: attachLookup(objects) }).get('c1')!;
    expect(route.points.length).toBeGreaterThan(2);
    // The route climbs over the block: some point of it is above the block's top.
    const top = Math.min(...route.points.map((p) => p.y));
    expect(top).toBeLessThan(-40);
    expect(svg).toContain(`${Math.round(top * 100) / 100}`);
  });

  it('draws a sketched, dashed connector with the canvas seeds and one lap', async () => {
    const node = board({
      appearance: { stroke: { color: '#334155', width: 3, dash: [6, 4] }, sketch: 'medium', sketchSeed: 3 },
      endScale: 3,
    });
    const svg = (await new SVGExporter().export({})) as string;
    const expected = canvasDrawing(node);
    expect(svg).toContain(`d="${expected.run}"`);
    expect(expected.cap).not.toBeNull();
    expect(svg).toContain(`d="${expected.cap}"`);
  });

  it('draws a sketched curve as one continuous curve, as the canvas does', async () => {
    const node = board({
      routing: 'curved',
      appearance: { stroke: { color: '#334155', width: 2 }, sketch: 'light' },
    });
    const svg = (await new SVGExporter().export({})) as string;
    const expected = canvasDrawing(node);
    expect(expected.route.curved).toBe(true);
    expect(svg).toContain(`d="${expected.run}"`);
  });

  it('breaks the line around a label', async () => {
    board({ labels: [{ id: 'l1', text: 'Yes', t: 0.5 }] });
    const svg = (await new SVGExporter().export({})) as string;
    expect(svg).toMatch(/<mask id="cl-c1"/);
    expect(svg).toContain('mask="url(#cl-c1)"');
    expect(svg).toContain('>Yes</text>');
  });

  it('puts unplaced labels where the canvas arrangement puts them, not all at the middle', async () => {
    // Two connectors between the same pair: their middles are a lane apart,
    // so labels left at t = 0.5 would sit on top of each other.
    board({ labels: [{ id: 'l1', text: 'Yes' }] });
    add({
      id: 'c2', type: 'connector', x: 0, y: 0, width: 1, height: 1, zIndex: 5,
      from: { nodeId: 'a', port: 'right' }, to: { nodeId: 'b', port: 'left' },
      routing: 'orthogonal', avoid: true, labels: [{ id: 'l1', text: 'No' }],
    });
    const svg = (await new SVGExporter().export({})) as string;

    // The canvas: each renderer publishes its route, the board arranges them.
    resetConnectorLabels();
    const routes = routeBoard(objects, { boxOf: boxLookup(objects), attachOf: attachLookup(objects) });
    for (const id of ['c1', 'c2']) {
      const flat = routes.get(id)!.points.flatMap((p: any) => [p.x, p.y]);
      for (const r of autoLabelRequests(objects[id], flat)) publishConnectorLabel(r.id, r.text, r.points);
    }
    await Promise.resolve();
    const centres = ['c1', 'c2'].map((id) => {
      const flat = routes.get(id)!.points.flatMap((p: any) => [p.x, p.y]);
      const label = labelsOf(objects[id])[0];
      const slot = slotFor(autoLabelKey(id, label.id));
      expect(slot, id).not.toBeNull();
      return { text: label.text, at: labelCentre(label, flat, slot) };
    });
    // They dodged each other on the canvas...
    expect(Math.hypot(centres[0].at.x - centres[1].at.x, centres[0].at.y - centres[1].at.y)).toBeGreaterThan(17);
    // ...and the file draws each exactly there.
    const num = (v: number) => String(v);
    for (const c of centres) expect(svg).toContain(`<text x="${num(c.at.x)}" y="${num(c.at.y)}"`);
    resetConnectorLabels();
  });
});
