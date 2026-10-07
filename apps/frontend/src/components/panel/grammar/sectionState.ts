import { storageGetJson, storageSet } from '../../../utils/safeStorage';

/**
 * Which panel sections are open, remembered per (subject, section).
 *
 * Keyed by subject as well as section because the same section means
 * different things on different objects: someone who folds Typography away on
 * shapes still wants it open on a text box. A selection change re-mounts the
 * panel, so without this every fold came undone on the next click.
 */
export const SECTIONS_KEY = 'vega.panel.sections';

type OpenMap = Record<string, boolean>;

let cache: OpenMap | null = null;
const listeners = new Set<() => void>();

function read(): OpenMap {
  if (!cache) cache = storageGetJson<OpenMap>(SECTIONS_KEY, {});
  if (typeof cache !== 'object' || cache === null) cache = {};
  return cache;
}

export function sectionKey(subject: string, id: string): string {
  return `${subject}:${id}`;
}

export function isSectionOpen(subject: string, id: string, fallback: boolean): boolean {
  const stored = read()[sectionKey(subject, id)];
  return typeof stored === 'boolean' ? stored : fallback;
}

export function setSectionOpen(subject: string, id: string, open: boolean): void {
  const next = { ...read(), [sectionKey(subject, id)]: open };
  cache = next;
  storageSet(SECTIONS_KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

export function subscribeSections(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forget the in-memory copy so the next read comes from storage. Tests only. */
export function resetSectionCache(): void {
  cache = null;
}
