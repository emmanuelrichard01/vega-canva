const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Postinstall check that esbuild can transform code.
 *
 * The root `package.json` overrides `esbuild` with `esbuild-wasm`, so Vite,
 * Vitest and tsx run esbuild as WebAssembly on every platform. That is
 * deliberate: on at least one development machine the native
 * `@esbuild/win32-x64/esbuild.exe` is blocked from executing (antivirus or a
 * policy on the OneDrive path), and with the native binary nothing that
 * transforms TypeScript can start. The cost is speed: WASM transforms are
 * slower than native ones, everywhere.
 *
 * This script changes nothing. It only reports, so a broken esbuild shows up
 * at install time with a cause rather than later as `spawn UNKNOWN`. It never
 * fails the install. Container builds skip it with `--ignore-scripts`.
 */
function checkEsbuild() {
  const root = path.resolve(__dirname, '..');
  const res = spawnSync(
    process.execPath,
    [
      '-e',
      'require("esbuild").transform("const x: number = 1;", { loader: "ts" })' +
        '.then(() => process.exit(0), () => process.exit(1));',
    ],
    { cwd: root, stdio: 'pipe', timeout: 60_000 }
  );
  if (res.status === 0) return true;

  console.warn(
    '[ensure-esbuild] esbuild could not transform a test file. Vite and Vitest will not start.\n' +
      '[ensure-esbuild] Check that the root package.json still overrides "esbuild" with "$esbuild-wasm",\n' +
      '[ensure-esbuild] then reinstall from the repository root.\n' +
      (res.stderr ? `[ensure-esbuild] ${String(res.stderr).trim().split('\n')[0]}` : '')
  );
  return false;
}

if (require.main === module) {
  checkEsbuild();
}

module.exports = { checkEsbuild };
