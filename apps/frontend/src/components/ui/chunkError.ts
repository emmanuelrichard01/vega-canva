/**
 * Whether an error is a lazily loaded chunk that could not be fetched.
 *
 * After a deploy, a tab that is still open asks for hashed chunk names that no
 * longer exist. That is not a bug in the page: a reload fixes it, and the
 * screen that reports it should say "a new version is available", not "this
 * board hit a problem".
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    error.message
  );
}

const RELOAD_KEY = 'vega_chunk_reload_at';
const RELOAD_WINDOW_MS = 30_000;

/**
 * Reload once to pick up the new build, unless this tab already tried in the
 * last 30 seconds. Returns whether a reload was started.
 *
 * The guard is what stops a chunk that is genuinely missing (a broken deploy,
 * not a stale tab) from reloading the page in a loop.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage there is no loop guard, so do not reload automatically.
    return false;
  }
  window.location.reload();
  return true;
}
