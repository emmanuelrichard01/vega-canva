/**
 * Mermaid flowcharts and structural diagrams, both directions.
 *
 * ## Senior-level Excalidraw/Figma-grade Implementation
 *
 * Supports:
 * - Subgraphs & cluster framing (`subgraph ID [Title] ... end`)
 * - Rich shape bracket forms:
 *     - `[Rect]` (Process)
 *     - `(Round)` (Rounded rectangle)
 *     - `([Stadium])` (Terminal / Pill)
 *     - `[[Subroutine]]` (Subprocess)
 *     - `[(Database)]` (Cylinder storage)
 *     - `((Circle))` (State)
 *     - `(((Double Circle)))` (End state)
 *     - `{Diamond}` (Decision)
 *     - `{{Hexagon}}` (Preparation)
 *     - `[/Parallelogram/]` & `[\Parallelogram\]` (I/O Data)
 *     - `[/Trapezoid\]` & `[\Trapezoid/]` (Manual operation)
 *     - `>Flag]` (Banner / Asymmetric)
 * - Multi-node chaining & Fan-In / Fan-Out: `A & B --> C & D`
 * - Inline class assignment: `NodeId[Label]:::className`
 * - Directives: `style`, `classDef`, `class`, `linkStyle`, `%% comments`
 * - Arrow types: `-->`, `---`, `-.->`, `-.-`, `==>`, `===`, `<-->`
 */

import type { ShapeKind } from '../model/schema';

// ---------------------------------------------------------------------------
// The intermediate form
// ---------------------------------------------------------------------------

/** The shapes mermaid's bracket syntax can ask for. */
export type MermaidShape =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'subroutine'
  | 'database'
  | 'diamond'
  | 'circle'
  | 'double_circle'
  | 'hexagon'
  | 'parallelogram'
  | 'parallelogram_inv'
  | 'trapezoid'
  | 'trapezoid_inv'
  | 'flag';

export interface NodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  color?: string;
}

export interface MermaidNode {
  /** The identifier used in the source, e.g. `A`. */
  key: string;
  label: string;
  shape: MermaidShape;
  /** Subgraph container id if this node is inside a cluster */
  subgraphId?: string;
  /** Paint from a `style` or `classDef` directive. */
  style?: NodeStyle;
}

export interface MermaidSubgraph {
  id: string;
  title: string;
  nodeKeys: string[];
}

export type EdgeLine = 'solid' | 'dotted' | 'thick';

export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
  line: EdgeLine;
  /** Whether the run ends in an arrowhead. `---` does not. */
  arrow: boolean;
  /** Whether the connector is bidirectional `<-->` */
  bidirectional?: boolean;
}

export type FlowDirection = 'TD' | 'TB' | 'LR' | 'RL' | 'BT';

export interface MermaidGraph {
  direction: FlowDirection;
  nodes: MermaidNode[];
  edges: MermaidEdge[];
  subgraphs?: MermaidSubgraph[];
}

export type DiagramThemeId = 'indigo' | 'pastel' | 'emerald' | 'amber' | 'mono';

export interface DiagramTheme {
  id: DiagramThemeId;
  name: string;
  primaryFill: string;
  primaryStroke: string;
  textColor: string;
  clusterFill: string;
  clusterStroke: string;
  connectorColor: string;
  accentFills: string[];
  /**
   * Ink for anything drawn **directly on the board**, with no fill behind it.
   *
   * Every other colour here is chosen against a known surface: `textColor`
   * reads on `accentFills`, `clusterStroke` outlines a `clusterFill`. A
   * lifeline, a block frame and its label have no surface -- they sit on the
   * canvas, whose colour is the *viewer's* theme and is not knowable when the
   * objects are written. A near-black `textColor` is right on a pale node and
   * invisible on a dark board.
   *
   * So these are mid-tones, picked to clear roughly 3:1 against both a white
   * canvas and a near-black one. That is the contrast a line or a small label
   * needs, and it is about the most a single fixed colour can do against two
   * opposite backgrounds -- which is why everything smaller or denser than a
   * label gets a plate to sit on instead. The pie legend is the example.
   */
  canvasInk: string;
}

export const DIAGRAM_THEMES: Record<DiagramThemeId, DiagramTheme> = {
  indigo: {
    id: 'indigo',
    name: 'Indigo & Slate',
    primaryFill: '#EEF2FF',
    primaryStroke: '#6366F1',
    textColor: '#1E293B',
    clusterFill: 'rgba(241, 245, 249, 0.65)',
    clusterStroke: '#94A3B8',
    connectorColor: '#64748B',
    accentFills: ['#EEF2FF', '#E0E7FF', '#C7D2FE', '#F1F5F9'],
    canvasInk: '#7C8AA5',
  },
  pastel: {
    id: 'pastel',
    name: 'Pastel Studio',
    primaryFill: '#FEF3C7',
    // Was #D97706, which is 2.86:1 on this theme's own pale fill -- an
    // outline you have to look for. One step darker clears 3:1.
    primaryStroke: '#B45309',
    textColor: '#1F2937',
    clusterFill: 'rgba(249, 250, 251, 0.7)',
    clusterStroke: '#CBD5E1',
    connectorColor: '#475569',
    accentFills: ['#FEF3C7', '#EDE9FE', '#DCFCE7', '#E0F2FE', '#FCE7F3'],
    canvasInk: '#8B8FA3',
  },
  emerald: {
    id: 'emerald',
    name: 'Emerald & Mint',
    primaryFill: '#ECFDF5',
    primaryStroke: '#059669',
    textColor: '#064E3B',
    clusterFill: 'rgba(240, 253, 244, 0.6)',
    clusterStroke: '#6EE7B7',
    connectorColor: '#047857',
    accentFills: ['#ECFDF5', '#D1FAE5', '#A7F3D0', '#F0FDF4'],
    canvasInk: '#4E9E86',
  },
  amber: {
    id: 'amber',
    name: 'Amber & Coral',
    primaryFill: '#FFF7ED',
    primaryStroke: '#EA580C',
    textColor: '#431407',
    clusterFill: 'rgba(255, 247, 237, 0.6)',
    clusterStroke: '#FDBA74',
    connectorColor: '#C2410C',
    accentFills: ['#FFF7ED', '#FFEDD5', '#FED7AA', '#FEF2F2'],
    canvasInk: '#B08157',
  },
  mono: {
    id: 'mono',
    name: 'Monochrome',
    primaryFill: '#F8FAFC',
    primaryStroke: '#0F172A',
    textColor: '#0F172A',
    clusterFill: 'rgba(248, 250, 252, 0.5)',
    clusterStroke: '#64748B',
    connectorColor: '#334155',
    accentFills: ['#FFFFFF', '#F1F5F9', '#E2E8F0', '#CBD5E1'],
    canvasInk: '#7B8794',
  },
};

export interface ParseResult {
  graph: MermaidGraph | null;
  /** What went wrong, in a sentence a person can act on. */
  error: string | null;
  /** Specific 1-indexed line number where the issue was detected, if known. */
  errorLine?: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Node declarations, longest bracket forms first to avoid prefix collisions.
 */
const NODE_FORMS: Array<{ open: string; close: string; shape: MermaidShape }> = [
  { open: '(((', close: ')))', shape: 'double_circle' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'database' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '[\\', close: '\\]', shape: 'parallelogram_inv' },
  { open: '[/', close: '\\]', shape: 'trapezoid' },
  { open: '[\\', close: '/]', shape: 'trapezoid_inv' },
  { open: '>', close: ']', shape: 'flag' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
];

/** Strip the quotes mermaid allows around a label, and unescape its entities. */
function cleanLabel(raw: string): string {
  let text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').trim();
}

/**
 * One `A[Label]` token, or a bare `A`, optionally with inline `:::className`.
 */
function readSingleNode(src: string): { node: MermaidNode; length: number; inlineClass?: string } | null {
  const keyMatch = /^\s*([A-Za-z0-9_]+)/.exec(src);
  if (!keyMatch) return null;
  const key = keyMatch[1];
  let cursor = keyMatch[0].length;
  const rest = src.slice(cursor);

  let shape: MermaidShape = 'rect';
  let label = key;
  let consumed = cursor;

  for (const form of NODE_FORMS) {
    if (!rest.startsWith(form.open)) continue;
    const end = rest.indexOf(form.close, form.open.length);
    if (end === -1) continue;
    const innerLabel = cleanLabel(rest.slice(form.open.length, end));
    shape = form.shape;
    label = innerLabel || key;
    consumed = cursor + end + form.close.length;
    break;
  }

  // Check for inline class `:::className`
  const afterNode = src.slice(consumed);
  const classMatch = /^:::([A-Za-z0-9_]+)/.exec(afterNode);
  let inlineClass: string | undefined;
  if (classMatch) {
    inlineClass = classMatch[1];
    consumed += classMatch[0].length;
  }

  return {
    node: { key, label, shape },
    length: consumed,
    inlineClass,
  };
}

/**
 * Reads a list of nodes joined by `&` (fan-in / fan-out), e.g. `A[Node A] & B[Node B]`
 */
function readNodeList(src: string): { nodes: MermaidNode[]; length: number; inlineClasses: Map<string, string> } | null {
  const first = readSingleNode(src);
  if (!first) return null;

  const nodes: MermaidNode[] = [first.node];
  const inlineClasses = new Map<string, string>();
  if (first.inlineClass) inlineClasses.set(first.node.key, first.inlineClass);

  let totalLength = first.length;
  let remaining = src.slice(totalLength);

  while (true) {
    const ampersandMatch = /^\s*&\s*/.exec(remaining);
    if (!ampersandMatch) break;
    const nextSrc = remaining.slice(ampersandMatch[0].length);
    const nextNode = readSingleNode(nextSrc);
    if (!nextNode) break;

    nodes.push(nextNode.node);
    if (nextNode.inlineClass) inlineClasses.set(nextNode.node.key, nextNode.inlineClass);
    const advanced = ampersandMatch[0].length + nextNode.length;
    totalLength += advanced;
    remaining = src.slice(totalLength);
  }

  return { nodes, length: totalLength, inlineClasses };
}

const EDGE_INLINE = /^\s*(--|-\.|==)\s*([^|>\-=.][^|>]*?)\s*(<-->|-->|---|<-.->|-\.->|-\.-|<==>|==>|===)\s*(?:\|\s*([^|]*?)\s*\|)?\s*/;
const EDGE_PLAIN = /^\s*(<-->|-->|---|<-.->|-\.->|-\.-|<==>|==>|===)\s*(?:\|\s*([^|]*?)\s*\|)?\s*/;

function lineKind(connector: string): EdgeLine {
  if (connector.includes('.')) return 'dotted';
  if (connector.includes('=')) return 'thick';
  return 'solid';
}

function readEdge(src: string): { edge: Omit<MermaidEdge, 'from' | 'to'>; length: number } | null {
  const inline = EDGE_INLINE.exec(src);
  if (inline) {
    const [full, , mid, connector, piped] = inline;
    const label = cleanLabel(piped || mid || '');
    const isArrow = connector.includes('>') || connector.includes('<');
    const isBidir = connector.startsWith('<') && connector.endsWith('>');
    return {
      edge: {
        line: lineKind(connector),
        arrow: isArrow,
        ...(isBidir ? { bidirectional: true } : {}),
        ...(label ? { label } : {}),
      },
      length: full.length,
    };
  }
  const plain = EDGE_PLAIN.exec(src);
  if (!plain) return null;
  const [full, connector, piped] = plain;
  const label = cleanLabel(piped ?? '');
  const isArrow = connector.includes('>') || connector.includes('<');
  const isBidir = connector.startsWith('<') && connector.endsWith('>');
  return {
    edge: {
      line: lineKind(connector),
      arrow: isArrow,
      ...(isBidir ? { bidirectional: true } : {}),
      ...(label ? { label } : {}),
    },
    length: full.length,
  };
}

function readStyleBody(body: string): NodeStyle {
  const style: NodeStyle = {};
  for (const part of body.split(',')) {
    const [rawKey, ...rest] = part.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (!value) continue;
    if (key === 'fill') style.fill = value;
    else if (key === 'stroke') style.stroke = value;
    else if (key === 'color') style.color = value;
    else if (key === 'stroke-width') {
      const px = parseFloat(value);
      if (Number.isFinite(px)) style.strokeWidth = px;
    }
  }
  return style;
}

function readStyle(line: string): { key: string; style: NodeStyle } | null {
  const m = /^style\s+([A-Za-z0-9_]+)\s+(.+)$/i.exec(line);
  return m ? { key: m[1], style: readStyleBody(m[2]) } : null;
}

function readClassDef(line: string): { name: string; style: NodeStyle } | null {
  const m = /^classDef\s+([A-Za-z0-9_]+)\s+(.+)$/i.exec(line);
  return m ? { name: m[1], style: readStyleBody(m[2]) } : null;
}

function readClassApply(line: string): { keys: string[]; name: string } | null {
  const m = /^class\s+([A-Za-z0-9_,\s]+?)\s+([A-Za-z0-9_]+)\s*$/i.exec(line);
  if (!m) return null;
  return { keys: m[1].split(',').map((k) => k.trim()).filter(Boolean), name: m[2] };
}

const DIRECTIONS: Record<string, FlowDirection> = {
  TD: 'TD',
  TB: 'TB',
  LR: 'LR',
  RL: 'RL',
  BT: 'BT',
};

/**
 * Fast check whether a string looks like a Mermaid flowchart declaration.
 */
export function looksLikeMermaid(text: string): boolean {
  const trimmed = text.trim();
  return /^(flowchart|graph)\s+[A-Za-z]{2}/i.test(trimmed);
}

/**
 * Parses Mermaid source into an editable diagram graph model.
 */
export function parseMermaid(source: string): ParseResult {
  const rawLines = source.split('\n');
  const lines: Array<{ text: string; lineNum: number }> = [];

  rawLines.forEach((l, idx) => {
    const trimmed = l.trim();
    if (trimmed && !trimmed.startsWith('%%')) {
      lines.push({ text: trimmed, lineNum: idx + 1 });
    }
  });

  if (lines.length === 0) return { graph: null, error: null };

  const first = lines[0];
  const header = /^(flowchart|graph)\s+([A-Za-z]{2})?/i.exec(first.text);
  if (!header) {
    /**
     * `sequenceDiagram` and `pie` are deliberately absent from this list.
     *
     * Each has its own parser and its own layout -- see `sequence.ts` for why
     * a timeline cannot go through dagre, and `pie.ts` for why a wedge is a
     * path rather than a shape -- and the callers dispatch on
     * `looksLikeSequence` / `looksLikePie` before reaching here. Naming them
     * as unsupported would be this module reporting on a decision it no longer
     * makes.
     */
    const kind = /^(classDiagram|stateDiagram|erDiagram|gantt|journey|mindmap)/i.exec(
      first.text
    );
    if (kind) {
      return {
        graph: null,
        error: `${kind[1]} is not supported yet. Flowcharts, sequence diagrams and pie charts become editable objects — start with "flowchart TD", "sequenceDiagram" or "pie".`,
        errorLine: first.lineNum,
      };
    }
    return {
      graph: null,
      error: 'Start with "flowchart TD", "graph LR", "sequenceDiagram" or "pie".',
      errorLine: first.lineNum,
    };
  }

  const direction = DIRECTIONS[(header[2] ?? 'TD').toUpperCase()] ?? 'TD';
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  const styles = new Map<string, NodeStyle>();
  const classDefs = new Map<string, NodeStyle>();
  const classNames = new Map<string, string>();
  const subgraphs: MermaidSubgraph[] = [];

  // Active subgraph stack for handling nested clusters
  const subgraphStack: MermaidSubgraph[] = [];

  /**
   * Record a node, and where it was mentioned.
   *
   * ## The bug this shape prevents
   *
   * Membership is written twice -- onto `subgraph.nodeKeys` and onto the
   * node's own `subgraphId` -- and the two used to be able to disagree. The
   * push to `nodeKeys` was unconditional, but `subgraphId` only survived on
   * the branches that *replaced* the stored node. So a node first mentioned
   * outside a block and used inside it:
   *
   *     B --> C[Process]
   *     subgraph S1 [Pipeline]
   *       C --> E
   *     end
   *
   * ...ended up in `S1.nodeKeys` and with no `subgraphId`. Both records are
   * read, by different code: `layout.ts` parents to dagre by `subgraphId`, so
   * C was laid out *outside* the cluster; `build.ts` assigned `frameId` from
   * `nodeKeys`, so C was given the frame anyway -- and `ObjectRenderer` clips
   * a framed node to its frame's rectangle. The node was placed outside a box
   * it was then cut to fit. That is the clipped, broken diagram.
   *
   * The membership stamp is now applied to whichever record is kept, so the
   * two cannot drift. `mermaid.test.ts` asserts they agree.
   */
  const remember = (node: MermaidNode) => {
    const activeSub = subgraphStack[subgraphStack.length - 1];

    if (activeSub && !activeSub.nodeKeys.includes(node.key)) {
      activeSub.nodeKeys.push(node.key);
    }

    const existing = nodes.get(node.key);
    let kept: MermaidNode;
    if (!existing || (existing.label === existing.key && node.label !== node.key)) {
      kept = node;
    } else if (existing.shape === 'rect' && node.shape !== 'rect') {
      kept = { ...existing, shape: node.shape };
    } else {
      kept = existing;
    }

    // Mentioning a node outside a block never *removes* it from one it is
    // already in -- `kept` carries the earlier stamp when there is no active
    // subgraph, which is why this is a conditional spread and not an assign.
    nodes.set(node.key, activeSub ? { ...kept, subgraphId: activeSub.id } : kept);
  };

  for (const { text: line, lineNum } of lines.slice(1)) {
    // 1. Check for subgraph start
    const subMatch = /^subgraph\s+([A-Za-z0-9_]+)(?:\s*\[\s*(.*?)\s*\])?(?:\s*"(.*?)")?\s*$/i.exec(line);
    if (subMatch) {
      const id = subMatch[1];
      const title = cleanLabel(subMatch[2] || subMatch[3] || id);
      const sub: MermaidSubgraph = { id, title, nodeKeys: [] };
      subgraphs.push(sub);
      subgraphStack.push(sub);
      continue;
    }

    // 2. Check for subgraph end
    if (/^end\s*$/i.test(line)) {
      subgraphStack.pop();
      continue;
    }

    // 3. Styling directives
    const styling = readStyle(line);
    if (styling) {
      styles.set(styling.key, { ...(styles.get(styling.key) ?? {}), ...styling.style });
      continue;
    }
    const classed = readClassDef(line);
    if (classed) {
      classDefs.set(classed.name, { ...(classDefs.get(classed.name) ?? {}), ...classed.style });
      continue;
    }
    const applied = readClassApply(line);
    if (applied) {
      applied.keys.forEach((key) => classNames.set(key, applied.name));
      continue;
    }
    if (/^(click|linkStyle|direction) /i.test(line)) continue;

    // 4. Parse node & multi-node chaining with fan-in/fan-out
    let cursor = 0;
    let guard = 0;

    const firstGroup = readNodeList(line.slice(cursor));
    if (!firstGroup) {
      // If line is not a comment or directive and cannot be parsed as a node/edge
      if (!line.startsWith('%%')) {
        return {
          graph: null,
          error: `Line ${lineNum}: Unrecognized syntax "${line.slice(0, 32)}"`,
          errorLine: lineNum,
        };
      }
      continue;
    }

    firstGroup.nodes.forEach(remember);
    firstGroup.inlineClasses.forEach((cls, k) => classNames.set(k, cls));
    cursor += firstGroup.length;

    let previousGroup = firstGroup.nodes;

    while (cursor < line.length && guard++ < 64) {
      const link = readEdge(line.slice(cursor));
      if (!link) break;
      cursor += link.length;

      const targetGroup = readNodeList(line.slice(cursor));
      if (!targetGroup) break;

      targetGroup.nodes.forEach(remember);
      targetGroup.inlineClasses.forEach((cls, k) => classNames.set(k, cls));
      cursor += targetGroup.length;

      // Create cartesian product of connections for fan-out / fan-in: A & B --> C & D
      for (const fromNode of previousGroup) {
        for (const toNode of targetGroup.nodes) {
          edges.push({
            from: fromNode.key,
            to: toNode.key,
            ...link.edge,
          });
        }
      }

      previousGroup = targetGroup.nodes;
    }
  }

  if (nodes.size === 0) {
    return { graph: null, error: 'No nodes found. Try "A[Start] --> B[End]".' };
  }

  const subgraphMap = new Map(subgraphs.map((s) => [s.id, s]));

  const painted = [...nodes.values()]
    .filter((node) => {
      const sub = subgraphMap.get(node.key);
      return !sub || sub.nodeKeys.length === 0;
    })
    .map((node) => {
      const fromClass = classDefs.get(classNames.get(node.key) ?? '');
      const direct = styles.get(node.key);
      const style = { ...(fromClass ?? {}), ...(direct ?? {}) };
      return Object.keys(style).length ? { ...node, style } : node;
    });

  return {
    graph: {
      direction,
      nodes: painted,
      edges,
      subgraphs: subgraphs.length ? subgraphs : undefined,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

const SHAPE_BRACKETS: Record<MermaidShape, [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  database: ['[(', ')]'],
  diamond: ['{', '}'],
  circle: ['((', '))'],
  double_circle: ['(((', ')))'],
  hexagon: ['{{', '}}'],
  parallelogram: ['[/', '/]'],
  parallelogram_inv: ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  trapezoid_inv: ['[\\', '/]'],
  flag: ['>', ']'],
};

const LINE_TOKENS: Record<EdgeLine, { arrow: string; plain: string; bidir: string }> = {
  solid: { arrow: '-->', plain: '---', bidir: '<-->' },
  dotted: { arrow: '-.->', plain: '-.-', bidir: '<-.->' },
  thick: { arrow: '==>', plain: '===', bidir: '<==>' },
};

function quoteLabel(label: string): string {
  const flat = label.replace(/\n/g, '<br>');
  return /["'[\]{}()<>|=-]/.test(flat) ? `"${flat.replace(/"/g, "'")}"` : flat;
}

export function keyFor(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  const cycle = Math.floor(index / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}

/** Converts a MermaidGraph model back to clean Mermaid source text */
export function emitMermaid(graph: MermaidGraph): string {
  const lines = [`flowchart ${graph.direction}`];
  const declared = new Set<string>();
  const styledNodes: MermaidNode[] = [];

  // If subgraphs are present, group nodes inside their respective subgraph blocks
  if (graph.subgraphs && graph.subgraphs.length > 0) {
    const assignedKeys = new Set<string>();
    for (const sub of graph.subgraphs) {
      lines.push(`    subgraph ${sub.id} ["${quoteLabel(sub.title)}"]`);
      for (const k of sub.nodeKeys) {
        const node = graph.nodes.find((n) => n.key === k);
        if (node) {
          const [open, close] = SHAPE_BRACKETS[node.shape] || ['[', ']'];
          lines.push(`        ${node.key}${open}${quoteLabel(node.label)}${close}`);
          declared.add(node.key);
          assignedKeys.add(node.key);
          if (node.style && Object.keys(node.style).length > 0) styledNodes.push(node);
        }
      }
      lines.push('    end');
    }

    // Top-level unclustered nodes
    for (const node of graph.nodes) {
      if (!assignedKeys.has(node.key)) {
        const [open, close] = SHAPE_BRACKETS[node.shape] || ['[', ']'];
        lines.push(`    ${node.key}${open}${quoteLabel(node.label)}${close}`);
        declared.add(node.key);
        if (node.style && Object.keys(node.style).length > 0) styledNodes.push(node);
      }
    }
  } else {
    for (const node of graph.nodes) {
      const [open, close] = SHAPE_BRACKETS[node.shape] || ['[', ']'];
      lines.push(`    ${node.key}${open}${quoteLabel(node.label)}${close}`);
      declared.add(node.key);
      if (node.style && Object.keys(node.style).length > 0) styledNodes.push(node);
    }
  }

  for (const edge of graph.edges) {
    if (!declared.has(edge.from) || !declared.has(edge.to)) continue;
    const kind = edge.line || 'solid';
    const token = edge.bidirectional
      ? LINE_TOKENS[kind].bidir
      : edge.arrow
      ? LINE_TOKENS[kind].arrow
      : LINE_TOKENS[kind].plain;
    const label = edge.label ? `|${quoteLabel(edge.label)}|` : '';
    lines.push(`    ${edge.from} ${token}${label} ${edge.to}`);
  }

  // Style definitions for styled nodes
  for (const node of styledNodes) {
    if (!node.style) continue;
    const parts: string[] = [];
    if (node.style.fill) parts.push(`fill:${node.style.fill}`);
    if (node.style.stroke) parts.push(`stroke:${node.style.stroke}`);
    if (node.style.strokeWidth) parts.push(`stroke-width:${node.style.strokeWidth}px`);
    if (node.style.color) parts.push(`color:${node.style.color}`);
    if (parts.length > 0) {
      lines.push(`    style ${node.key} ${parts.join(',')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Prettifies Mermaid flowchart source code with standardized indentation and spacing.
 */
export function formatMermaid(source: string): string {
  const parsed = parseMermaid(source);
  if (!parsed.graph) return source;
  return emitMermaid(parsed.graph);
}

// ---------------------------------------------------------------------------
// The canvas's vocabulary
// ---------------------------------------------------------------------------

export interface ShapeSpec {
  kind: ShapeKind;
  points?: number;
  cornerRadius?: number;
  square?: boolean;
}

export const SHAPE_SPECS: Record<MermaidShape, ShapeSpec> = {
  rect: { kind: 'rect' },
  round: { kind: 'rect', cornerRadius: 10 },
  stadium: { kind: 'rect', cornerRadius: 999 },
  subroutine: { kind: 'rect' },
  database: { kind: 'rect', cornerRadius: 6 },
  diamond: { kind: 'polygon', points: 4, square: true },
  circle: { kind: 'ellipse', square: true },
  double_circle: { kind: 'ellipse', square: true },
  hexagon: { kind: 'polygon', points: 6 },
  parallelogram: { kind: 'polygon', points: 4 },
  parallelogram_inv: { kind: 'polygon', points: 4 },
  trapezoid: { kind: 'polygon', points: 4 },
  trapezoid_inv: { kind: 'polygon', points: 4 },
  flag: { kind: 'polygon', points: 5 },
};

export function shapeFromCanvas(kind: ShapeKind, points?: number, cornerRadius?: number): MermaidShape {
  if (kind === 'ellipse') return 'circle';
  if (kind === 'squircle') return 'round';
  if (kind === 'polygon') {
    if (points === 4) return 'diamond';
    if (points === 6) return 'hexagon';
    if (points === 5) return 'flag';
    return 'rect';
  }
  if (kind === 'rect') {
    if ((cornerRadius ?? 0) >= 40) return 'stadium';
    if ((cornerRadius ?? 0) > 0) return 'round';
  }
  return 'rect';
}

/** A parse that got *something* on screen, and what it had to ignore to do it. */
export interface LenientParseResult extends ParseResult {
  /** 1-indexed lines skipped to reach a graph. Empty when the source is clean. */
  skippedLines: number[];
  /** The strict error, kept even when a partial graph was recovered. */
  strictError: string | null;
  strictErrorLine?: number;
}

/**
 * Parse for a preview, where blanking the canvas is the wrong answer.
 *
 * A live preview is bound to spend most of its life looking at a document
 * somebody is halfway through typing. Strict parsing means the picture
 * vanishes on every incomplete line and returns when the line is finished,
 * which is a flicker in exactly the moment the reader is trying to see the
 * effect of what they typed -- so it reports errors well and helps least when
 * it matters most.
 *
 * This drops the offending line and tries again, up to `maxSkips` times, so a
 * typo on line nine costs line nine and not the other twenty. The failing
 * lines are **blanked rather than removed**, because `errorLine` is what the
 * editor's gutter marks and renumbering the document underneath it would
 * point the marker at the wrong row.
 *
 * The strict error is still returned. This is error *recovery*, not error
 * suppression: the diagnostic stays exactly as loud, and the preview simply
 * stops being collateral damage.
 */
export function parseMermaidLenient(source: string, maxSkips = 12): LenientParseResult {
  const strict = parseMermaid(source);
  if (strict.graph || !strict.errorLine) {
    return {
      ...strict,
      skippedLines: [],
      strictError: strict.error,
      strictErrorLine: strict.errorLine,
    };
  }

  const lines = source.split('\n');
  const skippedLines: number[] = [];

  for (let attempt = 0; attempt < maxSkips; attempt++) {
    const result = parseMermaid(lines.join('\n'));
    if (result.graph) {
      return {
        graph: result.graph,
        // The recovered graph is shown; the original complaint is what is said.
        error: strict.error,
        errorLine: strict.errorLine,
        skippedLines,
        strictError: strict.error,
        strictErrorLine: strict.errorLine,
      };
    }

    const bad = result.errorLine;
    // No line to blame, or one already blanked: nothing further to try.
    if (!bad || bad < 1 || bad > lines.length || lines[bad - 1] === '') break;

    lines[bad - 1] = '';
    skippedLines.push(bad);
  }

  return {
    ...strict,
    skippedLines,
    strictError: strict.error,
    strictErrorLine: strict.errorLine,
  };
}
