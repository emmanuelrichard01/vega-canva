import { tokenize, type Token } from './codeTokenize';
import type { CodeSpec } from './codeTypes';
import { languageById } from './codeLanguages';

/**
 * Where everything in a code block goes, at a width.
 *
 * Shared by the canvas renderer, the in-place editor and the SVG exporter,
 * because the one thing a code block must never do is reflow when it opens for
 * editing: the text under the caret has to be the text that was under the
 * pointer. So the metrics — line height, gutter, padding, where a long line
 * wraps — are worked out here once, in world units, from the font size.
 *
 * Wrapping is by column, not by word. Code is monospaced and a wrapped line is
 * a continuation rather than a new sentence; breaking at a fixed column keeps
 * the continuation lined up under its start, which is what every editor does.
 */

export interface CodeMetrics {
  fontSize: number;
  lineHeight: number;
  headerHeight: number;
  padX: number;
  padY: number;
  gutterWidth: number;
  charWidth: number;
  footerHeight: number;
}

export interface VisualLine {
  /** 1-based logical line this row belongs to. */
  lineNumber: number;
  /** The first row of its logical line gets the number in the gutter. */
  first: boolean;
  tokens: Token[];
  y: number;
  highlighted: boolean;
}

export interface CodeLayout {
  metrics: CodeMetrics;
  rows: VisualLine[];
  /** Logical lines in the source. */
  lineCount: number;
  /** Logical lines folded away by `maxLines`. */
  hidden: number;
  /** Columns per row, when wrapping. */
  columns: number;
  height: number;
  contentTop: number;
  codeLeft: number;
}

/** A monospace character is about 0.6em across in every stack this app uses. */
export const MONO_RATIO = 0.6;

export function codeMetrics(spec: CodeSpec, lineCount: number, charWidth = spec.fontSize * MONO_RATIO): CodeMetrics {
  const fs = spec.fontSize;
  const digits = String(Math.max(1, lineCount)).length;
  return {
    fontSize: fs,
    lineHeight: Math.round(fs * 1.6),
    headerHeight: Math.round(Math.max(30, fs * 2.5)),
    padX: Math.round(fs * 1.15),
    padY: Math.round(fs * 0.85),
    gutterWidth: spec.lineNumbers ? Math.round(Math.max(2, digits) * charWidth + fs * 1.4) : 0,
    charWidth,
    footerHeight: Math.round(fs * 2.4),
  };
}

function sliceTokens(tokens: Token[], from: number, to: number): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const t of tokens) {
    const start = at;
    const end = at + t.text.length;
    at = end;
    if (end <= from || start >= to) continue;
    out.push({ kind: t.kind, text: t.text.slice(Math.max(0, from - start), Math.min(t.text.length, to - start)) });
  }
  return out;
}

/**
 * Break a logical line of tokens into visual rows that fit within `columns`.
 *
 * Rather than chopping mid-word at column boundaries, wrapping is token- and
 * word-boundary aware:
 * 1. Prefer breaking after whitespace (spaces, tabs) at or before `columns`.
 * 2. If no whitespace exists in the available span, break after punctuation or
 *    operators (`,`, `;`, `(`, `)`, `[`, `]`, `{`, `}`, `.`, `=`, etc.).
 * 3. Fall back to column boundary only when an unbroken token/URL exceeds the column limit.
 */
export function wrapTokens(tokens: Token[], columns: number): Token[][] {
  const length = tokens.reduce((n, t) => n + t.text.length, 0);
  if (length <= columns) return [tokens];

  const fullText = tokens.map((t) => t.text).join('');
  const out: Token[][] = [];
  let start = 0;

  while (start < fullText.length) {
    if (fullText.length - start <= columns) {
      out.push(sliceTokens(tokens, start, fullText.length));
      break;
    }

    const maxEnd = start + columns;
    let breakAt = -1;

    // 1. Look for whitespace boundary in (start, maxEnd]
    if (fullText[maxEnd] === ' ') {
      breakAt = maxEnd + 1;
    } else {
      for (let i = maxEnd - 1; i > start; i--) {
        if (fullText[i] === ' ' || fullText[i] === '\t') {
          if (i - start >= Math.min(6, Math.floor(columns * 0.25))) {
            breakAt = i + 1;
            break;
          }
        }
      }
    }

    // 2. If no whitespace break, check for punctuation / delimiter / operator
    if (breakAt === -1) {
      const PUNCT_BREAKS = new Set([',', ';', '(', ')', '[', ']', '{', '}', '.', '=', '+', '-', '*', '/', '&', '|', ':', '?', '!']);
      for (let i = maxEnd - 1; i > start; i--) {
        if (PUNCT_BREAKS.has(fullText[i])) {
          if (i - start >= Math.min(8, Math.floor(columns * 0.35))) {
            breakAt = i + 1;
            break;
          }
        }
      }
    }

    // 3. Fallback: hard break at columns
    if (breakAt === -1 || breakAt <= start || breakAt > maxEnd + 1) {
      breakAt = maxEnd;
    }

    out.push(sliceTokens(tokens, start, breakAt));
    start = breakAt;
  }

  return out.length > 0 ? out : [tokens];
}

export function layoutCode(spec: CodeSpec, width: number, charWidth?: number): CodeLayout {
  const lines = tokenize(spec.source, languageById(spec.language).id);
  const metrics = codeMetrics(spec, lines.length, charWidth);
  const codeLeft = metrics.padX + metrics.gutterWidth;
  const room = Math.max(metrics.charWidth * 8, width - codeLeft - metrics.padX);
  const columns = Math.max(8, Math.floor(room / metrics.charWidth));
  const highlighted = new Set(spec.highlights);

  const shown = spec.maxLines ? Math.min(lines.length, spec.maxLines) : lines.length;
  const hidden = lines.length - shown;
  const contentTop = metrics.headerHeight + metrics.padY;

  const rows: VisualLine[] = [];
  let y = contentTop;
  for (let i = 0; i < shown; i++) {
    const tokens = lines[i];
    const visualChunks = spec.wrap ? wrapTokens(tokens, columns) : [tokens];
    for (let c = 0; c < visualChunks.length; c++) {
      rows.push({
        lineNumber: i + 1,
        first: c === 0,
        tokens: visualChunks[c],
        y,
        highlighted: highlighted.has(i + 1),
      });
      y += metrics.lineHeight;
    }
  }

  const height = y + metrics.padY + (hidden > 0 ? metrics.footerHeight : 0);
  return { metrics, rows, lineCount: lines.length, hidden, columns, height: Math.round(height), contentTop, codeLeft };
}

/** The widest logical line, for "fit width" and for sizing a new block to its code. */
export function naturalCodeWidth(spec: CodeSpec, charWidth = spec.fontSize * MONO_RATIO): number {
  const lines = spec.source.replace(/\t/g, '  ').split('\n');
  const longest = Math.max(12, ...lines.map((l) => l.length));
  const m = codeMetrics(spec, lines.length, charWidth);
  return Math.round(m.padX * 2 + m.gutterWidth + longest * charWidth);
}

/** The number of the logical line under a world-space y inside the block. */
export function lineAtY(layout: CodeLayout, y: number): number | null {
  const row = layout.rows.find((r) => y >= r.y && y < r.y + layout.metrics.lineHeight);
  return row ? row.lineNumber : null;
}

/**
 * Measured once per font size, where a canvas exists.
 *
 * The 0.6 ratio is right for the monospace faces this stack reaches, but "about
 * right" drifts by a column in a long line, and a drifted column is a caret
 * that sits one letter off in the editor. So the renderer and the editor ask the
 * browser, and share the answer through this cache.
 */
const widthCache = new Map<number, number>();

export function measureCharWidth(fontSize: number, font: string): number {
  const hit = widthCache.get(fontSize);
  if (hit) return hit;
  let width = fontSize * MONO_RATIO;
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `${fontSize}px ${font}`;
      width = ctx.measureText('0123456789abcdefghij').width / 20 || width;
    }
  }
  widthCache.set(fontSize, width);
  return width;
}
