import { languageById, type CodeLanguage, type StringRule } from './codeLanguages';

/**
 * Source code as coloured runs, line by line.
 *
 * ## One pass, three readers
 *
 * The canvas renderer paints these runs, the in-place editor lays the same runs
 * under its caret, and the SVG exporter writes them as `<tspan>`s. They must
 * agree exactly — an editor whose colours shift the moment it opens reads as a
 * different object — so all three read this function, and it is pure so that
 * agreement can be asserted.
 *
 * ## Why state crosses lines
 *
 * A block comment, a template literal or a Python docstring opened on line 3
 * colours line 9. Tokenising line by line in isolation gets every such block
 * wrong from its second line on, which is the most visible failure a
 * highlighter can have. So the lexer carries what it is inside of from one line
 * to the next.
 */

export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'type'
  | 'constant'
  | 'builtin'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'property'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attr'
  | 'meta'
  | 'variable'
  | 'heading'
  | 'emphasis';

export interface Token {
  text: string;
  kind: TokenKind;
}

type State =
  | { in: 'none' }
  | { in: 'block'; close: string }
  | { in: 'string'; rule: StringRule }
  | { in: 'markupComment' }
  | { in: 'fence' };

interface LexContext {
  lang: CodeLanguage;
  keywords: Set<string>;
  types: Set<string>;
  constants: Set<string>;
  builtins: Set<string>;
  /** CSS only: how deep inside `{}` the lexer is. */
  depth: number;
}

const IDENT = /^[A-Za-z_][\w$]*/;
const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)[a-zA-Z%]*/;
const OPERATOR = /^(?:=>|->|::|\?\?|\?\.|\.\.\.|[+\-*/%=!<>&|^~?:]+)/;
const PUNCT = /^[{}[\]();,.]/;

const contextCache = new Map<string, LexContext>();

function contextFor(lang: CodeLanguage): LexContext {
  const hit = contextCache.get(lang.id);
  if (hit) return { ...hit, depth: 0 };
  const norm = (list?: string[]) =>
    new Set((list ?? []).map((w) => (lang.caseInsensitive ? w.toLowerCase() : w)));
  const ctx: LexContext = {
    lang,
    keywords: norm(lang.keywords),
    types: norm(lang.types),
    constants: norm(lang.constants),
    builtins: norm(lang.builtins),
    depth: 0,
  };
  contextCache.set(lang.id, ctx);
  return { ...ctx };
}

function push(out: Token[], text: string, kind: TokenKind) {
  if (!text) return;
  const last = out[out.length - 1];
  // Adjacent runs of one kind merge, so a line is a few runs rather than a
  // run per character — fewer draws for the renderer, fewer spans for the DOM.
  if (last && last.kind === kind) last.text += text;
  else out.push({ text, kind });
}

/** Read a string body from `at`, returning where it ended and whether it closed. */
function readString(line: string, at: number, rule: StringRule): { end: number; closed: boolean } {
  let i = at;
  while (i < line.length) {
    if (rule.escape && line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line.startsWith(rule.close, i)) return { end: i + rule.close.length, closed: true };
    i++;
  }
  return { end: line.length, closed: false };
}

// ---------------------------------------------------------------- code mode

function lexCode(line: string, state: State, ctx: LexContext, out: Token[], lineStart: boolean): State {
  const { lang } = ctx;
  let i = 0;

  // Continue whatever the previous line left open.
  if (state.in === 'block') {
    const end = line.indexOf(state.close);
    if (end < 0) {
      push(out, line, 'comment');
      return state;
    }
    push(out, line.slice(0, end + state.close.length), 'comment');
    i = end + state.close.length;
    state = { in: 'none' };
  } else if (state.in === 'string') {
    const { end, closed } = readString(line, 0, state.rule);
    push(out, line.slice(0, end), 'string');
    if (!closed) return state;
    i = end;
    state = { in: 'none' };
  }

  let prevSignificant = '';
  const firstWordIndex = line.search(/\S/);

  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i];

    if (/\s/.test(ch)) {
      const ws = rest.match(/^\s+/)![0];
      push(out, ws, 'plain');
      i += ws.length;
      continue;
    }

    const lineComment = lang.lineComment?.find((c) => rest.startsWith(c));
    // `#` is a comment in shell and Python but the start of a directive in C;
    // the C family lists `#include` as a keyword and never as a comment.
    if (lineComment) {
      push(out, rest, 'comment');
      return state;
    }

    const block = lang.blockComment?.find(([open]) => rest.startsWith(open));
    if (block) {
      const close = rest.indexOf(block[1], block[0].length);
      if (close < 0) {
        push(out, rest, 'comment');
        return { in: 'block', close: block[1] };
      }
      push(out, rest.slice(0, close + block[1].length), 'comment');
      i += close + block[1].length;
      continue;
    }

    const rule = lang.strings?.find((s) => rest.startsWith(s.open));
    if (rule) {
      const { end, closed } = readString(line, i + rule.open.length, rule);
      push(out, line.slice(i, end), 'string');
      i = end;
      if (!closed) return rule.multiline ? { in: 'string', rule } : state;
      prevSignificant = 'string';
      continue;
    }

    // Preprocessor directives and PHP tags, spelled with punctuation.
    const directive = rest.match(/^(?:#[a-z]+|<\?php|\?>)/);
    if (directive && ctx.keywords.has(directive[0])) {
      push(out, directive[0], 'keyword');
      i += directive[0].length;
      continue;
    }

    if (lang.decorators && ch === '@') {
      const m = rest.match(/^@[\w.]+/);
      if (m) {
        push(out, m[0], 'meta');
        i += m[0].length;
        continue;
      }
    }

    if (lang.dollarVariables && ch === '$') {
      const m = rest.match(/^\$(?:\{[^}]*\}|[\w]+|[@#?$!*0-9])/);
      if (m) {
        push(out, m[0], 'variable');
        i += m[0].length;
        continue;
      }
    }

    const prevChar = i > 0 ? line[i - 1] : '';
    if (!/[\w$]/.test(prevChar)) {
      const num = rest.match(NUMBER);
      if (num && /\d/.test(num[0])) {
        push(out, num[0], 'number');
        i += num[0].length;
        prevSignificant = 'number';
        continue;
      }
    }

    const ident = rest.match(IDENT);
    if (ident) {
      const word = ident[0];
      const key = lang.caseInsensitive ? word.toLowerCase() : word;
      const after = line.slice(i + word.length).match(/^\s*(\S)/)?.[1] ?? '';
      let kind: TokenKind = 'plain';
      if (lang.lineStartKeywords) {
        kind = i === firstWordIndex && lineStart && ctx.keywords.has(word.toUpperCase()) ? 'keyword' : 'plain';
      } else if (prevSignificant === '.' && !ctx.keywords.has(key)) {
        kind = after === '(' ? 'function' : 'property';
      } else if (ctx.keywords.has(key)) kind = 'keyword';
      else if (ctx.constants.has(key)) kind = 'constant';
      else if (ctx.types.has(key)) kind = 'type';
      else if (after === '(' || (lang.id === 'rust' && after === '!')) kind = ctx.builtins.has(key) ? 'builtin' : 'function';
      else if (ctx.builtins.has(key)) kind = 'builtin';
      else if (lang.capitalTypes && /^[A-Z][a-z0-9]/.test(word)) kind = 'type';
      else if (/^[A-Z][A-Z0-9_]{2,}$/.test(word) && lang.id !== 'sql') kind = 'constant';
      push(out, word, kind);
      i += word.length;
      prevSignificant = 'ident';
      continue;
    }

    const op = rest.match(OPERATOR);
    if (op) {
      push(out, op[0], 'operator');
      i += op[0].length;
      prevSignificant = op[0];
      continue;
    }

    if (PUNCT.test(ch)) {
      push(out, ch, 'punctuation');
      i += 1;
      prevSignificant = ch;
      continue;
    }

    push(out, ch, 'plain');
    i += 1;
    prevSignificant = ch;
  }
  return state;
}

// -------------------------------------------------------------- markup mode

function lexMarkup(line: string, state: State, out: Token[]): State {
  let i = 0;
  if (state.in === 'markupComment') {
    const end = line.indexOf('-->');
    if (end < 0) {
      push(out, line, 'comment');
      return state;
    }
    push(out, line.slice(0, end + 3), 'comment');
    i = end + 3;
    state = { in: 'none' };
  }

  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      if (end < 0) {
        push(out, rest, 'comment');
        return { in: 'markupComment' };
      }
      push(out, rest.slice(0, end + 3), 'comment');
      i += end + 3;
      continue;
    }
    const tag = rest.match(/^<\/?[A-Za-z!?][\w:.-]*/);
    if (tag) {
      const bracket = tag[0].match(/^<\/?[!?]?/)![0];
      push(out, bracket, 'punctuation');
      push(out, tag[0].slice(bracket.length), tag[0].startsWith('<!') ? 'meta' : 'tag');
      i += tag[0].length;
      // Attributes until the tag closes on this line.
      while (i < line.length) {
        const r = line.slice(i);
        const ws = r.match(/^\s+/);
        if (ws) {
          push(out, ws[0], 'plain');
          i += ws[0].length;
          continue;
        }
        const close = r.match(/^\/?\??>/);
        if (close) {
          push(out, close[0], 'punctuation');
          i += close[0].length;
          break;
        }
        const attr = r.match(/^[^\s=/>"']+/);
        if (attr) {
          push(out, attr[0], 'attr');
          i += attr[0].length;
          continue;
        }
        if (r[0] === '=') {
          push(out, '=', 'operator');
          i += 1;
          continue;
        }
        const quoted = r.match(/^"[^"]*"?|^'[^']*'?/);
        if (quoted) {
          push(out, quoted[0], 'string');
          i += quoted[0].length;
          continue;
        }
        push(out, r[0], 'plain');
        i += 1;
      }
      continue;
    }
    const entity = rest.match(/^&#?\w+;/);
    if (entity) {
      push(out, entity[0], 'constant');
      i += entity[0].length;
      continue;
    }
    const text = rest.match(/^[^<&]+/);
    push(out, text ? text[0] : rest[0], 'plain');
    i += text ? text[0].length : 1;
  }
  return state;
}

// ----------------------------------------------------------------- css mode

function lexCss(line: string, state: State, ctx: LexContext, out: Token[]): State {
  let i = 0;
  if (state.in === 'block') {
    const end = line.indexOf('*/');
    if (end < 0) {
      push(out, line, 'comment');
      return state;
    }
    push(out, line.slice(0, end + 2), 'comment');
    i = end + 2;
    state = { in: 'none' };
  }

  while (i < line.length) {
    const rest = line.slice(i);
    const ch = rest[0];
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      if (end < 0) {
        push(out, rest, 'comment');
        return { in: 'block', close: '*/' };
      }
      push(out, rest.slice(0, end + 2), 'comment');
      i += end + 2;
      continue;
    }
    if (rest.startsWith('//')) {
      push(out, rest, 'comment');
      break;
    }
    if (/\s/.test(ch)) {
      const ws = rest.match(/^\s+/)![0];
      push(out, ws, 'plain');
      i += ws.length;
      continue;
    }
    if (ch === '{' || ch === '}') {
      ctx.depth = Math.max(0, ctx.depth + (ch === '{' ? 1 : -1));
      push(out, ch, 'punctuation');
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const { end } = readString(line, i + 1, { open: ch, close: ch, escape: true });
      push(out, line.slice(i, end), 'string');
      i = end;
      continue;
    }
    const at = rest.match(/^@[\w-]+/);
    if (at) {
      push(out, at[0], 'keyword');
      i += at[0].length;
      continue;
    }
    if (ctx.depth === 0 || /^[^:;{}]*\{/.test(rest)) {
      // A selector.
      const sel = rest.match(/^[.#]?[\w-]+|^[:>+~*[\]=,()]+/);
      if (sel) {
        const kind: TokenKind = sel[0].startsWith('.') ? 'type' : sel[0].startsWith('#') ? 'constant' : /^[\w-]/.test(sel[0]) ? 'tag' : 'punctuation';
        push(out, sel[0], kind);
        i += sel[0].length;
        continue;
      }
    } else {
      const prop = rest.match(/^--?[\w-]+(?=\s*:)/);
      if (prop) {
        push(out, prop[0], 'property');
        i += prop[0].length;
        continue;
      }
      const hex = rest.match(/^#[\da-fA-F]{3,8}\b/);
      if (hex) {
        push(out, hex[0], 'constant');
        i += hex[0].length;
        continue;
      }
      const num = rest.match(/^-?\d*\.?\d+[a-z%]*/);
      if (num) {
        push(out, num[0], 'number');
        i += num[0].length;
        continue;
      }
      const fn = rest.match(/^[\w-]+(?=\()/);
      if (fn) {
        push(out, fn[0], 'function');
        i += fn[0].length;
        continue;
      }
      const word = rest.match(/^[\w-]+/);
      if (word) {
        push(out, word[0], word[0] === 'important' ? 'keyword' : 'plain');
        i += word[0].length;
        continue;
      }
    }
    push(out, ch, /[:;,()!]/.test(ch) ? 'punctuation' : 'plain');
    i += 1;
  }
  return state;
}

// ---------------------------------------------------------------- json mode

function lexJson(line: string, out: Token[]) {
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const ws = rest.match(/^\s+/);
    if (ws) {
      push(out, ws[0], 'plain');
      i += ws[0].length;
      continue;
    }
    if (rest.startsWith('//')) {
      push(out, rest, 'comment');
      break;
    }
    if (rest[0] === '"') {
      const { end } = readString(line, i + 1, { open: '"', close: '"', escape: true });
      const text = line.slice(i, end);
      const isKey = /^\s*:/.test(line.slice(end));
      push(out, text, isKey ? 'property' : 'string');
      i = end;
      continue;
    }
    const num = rest.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (num) {
      push(out, num[0], 'number');
      i += num[0].length;
      continue;
    }
    const lit = rest.match(/^(?:true|false|null)\b/);
    if (lit) {
      push(out, lit[0], 'constant');
      i += lit[0].length;
      continue;
    }
    push(out, rest[0], /[{}[\],:]/.test(rest[0]) ? 'punctuation' : 'plain');
    i += 1;
  }
}

// ---------------------------------------------------------------- yaml mode

function lexYaml(line: string, out: Token[]) {
  const comment = line.search(/(^|\s)#/);
  const body = comment >= 0 ? line.slice(0, comment) : line;
  const tail = comment >= 0 ? line.slice(comment) : '';
  const m = body.match(/^(\s*)(-\s+)?([^:#'"\s][^:#]*?)(\s*:)(\s|$)(.*)$/);
  if (m) {
    push(out, m[1], 'plain');
    if (m[2]) push(out, m[2], 'punctuation');
    push(out, m[3], 'property');
    push(out, m[4], 'punctuation');
    push(out, m[5], 'plain');
    yamlValue(m[6], out);
  } else {
    const item = body.match(/^(\s*)(-\s+)(.*)$/);
    if (item) {
      push(out, item[1], 'plain');
      push(out, item[2], 'punctuation');
      yamlValue(item[3], out);
    } else if (/^\s*(---|\.\.\.)\s*$/.test(body)) {
      push(out, body, 'meta');
    } else {
      yamlValue(body, out);
    }
  }
  push(out, tail, 'comment');
}

function yamlValue(value: string, out: Token[]) {
  const trimmed = value.trim();
  const lead = value.match(/^\s*/)![0];
  push(out, lead, 'plain');
  const core = value.slice(lead.length);
  if (!core) return;
  if (/^["']/.test(trimmed)) push(out, core, 'string');
  else if (/^-?\d+(\.\d+)?$/.test(trimmed)) push(out, core, 'number');
  else if (/^(true|false|null|yes|no|on|off|~)$/i.test(trimmed)) push(out, core, 'constant');
  else if (/^[&*!][\w-]+/.test(trimmed)) push(out, core, 'meta');
  else if (/^[|>][-+]?$/.test(trimmed)) push(out, core, 'operator');
  else push(out, core, 'string');
}

// ------------------------------------------------------------ markdown mode

function lexMarkdown(line: string, state: State, out: Token[]): State {
  if (/^\s*(```|~~~)/.test(line)) {
    push(out, line, 'meta');
    return state.in === 'fence' ? { in: 'none' } : { in: 'fence' };
  }
  if (state.in === 'fence') {
    push(out, line, 'string');
    return state;
  }
  const heading = line.match(/^(#{1,6}\s)(.*)$/);
  if (heading) {
    push(out, heading[1], 'punctuation');
    push(out, heading[2], 'heading');
    return state;
  }
  if (/^\s*>/.test(line)) {
    push(out, line, 'comment');
    return state;
  }
  let i = 0;
  const bullet = line.match(/^(\s*)([-*+]|\d+\.)(\s+)/);
  if (bullet) {
    push(out, bullet[1], 'plain');
    push(out, bullet[2], 'punctuation');
    push(out, bullet[3], 'plain');
    i = bullet[0].length;
  }
  while (i < line.length) {
    const rest = line.slice(i);
    const code = rest.match(/^`[^`]+`/);
    if (code) {
      push(out, code[0], 'string');
      i += code[0].length;
      continue;
    }
    const strong = rest.match(/^(\*\*|__)[^*_]+\1/) ?? rest.match(/^(\*|_)[^*_\s][^*_]*\1/);
    if (strong) {
      push(out, strong[0], 'emphasis');
      i += strong[0].length;
      continue;
    }
    const link = rest.match(/^\[([^\]]*)\]\(([^)]*)\)/);
    if (link) {
      push(out, `[${link[1]}]`, 'function');
      push(out, `(${link[2]})`, 'string');
      i += link[0].length;
      continue;
    }
    const text = rest.match(/^[^`*_[]+/);
    push(out, text ? text[0] : rest[0], 'plain');
    i += text ? text[0].length : 1;
  }
  return state;
}

// ------------------------------------------------------------------- entry

const lineCache = new Map<string, Token[][]>();

/**
 * Every line of `source` as runs. Memoised on the pair, because the renderer
 * asks for the same answer on every frame a block is on screen.
 */
export function tokenize(source: string, languageId: string): Token[][] {
  // A separator no language id can contain, so `ts` + `x…` never collides with `tsx` + `…`.
  const cacheKey = `${languageId}${String.fromCharCode(0)}${source}`;
  const hit = lineCache.get(cacheKey);
  if (hit) return hit;

  const lang = languageById(languageId);
  const ctx = contextFor(lang);
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const result: Token[][] = [];
  let state: State = { in: 'none' };

  for (const raw of lines) {
    // Tabs are laid out as spaces everywhere a block is drawn, so they are
    // expanded here once rather than measured three different ways.
    const line = raw.replace(/\t/g, '  ');
    const out: Token[] = [];
    switch (lang.mode) {
      case 'code':
        state = lexCode(line, state, ctx, out, true);
        break;
      case 'markup':
        state = lexMarkup(line, state, out);
        break;
      case 'css':
        state = lexCss(line, state, ctx, out);
        break;
      case 'json':
        lexJson(line, out);
        break;
      case 'yaml':
        lexYaml(line, out);
        break;
      case 'markdown':
        state = lexMarkdown(line, state, out);
        break;
      default:
        push(out, line, 'plain');
    }
    result.push(out);
  }

  if (lineCache.size > 400) lineCache.clear();
  lineCache.set(cacheKey, result);
  return result;
}

/** The text of a tokenised line, for measuring and for the plain fallback. */
export const lineText = (tokens: Token[]): string => tokens.map((t) => t.text).join('');
