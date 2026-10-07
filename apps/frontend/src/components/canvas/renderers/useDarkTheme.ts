import { useSyncExternalStore } from 'react';
import { ThemeService } from '../../../engine/ThemeService';

/**
 * Whether the board is in the dark theme, re-rendering when it changes.
 *
 * The theme is a class on `<body>`, so one MutationObserver serves every
 * subscriber on the page.
 */
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => listeners.forEach((l) => l()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, () => ThemeService.isDarkMode(), () => false);
}
