import { parseMermaidLenient } from './mermaid';
import { layoutGraph } from './layout';
import { layoutSequence, parseSequence } from './sequence';
import { layoutPie, parsePie, wedgePath } from './pie';
import type { MermaidTemplate } from './mermaidTemplates';

/**
 * A template's picture, for the gallery.
 *
 * Laid out by the same engines the preview and the board use, so a thumbnail
 * is the diagram's real shape in miniature rather than an illustration of the
 * kind. Labels are left out — at thumbnail size they are noise — and every box
 * is one fixed size, so laying out all the templates costs a few milliseconds
 * once, when the gallery first opens.
 */
export interface TemplateThumb {
  width: number;
  height: number;
  boxes: { x: number; y: number; width: number; height: number; round: boolean }[];
  lines: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }[];
  wedges: string[];
}

const BOX = { width: 120, height: 48 };

function flowThumb(source: string): TemplateThumb | null {
  const { graph } = parseMermaidLenient(source);
  if (!graph || graph.nodes.length === 0) return null;
  const { nodes, clusters } = layoutGraph(graph, { originX: 0, originY: 0, sizeOf: () => BOX });
  const at = new Map(nodes.map((n) => [n.key, n]));
  const boxes = [
    ...clusters.map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height, round: false })),
    ...nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height, round: true })),
  ];
  const lines = graph.edges.flatMap((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) return [];
    return [{ x1: a.x + a.width / 2, y1: a.y + a.height / 2, x2: b.x + b.width / 2, y2: b.y + b.height / 2, dashed: e.line === 'dotted' }];
  });
  const width = Math.max(...boxes.map((b) => b.x + b.width));
  const height = Math.max(...boxes.map((b) => b.y + b.height));
  return { width, height, boxes, lines, wedges: [] };
}

function sequenceThumb(source: string): TemplateThumb | null {
  const { diagram } = parseSequence(source);
  if (!diagram) return null;
  const layout = layoutSequence(diagram, { originX: 0, originY: 0 });
  if (layout.lanes.length === 0) return null;
  const centre = new Map(layout.lanes.map((l) => [l.key, l.x + l.width / 2]));
  const boxes = layout.lanes.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height, round: true }));
  const lifelines = layout.lanes.map((l) => ({ x1: l.x + l.width / 2, y1: l.y + l.height, x2: l.x + l.width / 2, y2: layout.height, dashed: true }));
  const arrows = layout.steps.flatMap((s) => {
    if (s.kind !== 'arrow' || s.self) return [];
    const x1 = centre.get(s.from);
    const x2 = centre.get(s.to);
    return x1 === undefined || x2 === undefined ? [] : [{ x1, y1: s.y, x2, y2: s.y }];
  });
  return { width: layout.width, height: layout.height, boxes, lines: [...lifelines, ...arrows], wedges: [] };
}

function pieThumb(source: string): TemplateThumb | null {
  const { chart } = parsePie(source);
  if (!chart) return null;
  const layout = layoutPie(chart, { originX: 0, originY: 0 });
  if (layout.wedges.length === 0) return null;
  // Framed on the wedges alone: the legend is words, which a thumbnail drops.
  const points = layout.wedges.flatMap((w) => w.anchors);
  const width = Math.max(...points.map((p) => p.x));
  const height = Math.max(...points.map((p) => p.y));
  return { width, height, boxes: [], lines: [], wedges: layout.wedges.map(wedgePath) };
}

const cache = new Map<string, TemplateThumb | null>();

export function thumbFor(template: MermaidTemplate): TemplateThumb | null {
  if (cache.has(template.id)) return cache.get(template.id)!;
  let thumb: TemplateThumb | null = null;
  try {
    thumb = template.kind === 'sequence' ? sequenceThumb(template.source) : template.kind === 'pie' ? pieThumb(template.source) : flowThumb(template.source);
  } catch {
    // A thumbnail is decoration; a template the engines cannot lay out still
    // gets its name in the gallery.
    thumb = null;
  }
  cache.set(template.id, thumb);
  return thumb;
}
