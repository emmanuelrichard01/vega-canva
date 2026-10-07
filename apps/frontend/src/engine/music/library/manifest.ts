/**
 * The music library manifest: which recordings exist and where they stream from.
 *
 * Tracks are never bundled. The manifest lists files on a CDN or bucket
 * (`VITE_MUSIC_BASE_URL`), and the player streams them with HTML audio.
 * Parsing is strict about the things that matter (a playable URL, a licence)
 * and forgiving about the rest: a bad entry is skipped and reported, never
 * allowed to break the whole library.
 *
 * Format:
 * ```json
 * { "version": 1,
 *   "tracks": [{ "id": "piano-001", "category": "piano", "title": "Morning Light",
 *                "artist": "Ana Ruiz", "duration": 184.2, "url": "piano/morning-light.mp3",
 *                "artwork": "piano/morning-light.jpg", "licence": "CC BY 4.0, Ana Ruiz" }] }
 * ```
 */

export interface LibraryTrack {
  id: string;
  category: string;
  title: string;
  artist: string;
  /** Seconds. */
  duration: number;
  /** Absolute, resolved against the base URL. */
  url: string;
  artwork: string | null;
  licence: string;
}

export interface ParsedManifest {
  tracks: LibraryTrack[];
  /** Categories in first-appearance order. */
  categories: string[];
  /** One line per skipped entry, for the console and the deploy docs' checklist. */
  problems: string[];
}

export const MAX_TRACKS = 5000;
const CATEGORY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const KNOWN_CATEGORIES: Record<string, string> = {
  ambient: 'Acoustic Ambient',
  piano: 'Peaceful Piano',
  lofi: 'Lo-fi',
  synth: 'Synth',
  house: 'House',
  retro: 'Retro',
};

/** A category's display name: the known label, or the slug in title case. */
export function categoryLabel(category: string): string {
  return KNOWN_CATEGORIES[category] ?? category.replace(/-+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolves `ref` against `base`, allowing only http(s).
 *
 * A plain `http:` URL is accepted only when the base itself is http (local
 * development); a secure page would refuse to play it anyway.
 */
export function resolveMediaUrl(ref: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(ref, base);
  } catch {
    return null;
  }
  const baseProtocol = (() => {
    try {
      return new URL(base).protocol;
    } catch {
      return 'https:';
    }
  })();
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && baseProtocol === 'http:') return url.toString();
  return null;
}

const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};

export function parseManifest(raw: unknown, base: string): ParsedManifest {
  const problems: string[] = [];
  const tracks: LibraryTrack[] = [];
  const categories: string[] = [];
  const ids = new Set<string>();

  const root = raw as { version?: unknown; tracks?: unknown } | null;
  if (!root || typeof root !== 'object' || !Array.isArray(root.tracks)) {
    return { tracks, categories, problems: ['The manifest has no "tracks" array.'] };
  }
  if (root.version !== undefined && root.version !== 1) problems.push(`Unknown manifest version ${String(root.version)}; reading it as version 1.`);

  const entries = root.tracks.slice(0, MAX_TRACKS);
  if (root.tracks.length > MAX_TRACKS) problems.push(`Only the first ${MAX_TRACKS} tracks are read.`);

  entries.forEach((entry, i) => {
    const e = entry as Record<string, unknown> | null;
    const where = `Track ${i + 1}`;
    if (!e || typeof e !== 'object') {
      problems.push(`${where}: not an object.`);
      return;
    }
    const title = str(e.title);
    const label = title ? `${where} ("${title}")` : where;
    const category = typeof e.category === 'string' ? e.category.trim().toLowerCase() : '';
    const artist = str(e.artist) ?? 'Unknown artist';
    const licence = str(e.licence ?? e.license, 300);
    const urlRef = str(e.url, 2000);
    const duration = typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration > 0 && e.duration < 6 * 3600 ? e.duration : null;

    if (!title) return void problems.push(`${label}: missing title.`);
    if (!CATEGORY_RE.test(category)) return void problems.push(`${label}: category must be a lowercase slug, got "${String(e.category ?? '')}".`);
    if (!licence) return void problems.push(`${label}: missing licence. Every track must say how it may be used.`);
    if (!urlRef) return void problems.push(`${label}: missing url.`);
    const url = resolveMediaUrl(urlRef, base);
    if (!url) return void problems.push(`${label}: url "${urlRef}" is not an http(s) address.`);
    if (!duration) return void problems.push(`${label}: duration must be a positive number of seconds.`);
    const artworkRef = str(e.artwork, 2000);
    const artwork = artworkRef ? resolveMediaUrl(artworkRef, base) : null;
    if (artworkRef && !artwork) problems.push(`${label}: artwork "${artworkRef}" ignored; it is not an http(s) address.`);

    let id = str(e.id, 120) ?? `${category}:${title}`;
    if (ids.has(id)) {
      problems.push(`${label}: duplicate id "${id}"; renamed.`);
      let n = 2;
      while (ids.has(`${id}~${n}`)) n++;
      id = `${id}~${n}`;
    }
    ids.add(id);
    if (!categories.includes(category)) categories.push(category);
    tracks.push({ id, category, title, artist, duration, url, artwork, licence });
  });

  return { tracks, categories, problems };
}

/** "3:04"; hours when needed. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
