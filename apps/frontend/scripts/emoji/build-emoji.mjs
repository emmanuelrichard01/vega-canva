#!/usr/bin/env node
/**
 * Builds the emoji pack from Microsoft Fluent Emoji (Flat style, MIT).
 *
 *   node scripts/emoji/fetch-emoji-sources.mjs   # once: sparse clone + emoji-test.txt
 *   node scripts/emoji/build-emoji.mjs
 *
 * Reads `.emoji-sources/` (gitignored) and writes:
 *   public/emoji/<code>.svg          one sanitised, optimised SVG per emoji / skin tone
 *   public/emoji/index.json          compact catalogue (order, names, keywords, tones)
 *   public/emoji/LICENSE.md          attribution
 *   src/engine/emoji/emojiVersion.ts content hash + count for cache busting
 *
 * The Unicode emoji-test.txt file is used only for ordering and grouping; it
 * is not redistributed.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { codeFromSequence, sanitizeSvg } from './sanitizeSvg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..', '..');
const SOURCES = join(FRONTEND, '.emoji-sources');
const FLUENT = join(SOURCES, 'fluentui-emoji');
const ASSETS = join(FLUENT, 'assets');
const EMOJI_TEST = join(SOURCES, 'emoji-test.txt');
const OUT = join(FRONTEND, 'public', 'emoji');
const VERSION_FILE = join(FRONTEND, 'src', 'engine', 'emoji', 'emojiVersion.ts');
const SOURCE_URL = 'https://github.com/microsoft/fluentui-emoji';

const CATEGORIES = [
  { id: 'smileys', label: 'Smileys & emotion' },
  { id: 'people', label: 'People & body' },
  { id: 'animals', label: 'Animals & nature' },
  { id: 'food', label: 'Food & drink' },
  { id: 'travel', label: 'Travel & places' },
  { id: 'activities', label: 'Activities' },
  { id: 'objects', label: 'Objects' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'flags', label: 'Flags' },
];
const GROUP_INDEX = {
  'Smileys & Emotion': 0,
  'People & Body': 1,
  'Animals & Nature': 2,
  'Food & Drink': 3,
  'Travel & Places': 4,
  Activities: 5,
  Objects: 6,
  Symbols: 7,
  Flags: 8,
};
/** Fluent tone folder -> Unicode skin-tone modifier, in output order. */
const TONES = [
  ['Light', '1f3fb'],
  ['Medium-Light', '1f3fc'],
  ['Medium', '1f3fd'],
  ['Medium-Dark', '1f3fe'],
  ['Dark', '1f3ff'],
];
const MODIFIERS = new Set(TONES.map(([, m]) => m));

function fail(msg) {
  console.error(`build-emoji: ${msg}`);
  process.exit(1);
}

if (!existsSync(ASSETS)) fail(`missing ${ASSETS}. Run: node scripts/emoji/fetch-emoji-sources.mjs`);
if (!existsSync(EMOJI_TEST)) fail(`missing ${EMOJI_TEST}. Run: node scripts/emoji/fetch-emoji-sources.mjs`);

/* ---- Unicode ordering ------------------------------------------------ */

/** code -> { order, group, glyph } for fully-qualified emoji. */
const unicode = new Map();
{
  let group = '';
  let order = 0;
  for (const line of readFileSync(EMOJI_TEST, 'utf8').split(/\r?\n/)) {
    const g = /^# group: (.+)$/.exec(line);
    if (g) { group = g[1].trim(); continue; }
    const m = /^([0-9A-F ]+?)\s*;\s*fully-qualified\s*#\s*(\S+)/.exec(line);
    if (!m) continue;
    const glyph = String.fromCodePoint(...m[1].trim().split(/\s+/).map((h) => parseInt(h, 16)));
    const code = codeFromSequence(glyph);
    if (!unicode.has(code)) unicode.set(code, { order: order++, group, glyph });
  }
}

/* ---- Fluent sources -------------------------------------------------- */

function flatSvg(dir) {
  const flat = join(dir, 'Flat');
  if (!existsSync(flat)) return null;
  const file = readdirSync(flat).find((f) => f.endsWith('.svg'));
  return file ? join(flat, file) : null;
}

function fluentCommit() {
  try {
    return execFileSync('git', ['-C', FLUENT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    try {
      const head = readFileSync(join(FLUENT, '.git', 'HEAD'), 'utf8').trim();
      if (!head.startsWith('ref:')) return head;
      return readFileSync(join(FLUENT, '.git', head.slice(5).trim()), 'utf8').trim();
    } catch {
      return 'unknown';
    }
  }
}

const words = (s) => s.toLowerCase().split(/[^\p{L}\p{N}+'’-]+/u).filter(Boolean);

function keywordsFor(name, keywords) {
  const nameWords = new Set(words(name));
  const out = [];
  const seen = new Set();
  for (const raw of keywords ?? []) {
    const k = String(raw).toLowerCase().trim().replace(/\s+/g, ' ');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const kw = words(k);
    if (kw.length && kw.every((w) => nameWords.has(w))) continue;
    out.push(k);
    if (out.length === 12) break;
  }
  return out;
}

const records = [];
const files = new Map(); // filename -> svg text
const skipped = [];
const warningsByEmoji = [];
const seenCodes = new Set();

function sanitizeFile(path, code) {
  const raw = readFileSync(path, 'utf8');
  const result = sanitizeSvg(raw, `e${code}_`);
  if (result?.warnings.length) warningsByEmoji.push(`${code}: ${result.warnings.join('; ')}`);
  return result?.svg ?? null;
}

for (const name of readdirSync(ASSETS).sort()) {
  const dir = join(ASSETS, name);
  const metaPath = join(dir, 'metadata.json');
  if (!existsSync(metaPath)) continue;
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    skipped.push(`${name} (bad metadata.json)`);
    continue;
  }
  let code = codeFromSequence(meta.glyph ?? '');
  // A few metadata glyphs are truncated (e.g. "woman in motorized wheelchair
  // facing right" lacks its ZWJ arrow); trust the `unicode` field when it
  // names a different, real emoji.
  const fromUnicode = String(meta.unicode ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((h) => parseInt(h, 16).toString(16))
    .filter((h) => h !== 'fe0f')
    .join('-');
  if (fromUnicode && fromUnicode !== code && unicode.has(fromUnicode)) {
    console.log(`note: ${name} glyph ${code || '(none)'} disagrees with unicode ${fromUnicode}; using ${fromUnicode}`);
    code = fromUnicode;
  }
  if (!code) { skipped.push(`${name} (no glyph)`); continue; }
  const uni = unicode.get(code);
  if (uni?.group === 'Component') { skipped.push(`${name} (${code}, Unicode component)`); continue; }
  const g = uni ? GROUP_INDEX[uni.group] : GROUP_INDEX[meta.group];
  if (g === undefined) { skipped.push(`${name} (${code}, unknown group ${uni?.group ?? meta.group})`); continue; }
  if (seenCodes.has(code)) { skipped.push(`${name} (${code}, duplicate code)`); continue; }

  const toned = Array.isArray(meta.unicodeSkintones) && existsSync(join(dir, 'Default'));
  const basePath = flatSvg(toned ? join(dir, 'Default') : dir);
  if (!basePath) { skipped.push(`${name} (${code}, no Flat svg)`); continue; }
  const base = sanitizeFile(basePath, code);
  if (!base) { skipped.push(`${name} (${code}, sanitiser rejected Flat svg)`); continue; }

  let tones;
  if (toned) {
    const variants = [];
    for (const [folder, modifier] of TONES) {
      const seq = meta.unicodeSkintones
        .map((s) => String(s).toLowerCase().split(/\s+/).filter((h) => h && h !== 'fe0f'))
        .find((parts) => parts.includes(modifier) && parts.every((p) => !MODIFIERS.has(p) || p === modifier));
      const path = flatSvg(join(dir, folder));
      if (!seq || !path) { variants.length = 0; break; }
      const toneCode = seq.join('-');
      const svg = sanitizeFile(path, toneCode);
      if (!svg) { variants.length = 0; break; }
      variants.push([toneCode, svg]);
    }
    if (variants.length === 5) {
      tones = variants.map(([c]) => c);
      for (const [c, svg] of variants) files.set(`${c}.svg`, svg);
    } else {
      skipped.push(`${name} (${code}, skin tones incomplete: base kept without tones)`);
    }
  }

  seenCodes.add(code);
  files.set(`${code}.svg`, base);
  const n = String(meta.cldr || meta.tts || name).toLowerCase().trim();
  const rec = { c: code, u: uni?.glyph ?? meta.glyph, n, k: keywordsFor(n, meta.keywords), g };
  if (tones) rec.s = tones;
  records.push({ rec, order: uni ? uni.order : Number.POSITIVE_INFINITY });
}

records.sort((a, b) => a.rec.g - b.rec.g || a.order - b.order || a.rec.n.localeCompare(b.rec.n));
const emoji = records.map((r) => r.rec);

/* ---- Hash + write ---------------------------------------------------- */

const names = [...files.keys()].sort();
const body = JSON.stringify({ categories: CATEGORIES, emoji });
const hash = createHash('sha256');
for (const f of names) hash.update(f).update('\0').update(files.get(f)).update('\0');
hash.update(body);
const version = hash.digest('hex').slice(0, 10);
const index = JSON.stringify({ version, categories: CATEGORIES, emoji });

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.svg')) rmSync(join(OUT, f));
for (const f of names) writeFileSync(join(OUT, f), files.get(f));
writeFileSync(join(OUT, 'index.json'), index);

const commit = fluentCommit();
const licenseText = readFileSync(join(FLUENT, 'LICENSE'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .join('\n')
  .trim();
writeFileSync(
  join(OUT, 'LICENSE.md'),
  `# Emoji artwork

The SVG files in this folder are the **Flat** style of
[Microsoft Fluent Emoji](${SOURCE_URL}), Copyright (c) Microsoft Corporation,
used under the MIT License.

- Source: ${SOURCE_URL}
- Commit: ${commit}

The files were sanitised and optimised for this project: only drawing
elements and attributes were kept (filters, scripts, styles and any external
references were removed), numbers were rounded to two decimals, and every
\`id\` was prefixed with the emoji's code so that several emoji can be inlined
into one SVG document. They are otherwise unmodified.

\`index.json\` orders and groups the emoji following the Unicode emoji-test
data; names and keywords come from the Fluent Emoji metadata.

## License

\`\`\`
${licenseText}
\`\`\`
`,
);

mkdirSync(dirname(VERSION_FILE), { recursive: true });
writeFileSync(
  VERSION_FILE,
  `/** Generated by scripts/emoji/build-emoji.mjs. Do not edit. */\nexport const EMOJI_VERSION = '${version}';\nexport const EMOJI_COUNT = ${emoji.length};\n`,
);

/* ---- Summary --------------------------------------------------------- */

let raw = 0;
let gz = 0;
const sizes = [];
for (const f of names) {
  const buf = Buffer.from(files.get(f));
  raw += buf.length;
  gz += gzipSync(buf, { level: 9 }).length;
  sizes.push([f, buf.length]);
}
sizes.sort((a, b) => b[1] - a[1]);
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const tonedFiles = emoji.reduce((sum, e) => sum + (e.s?.length ?? 0), 0);
console.log(`Fluent Emoji commit ${commit}`);
console.log(`emoji:        ${emoji.length} (${emoji.filter((e) => e.s).length} with skin tones)`);
console.log(`toned files:  ${tonedFiles}`);
console.log(`svg files:    ${names.length}, ${kb(raw)} raw, ~${kb(gz)} gzip (per-file)`);
console.log(`index.json:   ${kb(index.length)} raw, ~${kb(gzipSync(index, { level: 9 }).length)} gzip`);
console.log(`version:      ${version}`);
console.log('per category: ' + CATEGORIES.map((c, i) => `${c.id} ${emoji.filter((e) => e.g === i).length}`).join(', '));
console.log('largest:      ' + sizes.slice(0, 5).map(([f, b]) => `${f} ${kb(b)}`).join(', '));
const notInUnicode = records.filter((r) => r.order === Number.POSITIVE_INFINITY).map((r) => r.rec.c);
if (notInUnicode.length) console.log(`not in emoji-test.txt (appended to their group): ${notInUnicode.join(', ')}`);
console.log(`skipped (${skipped.length}):${skipped.length ? '\n  ' + skipped.join('\n  ') : ' none'}`);
if (warningsByEmoji.length) console.log(`sanitiser warnings (${warningsByEmoji.length} files):\n  ${warningsByEmoji.join('\n  ')}`);
