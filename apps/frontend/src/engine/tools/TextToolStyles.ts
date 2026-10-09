import { DEFAULT_TYPOGRAPHY, type Typography } from '../model/schema';
import { storageGet, storageSet } from '../../utils/safeStorage';

/**
 * Text styles: the five sizes a board's words come in, and the one the next
 * text box is made in.
 *
 * ## Why styles rather than a size field
 *
 * A board's text is a hierarchy, not a number: a title, a few headings, notes
 * under them, the odd caption. Asking for "24" makes everybody invent the
 * scale on the spot, so two people on one board end up with 22, 24, 26 and 28
 * where they meant "a heading" each time. Figma's text styles and FigJam's
 * size steps answer the same way: name the step, and the numbers follow.
 *
 * Each style is a size, a weight, a line height and a tracking, tuned
 * together: display sizes set tighter and with shorter lines, small sizes
 * looser. Body is the document default, so every existing text box already
 * reads as Body.
 *
 * ## The next text box
 *
 * The text tool makes its box in the remembered style and face. Picking a
 * style anywhere (the Text seat's menu, the shelf, the rail) is remembered,
 * which is what "the tool remembers how I was writing" means in FigJam.
 */

export const TEXT_STYLE_IDS = ['title', 'heading', 'subheading', 'body', 'caption'] as const;
export type TextStyleId = (typeof TEXT_STYLE_IDS)[number];

export interface TextStyle {
  id: TextStyleId;
  label: string;
  /** What the style is for, in a few words. */
  hint: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  /** In px, as `Typography.letterSpacing`. */
  letterSpacing: number;
}

export const TEXT_STYLES: Readonly<Record<TextStyleId, TextStyle>> = {
  title: { id: 'title', label: 'Title', hint: 'The board’s name, once', fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.25 },
  heading: { id: 'heading', label: 'Heading', hint: 'A section or a column', fontSize: 40, fontWeight: 700, lineHeight: 1.2, letterSpacing: -0.5 },
  subheading: { id: 'subheading', label: 'Subheading', hint: 'A group inside a section', fontSize: 28, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.2 },
  body: { id: 'body', label: 'Body', hint: 'Notes and paragraphs', fontSize: DEFAULT_TYPOGRAPHY.fontSize, fontWeight: 400, lineHeight: DEFAULT_TYPOGRAPHY.lineHeight, letterSpacing: 0 },
  caption: { id: 'caption', label: 'Caption', hint: 'Labels and small print', fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0.1 },
};

/** The two faces the text tool offers outright: typed, and drawn by hand. */
export const TEXT_FACES = {
  sans: { label: 'Typed', family: 'Inter' },
  hand: { label: 'Handwritten', family: 'Caveat' },
} as const;
export type TextFace = keyof typeof TEXT_FACES;

/** The typography a style sets, leaving family, colour and everything else alone. */
export function stylePatch(id: TextStyleId): Pick<Typography, 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing'> {
  const s = TEXT_STYLES[id];
  return { fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing };
}

/**
 * Which style a block of text is in, or null when it is in none.
 *
 * Read from size and weight only: those are what a reader sees as "a heading".
 * Line height and tracking are refinements somebody may have nudged without
 * meaning to leave the style.
 */
export function styleOf(t: Pick<Typography, 'fontSize' | 'fontWeight'>): TextStyleId | null {
  for (const id of TEXT_STYLE_IDS) {
    const s = TEXT_STYLES[id];
    if (s.fontSize === t.fontSize && s.fontWeight === t.fontWeight) return id;
  }
  return null;
}

/** The face a family belongs to, when it is one of the two. */
export function faceOf(family: string): TextFace | null {
  if (family === TEXT_FACES.sans.family) return 'sans';
  if (family === TEXT_FACES.hand.family) return 'hand';
  return null;
}

// ---------------------------------------------------------------------------
// What the next text box is made in
// ---------------------------------------------------------------------------

export interface NextText {
  style: TextStyleId;
  face: TextFace;
}

const KEY = 'vega_text_tool_style';
const FALLBACK: NextText = { style: 'body', face: 'sans' };

/** A stored value, made safe: anything unrecognised falls back field by field. */
export function readNextText(raw: string | null): NextText {
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<NextText>) : {};
    return {
      style: (TEXT_STYLE_IDS as readonly string[]).includes(parsed.style as string) ? (parsed.style as TextStyleId) : FALLBACK.style,
      face: parsed.face === 'sans' || parsed.face === 'hand' ? parsed.face : FALLBACK.face,
    };
  } catch {
    return { ...FALLBACK };
  }
}

let current: NextText = readNextText(storageGet(KEY));
const listeners = new Set<() => void>();

export const nextText = {
  get: (): NextText => current,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(patch: Partial<NextText>): void {
    const next = { ...current, ...patch };
    if (next.style === current.style && next.face === current.face) return;
    current = next;
    storageSet(KEY, JSON.stringify(current));
    listeners.forEach((fn) => fn());
  },
};

/** The typography the text tool gives a new box: the defaults, in the remembered style and face. */
export function typographyForNextText(base: Typography, next: NextText = current): Typography {
  return { ...base, ...stylePatch(next.style), fontFamily: TEXT_FACES[next.face].family };
}
