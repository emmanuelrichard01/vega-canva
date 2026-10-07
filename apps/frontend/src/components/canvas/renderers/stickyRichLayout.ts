import { fontEpoch, onFontsChanged, requestFont } from '../../../engine/text/fontEpoch';
import { STICKY_LINE_HEIGHT, STICKY_MAX_FONT, STICKY_MIN_FONT } from '../../../engine/model/stickyText';
import {
  fitRich,
  hasRichMarkup,
  layoutSticky,
  parseSticky,
  type StickyLayout,
} from '../../../engine/model/stickyRich';
import { stickyFit, STICKY_FONT_FAMILY, STICKY_FONT_WEIGHT } from './stickyFit';

/**
 * A sticky note's writing, sized and laid out for the canvas.
 *
 * Two paths, chosen so the editor overlay and the canvas never disagree about
 * the one thing the overlay can see — the size:
 *
 * - **Plain text in auto mode** (the common case) is sized by `stickyFit`,
 *   the same Konva-measured search the editor overlay uses, so the words do
 *   not change size when you stop typing. The lines are then balanced.
 * - **Formatted text** (bold, italic, links, checklists) is sized by its own
 *   layout, because the markers the editor shows are not drawn here and a
 *   checkbox takes room the raw text does not.
 *
 * A fixed size is used as given, and reports overflow rather than shrinking.
 */

/** Konva's own font shorthand, so measuring here and drawing there agree to the pixel. */
export function stickyFontStyle(bold: boolean, italic: boolean): string {
  const weight = bold ? '700' : STICKY_FONT_WEIGHT;
  return italic ? `italic ${weight}` : weight;
}

let ctx: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();
const WIDTH_LIMIT = 8000;

function measure(text: string, size: number, bold: boolean, italic: boolean): number {
  const key = `${size}|${bold ? 1 : 0}${italic ? 1 : 0}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  ctx ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  let w = text.length * size * 0.45;
  if (ctx) {
    ctx.font = `${stickyFontStyle(bold, italic)} normal ${size}px ${STICKY_FONT_FAMILY}`;
    w = ctx.measureText(text).width;
  }
  if (widths.size >= WIDTH_LIMIT) widths.clear();
  widths.set(key, w);
  return w;
}

export interface StickyText {
  fontSize: number;
  layout: StickyLayout;
  /** Some of the writing does not fit and is not drawn. */
  overflows: boolean;
}

const cache = new Map<string, StickyText>();
const CACHE_LIMIT = 2000;

onFontsChanged(() => {
  cache.clear();
  widths.clear();
});
requestFont(`700 16px ${STICKY_FONT_FAMILY}`);

export const FIXED_MIN = 10;
export const FIXED_MAX = 96;

export function stickyText(
  text: string,
  box: { width: number; height: number },
  opts: { fixedSize?: number; checklist?: boolean }
): StickyText {
  const fixed = opts.fixedSize !== undefined ? Math.max(FIXED_MIN, Math.min(FIXED_MAX, opts.fixedSize)) : undefined;
  const key = `${fontEpoch.get()}|${box.width}|${box.height}|${fixed ?? 'a'}|${opts.checklist ? 1 : 0}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const checklist = Boolean(opts.checklist);
  const paragraphs = parseSticky(text, { checklist });
  const isList = paragraphs.some((p) => p.check);
  const base = { lineHeight: STICKY_LINE_HEIGHT, measure, align: isList ? ('left' as const) : ('center' as const) };

  let size: number;
  if (fixed !== undefined) size = fixed;
  else if (!checklist && !hasRichMarkup(text)) size = stickyFit(text, box.width, box.height).fontSize;
  else size = fitRich(paragraphs, box, base, STICKY_MIN_FONT, STICKY_MAX_FONT);

  let layout = layoutSticky(paragraphs, { ...base, width: box.width, size, balance: !isList });
  // Konva and this layout can differ by a hair on a line break; never let
  // that push the last line out of an auto-sized note.
  while (fixed === undefined && layout.height > box.height && size > STICKY_MIN_FONT) {
    size -= 1;
    layout = layoutSticky(paragraphs, { ...base, width: box.width, size, balance: !isList });
  }

  const result: StickyText = { fontSize: size, layout, overflows: layout.height > box.height + 0.5 };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}
