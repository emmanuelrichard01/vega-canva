import type { NewNodeInput } from '../document/mutations';
import { defaultChartSpec } from '../chart/chartTypes';
import { defaultTableSpec } from '../table/tableTypes';

/**
 * A reproducible mixed board for performance measurement.
 *
 * Built from cells of 25 objects, each laid out like a small working area: a
 * frame, eight shapes of four geometries, three text blocks, four stickies, six
 * connectors between the shapes (orthogonal and curved), a table, a chart and a
 * drawn bezier standing in for an image. A board of `count` objects is
 * `ceil(count / 25)` cells on a square grid, trimmed to exactly `count`.
 *
 * Seeded and id-stable (`b<cell>-<slot>`), so two runs of the same size build
 * the same document and a timing difference belongs to the code, not to the
 * fixture. Used by the browser harness and by the engine micro-benchmarks.
 */

export const CELL_SIZE = 25;
export const CELL_W = 1400;
export const CELL_H = 1000;

const GEOMETRIES = ['rect', 'ellipse', 'diamond', 'cylinder'] as const;
const THEMES = ['yellow', 'blue', 'green', 'pink'] as const;
const FILLS = ['#E0E7FF', '#DCFCE7', '#FEF3C7', '#FCE7F3', '#E0F2FE', '#F1F5F9'];

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cell(index: number, ox: number, oy: number, random: () => number): NewNodeInput[] {
  const id = (slot: string) => `b${index}-${slot}`;
  const nodes: NewNodeInput[] = [];

  nodes.push({ id: id('frame'), type: 'frame', x: ox, y: oy, width: CELL_W - 80, height: CELL_H - 80, title: `Area ${index + 1}` });

  const shapeIds: string[] = [];
  for (let i = 0; i < 8; i++) {
    const col = i % 4;
    const rowY = i < 4 ? 80 : 300;
    const sid = id(`s${i}`);
    shapeIds.push(sid);
    nodes.push({
      id: sid,
      type: 'shape',
      x: ox + 60 + col * 300,
      y: oy + rowY + Math.round(random() * 20),
      width: 200,
      height: 110,
      geometry: { kind: GEOMETRIES[i % GEOMETRIES.length] },
      text: `Service ${index}.${i}`,
      appearance: {
        fill: [{ type: 'solid', color: FILLS[(index + i) % FILLS.length] }],
        stroke: { color: '#334155', width: 1.5 },
      },
      typography: { fontSize: 14, fontWeight: 600, color: '#1F2937', align: 'center', verticalAlign: 'middle' },
    });
  }

  for (let i = 0; i < 6; i++) {
    nodes.push({
      id: id(`c${i}`),
      type: 'connector',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      from: { nodeId: shapeIds[i], port: 'auto' },
      to: { nodeId: shapeIds[i + 2], port: 'auto' },
      routing: i % 2 ? 'curved' : 'orthogonal',
      endEnd: 'arrow',
      appearance: { stroke: { color: '#64748B', width: 2, cap: 'round' } },
    });
  }

  for (let i = 0; i < 3; i++) {
    nodes.push({
      id: id(`t${i}`),
      type: 'text',
      x: ox + 60 + i * 400,
      y: oy + 470,
      width: 340,
      height: 60,
      text: `Notes for area ${index + 1}, part ${i + 1}: latency budget, owners and the rollout plan.`,
      typography: { fontSize: 15, fontWeight: 400, color: '#1F2937' },
    });
  }

  for (let i = 0; i < 4; i++) {
    nodes.push({
      id: id(`k${i}`),
      type: 'sticky',
      x: ox + 60 + i * 210,
      y: oy + 570,
      width: 180,
      height: 180,
      text: `Idea ${index}.${i}`,
      theme: THEMES[i % THEMES.length],
      fontSize: 15,
      reactions: {},
      tags: [],
      pinned: false,
    });
  }

  nodes.push({ id: id('table'), type: 'table', x: ox + 900, y: oy + 560, width: 380, height: 180, table: defaultTableSpec(4, 4) });
  nodes.push({ id: id('chart'), type: 'chart', x: ox + 60, y: oy + 770, width: 360, height: 130, chart: defaultChartSpec('bar') });
  nodes.push({
    id: id('img'),
    type: 'path',
    x: ox + 480,
    y: oy + 770,
    width: 200,
    height: 130,
    geometry: {
      kind: 'bezier',
      closed: true,
      segments: [
        { x: 0, y: 130 },
        { x: 60, y: 40, cp1x: 20, cp1y: 90, cp2x: 40, cp2y: 40 },
        { x: 120, y: 90, cp1x: 80, cp1y: 40, cp2x: 100, cp2y: 90 },
        { x: 200, y: 20, cp1x: 150, cp1y: 90, cp2x: 180, cp2y: 20 },
        { x: 200, y: 130 },
      ],
    },
    appearance: { fill: [{ type: 'solid', color: '#93C5FD' }], stroke: { color: '#1D4ED8', width: 2 } },
  });

  return nodes;
}

/** `count` mixed objects, deterministic for a given `count` and `seed`. */
export function mixedBoard(count: number, seed = 0x5eed): NewNodeInput[] {
  const cells = Math.ceil(count / CELL_SIZE);
  const columns = Math.ceil(Math.sqrt(cells));
  const random = seeded(seed);
  const out: NewNodeInput[] = [];
  for (let i = 0; i < cells; i++) {
    out.push(...cell(i, (i % columns) * CELL_W, Math.floor(i / columns) * CELL_H, random));
  }
  // Trim from the end of the last cell, but never leave a connector whose end
  // was trimmed away: drop dangling ones and top up with plain shapes.
  const kept = out.slice(0, count);
  const ids = new Set(kept.map((n) => n.id));
  return kept.filter(
    (n) => n.type !== 'connector' || (ids.has((n.from as { nodeId: string }).nodeId) && ids.has((n.to as { nodeId: string }).nodeId))
  );
}
