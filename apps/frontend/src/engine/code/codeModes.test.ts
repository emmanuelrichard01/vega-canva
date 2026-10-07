import { describe, expect, it } from 'vitest';
import { diffLines, layoutCode } from './codeLayout';
import { CODE_THEMES, resolveCodeTheme } from './codeThemes';
import { HIGHLIGHT_LINE_CAP, MAX_LEXED_LINE, tokenize } from './codeTokenize';
import { defaultCodeSpec, normalizeCodeSpec } from './codeTypes';
import { codeToSvg } from './codeSvg';

describe('diff mode', () => {
  const source = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,2 +1,2 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;'].join('\n');

  it('marks added, removed and hunk lines, and leaves file headers alone', () => {
    const { marks } = diffLines(source);
    expect(marks).toEqual([undefined, undefined, 'hunk', undefined, 'del', 'add']);
  });

  it('blanks markers without moving any column', () => {
    const { masked } = diffLines(source);
    const before = source.split('\n');
    const after = masked.split('\n');
    after.forEach((line, i) => expect(line.length).toBe(before[i].length));
    expect(after[5]).toBe(' const b = 3;');
  });

  it('highlights the code after the marker as code', () => {
    const spec = { ...defaultCodeSpec(source, 'typescript'), diff: true };
    const layout = layoutCode(spec, 600, 8);
    const added = layout.rows.find((r) => r.diff === 'add')!;
    expect(added.tokens.some((t) => t.kind === 'keyword' && t.text === 'const')).toBe(true);
  });

  it('leaves rows unmarked outside diff mode', () => {
    const layout = layoutCode(defaultCodeSpec(source, 'typescript'), 600, 8);
    expect(layout.rows.every((r) => r.diff === undefined)).toBe(true);
  });

  it('exports changed rows with their tint and escapes the code', () => {
    const svg = codeToSvg({ ...defaultCodeSpec('+<script>alert(1)</script>', 'html'), diff: true }, 400, 120, 'x', false);
    expect(svg).toContain('rgba(63, 185, 80, 0.16)');
    expect(svg).not.toContain('<script>');
  });
});

describe('board-paired themes', () => {
  it('shows the partner that matches the board only when following it', () => {
    expect(resolveCodeTheme({ theme: 'midnight' }, false).id).toBe('midnight');
    expect(resolveCodeTheme({ theme: 'midnight', followBoard: true }, false).id).toBe('daylight');
    expect(resolveCodeTheme({ theme: 'daylight', followBoard: true }, true).id).toBe('midnight');
    expect(resolveCodeTheme({ theme: 'paper', followBoard: true }, true).id).toBe('dusk');
    expect(resolveCodeTheme({ theme: 'dusk', followBoard: true }, true)).toBe(CODE_THEMES.dusk);
  });

  it('reads the flags strictly and drops them when absent', () => {
    const spec = normalizeCodeSpec({ source: 'x', theme: 'paper', followBoard: 'yes', diff: true });
    expect(spec.followBoard).toBeUndefined();
    expect(spec.diff).toBe(true);
    expect('followBoard' in defaultCodeSpec() ? defaultCodeSpec().followBoard : undefined).toBeUndefined();
  });
});

describe('huge blocks', () => {
  it('stops colouring past the line cap but keeps every line', () => {
    const source = Array.from({ length: HIGHLIGHT_LINE_CAP + 5 }, () => 'const x = 1;').join('\n');
    const lines = tokenize(source, 'typescript');
    expect(lines).toHaveLength(HIGHLIGHT_LINE_CAP + 5);
    expect(lines[0].some((t) => t.kind === 'keyword')).toBe(true);
    expect(lines[HIGHLIGHT_LINE_CAP + 1]).toEqual([{ kind: 'plain', text: 'const x = 1;' }]);
  });

  it('draws a minified line as plain text', () => {
    const line = 'var a=1;'.repeat(Math.ceil(MAX_LEXED_LINE / 8) + 1);
    expect(tokenize(line, 'javascript')[0]).toEqual([{ kind: 'plain', text: line }]);
  });

  it('answers a repeated question from the cache', () => {
    expect(tokenize('let y = 2;', 'typescript')).toBe(tokenize('let y = 2;', 'typescript'));
  });
});
