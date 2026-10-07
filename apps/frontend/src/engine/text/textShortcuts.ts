import type { ListStyle, Typography } from '../model/schema';

/**
 * Keyboard formatting for text being edited on the canvas.
 *
 * Formatting here is per block, the same unit the schema stores (see
 * `Typography.list`): Cmd+B makes the whole text bold, "- " at the start of
 * an empty block makes it a bulleted list. That matches what a canvas text box
 * is — a label or a paragraph — and keeps the stored text a plain string,
 * which is what lets two people type into the same board and merge cleanly.
 */

/** Markdown-style prefixes that turn a block into a list when typed first. */
const LIST_PREFIXES: ReadonlyArray<{ pattern: RegExp; list: ListStyle }> = [
  { pattern: /^[-*+•] $/, list: 'bullet' },
  { pattern: /^1[.)] $/, list: 'number' },
  { pattern: /^a[.)] $/, list: 'letter' },
  { pattern: /^-- $/, list: 'dash' },
];

/**
 * A list prefix the user has just typed at the very start of the block.
 *
 * Only fires while the prefix is the whole of the text before the caret on the
 * first line, so typing "- " in the middle of a sentence stays literal. Returns
 * the list style, the text with the prefix removed and the prefix itself (so
 * Backspace at the start of the block can give it back), or null.
 */
export function detectListShortcut(
  value: string,
  caret: number,
  current: ListStyle | undefined
): { list: ListStyle; value: string; caret: number; prefix: string } | null {
  if (current) return null;
  const before = value.slice(0, caret);
  if (before.includes('\n')) return null;
  for (const { pattern, list } of LIST_PREFIXES) {
    if (pattern.test(before)) {
      return { list, value: value.slice(caret), caret: 0, prefix: before };
    }
  }
  return null;
}

/**
 * Backspace at the very start of a block that a typed prefix just turned into
 * a list: the list is dropped and the prefix is typed back, so the shortcut can
 * be refused the way every editor allows. Null when there is nothing to undo.
 */
export function undoListShortcut(
  prefix: string | null,
  value: string
): { value: string; caret: number } | null {
  if (!prefix) return null;
  return { value: prefix + value, caret: prefix.length };
}

export type FormatCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'bullets'
  | 'numbers'
  | 'grow'
  | 'shrink'
  | 'align-left'
  | 'align-center'
  | 'align-right';

/**
 * The command a key chord asks for while editing, or null.
 *
 * The chords are the ones Figma and Google Docs use, so nobody has to learn
 * them: ⌘B ⌘I ⌘U, ⌘⇧X strike, ⌘⇧7 numbers, ⌘⇧8 bullets, ⌘⇧. and ⌘⇧, size,
 * ⌘⇧L/E/R alignment. `code` is read for the digits and punctuation because
 * Shift changes `key` on most layouts.
 */
export function formatCommandFor(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): FormatCommand | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey) {
    if (key === 'b') return 'bold';
    if (key === 'i') return 'italic';
    if (key === 'u') return 'underline';
    return null;
  }
  if (key === 'x') return 'strikethrough';
  if (e.code === 'Digit7' || key === '&') return 'numbers';
  if (e.code === 'Digit8' || key === '*') return 'bullets';
  if (e.code === 'Period' || key === '.' || key === '>') return 'grow';
  if (e.code === 'Comma' || key === ',' || key === '<') return 'shrink';
  if (key === 'l') return 'align-left';
  if (key === 'e') return 'align-center';
  if (key === 'r') return 'align-right';
  return null;
}

/** The type ramp the size chords step along. */
export const FONT_SIZE_STEPS = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 128, 160, 200];

/** The next size up or down the ramp from `size`, which need not be on it. */
export function stepFontSize(size: number, direction: 1 | -1): number {
  if (direction > 0) return FONT_SIZE_STEPS.find((s) => s > size) ?? FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1];
  for (let i = FONT_SIZE_STEPS.length - 1; i >= 0; i--) if (FONT_SIZE_STEPS[i] < size) return FONT_SIZE_STEPS[i];
  return FONT_SIZE_STEPS[0];
}

/** Typography after applying `command`. Returns the same object when nothing changes. */
export function applyFormat(t: Typography, command: FormatCommand): Typography {
  switch (command) {
    case 'bold':
      return { ...t, fontWeight: t.fontWeight >= 600 ? 400 : 700 };
    case 'italic':
      return { ...t, italic: !t.italic };
    case 'underline':
      return { ...t, underline: !t.underline };
    case 'strikethrough':
      return { ...t, strikethrough: !t.strikethrough };
    case 'bullets':
      return { ...t, list: t.list === 'bullet' ? undefined : 'bullet' };
    case 'numbers':
      return { ...t, list: t.list === 'number' ? undefined : 'number' };
    case 'grow':
      return { ...t, fontSize: stepFontSize(t.fontSize, 1) };
    case 'shrink':
      return { ...t, fontSize: stepFontSize(t.fontSize, -1) };
    case 'align-left':
      return t.align === 'left' ? t : { ...t, align: 'left' };
    case 'align-center':
      return t.align === 'center' ? t : { ...t, align: 'center' };
    case 'align-right':
      return t.align === 'right' ? t : { ...t, align: 'right' };
  }
}
