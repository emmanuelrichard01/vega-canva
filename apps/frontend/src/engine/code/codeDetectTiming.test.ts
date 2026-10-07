import { describe, expect, it } from 'vitest';
import { detectLanguage, looksLikeCode, DETECT_LIMIT } from './codeDetect';

/**
 * Detection runs on every multi-line paste and every keystroke in the code
 * editor, so a pattern that backtracks freezes the page. Each input below is
 * shaped to defeat one family of regex: long whitespace runs after a keyword,
 * thousands of line starts, and repeated openers with no closer. Each must
 * finish in well under a frame budget's worth of a second.
 */
const N = 20_000;
const ADVERSARIAL: Record<string, string> = {
  importSpaces: 'import ' + ' '.repeat(N) + 'x',
  importTabs: 'import\t' + '\t'.repeat(N),
  blankLines: '\n'.repeat(N) + 'x',
  spacedLines: ' \n'.repeat(N / 2),
  defArrow: 'def f() -> ' + ' '.repeat(N) + 'x',
  ifColons: 'if ' + ':'.repeat(N) + 'x',
  cssSelectors: 'a '.repeat(N / 2) + '\n'.repeat(10),
  cssDecls: ('a: b\n').repeat(N / 5),
  brackets: '['.repeat(N),
  stars: '**'.repeat(N / 2),
  tags: '<p'.repeat(N / 2),
  generics: 'interface A<' + '<'.repeat(N),
  graphql: 'query q ' + '('.repeat(N),
};

describe('detectLanguage is linear on hostile input', () => {
  for (const [name, input] of Object.entries(ADVERSARIAL)) {
    it(name, () => {
      const started = performance.now();
      detectLanguage(input);
      looksLikeCode(input + '\nfoo');
      expect(performance.now() - started).toBeLessThan(250);
    });
  }

  it('reads only the first DETECT_LIMIT characters', () => {
    // A language mark past the limit is not evidence.
    const late = ' '.repeat(DETECT_LIMIT) + '\n#!/bin/bash\necho hi\n';
    expect(detectLanguage(late).language).not.toBe('bash');
  });
});

describe('detectLanguage still recognises ordinary snippets', () => {
  const cases: Array<[string, string]> = [
    ['typescript', "import { a } from 'b';\ninterface Foo { x: number }\nconst y: string = 'z';"],
    ['javascript', "const x = require('y');\nfunction go() {\n  console.log(x);\n}"],
    ['python', 'def main(argv) -> int:\n    if argv:\n        print(argv)\n    return 0'],
    ['sql', 'SELECT id, name\nFROM users\nWHERE active = 1\nORDER BY name'],
    ['css', '.card {\n  color: red;\n  margin: 0 auto;\n}'],
    ['bash', '#!/bin/bash\nnpm install\necho done'],
    ['go', 'package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("hi")\n}'],
    ['rust', 'fn main() {\n    let mut x = 1;\n    println!("{}", x);\n}'],
  ];
  for (const [lang, src] of cases) {
    it(lang, () => expect(detectLanguage(src).language).toBe(lang));
  }
});
