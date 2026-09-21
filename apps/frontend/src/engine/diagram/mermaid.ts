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
import { paramFallback } from '../model/shapes/params';

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
  | 'flag'
  /**
   * The shapes that only Mermaid 11's `A@{ shape: … }` form can ask for.
   *
   * Everything above has a bracket spelling and has had one for years. These
   * have no brackets left to give them — that is precisely why Mermaid added a
   * named form — and each is here because this canvas already draws the real
   * flowchart symbol for it. Nothing was added to the list for the sake of
   * completeness: a name with no faithful geometry behind it would be a
   * rectangle wearing a label, which is what `SHAPE_SPECS` spent years being.
   */
  | 'document'
  | 'internal_storage'
  | 'delay'
  | 'manual_input'
  | 'card'
  | 'triangle';

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
  /** Parent subgraph ID if nested inside another subgraph */
  parentSubgraphId?: string;
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
/**
 * The body of a Mermaid 11 `@{ … }` block, as key/value pairs.
 *
 * Tolerant in the two ways real documents need. Values may be bare, single- or
 * double-quoted, and the block may carry keys this parser does not act on
 * (`icon`, `form`, `pos`) — those are read and ignored rather than treated as
 * a syntax error, because a diagram that uses one is not malformed, it is just
 * using a feature this canvas has no equivalent for.
 */
function readAtBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // A quoted value may contain commas, so the split is on commas *outside*
  // quotes rather than on every comma. `label: "Reserve, then ship"` is the
  // case that breaks a naive split, and it is a perfectly ordinary label.
  const parts: string[] = [];
  let depth = '';
  let current = '';
  for (const ch of body) {
    if (depth) {
      if (ch === depth) depth = '';
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      depth = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  for (const part of parts) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const key = part.slice(0, at).trim().toLowerCase();
    if (key) out[key] = cleanLabel(part.slice(at + 1));
  }
  return out;
}

/**
 * Splits a line on statement-separating semicolons, ignoring semicolons inside quotes or brackets.
 */
export function splitStatements(line: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let bracketDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '(' || ch === '{') {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === ']' || ch === ')' || ch === '}') {
      if (bracketDepth > 0) bracketDepth--;
      current += ch;
      continue;
    }
    if (ch === ';' && bracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

/**
 * Splits Mermaid flowchart source code into discrete statements, respecting
 * multi-line quoted strings, bracketed labels, statement-separating semicolons,
 * and comment lines (%%).
 */
export function tokenizeStatements(source: string): Array<{ text: string; lineNum: number }> {
  const statements: Array<{ text: string; lineNum: number }> = [];
  let current = '';
  let inQuote: string | null = null;
  let bracketDepth = 0;
  let inComment = false;
  let lineNum = 1;
  let statementStartLine = 1;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed && !trimmed.startsWith('%%')) {
      statements.push({ text: trimmed, lineNum: statementStartLine });
    }
    current = '';
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const nextCh = source[i + 1];

    if (inComment) {
      if (ch === '\n') {
        inComment = false;
        lineNum++;
      }
      continue;
    }

    if (!inQuote && bracketDepth === 0 && ch === '%' && nextCh === '%') {
      inComment = true;
      i++;
      continue;
    }

    if (ch === '\\' && inQuote) {
      current += ch;
      if (nextCh !== undefined) {
        current += nextCh;
        i++;
        if (nextCh === '\n') lineNum++;
      }
      continue;
    }

    if (inQuote) {
      current += ch;
      if (ch === inQuote) {
        inQuote = null;
      } else if (ch === '\n') {
        lineNum++;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (!current.trim()) {
        statementStartLine = lineNum;
      }
      inQuote = ch;
      current += ch;
      continue;
    }

    if (ch === '[' || ch === '(' || ch === '{') {
      if (!current.trim()) {
        statementStartLine = lineNum;
      }
      bracketDepth++;
      current += ch;
      continue;
    }

    if (ch === ']' || ch === ')' || ch === '}') {
      if (bracketDepth > 0) bracketDepth--;
      current += ch;
      continue;
    }

    if (bracketDepth > 0) {
      if (ch === '\n') {
        lineNum++;
        current += '\n';
      } else {
        current += ch;
      }
      continue;
    }

    // Top-level statement terminators: semicolon or newline
    if (ch === '\n' || ch === ';') {
      flush();
      if (ch === '\n') {
        lineNum++;
      }
      statementStartLine = lineNum;
      continue;
    }

    if (!current.trim() && ch !== ' ' && ch !== '\t' && ch !== '\r') {
      statementStartLine = lineNum;
    }
    current += ch;
  }

  flush();
  return statements;
}

function readSingleNode(src: string): { node: MermaidNode; length: number; inlineClass?: string } | null {
  // Support quoted keys ("My Node"[Label] or 'My Node') or kebab-case identifiers (auth-service, api-gw)
  const keyMatch = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*))/.exec(src);
  if (!keyMatch) return null;
  const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
  const cursor = keyMatch[0].length;
  const rest = src.slice(cursor);

  let shape: MermaidShape = 'rect';
  let label = key;
  let consumed = cursor;

  /*
   * Mermaid 11's named form, checked before the brackets.
   */
  if (rest.startsWith('@{')) {
    const close = rest.indexOf('}', 2);
    if (close !== -1) {
      const fields = readAtBlock(rest.slice(2, close));
      const named = fields.shape ? shapeForName(fields.shape) : undefined;
      if (named) shape = named;
      label = fields.label || key;
      consumed = cursor + close + 1;

      const afterBlock = src.slice(consumed);
      const classAfter = /^:::([A-Za-z0-9_-]+)/.exec(afterBlock);
      return {
        node: { key, label, shape },
        length: consumed + (classAfter ? classAfter[0].length : 0),
        ...(classAfter ? { inlineClass: classAfter[1] } : {}),
      };
    }
  }

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

  // Check for inline class `:::className` (allowing hyphens)
  const afterNode = src.slice(consumed);
  const classMatch = /^:::([A-Za-z0-9_-]+)/.exec(afterNode);
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

const EDGE_INLINE = /^\s*(--+|-\.+|==+)\s*([^|>\-=.][^|>]*?)\s*(<--+>|--+>|--+|<-[.-]+->|-[.-]+->|-[.-]+-|<==+>|==+>|==+)\s*(?:\|\s*([^|]*?)\s*\|)?\s*/;
const EDGE_PLAIN = /^\s*(<--+>|--+>|--+|<-[.-]+->|-[.-]+->|-[.-]+-|<==+>|==+>|==+)\s*(?:\|\s*([^|]*?)\s*\|)?\s*/;

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
    const value = rest.join(':').trim().replace(/;+$/, '').trim();
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
  const m = /^style\s+([A-Za-z0-9_-]+)\s+(.+)$/i.exec(line);
  return m ? { key: m[1], style: readStyleBody(m[2]) } : null;
}

function readClassDef(line: string): { name: string; style: NodeStyle } | null {
  const m = /^classDef\s+([A-Za-z0-9_-]+)\s+(.+)$/i.exec(line);
  return m ? { name: m[1], style: readStyleBody(m[2]) } : null;
}

function readClassApply(line: string): { keys: string[]; name: string } | null {
  const m = /^class\s+([A-Za-z0-9_,\s-]+?)\s+([A-Za-z0-9_-]+)\s*$/i.exec(line);
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
  const lines = tokenizeStatements(source);

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
    // 1. Check for subgraph start (supporting kebab-case IDs)
    const subMatch = /^subgraph\s+([A-Za-z0-9_-]+)(?:\s*\[\s*(.*?)\s*\])?(?:\s*"(.*?)")?\s*$/i.exec(line);
    if (subMatch) {
      const id = subMatch[1];
      const title = cleanLabel(subMatch[2] || subMatch[3] || id);
      const parentSub = subgraphStack[subgraphStack.length - 1];
      const sub: MermaidSubgraph = {
        id,
        title,
        nodeKeys: [],
        parentSubgraphId: parentSub ? parentSub.id : undefined,
      };
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
      return !subgraphMap.has(node.key);
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
  // The named-only shapes never reach this table — `declare` sends them to the
  // `@{ … }` form first — but the record is total over `MermaidShape`, and a
  // missing entry would mean a new shape silently emitting as a rectangle.
  document: ['[', ']'],
  internal_storage: ['[', ']'],
  delay: ['[', ']'],
  manual_input: ['[', ']'],
  card: ['[', ']'],
  triangle: ['[', ']'],
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

/**
 * One node's declaration, in whichever form can express its shape.
 *
 * Brackets where there are brackets, because that is what almost every
 * flowchart in the world is written in and rewriting `A[Step]` as
 * `A@{ shape: rect, label: "Step" }` would be this tool making somebody's
 * source stranger than they left it.
 *
 * The named form only for the shapes that have no bracket spelling at all,
 * which is exactly the set Mermaid 11 added it for.
 */
function declare(node: MermaidNode): string {
  if (isNamedOnly(node.shape)) {
    return `${node.key}@{ shape: ${SHAPE_TO_NAME[node.shape]}, label: "${quoteInner(node.label)}" }`;
  }
  const [open, close] = SHAPE_BRACKETS[node.shape] || ['[', ']'];
  return `${node.key}${open}${quoteLabel(node.label)}${close}`;
}

/** A label for inside the quotes the named form always writes. */
function quoteInner(label: string): string {
  return label.replace(/\n/g, '<br>').replace(/"/g, "'");
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
          lines.push(`        ${declare(node)}`);
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
        lines.push(`    ${declare(node)}`);
        declared.add(node.key);
        if (node.style && Object.keys(node.style).length > 0) styledNodes.push(node);
      }
    }
  } else {
    for (const node of graph.nodes) {
      lines.push(`    ${declare(node)}`);
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
  /**
   * Headroom a shape needs beyond what its label measures.
   *
   * A few kinds spend part of their box on something that is not interior: a
   * cylinder's rim arcs across the top, and a label centred in the raw box
   * sits under it. The text measurement cannot know that — it measures text —
   * so the shape declares what it costs.
   */
  extraHeight?: number;
  /**
   * The kind's own dials, as `shapeParams.ts` names them.
   *
   * A trapezoid's `inset` and a parallelogram's `skew` are what make those two
   * shapes *those shapes* rather than a quadrilateral, and a negative value is
   * the mirrored form — which is exactly what mermaid's reversed brackets ask
   * for. Written here rather than left to the shape's fallback so that
   * `[/A\]` and `[\A/]` cannot come out as the same picture.
   */
  params?: Record<string, number>;
}

/**
 * A mermaid shape, as a shape this canvas actually has.
 *
 * ## What this table used to say, and why it was wrong
 *
 * Every entry here was once one of three kinds — `rect`, `ellipse` or
 * `polygon` — because those were the only ones the preview could draw. The
 * cost was severe and invisible from the code:
 *
 *  - `parallelogram`, `parallelogram_inv`, `trapezoid` and `trapezoid_inv`
 *    were all `polygon` with four points, and a four-point regular polygon is
 *    a **diamond**. Four distinct shapes in mermaid's vocabulary — the two I/O
 *    symbols and the two manual-operation symbols — all drew as the decision
 *    symbol. A flowchart whose every data node looked like a branch.
 *  - `hexagon` was a six-point regular polygon, which is **pointy-topped**.
 *    The flowchart hexagon is flat-topped with points on the sides; that is a
 *    different symbol, and the canvas has it as `preparation`.
 *  - `subroutine` and `database` were a plain and a slightly-rounded
 *    rectangle. The bars and the cylinder rims existed only in the preview's
 *    own SVG, so the board drew neither: what you previewed was not what you
 *    inserted.
 *
 * The canvas has had real flowchart geometry for all of these the whole time —
 * `predefined_process`, `cylinder`, `preparation`, `trapezoid`,
 * `parallelogram` — with correct contours, interior features and parametric
 * dials. This table was the only thing standing between mermaid and them.
 *
 * ## The one shape still approximated
 *
 * `double_circle` maps to a plain ellipse. Mermaid draws a ring inside the
 * circle and no canvas kind does; a `donut` would cut a hole through it.
 * Inserting the outer circle alone is the honest approximation, and
 * `silhouette.ts` makes the preview show exactly that rather than drawing a
 * ring the board will not produce.
 */
export const SHAPE_SPECS: Record<MermaidShape, ShapeSpec> = {
  rect: { kind: 'rect' },
  round: { kind: 'rect', cornerRadius: 10 },
  // A real capsule, whose ends are semicircles by construction rather than a
  // rectangle with a radius large enough to look like one.
  stadium: { kind: 'capsule' },
  // The double-barred process symbol, bars included — `shapeFeatureContours`
  // draws them, on the board as well as in the preview.
  subroutine: { kind: 'predefined_process' },
  /**
   * A drum, not a stack.
   *
   * `database` — the shelved kind — was the first choice here, for looking
   * richer. It is wrong twice. Mermaid draws `[(text)]` as a single cylinder,
   * so the stack is less faithful than it looks; and its decks are drawn
   * *through the whole body*, so at every box size a deck rim runs straight
   * across the label. A 140x56 box centres its text at y=28 and the second
   * deck reaches y=30.
   *
   * The drum has one rim, and a shallower one than the default: the rim is a
   * *fraction of the height*, so a taller box grows the rim with it and extra
   * headroom alone never wins. At the stock 0.2 the rim reaches `0.4h` while a
   * centred 14px label starts at `0.5h - 9`, which needs a box over 90px tall
   * before the two clear. At 0.12 they clear from 35px up, which is every box
   * this builds. The small headroom is for the descenders.
   */
  database: { kind: 'cylinder', params: { rimRatio: 0.12 }, extraHeight: 8 },
  diamond: { kind: 'diamond', square: true },
  circle: { kind: 'ellipse', square: true },
  double_circle: { kind: 'ellipse', square: true },
  // Flat-topped, points on the sides: the preparation symbol.
  hexagon: { kind: 'preparation' },
  // `[/A/]` leans right, `[\A\]` leans left. Same shape, mirrored — which is
  // what the sign of `skew` means.
  parallelogram: { kind: 'parallelogram', params: { skew: 0.2 } },
  parallelogram_inv: { kind: 'parallelogram', params: { skew: -0.2 } },
  // `[/A\]` narrows towards the top, `[\A/]` widens towards it. Same shape,
  // flipped — which is what the sign of `inset` means.
  trapezoid: { kind: 'trapezoid', params: { inset: 0.2 } },
  trapezoid_inv: { kind: 'trapezoid', params: { inset: -0.2 } },
  flag: { kind: 'banner', params: { indent: 0.15 } },

  // -- Mermaid 11's named shapes, where the canvas has the real symbol ------
  document: { kind: 'document' },
  internal_storage: { kind: 'internal_storage' },
  delay: { kind: 'delay' },
  manual_input: { kind: 'manual_input' },
  card: { kind: 'note' },
  triangle: { kind: 'polygon', points: 3 },
};

/**
 * Mermaid 11's shape names, and the ones it kept as synonyms.
 *
 * ## Why a table of names rather than one name per shape
 *
 * Mermaid deliberately gives most shapes several names — a semantic one
 * (`decision`), a shape one (`diam`), and often a flowchart-textbook one
 * (`question`) — because people reach for whichever vocabulary they already
 * have. A parser that accepted only one of the three would reject valid
 * Mermaid and, worse, reject it *silently enough* that the reader would assume
 * the shape was unsupported rather than misspelled.
 *
 * So every alias Mermaid documents for a shape this canvas can draw is here.
 * Names for shapes it cannot draw are deliberately absent: `hourglass`,
 * `fork`, `brace` and the rest have no faithful geometry here, and mapping
 * them to a near-enough rectangle is how the old `SHAPE_SPECS` made four
 * different symbols into one diamond. An unknown name is reported, not
 * guessed.
 *
 * ## The second test a name has to pass: can it hold a label?
 *
 * `cross-circ` and `com-link` are also absent, and they are the interesting
 * omissions because this canvas draws both of them well. A node in a flowchart
 * exists to carry words, and those two are *annotation* symbols: the circle's X
 * runs corner to corner through the middle of it, and the bolt is a thin
 * diagonal stroke. With a centred label — which is the only way this builder
 * places one — the X crosses the text and the bolt runs behind it.
 *
 * Both were wired up, drawn and looked at before being ruled out rather than
 * assumed unsuitable. The rule is the same one that governs the geometry: a
 * shape that cannot do the job honestly is worse than a name politely refused.
 */
const SHAPE_ALIASES: Record<string, MermaidShape> = {
  // Process
  rect: 'rect', proc: 'rect', process: 'rect', rectangle: 'rect',
  // Rounded
  rounded: 'round', event: 'round',
  // Terminal
  stadium: 'stadium', pill: 'stadium', terminal: 'stadium',
  // Subprocess
  subproc: 'subroutine', subprocess: 'subroutine', subroutine: 'subroutine',
  'framed-rectangle': 'subroutine', 'fr-rect': 'subroutine',
  // Database
  cyl: 'database', cylinder: 'database', database: 'database', db: 'database',
  // Circles
  circle: 'circle', circ: 'circle',
  'dbl-circ': 'double_circle', 'double-circle': 'double_circle',
  // Decision
  diam: 'diamond', diamond: 'diamond', decision: 'diamond', question: 'diamond',
  // Preparation
  hex: 'hexagon', hexagon: 'hexagon', prepare: 'hexagon',
  // Data (parallelograms)
  'lean-r': 'parallelogram', 'lean-right': 'parallelogram', 'in-out': 'parallelogram',
  'lean-l': 'parallelogram_inv', 'lean-left': 'parallelogram_inv', 'out-in': 'parallelogram_inv',
  // Trapezoids. `trap-b` has its base at the bottom, so it is the wide-bottom
  // form; `trap-t` is its inverse. Getting these the wrong way round is the
  // single easiest mistake here, and it is silent.
  'trap-b': 'trapezoid', 'trapezoid-bottom': 'trapezoid', priority: 'trapezoid',
  'trap-t': 'trapezoid_inv', 'trapezoid-top': 'trapezoid_inv', manual: 'trapezoid_inv',
  // Asymmetric
  odd: 'flag', 'rect-left-inv-arrow': 'flag', flag: 'flag', 'paper-tape': 'flag',
  // Named-only shapes
  doc: 'document', document: 'document',
  'win-pane': 'internal_storage', 'window-pane': 'internal_storage', 'internal-storage': 'internal_storage',
  delay: 'delay', 'half-rounded-rectangle': 'delay',
  'manual-input': 'manual_input', 'sl-rect': 'manual_input', 'sloped-rectangle': 'manual_input',
  'notch-rect': 'card', card: 'card', 'notched-rectangle': 'card',
  tri: 'triangle', triangle: 'triangle', extract: 'triangle',
};

/** The name to write back out, one per shape rather than one per alias. */
const SHAPE_TO_NAME: Partial<Record<MermaidShape, string>> = {
  document: 'doc',
  internal_storage: 'win-pane',
  delay: 'delay',
  manual_input: 'manual-input',
  card: 'notch-rect',
  triangle: 'tri',
};

/** Whether a shape can only be written with Mermaid 11's named form. */
const isNamedOnly = (shape: MermaidShape): boolean => shape in SHAPE_TO_NAME;

export const shapeForName = (name: string): MermaidShape | undefined =>
  SHAPE_ALIASES[name.trim().toLowerCase()];

/** Every name the `@{ shape: … }` form accepts, for the error that lists them. */
export const knownShapeNames = (): string[] => Object.keys(SHAPE_ALIASES).sort();

/**
 * A board shape, written back as the mermaid form that produces it.
 *
 * The inverse of `SHAPE_SPECS`, and it has to stay one: a diagram that does not
 * survive a round trip through code silently changes geometry, which is worse
 * than refusing to convert. `build.test.ts` walks every `MermaidShape` through
 * `SHAPE_SPECS` and back through here and asserts it arrives as itself.
 *
 * `geometry` rather than a handful of loose fields, because the mirrored forms
 * are told apart by the *sign* of a dial — a trapezoid tapering up is
 * `[/A\]` and one tapering down is `[\A/]` — and a signature taking only
 * `points` and `cornerRadius` could not see that.
 */
export function shapeFromCanvas(
  geometry: { kind: ShapeKind; points?: number; skew?: number; inset?: number },
  cornerRadius?: number
): MermaidShape {
  const { kind } = geometry;
  if (kind === 'ellipse') return 'circle';
  if (kind === 'squircle') return 'round';
  if (kind === 'diamond') return 'diamond';
  // Both drum and stack read back as mermaid's one database symbol.
  if (kind === 'cylinder' || kind === 'database') return 'database';
  if (kind === 'capsule') return 'stadium';
  if (kind === 'predefined_process') return 'subroutine';
  if (kind === 'preparation') return 'hexagon';
  if (kind === 'banner') return 'flag';
  // The named-only shapes, read back as themselves so a board drawn with the
  // shape tool emits Mermaid 11 rather than a rectangle.
  if (kind === 'document') return 'document';
  if (kind === 'internal_storage') return 'internal_storage';
  if (kind === 'delay') return 'delay';
  if (kind === 'manual_input') return 'manual_input';
  if (kind === 'note') return 'card';
  /*
   * The mirrored forms are told apart by the sign of the dial, and a shape
   * drawn with the tool rather than by this converter carries no dial at all.
   * `paramFallback` is what the renderer itself falls back to in that case, so
   * reading it here is what keeps a hand-drawn parallelogram from emitting as
   * the mirrored form it is not.
   */
  if (kind === 'parallelogram') {
    return (geometry.skew ?? paramFallback('parallelogram', 'skew')) < 0 ? 'parallelogram_inv' : 'parallelogram';
  }
  if (kind === 'trapezoid') {
    return (geometry.inset ?? paramFallback('trapezoid', 'inset')) < 0 ? 'trapezoid_inv' : 'trapezoid';
  }
  if (kind === 'polygon') {
    if (geometry.points === 3) return 'triangle';
    if (geometry.points === 4) return 'diamond';
    if (geometry.points === 6) return 'hexagon';
    if (geometry.points === 5) return 'flag';
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
