const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Self-healing esbuild setup for environments where native binaries are blocked
 * (such as Windows Defender heuristic false-positives on Go binaries).
 *
 * If native esbuild works, this script does nothing. If esbuild fails to spawn,
 * it safely copies esbuild-wasm into place so local tests and Vite run cleanly.
 */
function ensureEsbuild() {
  const root = path.resolve(__dirname, '..');
  const esbuildPkg = path.join(root, 'node_modules', 'esbuild');
  const wasmPkg = path.join(root, 'node_modules', 'esbuild-wasm');

  if (!fs.existsSync(esbuildPkg) || !fs.existsSync(wasmPkg)) return;

  try {
    const res = spawnSync(
      process.execPath,
      ['-e', 'require("esbuild").transform("const x: number = 1;", { loader: "ts" }).then(() => process.exit(0)).catch(() => process.exit(1));'],
      { cwd: root, stdio: 'pipe' }
    );
    if (res.status === 0) {
      return; // Working esbuild already active
    }
  } catch {
    // Need fallback
  }

  console.log('[esbuild-fallback] Native esbuild execution blocked. Activating WebAssembly fallback...');
  try {
    const files = fs.readdirSync(wasmPkg);
    for (const file of files) {
      const src = path.join(wasmPkg, file);
      const dest = path.join(esbuildPkg, file);
      fs.cpSync(src, dest, { recursive: true, force: true });
    }
    console.log('[esbuild-fallback] esbuild-wasm successfully activated.');
  } catch (err) {
    console.warn('[esbuild-fallback] Warning: could not apply fallback:', err.message);
  }
}

if (require.main === module) {
  ensureEsbuild();
}

module.exports = { ensureEsbuild };
