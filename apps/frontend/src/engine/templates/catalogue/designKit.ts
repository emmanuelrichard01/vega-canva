import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { StickyTheme } from '../../model/schema';
import { SHADOW_PRESETS } from '../../model/dropShadow';
import { TEXT_STYLES } from '../../tools/TextToolStyles';
import { contrast, luminance, textWidth, wrappedLines } from '../templateKit';

/**
 * The vocabulary of the web, UI and social boards.
 *
 * ## Every word sits on a surface it carries
 *
 * A board's ground follows the viewer's theme; a text node's ink does not. So
 * every board here is a set of artboards (frames with a literal fill), and the
 * words on them are written either as text, where the ground under them is
 * light, or as a *plate* where it is dark: a shape filled with the ground's own
 * colour and carrying the words as its label. A plate looks exactly like text
 * on that ground, and because the ground travels with it, the words read the
 * same on a light board, a dark board and an export.
 *
 * ## Boxes are measured before they are placed
 *
 * Each text box is sized from the gallery's Inter estimate (which the catalogue
 * tests hold every board to) with six per cent to spare, scaled up for faces
 * that set wider than Inter. A box sized here is never the one that wraps a
 * line further than the layout planned for.
 */

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export interface TextStyle {
  size: number;
  weight?: number;
  /** Line height as a multiple of the size. */
  lh?: number;
  /** Tracking in px. */
  ls?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  family?: string;
  italic?: boolean;
}

/**
 * A web type scale, anchored on the text tool's own presets: the display,
 * heading and subheading steps are `TEXT_STYLES` exactly, so a designer who
 * re-applies a preset from the dock gets the size the board already uses.
 */
export const TYPE = {
  display: { size: TEXT_STYLES.title.fontSize, weight: TEXT_STYLES.title.fontWeight, lh: TEXT_STYLES.title.lineHeight, ls: TEXT_STYLES.title.letterSpacing },
  h2: { size: TEXT_STYLES.heading.fontSize, weight: TEXT_STYLES.heading.fontWeight, lh: TEXT_STYLES.heading.lineHeight, ls: TEXT_STYLES.heading.letterSpacing },
  h3: { size: TEXT_STYLES.subheading.fontSize, weight: TEXT_STYLES.subheading.fontWeight, lh: TEXT_STYLES.subheading.lineHeight, ls: TEXT_STYLES.subheading.letterSpacing },
  title: { size: 20, weight: 600, lh: 1.4, ls: -0.1 },
  bodyL: { size: 18, weight: 400, lh: 1.6 },
  body: { size: 16, weight: 400, lh: 1.6 },
  small: { size: 14, weight: 500, lh: 1.45 },
  micro: { size: 12, weight: 500, lh: 1.4 },
} as const satisfies Record<string, TextStyle>;

/** How much wider than Inter a face sets, for sizing boxes. Never below one. */
const WIDTH_FACTOR: Record<string, number> = {
  'Architects Daughter': 1.22,
  'Space Grotesk': 1.04,
  'Source Serif 4': 1.02,
  'Playfair Display': 1.06,
  'DM Serif Display': 1.04,
  Georgia: 1.08,
  'JetBrains Mono': 1.12,
};

/** The width one line of `text` takes in `style`, with room for the estimate's error. */
export function measure(text: string, style: TextStyle): number {
  const factor = Math.max(1, WIDTH_FACTOR[style.family ?? 'Inter'] ?? 1);
  const tracking = (style.ls ?? 0) * [...text].length;
  return (textWidth(text, style.size, style.weight ?? 400) * factor + Math.max(0, tracking)) * 1.06;
}

/** Lines `text` wraps to at `width`. */
export const linesOf = (text: string, width: number, style: TextStyle): number =>
  wrappedLines(text, width, (run) => measure(run, style));

/** The height a wrapped block of `text` needs at `width`. */
export const heightOf = (text: string, width: number, style: TextStyle): number =>
  Math.ceil(linesOf(text, width, style) * style.size * (style.lh ?? 1.4)) + 2;

/** The widest line of `text`, unwrapped. */
export const widthOf = (text: string, style: TextStyle): number =>
  Math.ceil(Math.max(...text.split('\n').map((line) => measure(line, style)))) + 4;

const typography = (style: TextStyle, color: string) => ({
  fontSize: style.size,
  fontWeight: style.weight ?? 400,
  lineHeight: style.lh ?? 1.4,
  color,
  align: style.align ?? 'left',
  ...(style.ls !== undefined ? { letterSpacing: style.ls } : null),
  ...(style.family ? { fontFamily: style.family } : null),
  ...(style.italic ? { italic: true } : null),
});

/** Grounds this dark carry light words, which a plate keeps legible on either theme. */
const isDark = (ground: string) => (luminance(ground) ?? 1) < 0.35;

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

export type Elevation = (typeof SHADOW_PRESETS)[number]['id'];

/** One of the effects panel's drop-shadow presets, as the panel would apply it. */
export const shadowOf = (id: Elevation) => ({ ...SHADOW_PRESETS.find((p) => p.id === id)!.shadow });

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface FrameOptions {
  title: string;
  icon?: string;
  description?: string;
  /** A literal fill. Absent is white. */
  fill?: string;
  stroke?: string;
  radius?: number;
  /** The frame preset this artboard was sized from. */
  preset?: string;
  safeArea?: { top: number; right: number; bottom: number; left: number };
  columns?: { count: number; gutter: number; margin: number };
  clip?: boolean;
}

export interface RectOptions {
  fill?: string;
  /** Zero opacity fill: an outline only. */
  hollow?: boolean;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  radius?: number | [number, number, number, number];
  shadow?: Elevation;
  opacity?: number;
  sketch?: 'light' | 'medium' | 'heavy';
  kind?: string;
  /** Geometry extras: polygon points, star ratio and so on. */
  geometry?: Record<string, unknown>;
}

export interface ButtonOptions {
  fill: string;
  ink: string;
  stroke?: string;
  radius?: number;
  size?: number;
  weight?: number;
  shadow?: Elevation;
  opacity?: number;
  family?: string;
  sketch?: 'light' | 'medium' | 'heavy';
  strokeWidth?: number;
}

export interface WireOptions {
  label?: string;
  from?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  to?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  routing?: 'orthogonal' | 'curved' | 'straight';
  color?: string;
  dash?: number[];
  width?: number;
  at?: number;
}

/**
 * Collects a board's nodes and hands them back in drawing order: frames (the
 * outer before the nested), then the wires between them, then everything else
 * in the order written. Wires only ever join frames or the shapes on a frame's
 * own ground, so nothing that carries words is ever drawn beneath one.
 */
export class Board {
  private frames: NewNodeInput[] = [];
  private wires: NewNodeInput[] = [];
  private rest: NewNodeInput[] = [];

  /**
   * Every node, layered. Given a `limit` (a cover asking for a silhouette),
   * the largest objects up to that count, still in drawing order: the cover
   * draws the largest objects first anyway, so it loses nothing it would show.
   */
  nodes(limit?: number): NewNodeInput[] {
    const all = [...this.frames, ...this.wires, ...this.rest];
    if (limit === undefined || all.length <= limit) return all;
    const keep = new Set(
      all
        .filter((n) => n.type !== 'connector')
        .sort((a, b) => (b.type === 'frame' ? 1 : 0) - (a.type === 'frame' ? 1 : 0) || b.width * b.height - a.width * a.height)
        .slice(0, limit)
    );
    return all.filter((n) => keep.has(n));
  }

  add<T extends NewNodeInput>(node: T): T {
    this.rest.push(node);
    return node;
  }

  /** An artboard. Frames are pushed in the order written, so write the outer one first. */
  frame(x: number, y: number, width: number, height: number, o: FrameOptions): NewNodeInput {
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'frame',
      x,
      y,
      width,
      height,
      title: o.title,
      ...(o.icon ? { icon: o.icon } : null),
      ...(o.description ? { description: o.description } : null),
      appearance: {
        fill: [{ type: 'solid', color: o.fill ?? '#FFFFFF' }],
        ...(o.stroke ? { stroke: { color: o.stroke, width: 1 } } : null),
        ...(o.radius ? { cornerRadius: o.radius } : null),
      },
      ...(o.preset ? { preset: o.preset } : null),
      ...(o.safeArea ? { safeArea: o.safeArea } : null),
      ...(o.columns ? { layoutGuide: { columns: o.columns } } : null),
      ...(o.clip === false ? { clipContent: false } : null),
    };
    this.frames.push(node);
    return node;
  }

  /** A plain shape: a card, a fill, a placeholder. Carries no words. */
  rect(x: number, y: number, width: number, height: number, o: RectOptions = {}): NewNodeInput {
    const fill = o.fill ?? '#FFFFFF';
    return this.add({
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: o.kind ?? 'rect', ...o.geometry },
      ...(o.opacity !== undefined ? { opacity: o.opacity } : null),
      appearance: {
        fill: [{ type: 'solid', color: fill, ...(o.hollow ? { opacity: 0 } : null) }],
        stroke: o.stroke ? { color: o.stroke, width: o.strokeWidth ?? 1, ...(o.dash ? { dash: o.dash } : null) } : { color: fill, width: 0 },
        ...(o.radius !== undefined ? { cornerRadius: o.radius } : null),
        ...(o.shadow ? { shadow: shadowOf(o.shadow) } : null),
        ...(o.sketch ? { sketch: o.sketch } : null),
      },
    });
  }

  /** A hairline rule, as a one-unit rectangle so it stays crisp at every zoom. */
  rule(x: number, y: number, length: number, color: string, vertical = false, weight = 1): NewNodeInput {
    return this.rect(x, y, vertical ? weight : length, vertical ? length : weight, { fill: color });
  }

  /** A straight or bent run of line through `points`, in board units. */
  line(points: Array<[number, number]>, color: string, o: { width?: number; dash?: number[]; sketch?: 'light' | 'medium' | 'heavy'; arrow?: boolean } = {}): NewNodeInput {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const local = points.map(([px, py]) => ({ x: px - left, y: py - top }));
    return this.add({
      id: nanoid(),
      type: 'shape',
      x: left,
      y: top,
      width: Math.max(1, Math.max(...xs) - left),
      height: Math.max(1, Math.max(...ys) - top),
      geometry:
        local.length === 2
          ? { kind: 'line', a: local[0], b: local[1], ...(o.arrow ? { endEnd: 'arrow' } : null) }
          : { kind: 'line', vertices: local, ...(o.arrow ? { endEnd: 'arrow' } : null) },
      appearance: {
        stroke: { color, width: o.width ?? 2, cap: 'round', join: 'round', ...(o.dash ? { dash: o.dash } : null) },
        ...(o.sketch ? { sketch: o.sketch } : null),
      },
    });
  }

  /** A tick, drawn as a bent line: the check in a pricing list or a checkbox. */
  check(x: number, y: number, size: number, color: string, width = 2): NewNodeInput {
    return this.line([[x, y + size * 0.55], [x + size * 0.38, y + size * 0.9], [x + size, y + size * 0.12]], color, { width });
  }

  /**
   * A block of text wrapping at `width`. On a dark `ground` it is written as a
   * plate so the words keep their ground on either theme.
   */
  text(x: number, y: number, width: number, body: string, style: TextStyle, ground?: string): NewNodeInput {
    const color = style.color ?? '#1F2937';
    const height = heightOf(body, width, style);
    if (ground && isDark(ground)) return this.plate(x, y, width, height, body, style, ground);
    return this.add({
      id: nanoid(),
      type: 'text',
      x,
      y,
      width,
      height,
      text: body,
      resize: 'height',
      typography: typography(style, color),
    });
  }

  /** A one-line label sized to its words. Returns the node; read `.width` to place the next thing. */
  label(x: number, y: number, body: string, style: TextStyle, ground?: string): NewNodeInput {
    const width = widthOf(body, style);
    const align = style.align ?? 'left';
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    if (ground && isDark(ground)) return this.plate(left, y, width, heightOf(body, width, style), body, style, ground);
    return this.add({
      id: nanoid(),
      type: 'text',
      x: left,
      y,
      width,
      height: Math.ceil(body.split('\n').length * style.size * (style.lh ?? 1.4)) + 2,
      text: body,
      resize: 'width',
      typography: typography(style, style.color ?? '#1F2937'),
    });
  }

  /** Words on a dark ground, carried by a shape of the ground's own colour. */
  plate(x: number, y: number, width: number, height: number, body: string, style: TextStyle, ground: string): NewNodeInput {
    return this.add({
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: 'rect' },
      text: body,
      appearance: { fill: [{ type: 'solid', color: ground }], stroke: { color: ground, width: 0 } },
      typography: { ...typography(style, style.color ?? '#FFFFFF'), verticalAlign: 'top' },
    });
  }

  /** A control with its label centred: a button, a chip, a tab, a key. */
  button(x: number, y: number, width: number, height: number, label: string, o: ButtonOptions): NewNodeInput {
    return this.add({
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: 'rect' },
      text: label,
      ...(o.opacity !== undefined ? { opacity: o.opacity } : null),
      appearance: {
        fill: [{ type: 'solid', color: o.fill }],
        stroke: o.stroke ? { color: o.stroke, width: o.strokeWidth ?? 1 } : { color: o.fill, width: 0 },
        cornerRadius: o.radius ?? 8,
        ...(o.shadow ? { shadow: shadowOf(o.shadow) } : null),
        ...(o.sketch ? { sketch: o.sketch } : null),
      },
      typography: {
        fontSize: o.size ?? 15,
        fontWeight: o.weight ?? 600,
        color: o.ink,
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.3,
        ...(o.family ? { fontFamily: o.family } : null),
      },
    });
  }

  /** A button sized to its label: `padX` either side, so a row of them reads as one set. */
  pill(x: number, y: number, height: number, label: string, o: ButtonOptions & { padX?: number }): NewNodeInput {
    const width = Math.ceil(measure(label, { size: o.size ?? 15, weight: o.weight ?? 600, family: o.family }) + (o.padX ?? 20) * 2);
    return this.button(x, y, width, height, label, o);
  }

  /** A library shape drawn as an icon at its own aspect. */
  glyph(x: number, y: number, size: number, kind: string, fill: string, stroke: string, strokeWidth = 1.5): NewNodeInput {
    return this.rect(x, y, size, size, { kind, fill, stroke, strokeWidth });
  }

  /** A disc, optionally with initials or a number on it. */
  disc(cx: number, cy: number, r: number, fill: string, o: { label?: string; ink?: string; size?: number; stroke?: string; strokeWidth?: number; weight?: number } = {}): NewNodeInput {
    return this.add({
      id: nanoid(),
      type: 'shape',
      x: cx - r,
      y: cy - r,
      width: r * 2,
      height: r * 2,
      geometry: { kind: 'ellipse' },
      ...(o.label ? { text: o.label } : null),
      appearance: {
        fill: [{ type: 'solid', color: fill }],
        stroke: o.stroke ? { color: o.stroke, width: o.strokeWidth ?? 1.5 } : { color: fill, width: 0 },
      },
      typography: { fontSize: o.size ?? Math.round(r * 0.8), fontWeight: o.weight ?? 650, color: o.ink ?? '#FFFFFF', align: 'center', verticalAlign: 'middle', lineHeight: 1.2 },
    });
  }

  sticky(
    x: number,
    y: number,
    width: number,
    height: number,
    body: string,
    theme: StickyTheme,
    o: { author?: { id: string; name: string; color: string }; stamps?: Record<string, string[]>; fontSize?: number; tags?: string[]; checklist?: boolean } = {}
  ): NewNodeInput {
    return this.add({
      id: nanoid(),
      type: 'sticky',
      x,
      y,
      width,
      height,
      text: body,
      theme,
      fontSize: o.fontSize ?? 16,
      textSizing: 'fixed',
      reactions: o.stamps ?? {},
      tags: o.tags ?? [],
      pinned: false,
      ...(o.author ? { author: { ...o.author }, showAuthor: true } : { showAuthor: false }),
      ...(o.checklist ? { checklist: true } : null),
    });
  }

  /** A connector, attached by id at both ends and routed on read. */
  wire(from: NewNodeInput, to: NewNodeInput, o: WireOptions = {}): NewNodeInput {
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'connector',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      from: { nodeId: from.id as string, port: o.from ?? 'auto' },
      to: { nodeId: to.id as string, port: o.to ?? 'auto' },
      routing: o.routing ?? 'orthogonal',
      avoid: true,
      cornerRadius: 12,
      endEnd: 'arrow',
      appearance: { stroke: { color: o.color ?? '#475569', width: o.width ?? 2, cap: 'round', ...(o.dash ? { dash: o.dash } : null) } },
      ...(o.label ? { labels: [{ id: nanoid(6), text: o.label, ...(o.at !== undefined ? { t: o.at } : null) }] } : null),
    };
    this.wires.push(node);
    return node;
  }
}

/** The ink that reads on `ground`: the dark one if it clears AA there, else white. */
export const inkOn = (ground: string, dark = '#0F172A'): string => (contrast(dark, ground) >= 4.5 ? dark : '#FFFFFF');

/** A twelve-column measure: the left edge of column `i` and the width of `n` columns. */
export function grid(x0: number, margin: number, column: number, gutter: number) {
  return {
    col: (i: number) => x0 + margin + i * (column + gutter),
    span: (n: number) => n * column + (n - 1) * gutter,
  };
}
