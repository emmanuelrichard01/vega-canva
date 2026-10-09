import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The elevation tokens resolve in both themes.
 *
 * `--shadow-xs` was used by two pressed segments and defined nowhere, so the
 * one that had no fallback drew no shadow at all and its raised state was a
 * colour change only. This reads every stylesheet for the `--shadow-*` names
 * in use and checks each is declared for the light root and the dark theme.
 */

const src = fileURLToPath(new URL('..', import.meta.url));
const index = readFileSync(join(src, 'index.css'), 'utf8');

function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} block`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

const declared = (body: string) => new Set([...body.matchAll(/(--shadow-[a-z]+)\s*:/g)].map((m) => m[1]));
const light = declared(block(index, '\n:root'));
const dark = declared(block(index, '\n.dark-theme'));
const used = new Set(
  cssFiles(src).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/var\((--shadow-[a-z]+)/g)].map((m) => m[1]))
);

describe('elevation tokens', () => {
  it('declares every shadow token in use for the light theme', () => {
    for (const name of used) expect(light.has(name), name).toBe(true);
  });

  it('declares every one again for the dark theme, where a light-theme shadow reads as nothing', () => {
    for (const name of light) expect(dark.has(name), name).toBe(true);
  });

  it('gives every layer an offset and a blur, not a flat halo', () => {
    const body = block(index, '\n:root');
    for (const name of ['--shadow-xs', '--shadow-sm', '--shadow-md', '--shadow-lg']) {
      const value = new RegExp(`${name}:\\s*([^;]+);`).exec(body)![1];
      for (const layer of value.split(/,(?![^(]*\))/)) {
        const [, y, blur] = layer.trim().split(/\s+/);
        expect(parseFloat(y), `${name} offset`).toBeGreaterThan(0);
        expect(parseFloat(blur), `${name} blur`).toBeGreaterThan(0);
      }
    }
  });
});
