import type { EmojiEntry } from './emojiIndex';
import { nativeOf } from './emojiCode';

/**
 * The two things a picker remembers per viewer: what you used recently and
 * which skin tone you prefer.
 *
 * Browser storage, because both are conveniences of one person on one device —
 * never part of a board. Every access is guarded: storage throws in a private
 * window or with site data blocked, and the picker must work regardless.
 */

const RECENTS_KEY = 'vega_emoji_recents';
const TONE_KEY = 'vega_emoji_tone';
export const RECENTS_LIMIT = 24;

/** 0 is the default yellow; 1–5 are light to dark. */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

/** The modifier swatches the tone control shows, in order. */
export const SKIN_TONE_SWATCHES: ReadonlyArray<{ tone: SkinTone; label: string; color: string }> = [
  { tone: 0, label: 'Default', color: '#FFC83D' },
  { tone: 1, label: 'Light', color: '#F7D7C4' },
  { tone: 2, label: 'Medium-light', color: '#D8B094' },
  { tone: 3, label: 'Medium', color: '#BB9167' },
  { tone: 4, label: 'Medium-dark', color: '#8E562E' },
  { tone: 5, label: 'Dark', color: '#613D30' },
];

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference lasts for this page only */
  }
}

let recents: string[] | null = null;
let tone: SkinTone | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function subscribeEmojiPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Native glyphs, most recent first. */
export function recentEmoji(): readonly string[] {
  if (!recents) {
    try {
      const parsed = JSON.parse(read(RECENTS_KEY) ?? '[]');
      recents = Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string').slice(0, RECENTS_LIMIT) : [];
    } catch {
      recents = [];
    }
  }
  return recents;
}

export function pushRecentEmoji(native: string): void {
  if (!native) return;
  const next = [native, ...recentEmoji().filter((e) => e !== native)].slice(0, RECENTS_LIMIT);
  recents = next;
  write(RECENTS_KEY, JSON.stringify(next));
  emit();
}

export function skinTone(): SkinTone {
  if (tone === null) {
    const n = Number(read(TONE_KEY));
    tone = (Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0) as SkinTone;
  }
  return tone;
}

export function setSkinTone(next: SkinTone): void {
  tone = next;
  write(TONE_KEY, String(next));
  emit();
}

/** An entry as the chosen tone: its code and the glyph to insert. */
export function withTone(entry: EmojiEntry, t: SkinTone): { code: string; native: string } {
  if (t === 0 || !entry.s) return { code: entry.c, native: entry.u };
  const code = entry.s[t - 1];
  return { code, native: nativeOf(code) || entry.u };
}

/** For tests. */
export function resetEmojiPrefsForTests(): void {
  recents = null;
  tone = null;
}
