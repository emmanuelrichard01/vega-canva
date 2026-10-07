#!/usr/bin/env node
/**
 * What the dashboard downloads before it can render.
 *
 * Run after `vite build`: `node scripts/check-bundle.mjs [distDir]`.
 *
 * Walks the entry chunk's *static* imports (dynamic `import()` is what keeps
 * the board off this path, so it is not followed) and the stylesheets
 * `index.html` links, prints each with its gzipped size, and exits non-zero if
 * the closure reaches board-only code: any `app-*` chunk, Konva, or the Room
 * route. That is the regression that put ~550 kB of canvas code on `/`, and a
 * modulepreload filter could hide it from the HTML without removing it from
 * the import graph — so this reads the graph.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname, posix } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = process.argv[2] ?? join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No build at ${dist}. Run \`npx vite build\` first.`);
  process.exit(2);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = /<script[^>]+type="module"[^>]+src="\/([^"]+)"/.exec(html)?.[1];
if (!entry) {
  console.error('No module entry script in index.html.');
  process.exit(2);
}

const STATIC_IMPORT = /(?:^|[;\n}])\s*import\s*(?:[\w${},*\s]+from\s*)?["']\.\/([^"']+\.js)["']/g;
const seen = new Set();
const queue = [entry];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const src = readFileSync(join(dist, file), 'utf8');
  for (const m of src.matchAll(STATIC_IMPORT)) queue.push(posix.join(posix.dirname(file), m[1]));
}

const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+\.css)"/g)].map((m) => m[1]);
const gz = (f) => gzipSync(readFileSync(join(dist, f))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

let jsTotal = 0;
console.log('Static JS on the entry path:');
for (const f of seen) {
  const n = gz(f);
  jsTotal += n;
  console.log(`  ${basename(f).padEnd(44)} ${kb(n).padStart(10)} gz`);
}
let cssTotal = 0;
console.log('Render-blocking CSS:');
for (const f of css) {
  const n = gz(f);
  cssTotal += n;
  console.log(`  ${basename(f).padEnd(44)} ${kb(n).padStart(10)} gz`);
}
console.log(`Total: ${kb(jsTotal)} JS + ${kb(cssTotal)} CSS gzipped`);

const BOARD_ONLY = /^(app-|vendor-konva|Room)/;
const leaked = [...seen, ...css].map((f) => basename(f)).filter((f) => BOARD_ONLY.test(f));
if (leaked.length) {
  console.error(`\nBoard-only code on the dashboard path: ${leaked.join(', ')}`);
  process.exit(1);
}
console.log('OK: no board-only chunk on the entry path.');
