/**
 * Attribution for library tracks, read from each track's licence string. Pure.
 *
 * Some licences require it (freetouse.com tracks must be credited wherever
 * they play), so the player shows a credit for whatever is playing and a full
 * list on request. The licence string is the source of truth; this only
 * finds the parts worth showing.
 */
import type { LibraryTrack } from './manifest';

export interface Credit {
  title: string;
  artist: string;
  /** Where the track comes from, as a short name: "freetouse.com", "Pixabay". */
  source: string;
  /** A link for the source, when the licence gives one. https only. */
  url: string | null;
  /** The licence's name: "Free To Use", "Pixabay Content License". */
  licence: string;
  /** "Music: Title by Artist · Source". */
  line: string;
}

const KNOWN_SOURCES: { test: RegExp; name: string; fallbackUrl: string }[] = [
  { test: /freetouse/i, name: 'freetouse.com', fallbackUrl: 'https://freetouse.com/music' },
  { test: /pixabay/i, name: 'Pixabay', fallbackUrl: 'https://pixabay.com/service/license-summary/' },
];

const URL_RE = /https:\/\/[^\s"')]+/g;

function firstUrl(text: string, prefer?: RegExp): string | null {
  const all = (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, ''));
  return (prefer ? all.find((u) => prefer.test(u)) : undefined) ?? all[0] ?? null;
}

/** The licence's name: the text before its first bracket or sentence end ("CC BY 4.0" keeps its point). */
function licenceName(licence: string): string {
  const name = licence.split(/\s*\(|\.(?:\s|$)/)[0]?.trim() ?? '';
  return name.length > 0 && name.length <= 60 ? name : licence.slice(0, 60).trim();
}

export function creditFor(track: Pick<LibraryTrack, 'title' | 'artist' | 'licence'>): Credit {
  const known = KNOWN_SOURCES.find((s) => s.test.test(track.licence));
  const licence = licenceName(track.licence);
  const source = known?.name ?? licence;
  const url = known ? firstUrl(track.licence, known.test) ?? known.fallbackUrl : firstUrl(track.licence);
  return {
    title: track.title,
    artist: track.artist,
    source,
    url,
    licence,
    line: `Music: ${track.title} by ${track.artist} · ${source}`,
  };
}
