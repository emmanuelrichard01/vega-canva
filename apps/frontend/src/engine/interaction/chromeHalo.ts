import { useSyncExternalStore } from 'react';

/**
 * The board surface colour, for drawing a halo under canvas chrome.
 *
 * Konva cannot read CSS custom properties, so the value is read from the
 * element that carries the theme class (`body`, see App.tsx). Read at render,
 * so a theme change is picked up on the next draw.
 */
export function chromeSurfaceColor(): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return '#FFFFFF';
  try {
    const value = getComputedStyle(document.body).getPropertyValue('--surface-primary').trim();
    return value || (document.body.classList.contains('dark-theme') ? '#18181B' : '#FFFFFF');
  } catch {
    return '#FFFFFF';
  }
}

/** Halo width in screen pixels on each side of the line it sits under. */
export const HALO_PX = 2;

/**
 * A canvas-chrome colour token, read off <body> where the theme class lives.
 * Konva cannot resolve `var()`, so the value is read at draw time; `fallback`
 * covers a document without the stylesheet (tests, SSR).
 */
export function chromeToken(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  try {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

const isDark = () => typeof document !== 'undefined' && document.body.classList.contains('dark-theme');

function subscribeTheme(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/**
 * Whether the dark theme is on. Canvas chrome that bakes theme colours into
 * Konva nodes depends on this, so a theme switch redraws it.
 */
export function useChromeDark(): boolean {
  return useSyncExternalStore(subscribeTheme, isDark, () => false);
}
