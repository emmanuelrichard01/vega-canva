import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import { defaultChartSpec, type ChartSpec } from '../chart/chartTypes';
import type { DeckTheme } from './themes';
import { textHeight } from '../templates/templateKit';
import { PLACEHOLDER_OPACITY, PROMPTS } from './placeholderText';

/**
 * Slide layouts: the nine page structures a deck is made of.
 *
 * A layout is a function from a slide's box and a theme to the objects on the
 * slide. Given content it sets that content; given none it sets placeholders,
 * text that reads "Click to add title" in the theme's own type, which select
 * themselves whole when edited (so typing replaces them), are left out of a
 * presentation and an export, and become ordinary text the moment they hold
 * anything else. The deck templates are built from these same functions, so a
 * slide inserted from the slide view and a slide in a template are one design.
 *
 * Everything is placed on an 8-unit grid inside a 160-unit margin on a
 * 1920×1080 page, comfortably inside the slide preset's 64-unit safe area, and
 * scaled for other page sizes.
 */

export type LayoutId =
  | 'title'
  | 'section'
  | 'content'
  | 'two-column'
  | 'big-number'
  | 'quote'
  | 'image-text'
  | 'data'
  | 'closing';

export const SLIDE_LAYOUTS: ReadonlyArray<{ id: LayoutId; label: string; blurb: string }> = [
  { id: 'title', label: 'Title', blurb: 'The opening slide: title, subtitle and who is speaking.' },
  { id: 'section', label: 'Section', blurb: 'A pause between parts of the talk.' },
  { id: 'content', label: 'Title and content', blurb: 'A heading over a short list.' },
  { id: 'two-column', label: 'Two columns', blurb: 'Two ideas side by side: before and after, problem and fix.' },
  { id: 'big-number', label: 'Big number', blurb: 'One figure, what it measures and why it matters.' },
  { id: 'quote', label: 'Quote', blurb: 'A customer, an expert or a line worth repeating.' },
  { id: 'image-text', label: 'Image and text', blurb: 'A picture with its story beside it.' },
  { id: 'data', label: 'Data', blurb: 'A chart and the one thing to take away from it.' },
  { id: 'closing', label: 'Closing', blurb: 'The ask, the thanks and how to reach you.' },
];

export { PROMPTS, PLACEHOLDER_OPACITY, isPlaceholder } from './placeholderText';

export interface LayoutContent {
  title?: string;
  subtitle?: string;
  /** Body copy. Lines become list items when `list` is set. */
  body?: string;
  /** Title and content without the content: the slide's body is drawn by its author. */
  noBody?: boolean;
  list?: boolean;
  footer?: string;
  left?: { heading?: string; body?: string };
  right?: { heading?: string; body?: string };
  number?: string;
  label?: string;
  context?: string;
  quote?: string;
  attribution?: string;
  takeaway?: string;
  /** The data slide's chart. A placeholder chart is drawn when absent. */
  chart?: ChartSpec;
  /** Extra chart node fields, such as a pinned id. */
  chartExtra?: Record<string, unknown>;
  /** Drawn art for the image well, in well-relative units (0..1). */
  art?: (well: { x: number; y: number; width: number; height: number }) => NewNodeInput[];
}

export interface SlideBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Role = 'title' | 'heading' | 'subtitle' | 'body' | 'footer' | 'number' | 'label' | 'quote' | 'colhead' | 'stat';

interface RoleStyle {
  size: number;
  lineHeight: number;
  display: boolean;
  tone: 'ink' | 'muted' | 'accent';
  weight?: number;
}

const ROLE_STYLE: Record<Role, RoleStyle> = {
  title: { size: 104, lineHeight: 1.05, display: true, tone: 'ink' },
  heading: { size: 64, lineHeight: 1.1, display: true, tone: 'ink' },
  colhead: { size: 40, lineHeight: 1.2, display: true, tone: 'ink' },
  subtitle: { size: 36, lineHeight: 1.35, display: false, tone: 'muted' },
  body: { size: 32, lineHeight: 1.5, display: false, tone: 'ink' },
  footer: { size: 24, lineHeight: 1.4, display: false, tone: 'muted' },
  number: { size: 240, lineHeight: 1, display: true, tone: 'accent' },
  stat: { size: 96, lineHeight: 1, display: true, tone: 'accent' },
  label: { size: 40, lineHeight: 1.3, display: false, tone: 'ink', weight: 600 },
  quote: { size: 60, lineHeight: 1.2, display: true, tone: 'ink' },
};

/**
 * How tall `text` sets at `width`, so the next block can sit under it.
 *
 * Measured with the catalogue's Inter metrics (`templateKit.textHeight`),
 * rounded up to the 8-unit grid with a line's worth of slack for faces wider
 * than Inter: a gap a little generous reads as air, one too small as a
 * collision. A list loses its bullet indent from the width it wraps at.
 */
export function estimateTextHeight(text: string, size: number, lineHeight: number, width: number, weight = 400, list = false): number {
  const wrap = list ? width - size * 1.6 : width;
  const h = textHeight(text, Math.max(size, wrap * 0.94), size, weight, lineHeight);
  return Math.ceil(h / 8) * 8;
}

/** Builds a slide's objects in page units, scaled onto the real box. */
class Page {
  readonly nodes: NewNodeInput[] = [];
  readonly box: SlideBox;
  readonly theme: DeckTheme;
  readonly s: number;
  readonly margin: number;
  readonly inner: number;

  constructor(box: SlideBox, theme: DeckTheme) {
    this.box = box;
    this.theme = theme;
    this.s = Math.min(box.width / 1920, box.height / 1080);
    this.margin = Math.round(160 * this.s);
    this.inner = box.width - this.margin * 2;
  }

  /** Units on the 1920 page, to world units. */
  u(n: number): number {
    return Math.round(n * this.s);
  }

  /**
   * A text block. `content` undefined sets the role's placeholder; a string
   * sets the text. Returns the block's bottom edge in world units.
   */
  text(
    role: Role,
    x: number,
    y: number,
    width: number,
    content: string | undefined,
    prompt: string,
    extra: { align?: 'left' | 'center' | 'right'; list?: boolean; name?: string; italic?: boolean } = {}
  ): number {
    const style = ROLE_STYLE[role];
    const t = this.theme;
    const size = Math.max(10, Math.round(style.size * this.s));
    const text = content ?? prompt;
    const weight = style.weight ?? (style.display ? t.display.weight : t.body.weight);
    const height = estimateTextHeight(text, size, style.lineHeight, width, weight, extra.list);
    const color = style.tone === 'accent' ? t.accent : style.tone === 'muted' ? t.muted : t.ink;
    this.nodes.push({
      id: nanoid(),
      type: 'text',
      x,
      y,
      width,
      height,
      text,
      resize: 'height',
      ...(content === undefined ? { opacity: PLACEHOLDER_OPACITY } : null),
      title: extra.name ?? defaultName(role),
      typography: {
        fontFamily: style.display ? t.display.family : t.body.family,
        fontSize: size,
        fontWeight: weight,
        lineHeight: style.lineHeight,
        letterSpacing: style.display ? Math.round(t.display.tracking * (size / 64) * 10) / 10 : 0,
        color,
        align: extra.align ?? 'left',
        ...(extra.list ? { list: 'bullet' } : null),
        ...(extra.italic ? { italic: true } : null),
      },
    });
    return y + height;
  }

  /** A filled rectangle: a rule, a card, an image well. */
  rect(x: number, y: number, width: number, height: number, color: string, extra: Record<string, unknown> = {}): NewNodeInput {
    const node: NewNodeInput = {
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height,
      geometry: { kind: 'rect' },
      appearance: { fill: [{ type: 'solid', color, opacity: 1 }], cornerRadius: 0 },
      ...extra,
    };
    this.nodes.push(node);
    return node;
  }
}

function defaultName(role: Role): string {
  switch (role) {
    case 'title':
    case 'heading':
      return 'Title';
    case 'colhead':
      return 'Heading';
    case 'subtitle':
      return 'Subtitle';
    case 'footer':
      return 'Footer';
    case 'number':
    case 'stat':
      return 'Number';
    case 'label':
      return 'Label';
    case 'quote':
      return 'Quote';
    default:
      return 'Body';
  }
}

/** The slide frame itself: the page colour, a name and an icon. */
export function slideFrame(
  box: SlideBox,
  theme: DeckTheme,
  name: string,
  extra: Record<string, unknown> = {}
): NewNodeInput {
  return {
    id: nanoid(),
    type: 'frame',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    title: name,
    preset: box.width === 1920 && box.height === 1080 ? 'slide' : undefined,
    safeArea: { top: 64, right: 64, bottom: 64, left: 64 },
    appearance: { fill: [{ type: 'solid', color: theme.page, opacity: 1 }], cornerRadius: 0 },
    ...extra,
  };
}

/**
 * The objects a layout puts on a slide at `box`, in `theme`.
 *
 * Positions are absolute world coordinates; the frame is not included (see
 * `slideFrame`). Every object lies inside the box, so the frame owns and clips
 * nothing it should not.
 */
export function layoutNodes(id: LayoutId, box: SlideBox, theme: DeckTheme, content: LayoutContent = {}): NewNodeInput[] {
  const p = new Page(box, theme);
  const L = box.x + p.margin;
  const T = box.y + p.u(144);
  const W = p.inner;
  const bottom = box.y + box.height - p.u(120);

  switch (id) {
    case 'title': {
      const y0 = box.y + p.u(352);
      p.rect(L, y0 - p.u(56), p.u(96), p.u(8), theme.accent, { title: 'Accent' });
      const end = p.text('title', L, y0, p.u(1400), content.title, PROMPTS.title);
      p.text('subtitle', L, end + p.u(32), p.u(1200), content.subtitle, PROMPTS.subtitle);
      p.text('footer', L, bottom - p.u(32), p.u(1200), content.footer, PROMPTS.footer);
      break;
    }

    case 'section': {
      const y0 = box.y + p.u(400);
      p.rect(L, y0 - p.u(56), p.u(96), p.u(8), theme.accent, { title: 'Accent' });
      const end = p.text('title', L, y0, p.u(1280), content.title, PROMPTS.title);
      p.text('subtitle', L, end + p.u(32), p.u(1080), content.subtitle, PROMPTS.subtitle);
      break;
    }

    case 'content': {
      const end = p.text('heading', L, T, W, content.title, PROMPTS.title);
      if (!content.noBody) p.text('body', L, end + p.u(64), p.u(1240), content.body, PROMPTS.body, { list: content.body === undefined || content.list });
      break;
    }

    case 'two-column': {
      const end = p.text('heading', L, T, W, content.title, PROMPTS.title);
      const gap = p.u(96);
      const col = Math.floor((W - gap) / 2);
      const top = end + p.u(72);
      for (const [i, side] of [content.left, content.right].entries()) {
        const x = L + i * (col + gap);
        p.rect(x, top, p.u(48), p.u(6), theme.accent, { title: 'Accent' });
        const headEnd = p.text('colhead', x, top + p.u(40), col, side?.heading, PROMPTS.heading);
        p.text('body', x, headEnd + p.u(24), col, side?.body, PROMPTS.body, { list: side?.body === undefined });
      }
      break;
    }

    case 'big-number': {
      const y0 = box.y + p.u(232);
      const end = p.text('number', L, y0, W, content.number, PROMPTS.number);
      const labelEnd = p.text('label', L, end + p.u(40), p.u(1200), content.label, PROMPTS.label);
      if (content.context !== undefined || content.number === undefined) {
        p.text('subtitle', L, labelEnd + p.u(24), p.u(1200), content.context, PROMPTS.body, { name: 'Context' });
      }
      break;
    }

    case 'quote': {
      const y0 = box.y + p.u(280);
      // The mark is type, not a picture, so it takes the display face.
      p.nodes.push({
        id: nanoid(),
        type: 'text',
        x: L - p.u(8),
        y: y0 - p.u(200),
        width: p.u(240),
        height: p.u(200),
        text: '“',
        resize: 'fixed',
        title: 'Quote mark',
        typography: {
          fontFamily: theme.display.family,
          fontSize: p.u(200),
          fontWeight: theme.display.weight,
          lineHeight: 1,
          letterSpacing: 0,
          color: theme.accent,
          align: 'left',
        },
      });
      const end = p.text('quote', L, y0 + p.u(40), p.u(1400), content.quote, PROMPTS.quote);
      p.text('footer', L, end + p.u(48), p.u(1000), content.attribution, PROMPTS.attribution, { name: 'Attribution' });
      break;
    }

    case 'image-text': {
      const wellW = p.u(800);
      const well = { x: L, y: box.y + p.u(120), width: wellW, height: box.height - p.u(240) };
      // Drawn art brings its own ground; the empty well is only for a picture still to come.
      if (content.art) p.nodes.push(...content.art(well));
      else {
        p.rect(well.x, well.y, well.width, well.height, theme.surface, {
          title: 'Image',
          appearance: { fill: [{ type: 'solid', color: theme.surface, opacity: 1 }], cornerRadius: p.u(24) },
        });
        p.text('footer', well.x + p.u(48), well.y + well.height / 2 - p.u(16), well.width - p.u(96), undefined, PROMPTS.image, { align: 'center', name: 'Image hint' });
      }
      const x = L + wellW + p.u(112);
      const w = box.x + box.width - p.margin - x;
      const end = p.text('heading', x, box.y + p.u(296), w, content.title, PROMPTS.title);
      p.text('body', x, end + p.u(40), w, content.body, PROMPTS.body);
      break;
    }

    case 'data': {
      const end = p.text('heading', L, T, W, content.title, PROMPTS.title);
      const top = end + p.u(56);
      const chartW = p.u(1040);
      const chartH = Math.max(p.u(320), bottom - top);
      const spec: ChartSpec = content.chart ?? { ...defaultChartSpec('bar'), title: undefined };
      p.nodes.push({
        id: nanoid(),
        type: 'chart',
        x: L,
        y: top,
        width: chartW,
        height: chartH,
        title: 'Chart',
        chart: {
          ...spec,
          textSize: spec.textSize ?? 'l',
          series: spec.series.map((s, i) => ({ ...s, color: s.color ?? theme.series[i % theme.series.length] })),
        },
        ...content.chartExtra,
      });
      const x = L + chartW + p.u(96);
      const w = box.x + box.width - p.margin - x;
      const statEnd = content.number !== undefined ? p.text('stat', x, top + p.u(24), w, content.number, PROMPTS.number) : top;
      p.text('subtitle', x, statEnd + p.u(content.number !== undefined ? 32 : 24), w, content.takeaway, PROMPTS.takeaway, { name: 'Takeaway' });
      break;
    }

    case 'closing': {
      const y0 = box.y + p.u(360);
      const end = p.text('title', L, y0, p.u(1400), content.title, PROMPTS.title);
      const subEnd = p.text('subtitle', L, end + p.u(32), p.u(1200), content.subtitle, PROMPTS.subtitle);
      p.rect(L, subEnd + p.u(64), p.u(96), p.u(8), theme.accent, { title: 'Accent' });
      p.text('footer', L, bottom - p.u(32), p.u(1200), content.footer, PROMPTS.footer);
      break;
    }
  }
  return p.nodes;
}

/** A layout slide: the frame first, then what is on it, so the frame owns its contents on creation. */
export function layoutSlide(
  id: LayoutId,
  box: SlideBox,
  theme: DeckTheme,
  name: string,
  content: LayoutContent = {},
  frameExtra: Record<string, unknown> = {}
): NewNodeInput[] {
  return [slideFrame(box, theme, name, frameExtra), ...layoutNodes(id, box, theme, content)];
}
