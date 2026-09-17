/**
 * A code block: source, how it is read, and how it is shown.
 *
 * ## What a code block is for, on a board
 *
 * Not an editor and not a runtime. It is code *as a thing people point at*: a
 * snippet in a review, the handler an architecture diagram is about, the query
 * a table was built from. So the model carries what that needs — the source,
 * the language it is read as, the name of the file it came from, and the lines
 * somebody wants everyone to look at — and nothing an IDE would need.
 *
 * Presentation lives here too (theme, size, line numbers, wrapping) because it
 * is the *object's* look, shared by everyone viewing the board, the way a
 * table's theme is.
 */

export type CodeThemeId = 'midnight' | 'daylight' | 'dusk' | 'paper';

export const CODE_THEME_IDS: readonly CodeThemeId[] = ['midnight', 'daylight', 'dusk', 'paper'];

export interface CodeSpec {
  source: string;
  /** A language id from `CODE_LANGUAGES`, or `plaintext`. */
  language: string;
  /** True while the language is the detector's guess rather than a choice. */
  detected?: boolean;
  /** Where it came from — `api/users.ts`. Drawn in the header when set. */
  filename?: string;
  theme: CodeThemeId;
  lineNumbers: boolean;
  wrap: boolean;
  /** World units, like every other size on the board. */
  fontSize: number;
  /** Logical line numbers, 1-based, marked for attention. */
  highlights: number[];
  /**
   * Show only this many lines, with the rest folded behind a footer.
   * `null` shows everything. A long file on a board is usually about a few
   * lines of it; the rest is context you can open.
   */
  maxLines: number | null;
}

export const CODE_FONT_SIZES = [11, 12, 13, 14, 16, 18, 22] as const;
export const DEFAULT_CODE_FONT = 13;
export const MAX_CODE_LENGTH = 200_000;

export function defaultCodeSpec(source = '', language = 'typescript'): CodeSpec {
  return {
    source,
    language,
    theme: 'midnight',
    lineNumbers: true,
    wrap: false,
    fontSize: DEFAULT_CODE_FONT,
    highlights: [],
    maxLines: null,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * A spec every reader can rely on.
 *
 * Invariant 3: this is the read boundary, so a field it does not copy does not
 * exist downstream. Everything falls back rather than failing, because a code
 * block from a newer build with a theme this one does not know should still
 * draw — in the default theme — rather than draw nothing.
 */
export function normalizeCodeSpec(raw: unknown): CodeSpec {
  const src = isObj(raw) ? raw : {};
  const source = typeof src.source === 'string' ? src.source.slice(0, MAX_CODE_LENGTH) : '';
  const language = typeof src.language === 'string' && src.language ? src.language : 'plaintext';
  const theme = CODE_THEME_IDS.includes(src.theme as CodeThemeId) ? (src.theme as CodeThemeId) : 'midnight';
  const fontSize =
    typeof src.fontSize === 'number' && Number.isFinite(src.fontSize)
      ? Math.min(48, Math.max(8, src.fontSize))
      : DEFAULT_CODE_FONT;
  const highlights = Array.isArray(src.highlights)
    ? [...new Set(src.highlights.filter((n): n is number => Number.isInteger(n) && (n as number) > 0))].sort((a, b) => a - b)
    : [];
  const maxLines =
    typeof src.maxLines === 'number' && Number.isInteger(src.maxLines) && src.maxLines > 0 ? src.maxLines : null;
  return {
    source,
    language,
    detected: src.detected === true ? true : undefined,
    filename: typeof src.filename === 'string' && src.filename.trim() ? src.filename.slice(0, 120) : undefined,
    theme,
    lineNumbers: src.lineNumbers !== false,
    wrap: src.wrap === true,
    fontSize,
    highlights,
    maxLines,
  };
}
