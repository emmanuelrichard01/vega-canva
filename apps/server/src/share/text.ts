import fs from 'fs';
import path from 'path';
import * as fontkit from 'fontkit';

/**
 * Type, as vector outlines.
 *
 * A share card is rasterised on a server that has no fonts installed, and the
 * one thing it must get right is the board's name. Rather than hand the
 * rasteriser a font and hope its shaping matches, the words are laid out here
 * with fontkit — kerning included — and emitted as `<path>` outlines. The
 * picture then depends on nothing but geometry, renders identically on any
 * machine, and a name full of angle brackets is just more glyphs: there is no
 * text node in the SVG for it to break out of.
 *
 * ## Inter, in three subsets
 *
 * The typeface the app's interface is set in, so a card and the product agree.
 * Static weights rather than the variable file, because fontkit cannot lay out
 * a variation instance of a WOFF2 font. And three subsets, not just Latin: a
 * board called "Planiranje sprinta — čćšžđ" or "Дорожная карта" is ordinary,
 * and a card that silently drops half its letters is worse than no card. Each
 * character is set in the first subset that has it; anything none of them has
 * (emoji, CJK) is left out rather than drawn as a box.
 */

export type Weight = 400 | 600 | 700;
const SUBSETS = ['latin', 'latin-ext', 'cyrillic'] as const;
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const loaded = new Map<Weight, fontkit.Font[]>();

function fontsAt(weight: Weight): fontkit.Font[] {
  let fonts = loaded.get(weight);
  if (!fonts) {
    fonts = SUBSETS.map((subset) => {
      const opened = fontkit.create(fs.readFileSync(path.join(FONT_DIR, `Inter-${weight}-${subset}.woff`)));
      return ('fonts' in opened ? opened.fonts[0] : opened) as fontkit.Font;
    });
    loaded.set(weight, fonts);
  }
  return fonts;
}

export interface TextStyle {
  size: number;
  weight?: Weight;
  /** In em, like CSS `letter-spacing: 0.02em`. */
  tracking?: number;
}

interface Placed {
  glyph: fontkit.Glyph;
  x: number;
  y: number;
  scale: number;
}

/**
 * Lay a string out across the subsets.
 *
 * Runs of characters that share a subset are shaped together, so kerning
 * holds within a word; a boundary between subsets is rare enough (a Serbian
 * diacritic in a Latin word) that losing one kerning pair there is invisible.
 */
function layout(text: string, style: TextStyle): { placed: Placed[]; width: number } {
  const fonts = fontsAt(style.weight ?? 400);
  const tracking = (style.tracking ?? 0) * style.size;
  const runs: Array<{ font: fontkit.Font; text: string }> = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const font = fonts.find((f) => f.hasGlyphForCodePoint(code));
    if (!font) continue;
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += ch;
    else runs.push({ font, text: ch });
  }

  const placed: Placed[] = [];
  let cursor = 0;
  let count = 0;
  for (const run of runs) {
    const scale = style.size / run.font.unitsPerEm;
    const shaped = run.font.layout(run.text);
    shaped.glyphs.forEach((glyph, i) => {
      const p = shaped.positions[i];
      placed.push({ glyph, x: cursor + p.xOffset * scale, y: -p.yOffset * scale, scale });
      cursor += p.xAdvance * scale + tracking;
      count++;
    });
  }
  return { placed, width: count ? cursor - tracking : 0 };
}

/** How wide a run of text sets, in pixels. */
export function measure(text: string, style: TextStyle): number {
  return layout(text, style).width;
}

/**
 * A line of text as one `<path>`, with its baseline at `y`.
 *
 * `align` places the run by its start, centre or end, which is what SVG's
 * `text-anchor` would have done.
 */
export function textPath(
  text: string,
  x: number,
  y: number,
  style: TextStyle & { fill: string; align?: 'start' | 'middle' | 'end'; opacity?: number }
): string {
  if (!text) return '';
  const { placed, width } = layout(text, style);
  const left = style.align === 'middle' ? x - width / 2 : style.align === 'end' ? x - width : x;
  const d = placed
    .map((g) => g.glyph.path.scale(g.scale, -g.scale).translate(left + g.x, y + g.y).toSVG())
    .filter(Boolean)
    .join('');
  if (!d) return '';
  const opacity = style.opacity !== undefined && style.opacity < 1 ? ` fill-opacity="${style.opacity}"` : '';
  return `<path d="${d}" fill="${style.fill}"${opacity}/>`;
}

/**
 * Break text into at most `maxLines` lines no wider than `width`.
 *
 * Greedy, by word, which is what every card on the web does. A word longer
 * than a whole line — a pasted URL, a long compound — is broken by character
 * rather than left to run off the card. When there was more to say than fits,
 * the last line closes with an ellipsis.
 */
export function wrap(text: string, width: number, style: TextStyle, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  const fits = (s: string) => measure(s, style) <= width;
  let line = '';
  let i = 0;

  while (i < words.length && lines.length < maxLines) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (fits(candidate)) {
      line = candidate;
      i++;
    } else if (line) {
      lines.push(line);
      line = '';
    } else {
      const chars = Array.from(words[i]);
      let cut = chars.length - 1;
      while (cut > 1 && !fits(chars.slice(0, cut).join(''))) cut--;
      lines.push(chars.slice(0, cut).join(''));
      words[i] = chars.slice(cut).join('');
    }
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
    line = '';
  }

  if ((i < words.length || line) && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[\s,.;:–—-]+$/, '')}…`;
  }
  return lines;
}
