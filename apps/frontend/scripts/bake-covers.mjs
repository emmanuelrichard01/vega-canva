/**
 * Bakes every template cover and prints them as JSON on stdout.
 *
 * Run by the `vega-template-covers` plugin in `vite.config.ts` as a child
 * process, not inside the build: the app modules a template pulls in start
 * timers at import, and in-process they kept the build from ever exiting.
 * A child that calls `process.exit` takes them with it.
 */
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const entry = fileURLToPath(new URL('../src/components/home/coverBake.ts', import.meta.url));
try {
  const { module } = await runnerImport(entry, { configFile: false, logLevel: 'error' });
  const result = await module.bakeCovers();
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
} catch (err) {
  console.error(err?.stack ?? String(err));
  process.exit(1);
}
