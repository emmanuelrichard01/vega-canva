import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { StickyTheme } from '../../model/schema';
import type { ChartSpec } from '../../chart/chartTypes';
import { defaultCodeSpec, type CodeSpec } from '../../code/codeTypes';
import { codeMetrics } from '../../code/codeLayout';
import type { TableSpec } from '../../table/tableTypes';
import { chart as kitChart, code as kitCode, textWidth, wrappedLines as kitWrappedLines, INK, INK_SOFT, INK_STRONG, PAPER, table as kitTable } from '../templateKit';

/**
 * The vocabulary of the systems boards: architecture drawn the way the
 * engineers who run it would draw it, legible on a light board and a dark one.
 *
 * ## Why these boards look the way they do
 *
 * A board's ground follows the viewer's theme, and most of what sits on it does
 * not: a shape's fill and a text node's ink are fixed content colours. So every
 * word on these boards lives on a surface it carries with it (a white card, the
 * header card, a sticky, a table, a code block) and the things that sit
 * directly on the board are the ones that adapt by themselves: connector
 * labels, charts, frame headers, and zone washes, which are a hue at a few
 * per cent opacity and so tint whichever ground is under them.
 *
 * The one exception is a zone's heading. It is large text, where WCAG asks for
 * 3:1, and each heading colour is a 600–700 hue that clears 4.5:1 on the light
 * board and 3:1 on the dark one (`systems.test.ts` checks both).
 *
 * Zones are washes, not frames: a frame owns what its centre covers, and a
 * connector between two frames belongs to neither. Frames are kept for the
 * self-contained panels (a table and the chart that reads it, a workflow file,
 * the design notes) that no connector enters, and for the board itself.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** One family per zone: the wash, its edge, and the heading ink. */
export const FAMILY = {
  blue: { hue: '#3B82F6', ink: '#2563EB', tint: '#DBEAFE' },
  violet: { hue: '#8B5CF6', ink: '#7C3AED', tint: '#EDE9FE' },
  teal: { hue: '#14B8A6', ink: '#0F766E', tint: '#CCFBF1' },
  amber: { hue: '#F59E0B', ink: '#B45309', tint: '#FEF3C7' },
  rose: { hue: '#F43F5E', ink: '#BE123C', tint: '#FFE4E6' },
  green: { hue: '#22C55E', ink: '#15803D', tint: '#DCFCE7' },
  slate: { hue: '#64748B', ink: '#64748B', tint: '#F1F5F9' },
  sky: { hue: '#0EA5E9', ink: '#0369A1', tint: '#E0F2FE' },
  orange: { hue: '#F97316', ink: '#C2410C', tint: '#FFEDD5' },
  indigo: { hue: '#6366F1', ink: '#4F46E5', tint: '#E0E7FF' },
} as const;

export type Family = keyof typeof FAMILY;

/** What a connector means, by its colour and its line. The legend reads the same table. */
export const WIRE = {
  /** A request somebody waits on. */
  call: { color: '#475569', dash: undefined, routing: 'orthogonal', label: 'Request' },
  /** Bytes moving: media, rows, files. */
  data: { color: '#0D9488', dash: undefined, routing: 'orthogonal', label: 'Data' },
  /** Fire and forget: a message, an event, a webhook. */
  event: { color: '#6366F1', dash: [7, 6], routing: 'curved', label: 'Async event' },
  /** A loop back to an earlier stage. */
  loop: { color: '#D97706', dash: undefined, routing: 'curved', label: 'Feedback loop' },
  /** What happens when it goes wrong. */
  fail: { color: '#DC2626', dash: [6, 5], routing: 'orthogonal', label: 'Failure path' },
  /** Control: config, deploys, reconciliation. */
  control: { color: '#7C3AED', dash: [2, 5], routing: 'orthogonal', label: 'Control' },
} as const;

export type WireKind = keyof typeof WIRE;

// ---------------------------------------------------------------------------
// Measure
// ---------------------------------------------------------------------------

/**
 * How many lines `text` wraps to at `width`.
 *
 * The gallery's own Inter estimate, which its tests hold every board to, with
 * six per cent to spare for the renderer's rounding: a box sized from this is
 * never the one that comes up a line short.
 */
export const wrappedLines = (text: string, width: number, size: number, weight = 450): number =>
  kitWrappedLines(text, width, (run) => textWidth(run, size, weight) * 1.06);

/** The height a wrapped text block takes. */
export const textHeight = (text: string, width: number, size: number, lineHeight: number, weight = 450): number =>
  Math.ceil(wrappedLines(text, width, size, weight) * size * lineHeight) + 2;

// ---------------------------------------------------------------------------
// The draft: nodes in the order they are written, layered on the way out
// ---------------------------------------------------------------------------

export interface IconRef {
  pack: 'aws' | 'gcp' | 'k8s';
  id: string;
}

export const aws = (id: string): IconRef => ({ pack: 'aws', id });
export const gcp = (id: string): IconRef => ({ pack: 'gcp', id });
export const k8s = (id: string): IconRef => ({ pack: 'k8s', id });

export interface CardSpec {
  title: string;
  sub?: string;
  /** A cloud-pack icon, drawn at the card's left. */
  icon?: IconRef;
  /** Or a library shape drawn as the icon, in the card's family. */
  glyph?: string;
  /** The family the glyph and the card's edge take. Absent is a plain white card. */
  family?: Family;
  /** A dashed edge: a thing that is optional, external, or not yet true. */
  dashed?: boolean;
}

export interface WireOptions {
  label?: string;
  from?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  to?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  routing?: 'orthogonal' | 'curved' | 'straight';
  /** Where a single label sits along the run, 0 to 1. Absent lets the board place it. */
  at?: number;
}

const CARD_RADIUS = 10;
const TITLE_PX = 15;
const SUB_PX = 12.5;

/**
 * Collects a board's nodes and hands them back in drawing order.
 *
 * Frames first (the board before the panels in it), then zone washes, then
 * connectors, then everything else — so an arrow never crosses a label, and a
 * wash never covers the arrow running over it. Order inside each layer is the
 * order written.
 */
export class Draft {
  private frames: NewNodeInput[] = [];
  private grounds: NewNodeInput[] = [];
  private wires: NewNodeInput[] = [];
  private rest: NewNodeInput[] = [];

  /** Every node, layered. */
  nodes(): NewNodeInput[] {
    return [...this.frames, ...this.grounds, ...this.wires, ...this.rest];
  }

  /** Anything already built elsewhere, in the top layer. */
  add(...nodes: NewNodeInput[]): void {
    this.rest.push(...nodes);
  }

  /**
   * The board itself: a frame with no fill, so the board's ground (and its
   * theme) shows through, carrying the name, emoji and one line the frame
   * header draws above it.
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
      // A fill at zero opacity rather than none: the document reads an empty
      // fill list as "default white", and the board must stay the viewer's.
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
   * A panel inside the board: a frame, because what is in it belongs together
   * and moves together, and because nothing crosses into it.
   */
  panel(x: number, y: number, width: number, height: number, name: string, icon: string, description: string): NewNodeInput {
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'frame',
      x,
      y,
      width,
      height,
      title: name,
      icon,
      description,
      appearance: {
        fill: [{ type: 'solid', color: '#64748B', opacity: 0.04 }],
        stroke: { color: 'rgba(100,116,139,0.35)', width: 1 },
        cornerRadius: 16,
      },
    };
    this.frames.push(node);
    return node;
  }

  /**
   * A region behind a group: a few per cent of a hue, a dashed edge, and a
   * heading.
   *
   * Drawn as a path rather than a shape, because a shape is something a
   * connector routes around, and a wire from one zone to the next must be free
   * to cross a third on its way, as it would on a whiteboard.
   */
  zone(x: number, y: number, width: number, height: number, name: string, family: Family): void {
    const f = FAMILY[family];
    this.grounds.push(wash(x, y, width, height, 16, f.hue, 0.06, { color: f.hue, width: 1.5, dash: [8, 6] }));
    this.rest.push(this.text(x + 24, y + 18, width - 48, name, { size: 22, weight: 650, color: f.ink, lineHeight: 1.3 }));
  }

  /** A plain wash behind a row: a lane, a band. Carries no words, so it sits under the wires. */
  band(x: number, y: number, width: number, height: number, family: Family, opacity = 0.06): NewNodeInput {
    const node = wash(x, y, width, height, 8, FAMILY[family].hue, opacity);
    this.grounds.push(node);
    return node;
  }

  /**
   * A text block, sized to what it holds. Wraps at its width and grows down,
   * so an edit keeps its column.
   */
  text(
    x: number,
    y: number,
    width: number,
    body: string,
    o: { size?: number; weight?: number; color?: string; lineHeight?: number; align?: 'left' | 'center' | 'right'; letterSpacing?: number } = {}
  ): NewNodeInput {
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

  /** A white surface with a hairline: the ground every word on the board sits on. */
  surface(x: number, y: number, width: number, height: number, o: { family?: Family; dashed?: boolean; radius?: number } = {}): NewNodeInput {
    const edge = o.family ? FAMILY[o.family].hue : '#CBD5E1';
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: 'rect' },
      appearance: {
        fill: [{ type: 'solid', color: PAPER }],
        stroke: { color: edge, width: o.family ? 1.25 : 1, ...(o.dashed ? { dash: [6, 4] } : null) },
        cornerRadius: o.radius ?? CARD_RADIUS,
      },
    };
    this.rest.push(node);
    return node;
  }

  /**
   * A service: a card with its icon, its name and one line about what it does.
   * Returns the card itself, which is what connectors attach to.
   */
  card(x: number, y: number, width: number, height: number, spec: CardSpec): NewNodeInput {
    const ground = this.surface(x, y, width, height, { family: spec.family, dashed: spec.dashed });
    const hasArt = Boolean(spec.icon || spec.glyph);
    const ART = 36;
    const textX = hasArt ? x + 16 + ART + 14 : x + 18;
    const textW = x + width - 16 - textX;
    if (spec.icon) {
      this.rest.push({
        id: nanoid(),
        type: 'icon',
        x: x + 16,
        y: y + (height - ART) / 2,
        width: ART,
        height: ART,
        pack: spec.icon.pack,
        iconId: spec.icon.id,
      });
    } else if (spec.glyph) {
      const f = FAMILY[spec.family ?? 'slate'];
      // A phone is drawn upright and a screen wide, at the aspect the object has.
      const gw = spec.glyph === 'mobile' ? 26 : ART;
      const gh = spec.glyph === 'browser' || spec.glyph === 'desktop' || spec.glyph === 'display' ? 30 : ART;
      this.rest.push({
        id: nanoid(),
        type: 'shape',
        x: x + 16 + (ART - gw) / 2,
        y: y + (height - gh) / 2,
        width: gw,
        height: gh,
        geometry: { kind: spec.glyph },
        appearance: {
          fill: [{ type: 'solid', color: f.tint }],
          stroke: { color: f.ink, width: 1.5 },
          cornerRadius: 6,
        },
      });
    }
    const titleH = textHeight(spec.title, textW, TITLE_PX, 1.3, 600);
    const subH = spec.sub ? textHeight(spec.sub, textW, SUB_PX, 1.4) : 0;
    const block = titleH + (spec.sub ? 2 + subH : 0);
    const top = y + Math.max(10, (height - block) / 2);
    this.rest.push(this.text(textX, top, textW, spec.title, { size: TITLE_PX, weight: 600, color: INK_STRONG, lineHeight: 1.3 }));
    if (spec.sub) this.rest.push(this.text(textX, top + titleH + 2, textW, spec.sub, { size: SUB_PX, color: INK_SOFT, lineHeight: 1.4 }));
    return ground;
  }

  /** A small labelled pill in a family's tint: a matrix leg, a status, a tag. */
  chip(x: number, y: number, width: number, height: number, label: string, family: Family): NewNodeInput {
    const f = FAMILY[family];
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: 'rect' },
      text: label,
      appearance: {
        fill: [{ type: 'solid', color: f.tint }],
        stroke: { color: f.hue, width: 1 },
        cornerRadius: height / 2,
      },
      typography: { fontSize: 12.5, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
    };
    this.rest.push(node);
    return node;
  }

  /** A decision: the diamond every flowchart reader expects, with its question inside. */
  decision(x: number, y: number, width: number, height: number, question: string, family: Family = 'amber'): NewNodeInput {
    const f = FAMILY[family];
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: 'diamond' },
      text: question,
      appearance: {
        fill: [{ type: 'solid', color: f.tint }],
        stroke: { color: f.hue, width: 1.5 },
      },
      typography: { fontSize: 14, fontWeight: 650, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
    };
    this.rest.push(node);
    return node;
  }

  /** A numbered disc on a card's corner: the order a single request takes. */
  step(on: NewNodeInput, n: number | string): NewNodeInput {
    const D = 28;
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'shape',
      x: on.x - D / 2 + 2,
      y: on.y - D / 2 + 2,
      width: D,
      height: D,
      geometry: { kind: 'ellipse' },
      text: String(n),
      appearance: {
        fill: [{ type: 'solid', color: INK_STRONG }],
        stroke: { color: PAPER, width: 2 },
      },
      typography: { fontSize: 13, fontWeight: 700, color: PAPER, align: 'center', verticalAlign: 'middle' },
    };
    this.rest.push(node);
    return node;
  }

  /** A connector between two cards, meaning what its kind says. */
  wire(from: NewNodeInput, to: NewNodeInput, kind: WireKind = 'call', o: WireOptions = {}): NewNodeInput {
    const w = WIRE[kind];
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'connector',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      from: { nodeId: from.id as string, port: o.from ?? 'auto' },
      to: { nodeId: to.id as string, port: o.to ?? 'auto' },
      routing: o.routing ?? w.routing,
      avoid: true,
      cornerRadius: 12,
      endEnd: 'arrow',
      appearance: {
        stroke: { color: w.color, width: 2, cap: 'round', ...(w.dash ? { dash: [...w.dash] } : null) },
      },
      ...(o.label ? { labels: [{ id: nanoid(6), text: o.label, ...(o.at !== undefined ? { t: o.at } : null) }] } : null),
    };
    this.wires.push(node);
    return node;
  }

  /**
   * The board's title block: a card carrying the name, what the board shows,
   * and the legend for the wires on it.
   */
  header(x: number, y: number, width: number, height: number, name: string, summary: string, legend: WireKind[], stepsNote?: string): void {
    this.surface(x, y, width, height, { radius: 14 });
    const LEGEND_W = 520;
    const textW = width - LEGEND_W - 96;
    this.rest.push(this.text(x + 40, y + 32, textW, name, { size: 40, weight: 700, color: INK_STRONG, lineHeight: 1.15, letterSpacing: -0.6 }));
    this.rest.push(this.text(x + 40, y + 88, Math.min(textW, 1120), summary, { size: 17, color: INK_SOFT, lineHeight: 1.5 }));

    // The legend: one sample of each wire, as it is drawn on the board.
    const lx = x + width - LEGEND_W - 32;
    const colW = LEGEND_W / 2;
    const rows = Math.ceil(legend.length / 2);
    const rowH = 30;
    const top = y + (height - (rows * rowH + (stepsNote ? rowH : 0))) / 2;
    legend.forEach((kind, i) => {
      const w = WIRE[kind];
      const cx = lx + (i % 2) * colW;
      const cy = top + Math.floor(i / 2) * rowH;
      this.rest.push(lineSample(cx, cy + 6, 44, w.color, w.dash ? [...w.dash] : undefined, w.routing === 'curved'));
      this.rest.push(this.text(cx + 58, cy, colW - 66, w.label, { size: 14, weight: 500, color: INK, lineHeight: 1.4 }));
    });
    if (stepsNote) {
      const cy = top + rows * rowH;
      const disc: NewNodeInput = {
        id: nanoid(),
        type: 'shape',
        x: lx + 12,
        y: cy - 1,
        width: 22,
        height: 22,
        geometry: { kind: 'ellipse' },
        text: '1',
        appearance: { fill: [{ type: 'solid', color: INK_STRONG }] },
        typography: { fontSize: 11, fontWeight: 700, color: PAPER, align: 'center', verticalAlign: 'middle' },
      };
      this.rest.push(disc, this.text(lx + 58, cy, LEGEND_W - 66, stepsNote, { size: 14, weight: 500, color: INK, lineHeight: 1.4 }));
    }
  }

  /** A note card: a heading and a paragraph on white, with an edge in its family. */
  callout(x: number, y: number, width: number, title: string, body: string, family: Family = 'slate'): NewNodeInput {
    const innerW = width - 40;
    const titleH = textHeight(title, innerW, 15, 1.3, 650);
    const bodyH = textHeight(body, innerW, 13.5, 1.5);
    const height = 20 + titleH + 6 + bodyH + 20;
    const ground = this.surface(x, y, width, height, { family });
    this.rest.push(
      this.text(x + 20, y + 20, innerW, title, { size: 15, weight: 650, color: INK_STRONG, lineHeight: 1.3 }),
      this.text(x + 20, y + 20 + titleH + 6, innerW, body, { size: 13.5, color: INK_SOFT, lineHeight: 1.5 })
    );
    return ground;
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

  table(x: number, y: number, width: number, spec: TableSpec, rowH = 34): NewNodeInput {
    const node = kitTable(x, y, spec, width, spec.cells.length * rowH + (spec.summary?.some(Boolean) ? rowH : 0));
    this.rest.push(node);
    return node;
  }

  chart(x: number, y: number, width: number, height: number, spec: ChartSpec): NewNodeInput {
    const node = kitChart(x, y, spec, width, height);
    this.rest.push(node);
    return node;
  }

  /** Source on the board, in the dark theme that reads as code on either ground. */
  code(x: number, y: number, width: number, source: string, language: string, over: Partial<CodeSpec> = {}): NewNodeInput {
    const fontSize = over.fontSize ?? 12;
    const node = kitCode(x, y, source, language, width, codeHeight(source, fontSize), { theme: 'midnight', fontSize, wrap: false, ...over });
    this.rest.push(node);
    return node;
  }
}

/**
 * A filled rounded rectangle as a closed pen path.
 *
 * Each anchor carries the curve arriving at it, so the four corners are the
 * segments whose controls are set and the sides are the ones whose are not.
 * 0.5523 is the handle length that makes a cubic a quarter circle.
 */
function wash(x: number, y: number, w: number, h: number, r: number, color: string, opacity: number, stroke?: { color: string; width: number; dash?: number[] }): NewNodeInput {
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

/** The height a code block needs to show every line of `source` without scrolling. */
export function codeHeight(source: string, fontSize: number): number {
  const lines = source.split('\n').length;
  const m = codeMetrics({ ...defaultCodeSpec(source, 'plaintext'), fontSize }, lines);
  return m.headerHeight + m.padY * 2 + lines * m.lineHeight + 4;
}

/** A short run of line, for the legend. Curved kinds get a gentle arc. */
function lineSample(x: number, y: number, width: number, color: string, dash: number[] | undefined, curved: boolean): NewNodeInput {
  const H = 12;
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height: H,
    geometry: curved
      ? { kind: 'line', vertices: [{ x: 0, y: H - 1 }, { x: width / 2, y: 1 }, { x: width, y: H - 1 }], smooth: true, endEnd: 'arrow' }
      : { kind: 'line', a: { x: 0, y: H / 2 }, b: { x: width, y: H / 2 }, endEnd: 'arrow' },
    appearance: { stroke: { color, width: 2, cap: 'round', ...(dash ? { dash } : null) } },
  };
}

