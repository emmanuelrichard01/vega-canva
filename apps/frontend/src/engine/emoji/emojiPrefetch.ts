import { codeOf, emojiUrl } from './emojiCode';
import { loadEmojiIndex } from './emojiIndex';
import { recentEmoji } from './emojiPrefs';

/**
 * Warm the emoji picker while the board is idle, so opening it costs nothing.
 *
 * Opening the picker cold is a chain of round trips: the picker's script
 * chunk, then the catalogue, then the artwork of the first screen. On a slow
 * link each is a second or more. Once the board has settled this fetches the
 * catalogue and the first screen's artwork (recents plus the top of the first
 * category) at low priority, and the picker script with them. The files are
 * versioned and served immutable, so after the first visit all of this comes
 * from the browser's cache without a request.
 */

/** Recents plus the first rows of the first category: what the picker shows on open. */
export const FIRST_SCREEN = 64;

let scheduled = false;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

/** The codes the picker paints first, in order, without duplicates. */
export function firstScreenCodes(recents: readonly string[], firstCategory: readonly string[], limit = FIRST_SCREEN): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of [...recents.map(codeOf), ...firstCategory]) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= limit) break;
  }
  return out;
}

const warmed = new Set<string>();

/** Fetch and decode artwork off the critical path, so the picker's `<img>`s hit the cache. */
export function warmEmojiImages(codes: readonly string[]): void {
  if (typeof Image === 'undefined') return;
  for (const code of codes) {
    if (warmed.has(code)) continue;
    warmed.add(code);
    const img = new Image();
    img.decoding = 'async';
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
    img.src = emojiUrl(code);
  }
}

/**
 * Once per page: when the main thread is next idle, fetch the catalogue, the
 * picker chunk (`loadPicker`) and the first screen of artwork.
 */
export function scheduleEmojiPrefetch(loadPicker?: () => Promise<unknown>): void {
  if (scheduled || typeof window === 'undefined' || saveData()) return;
  scheduled = true;
  const run = () => {
    void loadPicker?.().catch(() => undefined);
    loadEmojiIndex()
      .then((index) => {
        const first = index.emoji.filter((e) => e.g === 0).slice(0, FIRST_SCREEN).map((e) => e.c);
        warmEmojiImages(firstScreenCodes(recentEmoji(), first));
      })
      .catch(() => {
        // Not fatal: the picker loads it on open and offers a retry.
      });
  };
  const w = window as IdleWindow;
  // Long enough after mount that the board's own first paint and sync come first.
  window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 4000 }) : run()), 2500);
}
