import { languageById } from './codeLanguages';

/**
 * The handful of editor behaviours that make typing code bearable.
 *
 * Not an IDE's. The five things whose absence is felt within a minute of
 * writing code in a plain text box: Tab indents instead of leaving the field,
 * Enter keeps the indentation, brackets and quotes close themselves, a comment
 * toggles on a key, and a line can be moved without cutting it. Each is a pure
 * edit of `(text, selection) → (text, selection)`, so they are tested without
 * a textarea and applied to one with a single write.
 */

export interface Edit {
  text: string;
  start: number;
  end: number;
}

export const INDENT = '  ';

const lineStartOf = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
const lineEndOf = (text: string, pos: number) => {
  const i = text.indexOf('\n', pos);
  return i < 0 ? text.length : i;
};

/** The whole lines a selection touches, as [start, end) offsets. */
function lineSpan(text: string, start: number, end: number): [number, number] {
  const from = lineStartOf(text, start);
  // A selection ending at the very start of a line does not include that line.
  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  return [from, lineEndOf(text, effectiveEnd)];
}

export function indent(text: string, start: number, end: number, outdent: boolean): Edit {
  if (start === end && !outdent) {
    return { text: text.slice(0, start) + INDENT + text.slice(end), start: start + INDENT.length, end: start + INDENT.length };
  }
  const [from, to] = lineSpan(text, start, end);
  const lines = text.slice(from, to).split('\n');
  let firstDelta = 0;
  let total = 0;
  const changed = lines.map((line, i) => {
    if (outdent) {
      const remove = line.startsWith(INDENT) ? INDENT.length : line.startsWith(' ') || line.startsWith('\t') ? 1 : 0;
      if (i === 0) firstDelta = -remove;
      total -= remove;
      return line.slice(remove);
    }
    if (i === 0) firstDelta = INDENT.length;
    total += INDENT.length;
    return INDENT + line;
  });
  return {
    text: text.slice(0, from) + changed.join('\n') + text.slice(to),
    start: Math.max(from, start + firstDelta),
    end: Math.max(from, end + total),
  };
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * A newline that keeps the current indentation, adds a level after an opener
 * (or a Python colon), and between a pair puts the closer on a line of its own.
 */
export function newline(text: string, start: number, end: number, languageId: string): Edit {
  const lineStart = lineStartOf(text, start);
  const current = text.slice(lineStart, start);
  const base = current.match(/^\s*/)![0];
  const before = text.slice(0, start).trimEnd();
  const lastChar = before[before.length - 1] ?? '';
  const nextChar = text[end] ?? '';
  const opens = lastChar in OPENERS || (languageId === 'python' && lastChar === ':') || before.endsWith('=>');
  const inner = opens ? base + INDENT : base;

  if (lastChar in OPENERS && nextChar === OPENERS[lastChar]) {
    const insert = `\n${inner}\n${base}`;
    const caret = start + 1 + inner.length;
    return { text: text.slice(0, start) + insert + text.slice(end), start: caret, end: caret };
  }
  const insert = `\n${inner}`;
  const caret = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(end), start: caret, end: caret };
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

/**
 * Typing an opener closes it; typing a closer that is already there steps over
 * it; typing a quote around a selection wraps the selection.
 *
 * Returns `null` when the keystroke should be left to the textarea.
 */
export function typeChar(text: string, start: number, end: number, char: string): Edit | null {
  const next = text[end] ?? '';
  const prev = text[start - 1] ?? '';

  // Step over a closer that auto-close already put there.
  if (start === end && (char === ')' || char === ']' || char === '}' || char === '"' || char === "'" || char === '`') && next === char) {
    return { text, start: start + 1, end: start + 1 };
  }

  const close = PAIRS[char];
  if (!close) return null;

  if (start !== end) {
    const inside = text.slice(start, end);
    return { text: text.slice(0, start) + char + inside + close + text.slice(end), start: start + 1, end: end + 1 };
  }

  const isQuote = char === close;
  // A quote after a letter is an apostrophe ("don't"), not the start of a string.
  if (isQuote && /\w/.test(prev)) return null;
  // Only close when the caret is at a boundary; mid-word it gets in the way.
  if (next && !/[\s)\]},;:]/.test(next)) return null;
  return { text: text.slice(0, start) + char + close + text.slice(end), start: start + 1, end: start + 1 };
}

/** Backspace between an empty pair removes both halves. */
export function backspace(text: string, start: number, end: number): Edit | null {
  if (start !== end || start === 0) return null;
  const prev = text[start - 1];
  if (PAIRS[prev] && text[start] === PAIRS[prev]) {
    return { text: text.slice(0, start - 1) + text.slice(start + 1), start: start - 1, end: start - 1 };
  }
  // Inside leading indentation, a backspace removes a whole level.
  const lineStart = lineStartOf(text, start);
  const lead = text.slice(lineStart, start);
  if (lead.length >= INDENT.length && /^ +$/.test(lead)) {
    const remove = lead.length % INDENT.length || INDENT.length;
    return { text: text.slice(0, start - remove) + text.slice(start), start: start - remove, end: start - remove };
  }
  return null;
}

/** Comment or uncomment the selected lines with the language's line comment. */
export function toggleComment(text: string, start: number, end: number, languageId: string): Edit {
  const lang = languageById(languageId);
  const [from, to] = lineSpan(text, start, end);
  const block = text.slice(from, to);
  const marker = lang.lineComment?.[0];

  if (!marker) {
    const pair = lang.blockComment?.[0] ?? (lang.mode === 'markup' || lang.mode === 'markdown' ? ['<!--', '-->'] as [string, string] : null);
    if (!pair) return { text, start, end };
    const [open, close] = pair;
    const trimmed = block.trim();
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      const unwrapped = block.replace(open + ' ', '').replace(open, '').replace(' ' + close, '').replace(close, '');
      const delta = unwrapped.length - block.length;
      return { text: text.slice(0, from) + unwrapped + text.slice(to), start: Math.max(from, start - (open.length + 1)), end: Math.max(from, end + delta) };
    }
    const lead = block.match(/^\s*/)![0];
    const wrapped = `${lead}${open} ${block.slice(lead.length)} ${close}`;
    return { text: text.slice(0, from) + wrapped + text.slice(to), start: start + open.length + 1, end: end + open.length * 1 + close.length + 2 };
  }

  const lines = block.split('\n');
  const nonEmpty = lines.filter((l) => l.trim());
  const allCommented = nonEmpty.length > 0 && nonEmpty.every((l) => l.trimStart().startsWith(marker));
  const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^\s*/)![0].length), Infinity);
  let firstDelta = 0;
  let total = 0;
  const changed = lines.map((line, i) => {
    if (!line.trim()) return line;
    if (allCommented) {
      const at = line.indexOf(marker);
      const removeLen = line.startsWith(marker + ' ', at) ? marker.length + 1 : marker.length;
      if (i === 0) firstDelta = -removeLen;
      total -= removeLen;
      return line.slice(0, at) + line.slice(at + removeLen);
    }
    const col = Number.isFinite(minIndent) ? minIndent : 0;
    if (i === 0) firstDelta = marker.length + 1;
    total += marker.length + 1;
    return `${line.slice(0, col)}${marker} ${line.slice(col)}`;
  });
  return {
    text: text.slice(0, from) + changed.join('\n') + text.slice(to),
    start: Math.max(from, start + firstDelta),
    end: Math.max(from, end + total),
  };
}

/** Move the selected lines up or down one line, carrying the selection. */
export function moveLines(text: string, start: number, end: number, direction: -1 | 1): Edit {
  const [from, to] = lineSpan(text, start, end);
  if (direction === -1 && from === 0) return { text, start, end };
  if (direction === 1 && to >= text.length) return { text, start, end };
  const block = text.slice(from, to);
  if (direction === -1) {
    const prevStart = lineStartOf(text, from - 1);
    const prev = text.slice(prevStart, from - 1);
    const shift = prev.length + 1;
    return { text: text.slice(0, prevStart) + block + '\n' + prev + text.slice(to), start: start - shift, end: end - shift };
  }
  const nextEnd = lineEndOf(text, to + 1);
  const nextLine = text.slice(to + 1, nextEnd);
  const shift = nextLine.length + 1;
  return { text: text.slice(0, from) + nextLine + '\n' + block + text.slice(nextEnd), start: start + shift, end: end + shift };
}
