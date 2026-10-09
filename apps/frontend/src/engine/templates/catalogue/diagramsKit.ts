import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { StickyTheme } from '../../model/schema';
import type { EndCapKind } from '../../model/connectorEnds';
import { defaultCodeSpec, type CodeSpec } from '../../code/codeTypes';
import { codeMetrics } from '../../code/codeLayout';
import type { TableSpec } from '../../table/tableTypes';
import { code as kitCode, INK, INK_SOFT, INK_STRONG, PAPER, table as kitTable, textWidth, wrappedLines as kitWrappedLines } from '../templateKit';

/**
 * The vocabulary of the diagrams boards: flowcharts, maps, trees, lanes and
 * schemas, drawn the way a Lucidchart power user would draw them.
 *
 * ## Legible on either theme
 *
 * The board's ground follows the viewer's theme; a shape's fill and a text
 * node's ink do not. So every word here sits on a surface it carries — a
 * node's own fill, a white card, a sticky, a table, a code block — and the
 * only things drawn straight onto the board are the ones that adapt by
 * themselves (connector labels, frame headers) or are large mid-tone headings
 * that clear 3:1 on both grounds (`diagrams.test.ts` checks them).
 *
 * ## Regions are washes, not frames
 *
 * A frame owns whatever its centre covers and clips it, so a connector between
 * two frames belongs to neither and vanishes in the gap. Lanes, phases and
 * groups are low-opacity paths instead: they own nothing, and a path is not an
 * obstacle, so a wire from one lane to the next crosses freely. The one frame
 * on each board is the board itself, with no fill, so the theme shows through.
 *
 * ## Drawing order
 *
 * `Draft` collects nodes as they are written and hands them back layered:
 * the board, then washes, then wires, then everything else. An arrow never
 * crosses a label, and a wash never covers the arrow running over it.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * One family per branch, lane or phase: `hue` strokes and wires, `ink` is the
 * heading colour (a 600–700 step that reads on the light board at 4.5:1 and
 * on the dark one at 3:1), `tint` is the pale fill that carries dark text.
 */
export const FAMILY = {
  indigo: { hue: '#6366F1', ink: '#4F46E5', tint: '#E0E7FF', wire: '#6366F1' },
  blue: { hue: '#3B82F6', ink: '#2563EB', tint: '#DBEAFE', wire: '#3B82F6' },
  sky: { hue: '#0EA5E9', ink: '#0369A1', tint: '#E0F2FE', wire: '#0EA5E9' },
  teal: { hue: '#14B8A6', ink: '#0F766E', tint: '#CCFBF1', wire: '#0D9488' },
  green: { hue: '#22C55E', ink: '#15803D', tint: '#DCFCE7', wire: '#16A34A' },
  amber: { hue: '#F59E0B', ink: '#B45309', tint: '#FEF3C7', wire: '#D97706' },
  orange: { hue: '#F97316', ink: '#C2410C', tint: '#FFEDD5', wire: '#EA580C' },
  rose: { hue: '#F43F5E', ink: '#BE123C', tint: '#FFE4E6', wire: '#E11D48' },
  pink: { hue: '#EC4899', ink: '#BE185D', tint: '#FCE7F3', wire: '#DB2777' },
  violet: { hue: '#8B5CF6', ink: '#7C3AED', tint: '#EDE9FE', wire: '#7C3AED' },
  slate: { hue: '#64748B', ink: '#64748B', tint: '#F1F5F9', wire: '#64748B' },
} as const;

export type Family = keyof typeof FAMILY;

/** The neutral wire: a mid slate that holds 3:1 on the light board and the dark one. */
export const WIRE_INK = '#64748B';
/** Card edges: visible on white, quiet on the dark board. */
export const EDGE = '#CBD5E1';

// ---------------------------------------------------------------------------
// Measure
// ---------------------------------------------------------------------------

/**
 * Lines `text` wraps to at `width`, by the gallery's own Inter estimate with
 * six per cent to spare, so a box sized from it never comes up a line short.
 */
export const wrappedLines = (text: string, width: number, size: number, weight = 450): number =>
  kitWrappedLines(text, width, (run) => textWidth(run, size, weight) * 1.06);

/** The height a wrapped text block takes. */
export const textHeight = (text: string, width: number, size: number, lineHeight: number, weight = 450): number =>
  Math.ceil(wrappedLines(text, width, size, weight) * size * lineHeight) + 2;


/** The height a code block needs to show every line of `source` without scrolling. */
export function codeHeight(source: string, fontSize: number): number {
  const lines = source.split('\n').length;
  const m = codeMetrics({ ...defaultCodeSpec(source, 'plaintext'), fontSize }, lines);
  return m.headerHeight + m.padY * 2 + lines * m.lineHeight + 4;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type Port = 'top' | 'right' | 'bottom' | 'left' | 'auto';

export interface WireOptions {
  color?: string;
  width?: number;
  dash?: number[];
  routing?: 'orthogonal' | 'curved' | 'straight';
  from?: Port;
  to?: Port;
  /** An exact spot on the source or target, in its own 0–1 proportions. */
  fromAnchor?: { u: number; v: number };
  toAnchor?: { u: number; v: number };
  label?: string;
  /** Where the label sits along the run, 0 to 1. */
  at?: number;
  /** Offsets the label across the run. */
  dn?: number;
  start?: EndCapKind;
  end?: EndCapKind;
  avoid?: boolean;
  corner?: number;
  /** Both end caps, as a multiple of their stroke-derived size. */
  endScale?: number;
  sketch?: 'light' | 'medium' | 'heavy';
}

export interface NodeOptions {
  /** A library geometry. Absent is a rounded rectangle. */
  kind?: string;
  family?: Family;
  /** Overrides the family's tint. */
  fill?: string;
  /** Overrides the family's hue. */
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  radius?: number;
  size?: number;
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  sketch?: 'light' | 'medium' | 'heavy';
  geometry?: Record<string, unknown>;
  shadow?: boolean;
}

export interface TextOptions {
  size?: number;
  weight?: number;
  color?: string;
  lineHeight?: number;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
}

/** One entry in a header's key. */
export type LegendItem =
  | { line: string; label: string; dash?: number[]; end?: EndCapKind; start?: EndCapKind; curved?: boolean }
  | { swatch: string; edge: string; label: string; round?: boolean; dashed?: boolean };

/** A soft lift for the cards that matter most; one level, never stacked. */
const LIFT = { color: 'rgba(15,23,42,0.10)', blur: 12, offsetX: 0, offsetY: 4, opacity: 1 };

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

export class Draft {
  private frames: NewNodeInput[] = [];
  private grounds: NewNodeInput[] = [];
  private wires: NewNodeInput[] = [];
  private rest: NewNodeInput[] = [];

  /** Every node, layered: frames, washes, wires, then content in the order written. */
  nodes(): NewNodeInput[] {
    return [...this.frames, ...this.grounds, ...this.wires, ...this.rest];
  }

  /** Something already built, in the top layer. */
  add(...nodes: NewNodeInput[]): void {
    this.rest.push(...nodes);
  }

  /**
   * The board: a frame with a zero-opacity fill (an empty fill list reads as
   * white), so the viewer's own ground shows through, carrying the emoji, name
   * and one line that the frame header draws above it.
   */
  board(width: number, height: number, name: string, icon: string, description: string): NewNodeInput {
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'frame',
      x: 0,
      y: 0,
      width,
      height,
      title: name,
      icon,
      description,
      appearance: {
        fill: [{ type: 'solid', color: '#FFFFFF', opacity: 0 }],
        stroke: { color: 'rgba(100,116,139,0.45)', width: 1 },
        cornerRadius: 24,
      },
    };
    this.frames.push(node);
    return node;
  }

  /**
   * A wash behind a group: a hue at a few per cent, so it tints whichever
   * ground is under it. A path, so connectors cross it rather than routing
   * around it.
   */
  wash(x: number, y: number, width: number, height: number, family: Family, o: { opacity?: number; radius?: number; edge?: boolean; dashed?: boolean } = {}): NewNodeInput {
    const f = FAMILY[family];
    const node = roundedPath(x, y, width, height, o.radius ?? 16, f.hue, o.opacity ?? 0.06,
      o.edge === false ? undefined : { color: f.hue, width: 1.25, ...(o.dashed === false ? null : { dash: [8, 6] }) });
    this.grounds.push(node);
    return node;
  }

  /** A wash with a heading in the family's ink at its top left. */
  zone(x: number, y: number, width: number, height: number, name: string, family: Family, size = 20): void {
    this.wash(x, y, width, height, family);
    this.rest.push(this.text(x + 24, y + 18, width - 48, name, { size, weight: 650, color: FAMILY[family].ink, lineHeight: 1.3 }));
  }

  /** A text block sized to what it holds. Wraps at its width and grows down. */
  text(x: number, y: number, width: number, body: string, o: TextOptions = {}): NewNodeInput {
    const size = o.size ?? 14;
    const lineHeight = o.lineHeight ?? 1.45;
    const weight = o.weight ?? 450;
    return {
      id: nanoid(),
      type: 'text',
      x,
      y,
      width,
      height: textHeight(body, width, size, lineHeight, weight),
      text: body,
      resize: 'height',
      typography: {
        fontSize: size,
        fontWeight: weight,
        color: o.color ?? INK_SOFT,
        lineHeight,
        align: o.align ?? 'left',
        ...(o.letterSpacing !== undefined ? { letterSpacing: o.letterSpacing } : null),
      },
    };
  }

  /** Pushes a text block and returns it. */
  write(x: number, y: number, width: number, body: string, o: TextOptions = {}): NewNodeInput {
    const node = this.text(x, y, width, body, o);
    this.rest.push(node);
    return node;
  }

  /** A white surface with an edge: the ground the words on a card sit on. */
  surface(x: number, y: number, width: number, height: number, o: { family?: Family; edge?: string; dashed?: boolean; radius?: number; fill?: string; lift?: boolean; strokeWidth?: number } = {}): NewNodeInput {
    const edge = o.edge ?? (o.family ? FAMILY[o.family].hue : EDGE);
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: 'rect' },
      appearance: {
        fill: [{ type: 'solid', color: o.fill ?? PAPER }],
        stroke: { color: edge, width: o.strokeWidth ?? (o.family ? 1.25 : 1), ...(o.dashed ? { dash: [6, 4] } : null) },
        cornerRadius: o.radius ?? 12,
        ...(o.lift ? { shadow: LIFT } : null),
      },
    };
    this.rest.push(node);
    return node;
  }

  /**
   * A labelled node: one shape carrying its own words, the way every
   * flowchart symbol is drawn. Line breaks are the author's, so the label
   * never wraps against the edge of its box.
   */
  node(x: number, y: number, width: number, height: number, label: string, o: NodeOptions = {}): NewNodeInput {
    const f = FAMILY[o.family ?? 'slate'];
    const kind = o.kind ?? 'rect';
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind, ...o.geometry },
      text: label,
      appearance: {
        fill: [{ type: 'solid', color: o.fill ?? (o.family ? f.tint : PAPER) }],
        stroke: {
          color: o.stroke ?? (o.family ? f.hue : EDGE),
          width: o.strokeWidth ?? 1.5,
          ...(o.dashed ? { dash: [6, 4] } : null),
        },
        cornerRadius: o.radius ?? (kind === 'rect' ? 10 : 0),
        ...(o.sketch ? { sketch: o.sketch } : null),
        ...(o.shadow ? { shadow: LIFT } : null),
      },
      typography: {
        fontSize: o.size ?? 14,
        fontWeight: o.weight ?? 600,
        color: o.color ?? INK_STRONG,
        align: o.align ?? 'center',
        verticalAlign: o.valign ?? 'middle',
        lineHeight: o.lineHeight ?? 1.35,
      },
    };
    this.rest.push(node);
    return node;
  }

  /** A pill-shaped tag in a family's tint. */
  chip(x: number, y: number, width: number, height: number, label: string, family: Family, size = 12.5): NewNodeInput {
    return this.node(x, y, width, height, label, { family, radius: height / 2, size, weight: 600, color: INK, strokeWidth: 1 });
  }

  /** A diamond with its question inside. */
  decision(x: number, y: number, width: number, height: number, question: string, family: Family = 'amber', size = 13.5): NewNodeInput {
    return this.node(x, y, width, height, question, { kind: 'diamond', family, size, weight: 650, lineHeight: 1.3 });
  }

  /** A numbered disc: a step's order, or a milestone on a route. */
  disc(cx: number, cy: number, d: number, label: string, fill: string, size = 13, o: { ink?: string; edge?: string } = {}): NewNodeInput {
    return this.node(cx - d / 2, cy - d / 2, d, d, label, {
      kind: 'ellipse',
      fill,
      stroke: o.edge ?? PAPER,
      strokeWidth: 2,
      size,
      weight: 700,
      color: o.ink ?? PAPER,
    });
  }

  /**
   * A card: an optional glyph at the left, a title and a line under it, on
   * white. Returns the ground, which is what connectors attach to.
   */
  card(
    x: number,
    y: number,
    width: number,
    height: number,
    spec: { title: string; sub?: string; glyph?: string; family?: Family; dashed?: boolean; lift?: boolean; titleSize?: number; subSize?: number; fill?: string; edge?: string; strokeWidth?: number }
  ): NewNodeInput {
    const ground = this.surface(x, y, width, height, { family: spec.family, dashed: spec.dashed, lift: spec.lift, fill: spec.fill, edge: spec.edge, strokeWidth: spec.strokeWidth });
    const ART = 34;
    const textX = spec.glyph ? x + 16 + ART + 14 : x + 18;
    const textW = x + width - 16 - textX;
    if (spec.glyph) {
      const f = FAMILY[spec.family ?? 'slate'];
      this.rest.push({
        id: nanoid(),
        type: 'shape',
        x: x + 16,
        y: y + (height - ART) / 2,
        width: ART,
        height: ART,
        geometry: { kind: spec.glyph },
        appearance: { fill: [{ type: 'solid', color: f.tint }], stroke: { color: f.ink, width: 1.5 }, cornerRadius: 6 },
      });
    }
    const ts = spec.titleSize ?? 15;
    const ss = spec.subSize ?? 12.5;
    const titleH = textHeight(spec.title, textW, ts, 1.3, 650);
    const subH = spec.sub ? textHeight(spec.sub, textW, ss, 1.4) : 0;
    const block = titleH + (spec.sub ? 2 + subH : 0);
    const top = y + Math.max(10, (height - block) / 2);
    this.rest.push(this.text(textX, top, textW, spec.title, { size: ts, weight: 650, color: INK_STRONG, lineHeight: 1.3 }));
    if (spec.sub) this.rest.push(this.text(textX, top + titleH + 2, textW, spec.sub, { size: ss, color: INK_SOFT, lineHeight: 1.4 }));
    return ground;
  }

  /** A heading and a paragraph on white, edged in a family. Height follows the words. */
  callout(x: number, y: number, width: number, title: string, body: string, family: Family = 'slate', o: { lift?: boolean; minHeight?: number } = {}): NewNodeInput {
    const innerW = width - 40;
    const titleH = textHeight(title, innerW, 15, 1.3, 650);
    const bodyH = textHeight(body, innerW, 13.5, 1.5);
    const height = Math.max(o.minHeight ?? 0, 20 + titleH + 6 + bodyH + 20);
    const ground = this.surface(x, y, width, height, { family, lift: o.lift });
    this.rest.push(
      this.text(x + 20, y + 20, innerW, title, { size: 15, weight: 650, color: INK_STRONG, lineHeight: 1.3 }),
      this.text(x + 20, y + 20 + titleH + 6, innerW, body, { size: 13.5, color: INK_SOFT, lineHeight: 1.5 })
    );
    return ground;
  }

  /** The height `callout` will take for the same words. */
  static calloutHeight(width: number, title: string, body: string): number {
    const innerW = width - 40;
    return 20 + textHeight(title, innerW, 15, 1.3, 650) + 6 + textHeight(body, innerW, 13.5, 1.5) + 20;
  }

  sticky(x: number, y: number, width: number, height: number, body: string, theme: StickyTheme, extra: Record<string, unknown> = {}): NewNodeInput {
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'sticky',
      x,
      y,
      width,
      height,
      text: body,
      theme,
      fontSize: 16,
      reactions: {},
      tags: [],
      pinned: false,
      showAuthor: false,
      ...extra,
    };
    this.rest.push(node);
    return node;
  }

  table(x: number, y: number, width: number, spec: TableSpec, rowH = 32): NewNodeInput {
    const node = kitTable(x, y, spec, width, spec.cells.length * rowH);
    this.rest.push(node);
    return node;
  }

  /** Source on the board, in a dark theme that reads as code on either ground. */
  code(x: number, y: number, width: number, source: string, language: string, over: Partial<CodeSpec> = {}): NewNodeInput {
    const fontSize = over.fontSize ?? 12;
    const node = kitCode(x, y, source, language, width, codeHeight(source, fontSize), { theme: 'midnight', fontSize, wrap: false, ...over });
    this.rest.push(node);
    return node;
  }

  /** A connector bound at both ends, so dragging either object re-solves the route. */
  wire(from: NewNodeInput, to: NewNodeInput, o: WireOptions = {}): NewNodeInput {
    const routing = o.routing ?? 'orthogonal';
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'connector',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      from: { nodeId: from.id as string, port: o.from ?? 'auto', ...(o.fromAnchor ? { anchor: o.fromAnchor } : null) },
      to: { nodeId: to.id as string, port: o.to ?? 'auto', ...(o.toAnchor ? { anchor: o.toAnchor } : null) },
      routing,
      avoid: o.avoid ?? routing === 'orthogonal',
      cornerRadius: o.corner ?? 10,
      endStart: o.start ?? 'none',
      endEnd: o.end ?? 'arrow',
      ...(o.endScale ? { endScale: o.endScale } : null),
      appearance: {
        stroke: { color: o.color ?? WIRE_INK, width: o.width ?? 2, cap: 'round', ...(o.dash ? { dash: [...o.dash] } : null) },
        ...(o.sketch ? { sketch: o.sketch } : null),
      },
      ...(o.label
        ? { labels: [{ id: nanoid(6), text: o.label, ...(o.at !== undefined ? { t: o.at } : null), ...(o.dn !== undefined ? { dn: o.dn } : null) }] }
        : null),
    };
    this.wires.push(node);
    return node;
  }

  /**
   * The board's title block: a white card with the name, what the board is
   * for, and a key for its wires and swatches on the right.
   */
  header(x: number, y: number, width: number, height: number, name: string, summary: string, legend: LegendItem[] = [], legendW = 500): void {
    this.surface(x, y, width, height, { radius: 16 });
    const hasKey = legend.length > 0;
    const textW = hasKey ? width - legendW - 112 : width - 80;
    this.rest.push(this.text(x + 40, y + 30, textW, name, { size: 38, weight: 700, color: INK_STRONG, lineHeight: 1.15, letterSpacing: -0.6 }));
    this.rest.push(this.text(x + 40, y + 84, Math.min(textW, 1080), summary, { size: 16, color: INK_SOFT, lineHeight: 1.5 }));
    if (!hasKey) return;

    const lx = x + width - legendW - 32;
    const colW = legendW / 2;
    const rows = Math.ceil(legend.length / 2);
    const rowH = 30;
    const top = y + Math.round((height - rows * rowH) / 2) + 4;
    legend.forEach((item, i) => {
      const cx = lx + (i % 2) * colW;
      const cy = top + Math.floor(i / 2) * rowH;
      if ('line' in item) {
        this.rest.push(lineSample(cx, cy + 4, 44, item.line, item.dash, item.curved ?? false, item.end ?? 'arrow', item.start ?? 'none'));
      } else {
        this.rest.push({
          id: nanoid(),
          type: 'shape',
          x: cx + 10,
          y: cy - 1,
          width: 24,
          height: 20,
          geometry: { kind: 'rect' },
          appearance: {
            fill: [{ type: 'solid', color: item.swatch }],
            stroke: { color: item.edge, width: 1.5, ...(item.dashed ? { dash: [4, 3] } : null) },
            cornerRadius: item.round ? 10 : 5,
          },
        });
      }
      this.rest.push(this.text(cx + 58, cy, colW - 66, item.label, { size: 13.5, weight: 500, color: INK, lineHeight: 1.4 }));
    });
  }
}

// ---------------------------------------------------------------------------
// Mind maps
// ---------------------------------------------------------------------------

export interface Topic {
  text: string;
  children?: Topic[];
}

export interface Branch {
  /** Leads the branch root, as an emoji. */
  icon: string;
  title: string;
  family: Family;
  topics: Topic[];
}

export interface MindMapStyle {
  /** Widths of the root, sub-topic and leaf columns. */
  rootW: number;
  subW: number;
  leafW: number;
  /** Horizontal gap between columns, and vertical gap between siblings. */
  colGap: number;
  rowGap: number;
  /** Extra outward offset of the middle branch root, for an arc. 0 is a straight column. */
  arc: number;
  sketch?: 'light' | 'medium' | 'heavy';
  leafSize: number;
}

const SUB_PX = 14;
const SUB_LH = 1.35;
const LEAF_LH = 1.4;
const NODE_PAD_Y = 12;
const NODE_PAD_X = 16;

/** How tall a sub-topic or leaf node is for its words. */
const topicHeight = (text: string, width: number, size: number, weight: number, lh: number) =>
  Math.max(40, Math.ceil(wrappedLines(text, width - NODE_PAD_X * 2, size, weight) * size * lh) + NODE_PAD_Y * 2);

/** Greedy breaks at `width`. */
function greedy(words: string[], width: number, size: number, weight: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, weight) * 1.06 > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  out.push(line);
  return out;
}

/**
 * Breaks a label into the lines its box will set, balanced so the last line is
 * never a single stranded word: the narrowest width that still takes the same
 * number of lines. Explicit breaks keep the renderer from re-wrapping the
 * label against the edge of its box.
 */
export function breakLines(text: string, width: number, size: number, weight: number): string {
  return text
    .split('\n')
    .map((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      const lines = greedy(words, width, size, weight).length;
      if (lines < 2) return words.join(' ');
      let lo = width * 0.4;
      let hi = width;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (greedy(words, mid, size, weight).length > lines) lo = mid;
        else hi = mid;
      }
      return greedy(words, hi, size, weight).join('\n');
    })
    .join('\n');
}

/**
 * A balanced mind map: the centre topic, branches alternating right and left,
 * each a tidy tree of sub-topics and leaves growing outward. Branch roots sit
 * on a gentle arc, so the map reads as radiating from the centre rather than
 * as two lists.
 *
 * Returns the vertical extent used, so the board can be sized around it.
 */
export function mindMap(
  d: Draft,
  cx: number,
  cy: number,
  centre: { text: string; width: number; height: number; fill: string },
  branches: Branch[],
  s: MindMapStyle
): { top: number; bottom: number; left: number; right: number } {
  const root = d.node(cx - centre.width / 2, cy - centre.height / 2, centre.width, centre.height, centre.text, {
    fill: centre.fill,
    stroke: centre.fill,
    radius: centre.height / 2,
    size: 22,
    weight: 700,
    color: PAPER,
    lineHeight: 1.25,
    shadow: true,
    sketch: s.sketch,
  });

  const subText = (t: string) => breakLines(t, s.subW - NODE_PAD_X * 2, SUB_PX, 600);
  const leafText = (t: string) => breakLines(t, s.leafW - NODE_PAD_X * 2, s.leafSize, 450);

  interface Sized { topic: Topic; label: string; h: number; leaves: Array<{ label: string; h: number }>; block: number }
  const size = (b: Branch) => {
    const subs: Sized[] = b.topics.map((t) => {
      const label = subText(t.text);
      const h = topicHeight(t.text, s.subW, SUB_PX, 600, SUB_LH);
      const leaves = (t.children ?? []).map((c) => ({ label: leafText(c.text), h: topicHeight(c.text, s.leafW, s.leafSize, 450, LEAF_LH) }));
      const leavesH = leaves.reduce((a, l) => a + l.h, 0) + Math.max(0, leaves.length - 1) * (s.rowGap * 0.5);
      return { topic: t, label, h, leaves, block: Math.max(h, leavesH) };
    });
    const block = subs.reduce((a, x) => a + x.block, 0) + Math.max(0, subs.length - 1) * s.rowGap;
    return { subs, block };
  };

  const sides: Array<{ branch: Branch; dir: 1 | -1 }> = branches.map((branch, i) => ({ branch, dir: i % 2 === 0 ? 1 : -1 }));
  const extent = { top: cy - centre.height / 2, bottom: cy + centre.height / 2, left: cx - centre.width / 2, right: cx + centre.width / 2 };
  const BRANCH_GAP = s.rowGap * 2.5;

  for (const dir of [1, -1] as const) {
    const group = sides.filter((x) => x.dir === dir).map((x) => ({ ...x, ...size(x.branch) }));
    const total = group.reduce((a, g) => a + g.block, 0) + Math.max(0, group.length - 1) * BRANCH_GAP;
    let y = cy - total / 2;
    const mid = (group.length - 1) / 2;
    group.forEach((g, gi) => {
      const f = FAMILY[g.branch.family];
      // Branch roots on an arc: the middle one reaches furthest out.
      const lift = mid === 0 ? 1 : 1 - Math.abs(gi - mid) / mid;
      const rootGap = s.colGap * 2 + s.arc * lift;
      const rootX = dir === 1 ? cx + centre.width / 2 + rootGap : cx - centre.width / 2 - rootGap - s.rootW;
      const rootH = 52;
      const rootY = y + g.block / 2 - rootH / 2;
      const branchRoot = d.node(rootX, rootY, s.rootW, rootH, `${g.branch.icon}  ${g.branch.title}`, {
        family: g.branch.family,
        strokeWidth: 2,
        radius: rootH / 2,
        size: 16,
        weight: 700,
        sketch: s.sketch,
      });
      d.wire(root, branchRoot, {
        routing: 'curved',
        from: dir === 1 ? 'right' : 'left',
        to: dir === 1 ? 'left' : 'right',
        color: f.wire,
        width: 4,
        end: 'none',
        avoid: false,
        sketch: s.sketch,
      });

      const subX = dir === 1 ? rootX + s.rootW + s.colGap : rootX - s.colGap - s.subW;
      const leafX = dir === 1 ? subX + s.subW + s.colGap * 0.8 : subX - s.colGap * 0.8 - s.leafW;
      let sy = y;
      for (const sub of g.subs) {
        const subY = sy + sub.block / 2 - sub.h / 2;
        const subNode = d.node(subX, subY, s.subW, sub.h, sub.label, {
          fill: PAPER,
          stroke: f.hue,
          strokeWidth: 1.5,
          radius: 10,
          size: SUB_PX,
          weight: 600,
          lineHeight: SUB_LH,
          sketch: s.sketch,
        });
        d.wire(branchRoot, subNode, {
          routing: 'curved',
          from: dir === 1 ? 'right' : 'left',
          to: dir === 1 ? 'left' : 'right',
          color: f.wire,
          width: 2.5,
          end: 'none',
          avoid: false,
          sketch: s.sketch,
        });
        const leavesH = sub.leaves.reduce((a, l) => a + l.h, 0) + Math.max(0, sub.leaves.length - 1) * (s.rowGap * 0.5);
        let ly = sy + sub.block / 2 - leavesH / 2;
        for (const leaf of sub.leaves) {
          const leafNode = d.node(leafX, ly, s.leafW, leaf.h, leaf.label, {
            fill: f.tint,
            stroke: f.tint,
            strokeWidth: 1,
            radius: 8,
            size: s.leafSize,
            weight: 450,
            color: INK,
            lineHeight: LEAF_LH,
            sketch: s.sketch,
          });
          d.wire(subNode, leafNode, {
            routing: 'curved',
            from: dir === 1 ? 'right' : 'left',
            to: dir === 1 ? 'left' : 'right',
            color: f.wire,
            width: 1.5,
            end: 'none',
            avoid: false,
            sketch: s.sketch,
          });
          extent.left = Math.min(extent.left, leafX);
          extent.right = Math.max(extent.right, leafX + s.leafW);
          ly += leaf.h + s.rowGap * 0.5;
        }
        extent.left = Math.min(extent.left, subX);
        extent.right = Math.max(extent.right, subX + s.subW);
        sy += sub.block + s.rowGap;
      }
      extent.top = Math.min(extent.top, y);
      extent.bottom = Math.max(extent.bottom, y + g.block);
      y += g.block + BRANCH_GAP;
    });
  }
  return extent;
}

/** The vertical extent a mind map will take, for laying the board out before drawing it. */
export function mindMapHeight(branches: Branch[], s: MindMapStyle): number {
  const blockOf = (b: Branch) =>
    b.topics.reduce((a, t) => {
      const h = topicHeight(t.text, s.subW, SUB_PX, 600, SUB_LH);
      const leaves = (t.children ?? []).map((c) => topicHeight(c.text, s.leafW, s.leafSize, 450, LEAF_LH));
      const leavesH = leaves.reduce((x, y) => x + y, 0) + Math.max(0, leaves.length - 1) * (s.rowGap * 0.5);
      return a + Math.max(h, leavesH);
    }, 0) + Math.max(0, b.topics.length - 1) * s.rowGap;
  let tallest = 0;
  for (const parity of [0, 1]) {
    const group = branches.filter((_, i) => i % 2 === parity);
    const total = group.reduce((a, b) => a + blockOf(b), 0) + Math.max(0, group.length - 1) * s.rowGap * 2.5;
    tallest = Math.max(tallest, total);
  }
  return tallest;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/**
 * A filled rounded rectangle as a closed pen path. Each anchor carries the
 * curve arriving at it; 0.5523 is the handle length that makes a quarter circle.
 */
function roundedPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  opacity: number,
  stroke?: { color: string; width: number; dash?: number[] }
): NewNodeInput {
  const k = r * (1 - 0.5523);
  return {
    id: nanoid(),
    type: 'path',
    x,
    y,
    width: w,
    height: h,
    geometry: {
      kind: 'bezier',
      closed: true,
      segments: [
        { x: r, y: 0, cp1x: 0, cp1y: k, cp2x: k, cp2y: 0 },
        { x: w - r, y: 0 },
        { x: w, y: r, cp1x: w - k, cp1y: 0, cp2x: w, cp2y: k },
        { x: w, y: h - r },
        { x: w - r, y: h, cp1x: w, cp1y: h - k, cp2x: w - k, cp2y: h },
        { x: r, y: h },
        { x: 0, y: h - r, cp1x: k, cp1y: h, cp2x: 0, cp2y: h - k },
        { x: 0, y: r },
      ],
    },
    appearance: {
      fill: [{ type: 'solid', color, opacity }],
      ...(stroke ? { stroke: { ...stroke, cap: 'butt' } } : { stroke: { color, width: 0 } }),
    },
  };
}

/** A short run of line for a key, with the ends the wire it stands for draws. */
function lineSample(x: number, y: number, width: number, color: string, dash: number[] | undefined, curved: boolean, end: EndCapKind, start: EndCapKind): NewNodeInput {
  const H = 14;
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height: H,
    geometry: curved
      ? { kind: 'line', vertices: [{ x: 0, y: H - 2 }, { x: width / 2, y: 2 }, { x: width, y: H - 2 }], smooth: true, endEnd: end, endStart: start }
      : { kind: 'line', a: { x: 0, y: H / 2 }, b: { x: width, y: H / 2 }, endEnd: end, endStart: start },
    appearance: { stroke: { color, width: 2, cap: 'round', ...(dash ? { dash } : null) } },
  };
}

/** A vertical line in a box two units wide: a lifeline, a divider. */
export function vline(x: number, y: number, height: number, color: string, dash?: number[], width = 1.5): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x: x - 1,
    y,
    width: 2,
    height,
    geometry: { kind: 'line', a: { x: 1, y: 0 }, b: { x: 1, y: height }, endEnd: 'none', endStart: 'none' },
    appearance: { stroke: { color, width, cap: 'round', ...(dash ? { dash } : null) } },
  };
}

