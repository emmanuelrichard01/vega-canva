import { isIconId, isPackId } from './iconSpec';
import type { IconCatalogue, IconEntry, IconPackIndex, IconPackInfo } from './iconTypes';

/**
 * Fetching icon packs, on demand.
 *
 * Nothing here runs until a board holds an icon or someone opens the library:
 * the index is a few kilobytes, a category file loads when an icon from it is
 * first drawn or browsed, and the search catalogue loads with the first query.
 * The packs are not in the entry graph (`scripts/check-bundle.mjs`), and this
 * module is only imported from code that is itself lazy.
 *
 * A failed fetch is remembered for `RETRY_MS`, so a board of five hundred icons
 * from an unreachable pack makes one request rather than five hundred, and
 * tries again later.
 */
const RETRY_MS = 15_000;
const FILE = /^[a-z0-9-]{1,24}\/[a-z0-9.-]{1,96}\.json$/;

const base = (): string => {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${b.endsWith('/') ? b : `${b}/`}icon-packs/`;
};

type Slot = { state: 'loading'; promise: Promise<unknown> } | { state: 'ready'; value: unknown } | { state: 'failed'; at: number };

const slots = new Map<string, Slot>();
const listeners = new Set<() => void>();
let epoch = 0;

/** A counter that changes whenever any pack data arrives or fails. */
export const iconPacksEpoch = () => epoch;
export function subscribeIconPacks(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const notify = () => {
  epoch++;
  listeners.forEach((l) => l());
};

let fetchJson: (url: string) => Promise<unknown> = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};
/** Replace the network. Tests only. */
export function setIconFetcher(fn: (url: string) => Promise<unknown>) {
  fetchJson = fn;
}
export function resetIconPacks() {
  slots.clear();
  epoch++;
}

function load<T>(key: string, url: string, accept: (raw: unknown) => T | null): Promise<T | null> {
  const slot = slots.get(key);
  if (slot?.state === 'ready') return Promise.resolve(slot.value as T);
  if (slot?.state === 'loading') return slot.promise as Promise<T | null>;
  if (slot?.state === 'failed' && Date.now() - slot.at < RETRY_MS) return Promise.resolve(null);
  const promise: Promise<T | null> = fetchJson(url)
    .then((raw) => {
      const value = accept(raw);
      if (value === null) throw new Error('malformed');
      slots.set(key, { state: 'ready', value });
      notify();
      return value;
    })
    .catch(() => {
      slots.set(key, { state: 'failed', at: Date.now() });
      notify();
      return null;
    });
  slots.set(key, { state: 'loading', promise });
  return promise;
}
const peek = <T,>(key: string): T | undefined => {
  const s = slots.get(key);
  return s?.state === 'ready' ? (s.value as T) : undefined;
};
const failed = (key: string) => {
  const s = slots.get(key);
  return s?.state === 'failed' && Date.now() - s.at < RETRY_MS;
};

const acceptIndex = (raw: unknown): IconPackIndex | null => {
  const r = raw as IconPackIndex;
  if (!r || !Array.isArray(r.packs)) return null;
  const packs = r.packs.filter(
    (p) =>
      isPackId(p?.id) &&
      Array.isArray(p.cats) &&
      FILE.test(p.catalogue) &&
      p.cats.every((c) => typeof c.id === 'string' && FILE.test(c.file)),
  );
  return { v: r.v, packs, unavailable: Array.isArray(r.unavailable) ? r.unavailable : [] };
};

export const loadPackIndex = () => load('index', `${base()}index.json`, acceptIndex);
export const packIndexNow = (): IconPackIndex | undefined => peek('index');
export const packInfoNow = (pack: string): IconPackInfo | undefined => packIndexNow()?.packs.find((p) => p.id === pack);
export const packIndexFailed = () => failed('index');

type Category = Map<string, IconEntry>;
const acceptCategory = (raw: unknown): Category | null => {
  const r = raw as { icons?: IconEntry[] };
  if (!r || !Array.isArray(r.icons)) return null;
  const m: Category = new Map();
  for (const e of r.icons) {
    if (e && typeof e.i === 'string' && Array.isArray(e.v) && Array.isArray(e.p)) m.set(e.i, e);
  }
  return m;
};

export async function loadCategory(pack: string, category: string): Promise<IconEntry[]> {
  const index = await loadPackIndex();
  const cat = index?.packs.find((p) => p.id === pack)?.cats.find((c) => c.id === category);
  if (!cat) return [];
  const m = await load(`cat:${pack}/${category}`, base() + cat.file, acceptCategory);
  return m ? [...m.values()] : [];
}

export async function loadCatalogue(pack: string): Promise<IconCatalogue | null> {
  const index = await loadPackIndex();
  const info = index?.packs.find((p) => p.id === pack);
  if (!info) return null;
  return load(`cata:${pack}`, base() + info.catalogue, (raw) => {
    const r = raw as IconCatalogue;
    return r && Array.isArray(r.icons) && Array.isArray(r.cats) ? r : null;
  });
}
export const catalogueNow = (pack: string): IconCatalogue | undefined => peek(`cata:${pack}`);
export const categoryNow = (pack: string, category: string): Category | undefined => peek(`cat:${pack}/${category}`);

/**
 * The artwork for a reference, without waiting.
 *
 * `undefined`: not here yet, and a load has been started.
 * `null`: it cannot be drawn (bad reference, unknown pack, failed load).
 */
export function iconEntryNow(pack: string, iconId: string): IconEntry | null | undefined {
  if (!isPackId(pack) || !isIconId(iconId)) return null;
  const index = packIndexNow();
  if (!index) {
    void loadPackIndex();
    return failed('index') ? null : undefined;
  }
  const slash = iconId.indexOf('/');
  const cat = iconId.slice(0, slash);
  const info = index.packs.find((p) => p.id === pack);
  if (!info?.cats.some((c) => c.id === cat)) return null;
  const m = categoryNow(pack, cat);
  if (m) return m.get(iconId.slice(slash + 1)) ?? null;
  void loadCategory(pack, cat);
  return failed(`cat:${pack}/${cat}`) ? null : undefined;
}

/** Resolve once every reference has either loaded or been ruled out. Used before export. */
export async function ensureIcons(refs: Array<{ pack: string; iconId: string }>): Promise<void> {
  await loadPackIndex();
  const wanted = new Set<string>();
  for (const r of refs) {
    if (isPackId(r.pack) && isIconId(r.iconId)) wanted.add(`${r.pack}|${r.iconId.slice(0, r.iconId.indexOf('/'))}`);
  }
  await Promise.all([...wanted].map((w) => loadCategory(w.split('|')[0], w.split('|')[1])));
}
