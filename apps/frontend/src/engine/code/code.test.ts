import { describe, expect, it } from 'vitest';
import { tokenize, lineText } from './codeTokenize';
import { detectLanguage, looksLikeCode, parseFence } from './codeDetect';
import { layoutCode, naturalCodeWidth } from './codeLayout';
import { defaultCodeSpec, normalizeCodeSpec } from './codeTypes';
import { CODE_THEMES } from './codeThemes';
import { languageForFilename } from './codeLanguages';
import { contrastRatio } from '../model/colorFormat';

const kinds = (source: string, lang: string, line = 0) =>
  tokenize(source, lang)[line].filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text.trim()}`);

describe('tokenize', () => {
  it('colours the parts of a TypeScript line', () => {
    expect(kinds("const user: User = await db.find('x');", 'typescript')).toEqual([
      'keyword:const', 'plain:user', 'operator::', 'type:User', 'operator:=', 'keyword:await',
      'plain:db', 'punctuation:.', 'function:find', 'punctuation:(', "string:'x'", 'punctuation:);',
    ]);
  });

  it('carries a block comment and a template literal across lines', () => {
    const lines = tokenize('/* one\ntwo */ x\nconst s = `a\nb`;', 'javascript');
    expect(lines[0][0].kind).toBe('comment');
    expect(lines[1][0]).toEqual({ text: 'two */', kind: 'comment' });
    expect(lines[3][0]).toEqual({ text: 'b`', kind: 'string' });
  });

  it('reads Python docstrings, decorators and keywords', () => {
    const lines = tokenize('@app.get("/")\ndef home():\n    """doc\n    string"""\n    return None', 'python');
    expect(lines[0][0].kind).toBe('meta');
    expect(lines[1][0]).toEqual({ text: 'def', kind: 'keyword' });
    expect(lines[3].find((t) => t.text.includes('string'))?.kind).toBe('string');
    expect(lines[4].find((t) => t.text === 'None')?.kind).toBe('constant');
  });

  it('matches SQL keywords in any case', () => {
    expect(kinds('select id FROM users where active', 'sql')).toEqual([
      'keyword:select', 'plain:id', 'keyword:FROM', 'plain:users', 'keyword:where', 'plain:active',
    ]);
  });

  it('tells JSON keys from values', () => {
    expect(kinds('{"name": "vega", "stars": 42, "ok": true}', 'json')).toEqual([
      'punctuation:{', 'property:"name"', 'punctuation::', 'string:"vega"', 'punctuation:,', 'property:"stars"',
      'punctuation::', 'number:42', 'punctuation:,', 'property:"ok"', 'punctuation::', 'constant:true', 'punctuation:}',
    ]);
  });

  it('reads markup tags and attributes', () => {
    expect(kinds('<a href="/x">Hi</a>', 'html')).toEqual([
      'punctuation:<', 'tag:a', 'attr:href', 'operator:=', 'string:"/x"', 'punctuation:>', 'plain:Hi',
      'punctuation:</', 'tag:a', 'punctuation:>',
    ]);
  });

  it('reads YAML keys and shell variables', () => {
    expect(kinds('  image: node:20 # base', 'yaml')).toEqual(['property:image', 'punctuation::', 'string:node:20', 'comment:# base']);
    expect(kinds('echo "$HOME" && export PATH=$PATH', 'bash')).toContain('variable:$PATH');
  });

  it('never loses or reorders characters', () => {
    const src = 'fn main() {\n\tlet mut x = vec![1, 2];\n\tprintln!("{}", x.len()); // done\n}';
    const text = tokenize(src, 'rust').map(lineText).join('\n');
    expect(text).toBe(src.replace(/\t/g, '  '));
  });
});

describe('detection', () => {
  it('names the common languages from short snippets', () => {
    expect(detectLanguage('def process(df):\n    return df.groupby("c").sum()').language).toBe('python');
    expect(detectLanguage('SELECT *\nFROM users\nWHERE active = true;').language).toBe('sql');
    expect(detectLanguage('interface User {\n  id: string;\n}').language).toBe('typescript');
    expect(detectLanguage('package main\n\nfunc main() {\n  fmt.Println("hi")\n}').language).toBe('go');
    expect(detectLanguage('{"a": [1, 2]}').language).toBe('json');
    expect(detectLanguage('FROM node:20\nRUN npm ci').language).toBe('dockerfile');
    expect(detectLanguage('flowchart LR\n  A --> B').language).toBe('mermaid');
  });

  it('declines to guess on prose', () => {
    expect(detectLanguage('Meeting notes for Tuesday. We agreed on the plan.').language).toBe('plaintext');
    expect(looksLikeCode('First, we will review the draft.\nThen we will ship it.')).toBeNull();
  });

  it('turns pasted code into a detection, but not a single line', () => {
    expect(looksLikeCode('const a = 1;')).toBeNull();
    expect(looksLikeCode('function add(a, b) {\n  return a + b;\n}')?.language).toBe('javascript');
  });

  it('reads a fence, with its language and file name', () => {
    expect(parseFence('```ts title="api.ts"\nconst a = 1;\n```')).toEqual({ language: 'typescript', source: 'const a = 1;', filename: 'api.ts' });
    expect(parseFence('before\n```js\nx\n```')).toBeNull();
    expect(languageForFilename('src/Dockerfile')).toBe('dockerfile');
    expect(languageForFilename('main.py')).toBe('python');
  });
});

describe('layout', () => {
  const spec = { ...defaultCodeSpec('a\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nc'), fontSize: 10 };

  it('grows with its lines and folds past maxLines', () => {
    const full = layoutCode(spec, 400, 6);
    expect(full.rows.map((r) => r.lineNumber)).toEqual([1, 2, 3]);
    const folded = layoutCode({ ...spec, maxLines: 1 }, 400, 6);
    expect(folded.hidden).toBe(2);
    expect(folded.height).toBeLessThan(full.height + full.metrics.footerHeight);
  });

  it('wraps by column and keeps continuation rows on their line', () => {
    const wrapped = layoutCode({ ...spec, wrap: true, lineNumbers: false }, 12 * 2 + 6 * 10, 6);
    expect(wrapped.columns).toBe(10);
    expect(wrapped.rows.filter((r) => r.lineNumber === 2).map((r) => r.first)).toEqual([true, false, false]);
  });

  it('intelligently wraps at word and operator boundaries without splitting words', () => {
    const codeLine = "const user: User = await db.find('x');";
    // With 20 columns, breaking at '=' keeps words intact
    const layout = layoutCode({ ...defaultCodeSpec(codeLine), wrap: true, lineNumbers: true, fontSize: 10 }, 12 * 2 + 26 + 6 * 20, 6);
    expect(layout.columns).toBe(20);
    const rowTexts = layout.rows.map((r) => r.tokens.map((t) => t.text).join(''));
    expect(rowTexts.length).toBe(2);
    expect(rowTexts[0]).toBe('const user: User = ');
    expect(rowTexts[1]).toBe("await db.find('x');");
    expect(layout.rows[0].first).toBe(true);
    expect(layout.rows[1].first).toBe(false);
  });

  it('sizes to the longest line', () => {
    expect(naturalCodeWidth({ ...spec, lineNumbers: false }, 6)).toBe(12 * 2 + 30 * 6);
  });
});

describe('spec', () => {
  it('normalises anything into a drawable block', () => {
    const s = normalizeCodeSpec({ source: 42, theme: 'neon', fontSize: 900, highlights: [3, 3, -1, 1.5, 2], maxLines: 0 });
    expect(s).toMatchObject({ source: '', theme: 'midnight', fontSize: 48, highlights: [2, 3], maxLines: null, lineNumbers: true, wrap: true });
  });

  it('defaults new code blocks to wrap: true', () => {
    expect(defaultCodeSpec().wrap).toBe(true);
  });
});

describe('themes', () => {
  it('keep body text and every token readable on their own ground', () => {
    for (const theme of Object.values(CODE_THEMES)) {
      expect(contrastRatio(theme.text, theme.background)).toBeGreaterThanOrEqual(7);
      for (const [kind, colour] of Object.entries(theme.tokens)) {
        const ratio = contrastRatio(colour, theme.background);
        if (ratio < 4.5) throw new Error(`${theme.id}.${kind} is ${ratio.toFixed(2)}:1`);
      }
    }
  });
});

import { backspace, indent, moveLines, newline, toggleComment, typeChar } from './codeEditing';

describe('editing', () => {
  it('indents and outdents whole lines, keeping the selection on them', () => {
    const e = indent('a\nb', 0, 3, false);
    expect(e).toEqual({ text: '  a\n  b', start: 2, end: 7 });
    expect(indent(e.text, e.start, e.end, true)).toEqual({ text: 'a\nb', start: 0, end: 3 });
  });

  it('keeps indentation on Enter, and opens a block between braces', () => {
    expect(newline('  foo', 5, 5, 'js')).toEqual({ text: '  foo\n  ', start: 8, end: 8 });
    expect(newline('if (x) {}', 8, 8, 'js')).toEqual({ text: 'if (x) {\n  \n}', start: 11, end: 11 });
    expect(newline('def f():', 8, 8, 'python').text).toBe('def f():\n  ');
  });

  it('closes brackets, steps over closers, wraps selections', () => {
    expect(typeChar('f', 1, 1, '(')).toEqual({ text: 'f()', start: 2, end: 2 });
    expect(typeChar('f()', 2, 2, ')')).toEqual({ text: 'f()', start: 3, end: 3 });
    expect(typeChar('ab', 0, 2, '"')).toEqual({ text: '"ab"', start: 1, end: 3 });
    expect(typeChar("don", 3, 3, "'")).toBeNull();
    expect(typeChar('xy', 1, 1, '(')).toBeNull();
  });

  it('backspaces a pair, or a level of indentation', () => {
    expect(backspace('()', 1, 1)).toEqual({ text: '', start: 0, end: 0 });
    expect(backspace('    x', 4, 4)).toEqual({ text: '  x', start: 2, end: 2 });
  });

  it('toggles line comments at the block indentation', () => {
    const on = toggleComment('  a\n    b', 0, 9, 'typescript');
    expect(on.text).toBe('  // a\n  //   b');
    expect(toggleComment(on.text, 0, on.text.length, 'typescript').text).toBe('  a\n    b');
    expect(toggleComment('x', 0, 1, 'python').text).toBe('# x');
  });

  it('moves lines with the selection', () => {
    expect(moveLines('a\nb\nc', 2, 3, -1)).toEqual({ text: 'b\na\nc', start: 0, end: 1 });
    expect(moveLines('a\nb\nc', 0, 1, 1)).toEqual({ text: 'b\na\nc', start: 2, end: 3 });
  });
});
