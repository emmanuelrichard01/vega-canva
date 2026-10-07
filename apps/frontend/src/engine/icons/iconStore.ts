import { useSyncExternalStore } from 'react';

/**
 * Whether the icon browser is open, and what it should show.
 *
 * A tiny store with no dependencies so the dock, the command palette, the
 * shapes flyout and the keyboard can all open the browser without importing it
 * (the browser, and every pack, load lazily when this says `open`).
 */
export interface IconBrowserState {
  open: boolean;
  pack?: string;
  query?: string;
  /** Changes on every open call, so reopening with the same options still resets the browser. */
  nonce: number;
}

/**
 * The packs the build produces, by name, for surfaces that list them without
 * loading anything (the command palette). The browser itself reads the real
 * index and greys out any pack that did not ship.
 */
export const ICON_PACK_LABELS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'aws', name: 'AWS' },
  { id: 'azure', name: 'Azure' },
  { id: 'gcp', name: 'Google Cloud' },
  { id: 'k8s', name: 'Kubernetes' },
];

let state: IconBrowserState = { open: false, nonce: 0 };
const listeners = new Set<() => void>();
const set = (next: IconBrowserState) => {
  state = next;
  listeners.forEach((l) => l());
};

export function openIconBrowser(opts: { pack?: string; query?: string } = {}) {
  set({ open: true, pack: opts.pack, query: opts.query, nonce: state.nonce + 1 });
}
export function closeIconBrowser() {
  if (state.open) set({ ...state, open: false });
}
export function toggleIconBrowser(opts: { pack?: string; query?: string } = {}) {
  if (state.open) closeIconBrowser();
  else openIconBrowser(opts);
}
export const iconBrowserState = () => state;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const useIconBrowser = (): IconBrowserState => useSyncExternalStore(subscribe, iconBrowserState, iconBrowserState);

// ------------------------------------------------------------------ recents

const RECENT_KEY = 'vega.icons.recent';
const MAX_RECENT = 24;
export interface RecentIcon {
  pack: string;
  iconId: string;
}

export function readRecentIcons(): RecentIcon[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((r) => typeof r?.pack === 'string' && typeof r?.iconId === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
export function rememberIcon(r: RecentIcon) {
  try {
    const next = [r, ...readRecentIcons().filter((x) => !(x.pack === r.pack && x.iconId === r.iconId))].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage can be unavailable; recents are a convenience */
  }
}
