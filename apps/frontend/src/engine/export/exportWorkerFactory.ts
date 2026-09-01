/**
 * Constructing the export worker, alone in a module.
 *
 * `new Worker(new URL('./exportWorker.ts', import.meta.url), ...)` is not an
 * ordinary expression: Vite recognises the pattern at transform time and
 * rewrites it into its own worker plumbing. That is what makes it work in a
 * build, and it is also why a test cannot reach it by stubbing the global
 * `Worker` -- the constructor the test replaces is never the one that runs.
 *
 * So it lives here, by itself, where a test can `vi.mock` the whole module.
 * The seam exists because the alternative is leaving the client's failure
 * handling uncovered, and its failure handling is the part that was wrong:
 * a dead worker used to leave its promise pending forever.
 */
export function createExportWorker(): Worker {
  return new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
}
