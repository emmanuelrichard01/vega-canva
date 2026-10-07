import { useSyncExternalStore } from 'react';
import { ThemeService } from '../../engine/ThemeService';

/**
 * The theme's ink, re-read when the theme flips.
 *
 * The theme is the `dark-theme` class on `body`, so this watches that one
 * attribute. The tray passes the value to `DrawTray`, whose first swatch is
 * the theme ink, and paints the pen in it while no other ink is chosen.
 */
function subscribeTheme(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function useThemeInk(): string {
  return useSyncExternalStore(
    subscribeTheme,
    () => ThemeService.getDefaultTextColor(),
    () => '#1F2937'
  );
}

/** Whether a media query matches, kept current. False where there is no window. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false
  );
}

/** Below this width the drawing tray shows glyphs instead of the tool art. */
export const TRAY_GLYPH_QUERY = '(max-width: 900px)';
