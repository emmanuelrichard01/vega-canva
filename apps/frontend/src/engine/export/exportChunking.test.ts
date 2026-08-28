import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The export engine must not be a dependency of opening a board.
 *
 * ## The regression this exists to catch
 *
 * `vite.config.ts` puts `engine/export/` in its own lazily-fetched chunk,
 * which is right: the SVG writer, the PDF writer and the raster path behind
 * them come to about 440kB and most sessions never touch any of it. But a
 * chunk is only lazy if nothing on the critical path imports from it, and that
 * is a property of the *source* -- invisible at the point where the chunking
 * rule is written, and invisible in the build output, which lists a separate
 * file either way.
 *
 * It broke exactly that way. `chrome.ts` holds the name Konva tags interface
 * nodes with: 47 lines, one string constant and a helper, imported by twelve
 * canvas components. Living under `engine/export/` was enough to route it into
 * the lazy chunk, and importing it from the canvas was enough to make the
 * entire exporter a dependency of every board and of the dashboard. The bundle
 * looked correctly split the whole time. The split was doing nothing.
 *
 * So the invariant is checked rather than trusted. A module under
 * `engine/export/` may be imported from outside only if it is on the shared
 * list below, and that list is mirrored in `vite.config.ts`, which this also
 * checks. Adding a genuinely shared, lightweight module means adding it in
 * both places. Importing an exporter from the canvas means this fails.
 */

const SHARED = [
  'chrome',
  'DocumentImport',
  'restoreDocument',
  'pendingRestore',
  'exportScope',
  'renderScope',
  'isolate',
] as const;

const SRC = join(__dirname, '..', '..');

/** Paths with forward slashes, whatever the platform hands back. */
const slashed = (p: string): string => p.split(sep).join('/');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/[.]tsx?$/.test(entry) && !/[.]test[.]tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `engine/export/<name>` a file names, static import or dynamic. */
function exportImportsOf(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/['"][^'"]*engine[/]export[/]([A-Za-z0-9_]+)['"]/g)) {
    found.add(m[1]);
  }
  return [...found];
}

/** True when a file names the barrel in a *static* import. */
function staticallyImportsBarrel(source: string): boolean {
  return /import\s[^;]*from\s*['"][^'"]*engine[/]export['"]/.test(source);
}

/**
 * The dialog is the lazy chunk's entry point.
 *
 * It is itself only ever reached through `lazy()`, so anything it imports is
 * already behind the same fetch and may be as heavy as it likes. Every *other*
 * file in the app is on some path that opening a board takes.
 */
const CHUNK_ENTRY = 'components/ui/ExportModal.tsx';

describe('the export chunk stays lazy', () => {
  const outside = sourceFiles(SRC)
    .map(slashed)
    .filter((f) => !f.includes('/engine/export/') && !f.endsWith(CHUNK_ENTRY));

  it('has files to check', () => {
    // Guards the walk itself. A broken path would otherwise let every
    // assertion below pass triumphantly over an empty list.
    expect(outside.length).toBeGreaterThan(100);
  });

  it('is reached from outside only through modules the canvas genuinely shares', () => {
    const offenders: string[] = [];

    for (const file of outside) {
      for (const name of exportImportsOf(readFileSync(file, 'utf8'))) {
        if (!SHARED.includes(name as (typeof SHARED)[number])) {
          offenders.push(`${slashed(relative(SRC, file))} -> engine/export/${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is reached through the barrel only by a dynamic import', () => {
    // The barrel re-exports `ExportService`, so naming it in a static import
    // pulls every exporter behind it. Inside a handler it becomes a separate
    // fetch at the moment somebody actually exports something.
    const statics = outside
      .filter((f) => staticallyImportsBarrel(readFileSync(f, 'utf8')))
      .map((f) => slashed(relative(SRC, f)));

    expect(statics).toEqual([]);
  });

  it('agrees with the chunking rule in vite.config.ts', () => {
    const config = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8');
    const declaration = /const EXPORT_SHARED\s*=([\s\S]*?);/.exec(config);
    expect(declaration, 'EXPORT_SHARED not found in vite.config.ts').not.toBeNull();

    const alternation = /[(]([A-Za-z0-9_|]+)[)]/.exec(declaration![1]);
    expect(alternation, 'no alternation group in EXPORT_SHARED').not.toBeNull();
    expect(alternation![1].split('|').sort()).toEqual([...SHARED].sort());
  });
});
