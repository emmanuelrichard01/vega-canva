/**
 * What a sticky note says, as styled runs laid out in lines.
 *
 * A note's text is stored as plain text and always will be: the editor is a
 * textarea, a copy pastes anywhere, and an older client shows it as written.
 * On the canvas that text is read for three light conventions —
 *
 * - `**bold**` and `*italic*` (or `_italic_`), markdown-lite;
 * - links, found rather than marked up (`https://…`, `www.…`);
 * - checklist lines, `[ ] ` to do and `[x] ` done, or every line when the
 *   note is in checklist mode.
 *
 * — and laid out here, because one `Konva.Text` cannot style part of itself.
 * The layout is pure and the measuring is injected, like `stickyText`: the
 * policy needs no canvas and the tests drive it with arithmetic.
 *
 * ## Balanced lines
 *
 * A note is centred, and a centred paragraph broken greedily ends in a short
 * orphan line ("…the whole / team"). Each paragraph is re-wrapped at the
 * narrowest width that keeps its line count — what CSS calls
 * `text-wrap: balance` — so the lines come out near-equal and the block
 * reads as composed.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** A safe, absolute http(s) URL. */
  href?: string;
}

export type Check = 'todo' | 'done';

export interface Paragraph {
  runs: Run[];
  check?: Check;
  /** Index of the source line, for toggling a checkbox back into the text. */
  source: number;
}

const CHECK_PREFIX = /^\s*(?:[-*]\s+)?\[( |x|X)\]\s?/;
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}'"»”’]+$/;

/** A detected link's target, or null if it is not one we will open. */
export function safeHref(raw: string): string | null {
  const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Split a line into bold/italic runs. Unclosed markers are left as typed. */
function parseEmphasis(line: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*([^*\n]+?)\*\*|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/g;
  let at = 0;
  for (const m of line.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) runs.push({ text: line.slice(at, i) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2] ?? m[3], italic: true });
    at = i + m[0].length;
  }
  if (at < line.length) runs.push({ text: line.slice(at) });
  return runs;
}

/** Cut links out of runs, keeping each run's emphasis. */
function linkify(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    let at = 0;
    for (const m of run.text.matchAll(LINK)) {
      const i = m.index ?? 0;
      const raw = m[0].replace(TRAILING, '');
      const href = safeHref(raw);
      if (!href) continue;
      if (i > at) out.push({ ...run, text: run.text.slice(at, i) });
      out.push({ ...run, text: raw, href });
      at = i + raw.length;
    }
    if (at < run.text.length) out.push({ ...run, text: run.text.slice(at) });
  }
  return out;
}

/** Whether the text uses anything beyond plain words, so the caller can keep the plain path. */
export function hasRichMarkup(text: string): boolean {
  if (/\*\*[^*\n]+\*\*|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?<![\w_])_[^_\s][^_\n]*_(?![\w_])/.test(text)) return true;
  LINK.lastIndex = 0;
  if (LINK.test(text)) return true;
  return text.split('\n').some((l) => CHECK_PREFIX.test(l));
}

export function parseSticky(text: string, opts: { checklist?: boolean } = {}): Paragraph[] {
  return text.split('\n').map((line, source) => {
    const marker = CHECK_PREFIX.exec(line);
    let check: Check | undefined;
    let body = line;
    if (marker) {
      check = marker[1] === ' ' ? 'todo' : 'done';
      body = line.slice(marker[0].length);
    } else if (opts.checklist && line.trim()) {
      check = 'todo';
    }
    return { runs: linkify(parseEmphasis(body)), check, source };
  });
}

/**
 * Tick or untick the checklist item on `source` line, as a text edit.
 * A line with no marker gains one, so checklist mode needs nothing stored.
 */
export function toggleCheck(text: string, source: number): string {
  const lines = text.split('\n');
  const line = lines[source];
  if (line === undefined) return text;
  const marker = CHECK_PREFIX.exec(line);
  if (marker) {
    const done = marker[1] !== ' ';
    lines[source] = (done ? '[ ] ' : '[x] ') + line.slice(marker[0].length);
  } else {
    lines[source] = `[x] ${line}`;
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- layout

export interface LaidRun extends Run {
  x: number;
  width: number;
}

export interface LaidLine {
  y: number;
  /** Left edge of the line's content, after alignment and any checkbox. */
  x: number;
  width: number;
  runs: LaidRun[];
  /** On the first line of a checklist item only. */
  check?: Check;
  /** Every line of a checklist item, so a done item is struck through whole. */
  done?: boolean;
  source: number;
}

export interface StickyLayout {
  lines: LaidLine[];
  height: number;
  /** A word wider than the box had to be broken mid-word. */
  brokeWord: boolean;
}

/** Width of `text` at `size`, in the given emphasis. */
export type MeasureRun = (text: string, size: number, bold: boolean, italic: boolean) => number;

export interface LayoutOptions {
  width: number;
  size: number;
  lineHeight: number;
  measure: MeasureRun;
  align: 'center' | 'left';
  balance: boolean;
}

/** Checkbox size and the gap after it, as fractions of the font size. */
export const CHECK_BOX = 0.62;
export const CHECK_GAP = 0.42;

interface Token {
  text: string;
  run: Run;
  space: boolean;
}

function tokens(runs: Run[]): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      const space = /^\s+$/.test(part);
      // A link is one unbreakable token even though it has no spaces to split on.
      out.push({ text: space ? ' ' : part, run, space });
    }
  }
  return out;
}

interface WrapLine {
  parts: Array<{ text: string; run: Run; width: number }>;
  width: number;
}

/** Greedy wrap of one paragraph at `width`. */
function wrap(toks: Token[], width: number, size: number, measure: MeasureRun): { lines: WrapLine[]; brokeWord: boolean } {
  const lines: WrapLine[] = [];
  let line: WrapLine = { parts: [], width: 0 };
  let brokeWord = false;
  const w = (t: string, r: Run) => measure(t, size, Boolean(r.bold), Boolean(r.italic));
  const push = () => {
    // Trailing spaces take no room at a line end.
    while (line.parts.length && /^\s+$/.test(line.parts[line.parts.length - 1].text)) {
      line.width -= line.parts.pop()!.width;
    }
    lines.push(line);
    line = { parts: [], width: 0 };
  };

  for (const tok of toks) {
    if (tok.space) {
      if (line.parts.length === 0) continue;
      const sw = w(' ', tok.run);
      line.parts.push({ text: ' ', run: tok.run, width: sw });
      line.width += sw;
      continue;
    }
    const tw = w(tok.text, tok.run);
    if (line.parts.length && line.width + tw > width + 0.01) push();
    if (tw <= width + 0.01) {
      line.parts.push({ text: tok.text, run: tok.run, width: tw });
      line.width += tw;
      continue;
    }
    // Longer than a whole line: break it by characters, filling each line.
    brokeWord = true;
    let rest = tok.text;
    while (rest) {
      // The longest prefix that fits what is left of the line, by bisection.
      let lo = 1;
      let hi = rest.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (w(rest.slice(0, mid), tok.run) <= width - line.width + 0.01) lo = mid;
        else hi = mid - 1;
      }
      const n = lo;
      const piece = rest.slice(0, n);
      const pw = w(piece, tok.run);
      line.parts.push({ text: piece, run: tok.run, width: pw });
      line.width += pw;
      rest = rest.slice(n);
      if (rest) push();
    }
  }
  if (line.parts.length || lines.length === 0) push();
  return { lines, brokeWord };
}

/** Merge neighbouring parts of the same run, so a line draws as few `Text`s as it can. */
function merge(parts: WrapLine['parts']): Array<{ text: string; run: Run; width: number; x: number }> {
  const out: Array<{ text: string; run: Run; width: number; x: number }> = [];
  let x = 0;
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.run === p.run) {
      last.text += p.text;
      last.width += p.width;
    } else {
      out.push({ ...p, x });
    }
    x += p.width;
  }
  return out;
}

/**
 * The narrowest width at which `toks` still wraps to `count` lines.
 * Binary search: line count only grows as the width shrinks.
 */
function balancedWidth(toks: Token[], width: number, count: number, size: number, measure: MeasureRun): number {
  if (count < 2) return width;
  let lo = width * 0.5;
  let hi = width;
  for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    const r = wrap(toks, mid, size, measure);
    if (r.lines.length <= count && !r.brokeWord) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function layoutSticky(paragraphs: Paragraph[], opts: LayoutOptions): StickyLayout {
  const { width, size, lineHeight, measure, align } = opts;
  const lh = size * lineHeight;
  const indent = size * (CHECK_BOX + CHECK_GAP);
  const lines: LaidLine[] = [];
  let y = 0;
  let brokeWord = false;

  for (const p of paragraphs) {
    const avail = Math.max(1, width - (p.check ? indent : 0));
    const toks = tokens(p.runs);
    let result = wrap(toks, avail, size, measure);
    if (opts.balance && !p.check && result.lines.length > 1 && !result.brokeWord) {
      const narrow = balancedWidth(toks, avail, result.lines.length, size, measure);
      result = wrap(toks, narrow, size, measure);
    }
    brokeWord ||= result.brokeWord;
    result.lines.forEach((l, i) => {
      const contentWidth = l.width + (p.check ? indent : 0);
      const left = align === 'center' ? (width - contentWidth) / 2 : 0;
      lines.push({
        y,
        x: left + (p.check ? indent : 0),
        width: l.width,
        runs: merge(l.parts).map((m) => ({ ...m.run, text: m.text, x: m.x, width: m.width })),
        check: i === 0 ? p.check : undefined,
        done: p.check === 'done' || undefined,
        source: p.source,
      });
      y += lh;
    });
  }

  return { lines, height: y, brokeWord };
}

/**
 * The largest size in [min, max] at which the layout fits `height` without
 * breaking a word, or `min` when nothing does. Monotonic, so binary search.
 */
export function fitRich(
  paragraphs: Paragraph[],
  box: { width: number; height: number },
  opts: Omit<LayoutOptions, 'width' | 'size' | 'balance'>,
  min: number,
  max: number
): number {
  let lo = min;
  let hi = Math.max(min, Math.round(max));
  let best = min;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const l = layoutSticky(paragraphs, { ...opts, width: box.width, size: mid, balance: false });
    if (l.height <= box.height && !l.brokeWord) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
