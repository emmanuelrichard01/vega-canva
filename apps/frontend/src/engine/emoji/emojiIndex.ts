import { codeOf, emojiIndexUrl } from './emojiCode';

/**
 * The emoji catalogue, fetched the first time somebody opens a picker.
 *
 * Nothing about it is bundled: the board's own JavaScript carries only this
 * loader, and the dashboard carries nothing at all. The file is written by
 * `scripts/emoji/build-emoji.mjs`; its compact keys are documented there and
 * named here.
 */

export interface EmojiCategory {
  id: string;
  label: string;
}

export interface EmojiEntry {
  /** File code, see `codeOf`. */
  c: string;
  /** The fully-qualified native glyph. */
  u: string;
  /** Lowercase CLDR name. */
  n: string;
  /** Extra search words, not repeating the name. */
  k: string[];
  /** Index into `categories`. */
  g: number;
  /** Skin-tone codes, light to dark, when the emoji has them. */
  s?: string[];
}

export interface EmojiIndex {
  version: string;
  categories: EmojiCategory[];
  emoji: EmojiEntry[];
  /** Built on load: code → entry, for every base and toned code. */
  byCode: Map<string, EmojiEntry>;
}

/** Validates the parsed file, dropping anything that is not the documented shape. */
export function buildIndex(raw: unknown): EmojiIndex {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const categories = Array.isArray(data.categories)
    ? data.categories.filter(
        (c): c is EmojiCategory =>
          Boolean(c) && typeof (c as EmojiCategory).id === 'string' && typeof (c as EmojiCategory).label === 'string'
      )
    : [];
  const emoji: EmojiEntry[] = [];
  const byCode = new Map<string, EmojiEntry>();
  if (Array.isArray(data.emoji)) {
    for (const item of data.emoji) {
      const e = item as Partial<EmojiEntry> | null;
      if (!e || typeof e.c !== 'string' || typeof e.u !== 'string' || typeof e.n !== 'string') continue;
      if (!/^[0-9a-f-]+$/.test(e.c)) continue;
      const entry: EmojiEntry = {
        c: e.c,
        u: e.u,
        n: e.n,
        k: Array.isArray(e.k) ? e.k.filter((w): w is string => typeof w === 'string') : [],
        g: typeof e.g === 'number' && e.g >= 0 && e.g < categories.length ? e.g : Math.max(0, categories.length - 1),
        s:
          Array.isArray(e.s) && e.s.length === 5 && e.s.every((t) => typeof t === 'string' && /^[0-9a-f-]+$/.test(t))
            ? (e.s as string[])
            : undefined,
      };
      emoji.push(entry);
      byCode.set(entry.c, entry);
      entry.s?.forEach((t) => byCode.set(t, entry));
    }
  }
  return { version: typeof data.version === 'string' ? data.version : '', categories, emoji, byCode };
}

let loaded: EmojiIndex | null = null;
let pending: Promise<EmojiIndex> | null = null;
const listeners = new Set<() => void>();

/** The catalogue if it has arrived, else null. Never starts a fetch. */
export function emojiIndexNow(): EmojiIndex | null {
  return loaded;
}

export function subscribeEmojiIndex(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Fetch the catalogue once. A failure is not remembered, so the next open
 * tries again rather than leaving the picker broken for the rest of the visit.
 */
export function loadEmojiIndex(fetcher: typeof fetch = fetch): Promise<EmojiIndex> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= fetcher(emojiIndexUrl())
    .then((res) => {
      if (!res.ok) throw new Error(`Emoji index: HTTP ${res.status}`);
      return res.json();
    })
    .then((json) => {
      loaded = buildIndex(json);
      listeners.forEach((fn) => fn());
      return loaded;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** For tests: forget what was loaded. */
export function resetEmojiIndexForTests(): void {
  loaded = null;
  pending = null;
}

/** The catalogue entry for a native glyph or code, toned variants included. */
export function lookupEmoji(index: EmojiIndex, nativeOrCode: string): EmojiEntry | undefined {
  return index.byCode.get(nativeOrCode) ?? index.byCode.get(codeOf(nativeOrCode));
}

/** `grinning face` → `grinning_face`, the `:shortcode` people type. */
export function shortcodeOf(entry: Pick<EmojiEntry, 'n'>): string {
  return entry.n
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Rank emoji against a query.
 *
 * Every word of the query must match the start of a word in the name or a
 * keyword (so `thu up` finds thumbs up, and `cat` does not find "communicate").
 * Within that, an exact name beats a name prefix beats a name word beats a
 * keyword, and ties keep catalogue order, which is Unicode's own ordering and
 * the one people recognise.
 */
export function searchEmoji(index: Pick<EmojiIndex, 'emoji'>, query: string, limit = 400): EmojiEntry[] {
  const words = query
    .toLowerCase()
    .replace(/^:/, '')
    .split(/[\s_]+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const phrase = words.join(' ');

  const scored: Array<{ e: EmojiEntry; score: number; i: number }> = [];
  index.emoji.forEach((e, i) => {
    const nameWords = e.n.split(/[\s:_-]+/);
    let score = 0;
    for (const w of words) {
      let best = 0;
      for (const nw of nameWords) if (nw.startsWith(w)) best = Math.max(best, nw === w ? 4 : 3);
      if (!best) for (const k of e.k) if (k.startsWith(w)) best = Math.max(best, k === w ? 2 : 1);
      if (!best) return;
      score += best;
    }
    if (e.n === phrase) score += 100;
    else if (e.n.startsWith(phrase)) score += 20;
    if (e.u === query.trim()) score += 200;
    scored.push({ e, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.e);
}
