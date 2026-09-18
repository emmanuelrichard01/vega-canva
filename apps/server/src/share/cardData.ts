/**
 * What a board says about itself when its link is shared.
 *
 * A board's name and a silhouette of its contents, uploaded by the board as
 * people work on it — the same summary the dashboard draws each board's cover
 * from (`boardPreview.ts` in the frontend). Link unfurlers (Slack, iMessage, X,
 * LinkedIn, Teams, Discord) read it to show the board rather than a generic
 * logo, which is what FigJam and Miro links do.
 *
 * ## Everything arrives from a client, so everything is re-checked
 *
 * The preview is drawn into an SVG on this server. A colour of
 * `red"/><script>` or a coordinate of `1e308` would either break out of an
 * attribute or wreck the render, so every field is rebuilt here from a strict
 * reading of the input — never spread, never passed through — and what comes
 * out is numbers in known ranges, a closed set of flags and colours that
 * matched a CSS colour grammar. The name is drawn as glyph outlines and
 * escaped wherever it reaches HTML.
 */

export interface CardItem {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
  r?: number;
  o?: 1;
  l?: number[];
  t?: 1;
  fs?: number;
  k?: 1;
  s?: 'polygon' | 'star' | 'line';
  p?: number;
  ir?: number;
  rot?: number;
  no?: 1;
}

export interface CardPreview {
  ratio: number;
  total: number;
  items: CardItem[];
}

export interface BoardCard {
  name: string;
  /** The board asked not to be previewed: unfurls show a generic card. */
  hidden: boolean;
  preview: CardPreview | null;
}

export const MAX_CARD_ITEMS = 170;
const MAX_LINE_NUMBERS = 200;
export const MAX_NAME = 120;
const FALLBACK_COLOR = '#94A3B8';

const COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.round(Math.min(max, Math.max(min, v)) * 1000) / 1000;
}

/**
 * Controls, zero-width marks and bidirectional overrides.
 *
 * The last are the ones that matter: a name carrying U+202E renders the rest
 * of itself backwards, which is a way to make a card read as something the
 * board is not. Spelled as numbers, not as a character class, so the source
 * holds no raw control bytes.
 */
function invisible(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return Array.from(v, (ch) => (invisible(ch.codePointAt(0)!) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

function color(v: unknown): string {
  return typeof v === 'string' && v.length <= 60 && COLOR.test(v.trim()) ? v.trim() : FALLBACK_COLOR;
}

function item(raw: unknown): CardItem | null {
  if (!isObj(raw)) return null;
  const x = num(raw.x, -1, 2);
  const y = num(raw.y, -1, 2);
  const w = num(raw.w, 0, 3);
  const h = num(raw.h, 0, 3);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;

  const out: CardItem = { x, y, w, h, c: color(raw.c) };
  const r = num(raw.r, 0, 0.5);
  if (r) out.r = r;
  if (raw.o === 1) out.o = 1;
  if (raw.t === 1) out.t = 1;
  if (raw.k === 1) out.k = 1;
  if (raw.no === 1) out.no = 1;
  const fs = num(raw.fs, 0, 1);
  if (fs) out.fs = fs;
  if (raw.s === 'polygon' || raw.s === 'star' || raw.s === 'line') out.s = raw.s;
  const p = num(raw.p, 3, 64);
  if (p !== undefined) out.p = Math.round(p);
  const ir = num(raw.ir, 0.05, 0.95);
  if (ir !== undefined) out.ir = ir;
  const rot = num(raw.rot, -360, 360);
  if (rot) out.rot = rot;
  if (Array.isArray(raw.l)) {
    const l: number[] = [];
    for (const v of raw.l.slice(0, MAX_LINE_NUMBERS)) {
      const n = num(v, -1, 2);
      if (n === undefined) break;
      l.push(n);
    }
    if (l.length >= 4) out.l = l.length % 2 ? l.slice(0, -1) : l;
  }
  return out;
}

export function normalizePreview(raw: unknown): CardPreview | null {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const ratio = num(raw.ratio, 0.02, 50);
  if (ratio === undefined) return null;
  const items = raw.items.slice(0, MAX_CARD_ITEMS).map(item).filter((i): i is CardItem => i !== null);
  const total = num(raw.total, 0, 10_000_000);
  return { ratio, items, total: Math.round(total ?? items.length) };
}

/** A card upload, rebuilt field by field. `null` when it is not one. */
export function normalizeCard(raw: unknown): BoardCard | null {
  if (!isObj(raw)) return null;
  const hidden = raw.hidden === true;
  return {
    name: hidden ? '' : cleanName(raw.name),
    hidden,
    preview: hidden ? null : normalizePreview(raw.preview),
  };
}

/** The line under a board's name: what is on it, in words. */
export function describeContents(preview: CardPreview | null): string {
  const total = preview?.total ?? 0;
  if (total === 0) return 'An empty board, ready to draw on';
  return `${total.toLocaleString('en-US')} object${total === 1 ? '' : 's'} on the board`;
}
