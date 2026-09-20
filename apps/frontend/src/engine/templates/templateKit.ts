import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import type { StickyTheme } from '../model/schema';
import { defaultChartSpec, type ChartSpec } from '../chart/chartTypes';
import { defaultCodeSpec, type CodeSpec } from '../code/codeTypes';
import type { TableSpec } from '../table/tableTypes';

/**
 * The pieces every template board is built from.
 *
 * ## Why these are shared rather than local
 *
 * The first three template files each grew their own `box`, `label` and
 * `link`, and they drifted — three different corner radii, two different label
 * weights, and one that forgot to set the ink colour so every caption on that
 * board was white on cream. A gallery whose boards disagree about what a box
 * looks like reads as a gallery of demos by different people, which is the one
 * thing a gallery of demos must not look like.
 *
 * So the vocabulary lives here once, and a template file contains layout and
 * content and nothing else. Adding a board should be an exercise in deciding
 * *what goes where*, never in restating what a rounded rectangle is.
 *
 * ## The palette
 *
 * One muted set, used by every board. Saturated fills are what make a diagram
 * look like a slide from 2009; these are pale grounds carrying dark ink, which
 * is how Figma, Linear and every modern diagram tool draw a labelled box, and
 * it is the only treatment that survives being put next to a photograph or a
 * chart without shouting over it.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** Pale grounds. Every one of these carries `INK` at 4.5:1 or better. */
export const TINT = {
  slate: '#F1F5F9',
  indigo: '#E0E7FF',
  blue: '#DBEAFE',
  sky: '#E0F2FE',
  teal: '#CCFBF1',
  green: '#DCFCE7',
  lime: '#ECFCCB',
  amber: '#FEF3C7',
  orange: '#FFEDD5',
  rose: '#FFE4E6',
  pink: '#FCE7F3',
  violet: '#EDE9FE',
  stone: '#EFEDE9',
} as const;

export type Tint = keyof typeof TINT;

/**
 * The ink ramp, darkest first.
 *
 * Four steps and no more. `INK_STRONG` is for a board's own title, `INK` is
 * every label on a tinted ground, `INK_MID` is body text that has to hold its
 * own beside a label, and the last two are for things the reader should be
 * able to ignore. A fifth grey is always somebody matching a screenshot.
 */
export const INK_STRONG = '#0F172A';
export const INK = '#1F2937';
export const INK_MID = '#334155';
export const INK_SOFT = '#475569';
export const INK_FAINT = '#94A3B8';

/**
 * The brand, on a board.
 *
 * These are DESIGN.md's `brand-orange` and `brand-ink`, and they are the only
 * two values here that mean something outside this directory — which is
 * exactly why they are named. A board that wants to be *this product's* board
 * uses them; a board drawing somebody else's diagram must not, and the
 * literal-colour rule is what keeps that decision visible.
 */
export const BRAND = '#F3A024';
export const BRAND_INK = '#161616';

/** DESIGN.md's `signal-online` and `signal-danger`, for a board that reports a state. */
export const SIGNAL_OK = '#10B981';
export const SIGNAL_BAD = '#EF4444';

/**
 * A card that sits *on* a tinted ground rather than being one.
 *
 * White with a hairline, never white alone: a white card on a pale band with
 * no edge reads as a hole cut in the band. `HAIRLINE` is the edge, and the
 * darker `RULE` is for the few places a border has to survive being drawn over
 * a mid-tone.
 */
export const PAPER = '#FFFFFF';
/** A card that is not quite white, for sitting on white. */
export const PAPER_SOFT = '#F8FAFC';
export const HAIRLINE = '#E2E8F0';
export const RULE = '#CBD5E1';

/** Stronger versions of the tints, for strokes, accents and chart series. */
export const HUE = {
  slate: '#64748B',
  indigo: '#6366F1',
  blue: '#3B82F6',
  sky: '#0EA5E9',
  teal: '#14B8A6',
  green: '#22C55E',
  lime: '#84CC16',
  amber: '#F59E0B',
  orange: '#F97316',
  rose: '#F43F5E',
  pink: '#EC4899',
  violet: '#8B5CF6',
  stone: '#78716C',
} as const;

/**
 * A ring of hues, evenly spaced.
 *
 * HSL rather than a fixed palette: the generated boards need hundreds of
 * colours that stay related, and interpolating a list of eight would give
 * banding exactly where the eye is most likely to look for structure.
 */
export const hue = (t: number, saturation = 68, lightness = 62): string =>
  `hsl(${Math.round((((t % 1) + 1) % 1) * 360)}, ${saturation}%, ${lightness}%)`;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** A board's own name, at the top left of it. */
export const title = (x: number, y: number, text: string, fontSize = 44): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width: 900,
  height: fontSize * 1.5,
  text,
  resize: 'width',
  typography: { fontSize, fontWeight: 700, color: INK_STRONG, lineHeight: 1.15 },
});

/** The line under a title that says what the board is for. */
export const caption = (x: number, y: number, text: string, width = 760): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width,
  height: 30,
  text,
  resize: 'width',
  typography: { fontSize: 18, fontWeight: 500, color: INK_SOFT, lineHeight: 1.45 },
});

/** A heading over a group of things. */
export const heading = (x: number, y: number, text: string, fontSize = 24, width = 520): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width,
  height: fontSize * 1.5,
  text,
  resize: 'width',
  typography: { fontSize, fontWeight: 650, color: INK_STRONG, letterSpacing: -0.2 },
});

/** Body text: an annotation, a paragraph, a note in the margin. */
export const note = (
  x: number,
  y: number,
  text: string,
  width = 320,
  fontSize = 15,
  color = INK_SOFT
): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width,
  height: fontSize * 1.6,
  text,
  resize: 'width',
  typography: { fontSize, fontWeight: 450, color, lineHeight: 1.5 },
});

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type Extra = Record<string, unknown>;

/**
 * A labelled rounded box — the workhorse of every diagram here.
 *
 * Ink is set explicitly. A shape's text defaults to white, which is right for
 * the saturated fills the shape tool produces and wrong for every fill in
 * `TINT`; the first build of these templates shipped white-on-cream labels
 * across four boards.
 */
export const fillOf = (tint: Tint | string): string => (tint in TINT ? TINT[tint as Tint] : tint);

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r * 255, g * 255, b * 255];
}

export function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 1;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Harmonious, low-contrast stroke tones that are slightly darker than the fill. */
export const TINT_STROKE: Record<Tint, string> = {
  slate: '#CBD5E1',   // slate-300 on slate-100 (#F1F5F9)
  indigo: '#C7D2FE',  // indigo-200 on indigo-100 (#E0E7FF)
  blue: '#BFDBFE',    // blue-200 on blue-100 (#DBEAFE)
  sky: '#BAE6FD',     // sky-200 on sky-100 (#E0F2FE)
  teal: '#99F6E4',    // teal-200 on teal-100 (#CCFBF1)
  green: '#BBF7D0',   // green-200 on green-100 (#DCFCE7)
  lime: '#D9F99D',    // lime-200 on lime-100 (#ECFCCB)
  amber: '#FDE68A',   // amber-200 on amber-100 (#FEF3C7)
  orange: '#FED7AA',  // orange-200 on orange-100 (#FFEDD5)
  rose: '#FECDD3',    // rose-200 on rose-100 (#FFE4E6)
  pink: '#FBCFE8',    // pink-200 on pink-100 (#FCE7F3)
  violet: '#DDD6FE',  // violet-200 on violet-100 (#EDE9FE)
  stone: '#E7E5E4',   // stone-200 on stone-100 (#EFEDE9)
};

export const strokeOf = (tint: Tint | string): string => {
  if (tint in TINT_STROKE) return TINT_STROKE[tint as Tint];
  if (tint in TINT) return TINT_STROKE[tint as Tint];

  const hex = typeof tint === 'string' ? tint.toUpperCase() : '';
  if (hex === '#FFFFFF' || hex === PAPER || hex === '#F8FAFC' || hex === PAPER_SOFT) return HAIRLINE;
  if (hex === '#0F172A' || hex === '#020617') return '#1E293B';
  if (hex === '#1E293B') return '#334155';
  if (hex === '#F1F5F9' || hex === '#E2E8F0') return '#CBD5E1';
  if (hex === '#E0E7FF') return '#C7D2FE';
  if (hex === '#DBEAFE') return '#BFDBFE';
  if (hex === '#E0F2FE') return '#BAE6FD';
  if (hex === '#CCFBF1') return '#99F6E4';
  if (hex === '#DCFCE7') return '#BBF7D0';
  if (hex === '#ECFCCB') return '#D9F99D';
  if (hex === '#FEF3C7') return '#FDE68A';
  if (hex === '#FFEDD5') return '#FED7AA';
  if (hex === '#FFE4E6' || hex === '#FEE2E2') return '#FECDD3';
  if (hex === '#FCE7F3') return '#FBCFE8';
  if (hex === '#EDE9FE') return '#DDD6FE';
  if (hex === '#EFEDE9') return '#E7E5E4';
  if (hex === BRAND || hex === '#F3A024') return '#D97706';

  const rgb = hexToRgb(tint);
  if (rgb) {
    const [h, s, l] = rgbToHsl(...rgb);
    if (l > 0.20) {
      const targetL = Math.max(0.05, l - 0.11);
      const targetS = Math.min(1, s * 1.05);
      const [r2, g2, b2] = hslToRgb(h, targetS, targetL);
      return rgbToHex(r2, g2, b2);
    } else {
      const targetL = Math.min(0.28, l + 0.08);
      const [r2, g2, b2] = hslToRgb(h, s, targetL);
      return rgbToHex(r2, g2, b2);
    }
  }

  return tint;
};

export const box = (
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  tint: Tint | string = 'slate',
  extra: Extra = {}
): NewNodeInput => {
  const defaultFontSize = height <= 54 ? 12 : height <= 84 ? 13 : 15;
  const strokeColor = strokeOf(tint);
  const extraAppearance = (extra.appearance as Record<string, unknown>) || {};
  const extraTypography = (extra.typography as Record<string, unknown>) || {};
  const passedStroke = extraAppearance.stroke as { color?: string; width?: number } | undefined;

  let stroke = { color: strokeColor, width: 1.5 };
  if (passedStroke) {
    const strokeWidth = passedStroke.width ?? 1.5;
    const strokeCol = passedStroke.color;
    if (strokeCol) {
      const fillCol = fillOf(tint);
      const cr = contrast(fillCol, strokeCol);
      if (cr > 2.0) {
        stroke = { color: strokeColor, width: strokeWidth };
      } else {
        stroke = { color: strokeCol, width: strokeWidth };
      }
    } else {
      stroke = { color: strokeColor, width: strokeWidth };
    }
  }

  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height,
    geometry: { kind: 'rect' },
    text,
    ...extra,
    appearance: {
      fill: [{ type: 'solid', color: fillOf(tint) }],
      ...extraAppearance,
      stroke,
      cornerRadius: 0,
    },
    typography: {
      fontSize: defaultFontSize,
      fontWeight: 600,
      color: INK,
      align: 'center',
      verticalAlign: 'middle',
      ...extraTypography,
    },
  };
};

/**
 * A box in the shape of the thing it names — a database, a server, a queue.
 *
 * Fifty-odd geometries ship with the shape tool and almost none of them appear
 * in a template, which is how a feature becomes invisible. An architecture
 * diagram is the honest place for them: a cylinder *is* how everybody draws a
 * database, and using a rectangle there throws away information the reader
 * already knows how to read.
 */
export const glyph = (
  x: number,
  y: number,
  width: number,
  height: number,
  kind: string,
  text: string,
  tint: Tint | string = 'slate',
  extra: Extra = {}
): NewNodeInput =>
  box(x, y, width, height, text, tint, {
    geometry: { kind },
    typography: { fontSize: height <= 84 ? 13 : 14, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
    ...extra,
    appearance: {
      ...((extra.appearance as Record<string, unknown>) || {}),
      cornerRadius: 0,
    },
  });

/**
 * A wide labelled row with a small square icon at its left.
 *
 * ## Why an icon cannot just be the box
 *
 * `glyph` fills its whole box with the geometry, which is right for the shapes
 * that are *containers* — a cylinder, a document, a folder — because those are
 * drawn wide in every diagram ever made. It is wrong for the ones that are
 * **pictures of a thing**. A `bolt` stretched to 300×74 is not a lightning
 * bolt, it is a smear; a `globe` at 2:1 is an ellipse; a `mobile` in landscape
 * is a television. The geometry stops carrying the meaning it was chosen for,
 * which is the entire reason to use it over a rectangle.
 *
 * So the icon keeps its own square and the label gets the rest of the row.
 * Three nodes instead of one, and each is still an ordinary object that can be
 * picked up on its own.
 *
 * Returns the ground as `node` — connectors attach to that — and `nodes` to
 * push, in draw order.
 */
export function iconRow(
  x: number,
  y: number,
  width: number,
  height: number,
  kind: string,
  text: string,
  tint: Tint | string = 'slate',
  extra: Extra = {}
): { node: NewNodeInput; nodes: NewNodeInput[] } {
  const ICON = Math.min(44, height - 20);
  const PAD = 16;

  const ground = box(x, y, width, height, '', tint, extra);
  const icon: NewNodeInput = {
    id: nanoid(),
    type: 'shape',
    x: x + PAD,
    y: y + (height - ICON) / 2,
    width: ICON,
    height: ICON,
    geometry: { kind },
    appearance: {
      fill: [{ type: 'solid', color: strokeOf(tint) }],
      stroke: { color: strokeOf(tint), width: 1 },
      opacity: 0.85,
      cornerRadius: 0,
    },
  };
  const label: NewNodeInput = {
    id: nanoid(),
    type: 'text',
    x: x + PAD * 2 + ICON,
    y: y + height / 2 - 18,
    width: Math.max(50, width - PAD * 3 - ICON),
    height: 36,
    text,
    resize: 'none',
    typography: { fontSize: 15, fontWeight: 600, color: INK, align: 'left', verticalAlign: 'middle', lineHeight: 1.3 },
  };
  return { node: ground, nodes: [ground, icon, label] };
}

/** A small pill: a status, a tag, a lane marker. */
export const pill = (x: number, y: number, width: number, text: string, tint: Tint | string = 'slate'): NewNodeInput =>
  box(x, y, width, 34, text, tint, {
    appearance: { fill: [{ type: 'solid', color: fillOf(tint) }], stroke: { color: strokeOf(tint), width: 1.5 }, cornerRadius: 0 },
    typography: { fontSize: 13, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
  });

/** A decision point. A diamond, because that is what every flowchart reader expects. */
export const decision = (x: number, y: number, width: number, height: number, text: string): NewNodeInput =>
  box(x, y, width, height, text, 'amber', {
    geometry: { kind: 'polygon', points: 4 },
    typography: { fontSize: 14, fontWeight: 600, color: INK, align: 'center', verticalAlign: 'middle' },
  });

/** A start or an end. A pill, for the same reason. */
export const terminator = (x: number, y: number, width: number, text: string, tint: Tint = 'indigo'): NewNodeInput =>
  box(x, y, width, 60, text, tint, {
    appearance: { fill: [{ type: 'solid', color: fillOf(tint) }], stroke: { color: strokeOf(tint), width: 1.5 }, cornerRadius: 0 },
  });

/** A plain band of colour behind a group — a swimlane, a phase, a zone. */
export const band = (
  x: number,
  y: number,
  width: number,
  height: number,
  tint: Tint | string,
  opacity = 0.55
): NewNodeInput => ({
  id: nanoid(),
  type: 'shape',
  x,
  y,
  width,
  height,
  geometry: { kind: 'rect' },
  appearance: {
    fill: [{ type: 'solid', color: fillOf(tint) }],
    stroke: { color: strokeOf(tint), width: 1 },
    cornerRadius: 0,
    opacity,
  },
});

export const sticky = (
  x: number,
  y: number,
  text: string,
  theme: StickyTheme = 'yellow',
  extra: Extra = {}
): NewNodeInput => {
  const { appearance, ...restExtra } = extra;
  const cleanAppearance = appearance ? { ...(appearance as object), sketch: undefined } : undefined;
  return {
    id: nanoid(),
    type: 'sticky',
    x,
    y,
    width: 180,
    height: 180,
    text,
    theme,
    fontSize: 15,
    reactions: {},
    tags: [],
    pinned: false,
    ...restExtra,
    ...(cleanAppearance ? { appearance: cleanAppearance } : {}),
  };
};

export const frame = (x: number, y: number, width: number, height: number, title: string): NewNodeInput => ({
  id: nanoid(),
  type: 'frame',
  x,
  y,
  width,
  height,
  title,
});

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

/**
 * An arrow between two nodes.
 *
 * Attached by id at both ends and routed on read, never by stored geometry —
 * so dragging either box re-solves the route. That is the single most
 * convincing thing a template can demonstrate about this tool, and it only
 * works if templates never hand-place an arrow.
 */
export const link = (fromId: unknown, toId: unknown, extra: Extra = {}): NewNodeInput => ({
  id: nanoid(),
  type: 'connector',
  // Derived from the route on the first render; these only seed the box.
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  from: { nodeId: fromId as string, port: 'auto' },
  to: { nodeId: toId as string, port: 'auto' },
  routing: 'orthogonal',
  endEnd: 'arrow',
  appearance: { stroke: { color: HUE.slate, width: 2, cap: 'round' } },
  ...extra,
});

/** A connector that curves — for a loop back, or anything crossing the page. */
export const curve = (fromId: unknown, toId: unknown, extra: Extra = {}): NewNodeInput =>
  link(fromId, toId, { routing: 'curved', ...extra });

/** A dashed connector: a weaker relationship — async, optional, "see also". */
export const dashed = (fromId: unknown, toId: unknown, extra: Extra = {}): NewNodeInput =>
  link(fromId, toId, {
    appearance: { stroke: { color: HUE.slate, width: 2, cap: 'round', dash: [8, 6] } },
    ...extra,
  });

/** Chain a run of nodes front to back, so a pipeline reads as one call. */
export const chain = (nodes: NewNodeInput[], extra: Extra = {}): NewNodeInput[] =>
  nodes.slice(1).map((node, i) => link(nodes[i].id, node.id, extra));

// ---------------------------------------------------------------------------
// Data objects
// ---------------------------------------------------------------------------

export const plot = (kind: ChartSpec['kind'], over: Partial<ChartSpec>): ChartSpec => ({
  ...defaultChartSpec(kind),
  ...over,
});

export const chart = (
  x: number,
  y: number,
  spec: ChartSpec,
  width = 520,
  height = 340,
  extra: Extra = {}
): NewNodeInput =>
  ({
    id: nanoid(),
    type: 'chart',
    x,
    y,
    width,
    height,
    chart: spec,
    ...extra,
  }) as unknown as NewNodeInput;

export const table = (
  x: number,
  y: number,
  spec: TableSpec,
  width = 520,
  height = 340,
  extra: Extra = {}
): NewNodeInput =>
  ({
    id: nanoid(),
    type: 'table',
    x,
    y,
    width,
    height,
    table: spec,
    ...extra,
  }) as unknown as NewNodeInput;

/**
 * Source on the board.
 *
 * Real source, always — a YAML workflow that would run, a query that would
 * execute. A template carrying plausible-looking nonsense is worse than one
 * carrying none: somebody will read it, and a few of them will copy it.
 */
export const code = (
  x: number,
  y: number,
  source: string,
  language: string,
  width = 520,
  height = 340,
  over: Partial<CodeSpec> = {}
): NewNodeInput =>
  ({
    id: nanoid(),
    type: 'code',
    x,
    y,
    width,
    height,
    code: { ...defaultCodeSpec(source, language), ...over },
  }) as unknown as NewNodeInput;

/**
 * A hand-drawn treatment, applied to anything that takes an `appearance`.
 *
 * Spread into a builder's `extra`, so the sketch boards read as the same
 * layout as the crisp ones with one word changed — which is the claim being
 * made about the feature.
 */
export const sketched = (level: 'light' | 'medium' | 'heavy' = 'medium', extra: Extra = {}): Extra => ({
  appearance: { sketch: level, ...(extra.appearance as object) },
  ...extra,
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Evenly spaced positions along an axis: `row(0, 5, 260)` → 0, 260, 520, … */
export const row = (start: number, count: number, step: number): number[] =>
  Array.from({ length: count }, (_, i) => start + i * step);

/**
 * Put the wiring underneath the things it wires.
 *
 * ## The bug this exists to prevent
 *
 * A template returns a flat list and the loader stamps `zIndex` from its
 * order, so anything pushed later draws on top. Written naturally — a box,
 * then the arrow leaving it, then the next box — that puts *some* arrows over
 * boxes and others under them, and the ones that cross the board pass straight
 * over everything between their endpoints. Diagrams drawn that way have arrows
 * running across labels, which reads as a rendering fault rather than as a
 * diagram.
 *
 * Every drawing tool solves this the same way: edges below nodes, always. This
 * does that in one pass at the end, so a builder can still push a connector
 * beside the pair it joins — which is how it stays readable — without that
 * order deciding what covers what.
 *
 * Bands are pulled below the connectors for the same reason: a band is a
 * region behind a group, and a region drawn over an arrow is a region that
 * erases it. Relative order is preserved inside each of the three layers, so
 * nothing else about the board moves.
 */
export function layer(nodes: NewNodeInput[]): NewNodeInput[] {
  const grounds: NewNodeInput[] = [];
  const wires: NewNodeInput[] = [];
  const rest: NewNodeInput[] = [];
  for (const node of nodes) {
    if (node.type === 'connector') wires.push(node);
    else if (node.type === 'frame' || GROUNDS.has(node)) grounds.push(node);
    else rest.push(node);
  }
  return [...grounds, ...wires, ...rest];
}

/**
 * The backdrops made by `zone`, remembered by identity.
 *
 * A marker field on the node would be simpler to read and would travel into
 * the document — a field the schema does not declare, carried through the CRDT
 * boundary, into every export, for the benefit of a sort that happens before
 * any of that. A `WeakSet` keyed on the object says the same thing and stops
 * existing the moment `build()` returns.
 */
const GROUNDS = new WeakSet<object>();

/**
 * A region behind a group of things — and deliberately *not* a frame.
 *
 * ## Why this is not a frame
 *
 * A frame is a page: it owns whatever has its centre inside it, and it
 * **clips** what it owns. That is right for an artboard and wrong for a zone
 * on a diagram, where it produces two failures that look like rendering bugs.
 * A caption that wraps to one more line than expected is silently cut off at
 * the frame's edge, and — worse — a connector running between two zones has
 * its own midpoint inside one of them, so it is adopted, clipped, and
 * disappears somewhere in the gap.
 *
 * Both of those are invisible when the board is written and obvious when it is
 * opened, which is the worst combination. So a zone is a coloured rectangle
 * with a heading over it: it looks identical, owns nothing, and cannot cut
 * anything off.
 *
 * Frames remain right where a template really is a set of pages — the
 * presentation-versus-whiteboard boards, where every item genuinely lives
 * inside one artboard and nothing crosses between them.
 */
export const zone = (
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  tint: Tint | string,
  opacity = 0.42
): NewNodeInput[] => {
  const strokeColor = strokeOf(tint);
  const ground: NewNodeInput = {
    ...band(x, y, width, height, tint, opacity),
    appearance: {
      fill: [{ type: 'solid', color: fillOf(tint) }],
      stroke: { color: strokeColor, width: 1.5 },
      cornerRadius: 0,
      opacity,
    },
  };
  GROUNDS.add(ground);
  return [ground, heading(x + 24, y + 18, name, 17, Math.max(100, width - 48))];
};

/**
 * A deterministic pseudo-random sequence.
 *
 * Templates that scatter things need randomness that is *the same every time*:
 * a board whose thumbnail differs from the board it opens is a broken promise,
 * and `Math.random` in a `build()` gives exactly that — the card is drawn from
 * one call and the board from another. Seeded, both are the same drawing.
 */
export function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32: short, no dependencies, and good enough to scatter shapes.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}
