/**
 * Colouring for the diagram editor.
 *
 * Not a parser: the parser (`mermaid.ts`, `sequence.ts`, `pie.ts`) decides what
 * the source means and reports errors. This only gives the eye the structure of
 * a line — which word is a keyword, which run is an arrow, which part is a
 * label a person wrote — so it is a single pass per line with no state beyond
 * the line, and it never fails: anything it does not recognise is plain text.
 *
 * The runs concatenate back to the line exactly, character for character,
 * because they are drawn under a transparent textarea and every column has to
 * land under the caret that typed it.
 */

export type MermaidTokenKind = 'plain' | 'keyword' | 'direction' | 'arrow' | 'label' | 'comment' | 'string' | 'number' | 'punct' | 'id';

export interface MermaidToken {
  kind: MermaidTokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'graph', 'flowchart', 'sequencediagram', 'pie', 'subgraph', 'end', 'participant', 'actor', 'note', 'over', 'left', 'right', 'of',
  'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical', 'break', 'rect', 'classdef', 'class', 'style', 'linkstyle', 'direction',
  'title', 'autonumber', 'activate', 'deactivate', 'showdata', 'click', 'as',
]);

const DIRECTIONS = new Set(['TD', 'TB', 'BT', 'LR', 'RL']);

/** Arrow forms, longest first, so `-->>` is not read as `-->` and `>`. */
const ARROW = /^(<?-{2,}>>|<?-->>|-->>|->>|-x|--x|-\)|--\)|<?={2,}>|<?-{2,}>|<?-\.+->|-\.+-|-{3,}|={3,}|--o|o--o|x--x|<-->|->)/;

/** A bracketed label after a node id, in any of mermaid's shape forms. */
const OPENERS: Record<string, string> = { '[': ']', '(': ')', '{': '}', '>': ']' };

function push(out: MermaidToken[], text: string, kind: MermaidTokenKind) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ kind, text });
}

export function highlightMermaidLine(line: string): MermaidToken[] {
  const out: MermaidToken[] = [];
  const trimmedStart = line.length - line.trimStart().length;
  if (line.trimStart().startsWith('%%')) {
    push(out, line.slice(0, trimmedStart), 'plain');
    push(out, line.slice(trimmedStart), 'comment');
    return out;
  }

  let i = 0;
  let sawWord = false;
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i];

    if (/\s/.test(ch)) {
      const ws = /^\s+/.exec(rest)![0];
      push(out, ws, 'plain');
      i += ws.length;
      continue;
    }
    if (rest.startsWith('%%')) {
      push(out, rest, 'comment');
      break;
    }
    if (ch === '"') {
      const end = line.indexOf('"', i + 1);
      const text = end < 0 ? rest : line.slice(i, end + 1);
      push(out, text, 'string');
      i += text.length;
      continue;
    }
    if (ch === '|') {
      // An edge label: `-->|yes|`.
      const end = line.indexOf('|', i + 1);
      if (end > i) {
        push(out, '|', 'punct');
        push(out, line.slice(i + 1, end), 'label');
        push(out, '|', 'punct');
        i = end + 1;
        continue;
      }
    }
    const arrow = ARROW.exec(rest);
    if (arrow) {
      push(out, arrow[0], 'arrow');
      i += arrow[0].length;
      continue;
    }
    if (rest.startsWith(':::')) {
      push(out, ':::', 'punct');
      i += 3;
      continue;
    }
    if (ch === ':') {
      // Everything after a colon is the person's words: a message, a note, a
      // pie slice's label already passed as a string, or a value.
      push(out, ':', 'punct');
      const tail = rest.slice(1);
      if (/^\s*-?\d+(\.\d+)?\s*$/.test(tail)) push(out, tail, 'number');
      else push(out, tail, 'label');
      break;
    }
    if (OPENERS[ch] && sawWord && out[out.length - 1]?.kind === 'id') {
      // Doubled forms first: `((`, `([`, `[[`, `{{`, `[(`.
      const doubled = /^(\(\(\(|\(\[|\[\[|\[\(|\(\(|\{\{|\[\/|\[\\)/.exec(rest)?.[0];
      const open = doubled ?? ch;
      const close = OPENERS[open[0]];
      let end = line.indexOf(close, i + open.length);
      if (end < 0) end = line.length;
      let closeLen = 0;
      while (end + closeLen < line.length && /[\])}\/\\]/.test(line[end + closeLen]) && closeLen < open.length) closeLen++;
      push(out, open, 'punct');
      push(out, line.slice(i + open.length, end), 'label');
      push(out, line.slice(end, end + closeLen), 'punct');
      i = end + closeLen;
      continue;
    }
    // A hyphen joins an id only when a word character follows, so `Alice->>Bob`
    // stops at `Alice` and the arrow is read as an arrow.
    const word = /^[A-Za-z_](?:\w|-(?=\w))*/.exec(rest)?.[0];
    if (word) {
      const lower = word.toLowerCase();
      if (DIRECTIONS.has(word) && out.some((t) => t.kind === 'keyword')) push(out, word, 'direction');
      else if (KEYWORDS.has(lower) && (!sawWord || lower === 'as' || lower === 'of' || lower === 'over' || lower === 'right' || lower === 'left')) push(out, word, 'keyword');
      else push(out, word, 'id');
      sawWord = true;
      i += word.length;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(rest)?.[0];
    if (num) {
      push(out, num, 'number');
      i += num.length;
      continue;
    }
    push(out, ch, /[;,&()[\]{}<>]/.test(ch) ? 'punct' : 'plain');
    i += 1;
  }
  return out;
}

const cache = new Map<string, MermaidToken[][]>();

/** Every line of the source as coloured runs. Memoised: the editor asks on every keystroke. */
export function highlightMermaid(source: string): MermaidToken[][] {
  const hit = cache.get(source);
  if (hit) return hit;
  const lines = source.split('\n').map(highlightMermaidLine);
  if (cache.size > 64) cache.clear();
  cache.set(source, lines);
  return lines;
}
