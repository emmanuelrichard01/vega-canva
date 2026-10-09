import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { ChartKind, ChartSpec } from '../../chart/chartTypes';
import { specForRange } from '../../chart/chartFromTable';
import { tableFromCsv } from '../../table/tableModel';
import { layoutSlide, type LayoutContent, type LayoutId, type SlideBox } from '../../slides/layouts';
import type { SlideTransition } from '../../slides/slideMeta';
import type { DeckTheme } from '../../slides/themes';
import { layer, table } from '../templateKit';

/**
 * The slide decks' own vocabulary: a deck laid out as rows of slides, cards
 * and wires for the diagrams drawn on them, and a table on the board that a
 * slide's chart reads from.
 *
 * Every deck is built from `engine/slides/layouts`, the same functions the
 * slide view inserts new slides with, so a template's slides and a slide
 * somebody adds later are one design.
 */

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
const COL_GAP = 160;
const ROW_GAP = 320;
const PER_ROW = 4;

/** The box of slide `i` in a deck laid out four to a row. */
export function slideBox(i: number): SlideBox {
  return {
    x: (i % PER_ROW) * (SLIDE_W + COL_GAP),
    y: Math.floor(i / PER_ROW) * (SLIDE_H + ROW_GAP),
    width: SLIDE_W,
    height: SLIDE_H,
  };
}

/** Where the board continues under a deck of `count` slides. */
export function belowDeck(count: number): number {
  return Math.ceil(count / PER_ROW) * (SLIDE_H + ROW_GAP);
}

export interface DeckSlideSpec {
  layout: LayoutId;
  /** The frame's name, shown on the board and in the slide view. */
  name: string;
  icon?: string;
  content?: LayoutContent;
  notes?: string;
  section?: string;
  transition?: SlideTransition;
  /** Objects of the slide's own, drawn after the layout. Must lie inside `box`. */
  extra?: (box: SlideBox) => NewNodeInput[];
}

/**
 * A deck: every slide's frame and contents, numbered in order, with its
 * notes, section and transition on the frame. Frames come first, so each
 * slide owns what is drawn on it from the moment it is created.
 */
export function buildDeck(theme: DeckTheme, slides: DeckSlideSpec[], after: NewNodeInput[] = []): NewNodeInput[] {
  const nodes: NewNodeInput[] = [];
  slides.forEach((s, i) => {
    const box = slideBox(i);
    const built = layoutSlide(s.layout, box, theme, s.name, s.content ?? {}, {
      slideOrder: i,
      ...(s.icon ? { icon: s.icon } : null),
      ...(s.notes ? { notes: s.notes } : null),
      ...(s.section ? { slideSection: s.section } : null),
      ...(s.transition ? { transition: s.transition } : null),
    });
    nodes.push(...built, ...(s.extra?.(box) ?? []));
  });
  return layer([...nodes, ...after]);
}

/** A labelled card on a slide: a diagram box, a swatch, a step. */
export function card(
  theme: DeckTheme,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: { tone?: 'surface' | 'accent' | 'page'; size?: number; name?: string; weight?: number; radius?: number; align?: 'left' | 'center' } = {}
): NewNodeInput {
  const tone = options.tone ?? 'surface';
  const fill = tone === 'accent' ? theme.accent : tone === 'page' ? theme.page : theme.surface;
  const ink = tone === 'accent' ? theme.onAccent : theme.ink;
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height,
    geometry: { kind: 'rect' },
    text,
    ...(options.name ? { title: options.name } : null),
    appearance: {
      fill: [{ type: 'solid', color: fill, opacity: 1 }],
      stroke: { color: theme.line, width: tone === 'surface' ? 1.5 : 0 },
      cornerRadius: options.radius ?? 16,
    },
    typography: {
      fontFamily: theme.body.family,
      fontSize: options.size ?? 28,
      fontWeight: options.weight ?? 600,
      color: ink,
      align: options.align ?? 'center',
      verticalAlign: 'middle',
      lineHeight: 1.3,
    },
  };
}

/** A plain filled rectangle: a swatch, a bar, a rule. */
export function block(x: number, y: number, width: number, height: number, color: string, extra: Record<string, unknown> = {}): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height,
    geometry: { kind: 'rect' },
    appearance: { fill: [{ type: 'solid', color, opacity: 1 }], cornerRadius: 12 },
    ...extra,
  };
}

/** A line of text on a slide, in the theme's body face. Sized for one line at `width`. */
export function words(
  theme: DeckTheme,
  x: number,
  y: number,
  width: number,
  text: string,
  options: { size?: number; weight?: number; tone?: 'ink' | 'muted' | 'accent'; name?: string; align?: 'left' | 'center' | 'right'; mono?: boolean } = {}
): NewNodeInput {
  const size = options.size ?? 24;
  const lines = text.split('\n').length;
  return {
    id: nanoid(),
    type: 'text',
    x,
    y,
    width,
    height: Math.ceil((lines * size * 1.4) / 8) * 8 + 8,
    text,
    resize: 'height',
    ...(options.name ? { title: options.name } : null),
    typography: {
      fontFamily: options.mono ? 'JetBrains Mono' : theme.body.family,
      fontSize: size,
      fontWeight: options.weight ?? 500,
      lineHeight: 1.4,
      letterSpacing: 0,
      color: options.tone === 'accent' ? theme.accent : options.tone === 'muted' ? theme.muted : theme.ink,
      align: options.align ?? 'left',
    },
  };
}

/** An arrow between two cards, in the theme's quiet ink. */
export function wire(theme: DeckTheme, from: NewNodeInput, to: NewNodeInput, extra: Record<string, unknown> = {}): NewNodeInput {
  return {
    id: nanoid(),
    type: 'connector',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    from: { nodeId: from.id as string, port: 'auto' },
    to: { nodeId: to.id as string, port: 'auto' },
    routing: 'orthogonal',
    endEnd: 'arrow',
    avoid: true,
    appearance: { stroke: { color: theme.muted, width: 3, cap: 'round' } },
    ...extra,
  };
}

/**
 * A table on the board and a chart spec that reads it.
 *
 * The table sits under the deck, where the numbers are kept and edited; the
 * slide shows the chart. Changing a cell redraws the slide, which is the point
 * a data slide on a canvas can make that a slide in a file cannot.
 */
export function sourceData(
  x: number,
  y: number,
  csv: string,
  kind: ChartKind,
  width = 1100,
  over: Partial<ChartSpec> = {}
): { table: NewNodeInput; chart: ChartSpec } {
  const spec = tableFromCsv(csv.trim(), { theme: 'clean', header: true, firstColumn: true });
  if (!spec) throw new Error('slides: source data did not parse');
  const rows = spec.cells.length;
  const cols = spec.cells[0]?.length ?? 0;
  const node = table(x, y, spec, width, rows * 44 + 8);
  const chart = specForRange(spec, node.id as string, { r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 }, { kind });
  if (!chart) throw new Error('slides: source data has no numbers');
  return { table: node, chart: { ...chart, ...over } };
}
