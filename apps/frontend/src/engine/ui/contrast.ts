import { useSyncExternalStore } from 'react';
import { storageGet, storageSet } from '../../utils/safeStorage';

/**
 * Increase contrast: a viewer preference, never a document property.
 *
 * Three values, because "off" and "follow the system" are different promises:
 * `system` tracks `prefers-contrast: more` (and forced colours) as the OS
 * setting changes, `on` and `off` pin the choice regardless of it.
 *
 * The effect is a single attribute, `data-contrast="more"` on the root
 * element. `styles/contrast.css` re-declares the colour tokens under it, so
 * every surface built on tokens follows without knowing this module exists.
 * The same decision is made before first paint by the boot script in
 * `index.html`, which reads the same storage key; keep the two in step.
 */
export type ContrastPreference = 'system' | 'on' | 'off';

export const CONTRAST_STORAGE_KEY = 'vega_contrast';
export const MORE_CONTRAST_QUERY = '(prefers-contrast: more)';
export const FORCED_COLORS_QUERY = '(forced-colors: active)';

const PREFERENCES: readonly ContrastPreference[] = ['system', 'on', 'off'];

export function parseContrastPreference(raw: string | null | undefined): ContrastPreference {
  return PREFERENCES.includes(raw as ContrastPreference) ? (raw as ContrastPreference) : 'system';
}

/**
 * Whether enhanced contrast applies.
 *
 * Forced colours count as asking for more contrast under `system`: the OS has
 * already replaced the palette, and what is left for the app to strengthen is
 * the non-colour half (ring width, opaque surfaces), which is exactly what a
 * forced-colours user wants.
 */
export function resolveContrast(
  preference: ContrastPreference,
  system: { moreContrast: boolean; forcedColors: boolean },
): boolean {
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return system.moreContrast || system.forcedColors;
}

function matches(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  } catch {
    return false;
  }
}

function readSystem() {
  return { moreContrast: matches(MORE_CONTRAST_QUERY), forcedColors: matches(FORCED_COLORS_QUERY) };
}

interface ContrastState {
  preference: ContrastPreference;
  enhanced: boolean;
}

let state: ContrastState = { preference: 'system', enhanced: false };
const listeners = new Set<() => void>();
let started = false;

function apply(): void {
  const enhanced = resolveContrast(state.preference, readSystem());
  if (enhanced !== state.enhanced) state = { ...state, enhanced };
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (enhanced) root.setAttribute('data-contrast', 'more');
  else root.removeAttribute('data-contrast');
}

function emit(): void {
  listeners.forEach((l) => l());
}

/**
 * Read the stored preference, apply it, and follow the OS setting from now on.
 * Idempotent; `main.tsx` calls it before the first render.
 */
export function initContrast(): void {
  if (started) return;
  started = true;
  state = { preference: parseContrastPreference(storageGet(CONTRAST_STORAGE_KEY)), enhanced: false };
  apply();
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const onSystemChange = () => {
    const before = state.enhanced;
    apply();
    if (state.enhanced !== before) emit();
  };
  for (const query of [MORE_CONTRAST_QUERY, FORCED_COLORS_QUERY]) {
    try {
      window.matchMedia(query).addEventListener('change', onSystemChange);
    } catch {
      // An engine without MediaQueryList events keeps the value it booted with.
    }
  }
}

export function getContrastPreference(): ContrastPreference {
  return state.preference;
}

/** Whether enhanced contrast is in effect right now, from any source. */
export function isContrastEnhanced(): boolean {
  return state.enhanced;
}

export function setContrastPreference(preference: ContrastPreference): void {
  if (!started) initContrast();
  state = { ...state, preference };
  storageSet(CONTRAST_STORAGE_KEY, preference);
  apply();
  emit();
}

/**
 * Cycle Standard → Increased → Standard, from whatever is in effect now.
 * For a keyboard command: pressing it always visibly changes something, which
 * stepping through `system` would not when the OS setting already matches.
 */
export function toggleContrast(): void {
  setContrastPreference(state.enhanced ? 'off' : 'on');
}

export function subscribeContrast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;

export function useContrast(): ContrastState & { setPreference: (p: ContrastPreference) => void } {
  const snapshot = useSyncExternalStore(subscribeContrast, getSnapshot, getSnapshot);
  return { ...snapshot, setPreference: setContrastPreference };
}

/**
 * Canvas chrome is drawn by Konva, which cannot read CSS custom properties, so
 * the handles, guides and selection outline take their weight from here.
 * `strokeScale` multiplies hairline widths; `halo` is drawn under a guide or
 * outline so it separates from whatever board content it crosses.
 */
export interface CanvasChromeContrast {
  strokeScale: number;
  halo: boolean;
}

export function canvasChromeContrast(enhanced = state.enhanced): CanvasChromeContrast {
  return enhanced ? { strokeScale: 1.75, halo: true } : { strokeScale: 1, halo: false };
}

/** Test seam: forget module state so each test boots from storage again. */
export function resetContrastForTests(): void {
  started = false;
  state = { preference: 'system', enhanced: false };
  listeners.clear();
}
