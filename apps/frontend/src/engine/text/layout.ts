/**
 * Text layout, as arithmetic.
 *
 * ## Why this module exists
 *
 * Text used to be one `Konva.Text` per node, which drew the whole string in a
 * single call and reported one box. That is enough to *show* words and not
 * enough to do anything with them. Three features the specification asks for
 * were all blocked on the same missing thing, and were recorded as "one
 * decision, not three":
 *
 *  - **Paragraph spacing** needs the gap between two paragraphs to differ from
 *    the gap between two lines of one paragraph. A single `lineHeight`
 *    multiplier cannot express that.
 *  - **Per-line decoration** — the rounded background that breaks and clones
 *    around each wrapped line, an outline box, a glow — needs *where each line
 *    is and how wide it is*, which nothing was computing.
 *  - **Vertical alignment and honest bounds** need the content height before
 *    anything is drawn, rather than after asking the renderer what it did.
 *
 * So layout is computed here, once, and the renderer draws the result. The
 * value is the line boxes: everything above becomes a consumer of the same
 * numbers rather than three separate re-measurements that can disagree.
 *
 * ## Why it takes a measurer instead of measuring
 *
 * Glyph advances come from a font, and a font lives in a browser. Passing the
 * measurement in keeps every rule below — wrapping, tracking, alignment,
 * paragraph gaps, ellipsis, vertical placement — runnable in Node and under
 * test, which is the same trade `stickyText` makes for the same reason. The
 * adapter that supplies a real measurer is `engine/text/measure.ts`; it also
 * owns the font-epoch problem, because a layout computed before a webfont
 * arrives is measured against a fallback face and is wrong.
 */

import type { TextAlign, VerticalAlign } from '../model/schema';

/** Advance width of a run at the layout's font, in world units, without tracking. */
export type TextMeasurer = (text: string) => number;

export interface LayoutInput {
  text: string;
  /**
   * `none` lets every line run as long as it likes — the box is as wide as the
   * longest line, which is what an auto-width label means. `word` wraps inside
   * `width`.
   */
  wrap: 'none' | 'word';
  /** The wrapping width. Required by `word`, ignored by `none`. */
  width?: number;
  /**
   * An imposed height, for vertical alignment and for truncation. Absent means
   * the box grows downward and nothing is ever cut.
   */
  height?: number;
  fontSize: number;
  /** Multiplier on `fontSize`, as CSS and Konva both define it. */
  lineHeight: number;
  /** Absolute units added after each character. */
  letterSpacing: number;
  /**
   * Absolute units added *between paragraphs only*, on top of the line
   * advance. This is the field a `lineHeight` alone cannot express, and the
   * reason is worth stating: leading applies within a block of prose, while
   * paragraph spacing separates blocks. Raising `lineHeight` to fake it opens
   * up the lines inside every paragraph as well.
   */
  paragraphSpacing?: number;
  align: TextAlign;
  verticalAlign?: VerticalAlign;
  /** Replace the tail with `…` when an imposed height cannot hold every line. */
  ellipsis?: boolean;
  measure: TextMeasurer;
}

export interface TextLine {
  /** The run as drawn. Never carries the newline that ended it. */
  text: string;
  /** Left edge within the content box, already resolved from `align`. */
  x: number;
  /** Top of this line's box. */
  y: number;
  /** Measured advance, including tracking. */
  width: number;
  /** The line's full advance height — `fontSize * lineHeight`. */
  height: number;
  /**
   * Where the glyphs' baseline sits inside the line box.
   *
   * Leading is distributed evenly above and below the type, which is what CSS
   * and Konva both do. A renderer that drew at `y` instead would ride every
   * line high by half the leading, and the error would grow with `lineHeight`.
   */
  baseline: number;
  /** Which paragraph this line came from, so decoration can group by block. */
  paragraph: number;
  /** True for the last line of its paragraph, which is where the gap is added. */
  endsParagraph: boolean;
  /**
   * Where this line begins in the *source* string.
   *
   * Needed because a wrapped line has no newline behind it — the break was the
   * renderer's decision, not the author's — so there is otherwise no way back
   * from "the third visual line" to an index the editor can put a caret at.
   * Recorded during wrapping, where the answer is known for free, rather than
   * reconstructed afterwards by searching for the line's text: a line that
   * happens to repeat earlier in the paragraph would find the wrong one.
   */
  start: number;
}

export interface TextLayout {
  lines: TextLine[];
  /** The longest line. What an auto-width box takes for its width. */
  width: number;
  /** Total advance of every line plus every paragraph gap. */
  height: number;
  /** True when an imposed height cut something off. */
  truncated: boolean;
}

/** Tracking is added after every character, including the last, as Konva does. */
function advance(run: string, measure: TextMeasurer, letterSpacing: number): number {
  if (run === '') return 0;
  return measure(run) + letterSpacing * run.length;
}

/**
 * Break one paragraph into lines that fit.
 *
 * Greedy, which is what every browser and every canvas library does: take
 * words until the next one would not fit. Knuth–Plass would break more evenly
 * and would also disagree with the `<textarea>` the editor overlays on top,
 * and text that reflows the moment you stop typing is the defect the sticky
 * editor's fit exists to prevent.
 */
function wrapParagraph(
  paragraph: string,
  limit: number,
  measure: TextMeasurer,
  letterSpacing: number
): Array<{ text: string; start: number }> {
  if (paragraph === '') return [{ text: '', start: 0 }];

  const lines: Array<{ text: string; start: number }> = [];
  /** How far into the paragraph the line being built began. */
  let lineStart = 0;
  let consumed = 0;
  // Split on spaces but keep them attached to the word they follow, so a run
  // of several spaces is not silently collapsed into one.
  const words = paragraph.match(/\S+\s*|\s+/g) ?? [paragraph];
  let line = '';

  for (const word of words) {
    const candidate = line + word;
    // `trimEnd` before measuring: trailing spaces hang past the wrap point in
    // every text engine rather than pushing a word onto the next line.
    if (line !== '' && advance(candidate.trimEnd(), measure, letterSpacing) > limit) {
      lines.push({ text: line.trimEnd(), start: lineStart });
      consumed += line.length;
      lineStart = consumed + (word.length - word.trimStart().length);
      line = word.trimStart();
    } else {
      line = candidate;
    }

    // A single word longer than the line has to be broken by character, or it
    // would overhang the box with nothing able to wrap it.
    while (advance(line.trimEnd(), measure, letterSpacing) > limit && line.trim().length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && advance(line.slice(0, cut), measure, letterSpacing) > limit) cut--;
      lines.push({ text: line.slice(0, cut), start: lineStart });
      consumed += cut;
      lineStart = consumed;
      line = line.slice(cut);
    }
  }

  lines.push({ text: line.trimEnd(), start: lineStart });
  return lines;
}

/** Cut a run down until it plus an ellipsis fits, so the mark is inside the box. */
function ellipsize(
  run: string,
  limit: number,
  measure: TextMeasurer,
  letterSpacing: number
): string {
  const mark = '…';
  if (advance(run, measure, letterSpacing) <= limit) return run;
  let cut = run.length;
  while (cut > 0 && advance(run.slice(0, cut) + mark, measure, letterSpacing) > limit) cut--;
  return run.slice(0, cut) + mark;
}

/**
 * Lay text out into positioned lines.
 *
 * Total and never throwing, like everything at this layer: an empty string
 * still produces one line box, because a caret has to have somewhere to sit
 * and an empty paragraph still occupies its own height.
 */
export function layoutText(input: LayoutInput): TextLayout {
  const {
    text,
    wrap,
    width,
    height,
    fontSize,
    lineHeight,
    letterSpacing,
    paragraphSpacing = 0,
    align,
    verticalAlign = 'top',
    ellipsis = false,
    measure,
  } = input;

  const lineAdvance = fontSize * lineHeight;
  // Leading is the difference between the line box and the type in it, split
  // evenly above and below.
  const baseline = (lineAdvance + fontSize) / 2 - fontSize * 0.21;

  // `\r\n` and a lone `\r` are newlines too; a document pasted from Windows or
  // from an old Mac would otherwise render its paragraph breaks as glyphs.
  const paragraphs = text.split(/\r\n|\r|\n/);
  const limit = wrap === 'word' && width && width > 0 ? width : Infinity;

  interface Raw {
    text: string;
    paragraph: number;
    endsParagraph: boolean;
    start: number;
  }
  const raw: Raw[] = [];
  /**
   * Where each paragraph begins in the source, including the newline that
   * ended the one before it — so a line's `start` is an index into the string
   * the editor holds, not into the paragraph it happens to belong to.
   */
  let paragraphStart = 0;
  paragraphs.forEach((paragraph, index) => {
    const wrapped =
      limit === Infinity
        ? [{ text: paragraph, start: 0 }]
        : wrapParagraph(paragraph, limit, measure, letterSpacing);
    wrapped.forEach((line, i) => {
      raw.push({
        text: line.text,
        paragraph: index,
        endsParagraph: i === wrapped.length - 1,
        start: paragraphStart + line.start,
      });
    });
    paragraphStart += paragraph.length + 1;
  });

  // How many lines an imposed height can hold. Floored at one: a box too short
  // for even a single line shows that line clipped rather than showing nothing,
  // which is the more recoverable of the two failures.
  let truncated = false;
  let kept = raw;
  if (height !== undefined && height > 0) {
    const fits = Math.max(1, Math.floor((height + paragraphSpacing) / lineAdvance));
    if (raw.length > fits) {
      kept = raw.slice(0, fits);
      truncated = true;
    }
  }

  const runs = kept.map((line, i) => {
    const isLast = i === kept.length - 1;
    const body = truncated && isLast && ellipsis && limit !== Infinity
      ? ellipsize(line.text, limit, measure, letterSpacing)
      : line.text;
    return { ...line, text: body, width: advance(body, measure, letterSpacing) };
  });

  const contentWidth = runs.reduce((max, r) => Math.max(max, r.width), 0);
  // The box aligns within its declared width where it has one; an auto-width
  // box has no width but its own content, so alignment resolves against that.
  const boxWidth = limit === Infinity ? contentWidth : limit;

  let y = 0;
  const lines: TextLine[] = runs.map((run) => {
    const x =
      align === 'center'
        ? (boxWidth - run.width) / 2
        : align === 'right'
          ? boxWidth - run.width
          : 0;
    const line: TextLine = {
      text: run.text,
      x,
      y,
      width: run.width,
      height: lineAdvance,
      baseline,
      paragraph: run.paragraph,
      start: run.start,
      endsParagraph: run.endsParagraph,
    };
    y += lineAdvance;
    // The gap belongs *after* a paragraph's last line and not after the very
    // last line of all — trailing space below the final line is padding the
    // box never asked for, and it would make the derived height wrong.
    if (run.endsParagraph) y += paragraphSpacing;
    return line;
  });

  // Drop the gap that followed the final paragraph, which the loop above adds
  // unconditionally because it cannot see ahead.
  const last = runs[runs.length - 1];
  const contentHeight = Math.max(0, y - (last?.endsParagraph ? paragraphSpacing : 0));

  // Vertical alignment needs a box taller than the content to have any room to
  // work in; without an imposed height the two are the same and the offset is
  // zero by construction.
  if (height !== undefined && height > contentHeight && verticalAlign !== 'top') {
    const slack = height - contentHeight;
    const shift = verticalAlign === 'middle' ? slack / 2 : slack;
    for (const line of lines) line.y += shift;
  }

  return { lines, width: contentWidth, height: contentHeight, truncated };
}

/**
 * The character offset nearest a point, for placing a caret.
 *
 * ## Why this exists
 *
 * Clicking a text object put the caret wherever the browser felt like — in
 * practice at the start, because the `<textarea>` overlay is focused
 * programmatically and never receives the click that opened it. So editing an
 * existing sentence meant clicking to enter, then clicking again to get to the
 * word you were aiming at the first time.
 *
 * The layout already knows where every line is and where every line begins in
 * the source, so the answer is two searches: which line the y falls in, then
 * how many characters of it fit to the left of the x.
 *
 * Binary search on measured prefixes rather than dividing by an average glyph
 * width — proportional type makes an average wrong by several characters on a
 * line of any length, and being off by three is the difference between landing
 * in a word and landing in the wrong one.
 */
export function caretAt(
  layout: TextLayout,
  point: { x: number; y: number },
  measure: TextMeasurer,
  letterSpacing: number
): number {
  if (layout.lines.length === 0) return 0;

  // Nearest line by vertical distance, clamped — a click above the first line
  // or below the last belongs to that line rather than to nothing.
  let line = layout.lines[0];
  for (const candidate of layout.lines) {
    if (point.y >= candidate.y) line = candidate;
  }

  const local = point.x - line.x;
  if (local <= 0) return line.start;
  if (local >= line.width) return line.start + line.text.length;

  let low = 0;
  let high = line.text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (advance(line.text.slice(0, mid), measure, letterSpacing) < local) low = mid + 1;
    else high = mid;
  }

  // Snap to whichever side of the character the click actually fell on, so a
  // click on the right half of a letter puts the caret after it. Without this
  // the caret always lands before the glyph you clicked, which feels like a
  // one-character lag on every single click.
  const before = advance(line.text.slice(0, Math.max(0, low - 1)), measure, letterSpacing);
  const after = advance(line.text.slice(0, low), measure, letterSpacing);
  const offset = local - before < after - local ? Math.max(0, low - 1) : low;
  return line.start + offset;
}
