#!/usr/bin/env node
/**
 * Fetches the emoji sources into the gitignored `.emoji-sources/` folder:
 * a sparse, blob-filtered clone of microsoft/fluentui-emoji holding only
 * `assets/<Name>/metadata.json`, the Flat SVGs (all skin tones) and LICENSE,
 * plus Unicode's emoji-test.txt for ordering. Re-running updates the clone.
 *
 *   node scripts/emoji/fetch-emoji-sources.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCES = join(FRONTEND, '.emoji-sources');
const FLUENT = join(SOURCES, 'fluentui-emoji');
const REPO = 'https://github.com/microsoft/fluentui-emoji';
const EMOJI_TEST_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';

const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });

mkdirSync(SOURCES, { recursive: true });
writeFileSync(join(SOURCES, '.gitignore'), '*\n');

if (!existsSync(join(FLUENT, '.git'))) {
  git('clone', '--depth', '1', '--filter=blob:none', '--sparse', REPO, FLUENT);
} else {
  git('-C', FLUENT, 'pull', '--depth', '1', '--ff-only');
}
git('-C', FLUENT, 'sparse-checkout', 'set', '--no-cone', 'assets/*/metadata.json', '/**/Flat/*.svg', '/LICENSE');

const res = await fetch(EMOJI_TEST_URL);
if (!res.ok) throw new Error(`emoji-test.txt: HTTP ${res.status}`);
writeFileSync(join(SOURCES, 'emoji-test.txt'), await res.text());
console.log(`sources ready in ${SOURCES}`);
