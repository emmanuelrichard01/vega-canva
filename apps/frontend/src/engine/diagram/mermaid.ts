/**
 * Mermaid flowcharts, both directions.
 *
 * ## What this is, and what it deliberately is not
 *
 * Mermaid is normally used by handing text to the `mermaid` package and getting
 * an SVG back. That is not useful here and would actively fight the product: an
 * SVG is one opaque picture on a canvas whose entire point is that everything
 * on it is a real, editable object. A diagram you cannot drag a box out of is a
 * screenshot with extra steps.
 *
 * So the text is parsed here into the canvas's own vocabulary — shapes and
 * connectors — and read back out of it the same way. That is what makes the
 * feature round-trip: you write code, you get objects, you move them and
 * recolour them and add one by hand, and the code still describes what is on
 * the board. It is also why the dependency is not worth taking: the package is
 * over a megabyte and renders the one thing this feature must not produce.
 *
 * ## Scope
 *
 * **Flowcharts only** (`flowchart` / `graph`), which is the form that maps onto
 * boxes-and-arrows exactly. Sequence, class, state and Gantt diagrams each have
 * their own layout model and their own primitives — a lifeline is not a shape
 * with a connector — and pretending to support them by approximating would
 * produce diagrams that are wrong in ways the user has to discover. Declining
 * them is stated in the parse result rather than guessed at.
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
  | 'diamond'
  | 'circle'
  | 'hexagon'
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
  /**
   * Paint from a `style` or `classDef` directive.
   *
   * These lines were skipped outright, which meant a diagram that had been
   * coloured — and colour in a flowchart is nearly always load-bearing, marking
   * the error path or the happy path — arrived on the board uniformly white.
   * The information was in the source and was being thrown away.
   */
  style?: NodeStyle;
}

export type EdgeLine = 'solid' | 'dotted' | 'thick';

export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
  line: EdgeLine;
  /** Whether the run ends in an arrowhead. `---` does not. */
  arrow: boolean;
}

export type FlowDirection = 'TD' | 'TB' | 'LR' | 'RL' | 'BT';

export interface MermaidGraph {
  direction: FlowDirection;
  nodes: MermaidNode[];
  edges: MermaidEdge[];
}

export interface ParseResult {
  graph: MermaidGraph | null;
  /**
   * What went wrong, in a sentence a person can act on.
   *
   * One message rather than a list of every offending line: the first error in
   * a diagram is nearly always the cause of the rest, and showing six makes the
   * one that matters harder to find.
   */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Node declarations, longest bracket forms first.
 *
 * Order is load-bearing. `([Stadium])` also matches the `(Round)` pattern, and
 * `[[Subroutine]]` also matches `[Rect]` — so a shorter form tested first would
 * claim the text and silently produce the wrong shape with stray brackets left
 * in the label. Longest-first is the only ordering that cannot do that.
 */
const NODE_FORMS: Array<{ open: string; close: string; shape: MermaidShape }> = [
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '>', close: ']', shape: 'flag' },
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
  // `<br>` is the one piece of markup mermaid labels use often enough to matter.
  return text.replace(/<br\s*\/?>/gi, '\n').trim();
}

/**
 * One `A[Label]` token, or a bare `A`.
 *
 * Returns the node and how much of the string it consumed, because the caller
 * is walking an edge statement and needs to know where the arrow starts.
 */
function readNode(src: string): { node: MermaidNode; length: number } | null {
  /**
   * Deliberately excludes `-` and `.`.
   *
   * Those are what arrows are made of, so a class containing them matched the
   * leading `--` of the very link that follows the node and consumed it as an
   * identifier — which is why `A --> B --> C` came back as one edge instead of
   * two. Mermaid ids in practice are word characters; giving up the rare
   * hyphenated id is worth not mis-reading every chained line.
   */
  const keyMatch = /^\s*([A-Za-z0-9_]+)/.exec(src);
  if (!keyMatch) return null;
  const key = keyMatch[1];
  let cursor = keyMatch[0].length;
  const rest = src.slice(cursor);

  for (const form of NODE_FORMS) {
    if (!rest.startsWith(form.open)) continue;
    const end = rest.indexOf(form.close, form.open.length);
    if (end === -1) continue;
    const label = cleanLabel(rest.slice(form.open.length, end));
    return {
      node: { key, label: label || key, shape: form.shape },
      length: cursor + end + form.close.length,
    };
  }
  return { node: { key, label: key, shape: 'rect' }, length: cursor };
}

/**
 * The two ways mermaid writes a labelled link.
 *
 * Both `-->|yes|` and `-- yes -->` appear in real documents often enough that
 * supporting only one would make the feature look broken on somebody's
 * existing diagram.
 *
 * Tried as separate patterns rather than one clever alternation. The combined
 * regex could not tell `-- yes -->` from `-->`: the inline form's opening `--`
 * is a prefix of the plain arrow, so whichever branch was tried first claimed
 * both and the other never matched. Two patterns, inline first and requiring a
 * non-empty label, cannot be ambiguous.
 */
const EDGE_INLINE = /^\s*(--|-\.|==)\s*([^|>\-=.][^|>]*?)\s*(-->|---|-\.->|-\.-|==>|===)\s*(?:\|\s*([^|]*?)\s*\|)?\s*/;
/** Longest connector first, so `-.->' is never read as `-.-` plus a stray `>`. */
const EDGE_PLAIN = /^\s*(-\.->|-\.-|==>|===|-->|---)\s*(?:\|\s*([^|]*?)\s*\|)?\s*/;

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
    return {
      edge: { line: lineKind(connector), arrow: connector.endsWith('>'), ...(label ? { label } : {}) },
      length: full.length,
    };
  }
  const plain = EDGE_PLAIN.exec(src);
  if (!plain) return null;
  const [full, connector, piped] = plain;
  const label = cleanLabel(piped ?? '');
  return {
    edge: { line: lineKind(connector), arrow: connector.endsWith('>'), ...(label ? { label } : {}) },
    length: full.length,
  };
}

/**
 * `fill:#f9f,stroke:#333,stroke-width:2px,color:#fff` — mermaid's own style
 * vocabulary, of which these four are the ones that map onto anything this
 * canvas can draw.
 *
 * Anything else in the declaration is ignored rather than refused: a diagram
 * carrying a property we cannot honour should still import, minus that one
 * property, instead of failing whole.
 */
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

/** `style A fill:#f9f` */
function readStyle(line: string): { key: string; style: NodeStyle } | null {
  const m = /^style\s+([A-Za-z0-9_]+)\s+(.+)$/i.exec(line);
  return m ? { key: m[1], style: readStyleBody(m[2]) } : null;
}

/** `classDef warn fill:#fee,stroke:#b00` */
function readClassDef(line: string): { name: string; style: NodeStyle } | null {
  const m = /^classDef\s+([A-Za-z0-9_]+)\s+(.+)$/i.exec(line);
  return m ? { name: m[1], style: readStyleBody(m[2]) } : null;
}

/** `class A,B warn` — several nodes assigned to one named class at once. */
function readClassApply(line: string): { keys: string[]; name: string } | null {
  const m = /^class\s+([A-Za-z0-9_,\s]+?)\s+([A-Za-z0-9_]+)\s*$/i.exec(line);
  if (!m) return null;
  return { keys: m[1].split(',').map((k) => k.trim()).filter(Boolean), name: m[2] };
}

const DIRECTIONS: Record<string, FlowDirection> = {
  TD: 'TD', TB: 'TB', LR: 'LR', RL: 'RL', BT: 'BT',
};

/**
 * Mermaid text to a graph.
 *
 * Never throws. This runs on every keystroke in the editor, and a parser that
 * throws halfway through a half-typed line takes the live preview with it —
 * the preview is most useful exactly while the text is incomplete.
 */
export function parseMermaid(source: string): ParseResult {
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));

  if (lines.length === 0) return { graph: null, error: null };

  const header = /^(flowchart|graph)\s+([A-Za-z]{2})?/i.exec(lines[0]);
  if (!header) {
    const kind = /^(sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey)/i.exec(
      lines[0]
    );
    if (kind) {
      return {
        graph: null,
        // Named rather than a generic failure: knowing *which* diagram type was
        // recognised and declined is the difference between "this tool is
        // broken" and "this tool does flowcharts".
        error: `${kind[1]} is not supported yet — this converts flowcharts to editable objects. Start with "flowchart TD".`,
      };
    }
    return { graph: null, error: 'Start with "flowchart TD" or "graph LR".' };
  }

  const direction = DIRECTIONS[(header[2] ?? 'TD').toUpperCase()] ?? 'TD';
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  /** Per-node paint, and the named classes nodes can be assigned to. */
  const styles = new Map<string, NodeStyle>();
  const classDefs = new Map<string, NodeStyle>();
  const classNames = new Map<string, string>();

  /** Later declarations win, so `A` then `A[Real name]` ends up named. */
  const remember = (node: MermaidNode) => {
    const existing = nodes.get(node.key);
    if (!existing || (existing.label === existing.key && node.label !== node.key)) {
      nodes.set(node.key, node);
    } else if (existing.shape === 'rect' && node.shape !== 'rect') {
      nodes.set(node.key, { ...existing, shape: node.shape });
    }
  };

  for (const line of lines.slice(1)) {
    // Styling directives, read before the skip list below rather than skipped
    // with it — these carry colour, and colour in a flowchart is nearly always
    // saying something the diagram would lose without it.
    const styling = readStyle(line);
    if (styling) {
      // Held until every line is read: `style` may name a node declared later,
      // and mermaid does not require the declaration to come first.
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
    if (/^(subgraph|end|click|linkStyle|direction)/i.test(line)) continue;

    let cursor = 0;
    let guard = 0;

    // One node, then link/node pairs. The old shape re-read a *node* at the top
    // of every iteration, so after consuming `A --> B` it tried to read another
    // identifier where the second arrow of `A --> B --> C` actually was.
    const first = readNode(line.slice(cursor));
    if (!first) continue;
    remember(first.node);
    cursor += first.length;
    let previous = first.node.key;

    while (cursor < line.length && guard++ < 64) {
      const link = readEdge(line.slice(cursor));
      if (!link) break;
      cursor += link.length;

      const target = readNode(line.slice(cursor));
      if (!target) break;
      remember(target.node);
      cursor += target.length;

      edges.push({ from: previous, to: target.node.key, ...link.edge });
      // The target becomes the source of any further link on the same line.
      previous = target.node.key;
    }
  }

  if (nodes.size === 0) {
    return { graph: null, error: 'No nodes found. Try "A[Start] --> B[End]".' };
  }

  // A direct `style` beats the class it also belongs to, which is the
  // precedence mermaid itself uses and the one anyone would expect.
  const painted = [...nodes.values()].map((node) => {
    const fromClass = classDefs.get(classNames.get(node.key) ?? '');
    const direct = styles.get(node.key);
    const style = { ...(fromClass ?? {}), ...(direct ?? {}) };
    return Object.keys(style).length ? { ...node, style } : node;
  });

  return { graph: { direction, nodes: painted, edges }, error: null };
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

/** The bracket pair each shape is written with. */
const SHAPE_BRACKETS: Record<MermaidShape, [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  diamond: ['{', '}'],
  circle: ['((', '))'],
  hexagon: ['{{', '}}'],
  flag: ['>', ']'],
};

const LINE_TOKENS: Record<EdgeLine, { arrow: string; plain: string }> = {
  solid: { arrow: '-->', plain: '---' },
  dotted: { arrow: '-.->', plain: '-.-' },
  thick: { arrow: '==>', plain: '===' },
};

/**
 * A label that has to survive being read back.
 *
 * Quoted whenever it carries anything mermaid's own grammar would choke on —
 * brackets, arrows, pipes, quotes. Emitting `A[Ship it (v2)]` produces a file
 * that does not parse, and the user's first sight of that is their own diagram
 * failing to import.
 */
function quoteLabel(label: string): string {
  const flat = label.replace(/\n/g, '<br>');
  return /["'[\]{}()<>|=-]/.test(flat) ? `"${flat.replace(/"/g, "'")}"` : flat;
}

/** A stable, mermaid-safe identifier for a node id. */
export function keyFor(index: number): string {
  // A..Z, then A1.. — short enough to read, and never a mermaid keyword.
  const letter = String.fromCharCode(65 + (index % 26));
  const cycle = Math.floor(index / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}

/** A graph back to mermaid source. */
export function emitMermaid(graph: MermaidGraph): string {
  const lines = [`flowchart ${graph.direction}`];
  const declared = new Set<string>();

  for (const node of graph.nodes) {
    const [open, close] = SHAPE_BRACKETS[node.shape];
    lines.push(`    ${node.key}${open}${quoteLabel(node.label)}${close}`);
    declared.add(node.key);
  }

  for (const edge of graph.edges) {
    // An edge naming a node nothing declared would produce a phantom box on
    // re-import, so it is dropped rather than written.
    if (!declared.has(edge.from) || !declared.has(edge.to)) continue;
    const token = LINE_TOKENS[edge.line][edge.arrow ? 'arrow' : 'plain'];
    const label = edge.label ? `|${quoteLabel(edge.label)}|` : '';
    lines.push(`    ${edge.from} ${token}${label} ${edge.to}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The canvas's vocabulary
// ---------------------------------------------------------------------------

/** How each mermaid shape is drawn with the primitives this canvas has. */
export interface ShapeSpec {
  kind: ShapeKind;
  points?: number;
  cornerRadius?: number;
  /** Mermaid's circles and diamonds read wrong at a wide aspect. */
  square?: boolean;
}

export const SHAPE_SPECS: Record<MermaidShape, ShapeSpec> = {
  rect: { kind: 'rect' },
  round: { kind: 'rect', cornerRadius: 10 },
  // A stadium is a rectangle rounded until the ends are semicircles, which is
  // a radius of half the height rather than a shape of its own.
  stadium: { kind: 'rect', cornerRadius: 999 },
  subroutine: { kind: 'rect' },
  // A four-sided polygon stood on its point *is* mermaid's rhombus, so this
  // needs no new primitive — and it stays editable as a polygon afterwards.
  diamond: { kind: 'polygon', points: 4, square: true },
  circle: { kind: 'ellipse', square: true },
  hexagon: { kind: 'polygon', points: 6 },
  flag: { kind: 'polygon', points: 5 },
};

/** The inverse, for reading a board back out as code. */
export function shapeFromCanvas(kind: ShapeKind, points?: number, cornerRadius?: number): MermaidShape {
  if (kind === 'ellipse') return 'circle';
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
