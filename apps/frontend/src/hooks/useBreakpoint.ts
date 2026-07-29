import { useEffect, useState } from 'react';

/**
 * Layout breakpoints, shared between the CSS and the components that need to
 * change *behaviour* (not just styling) at a given width.
 *
 * These values are duplicated in index.css. Keep them in sync — a breakpoint
 * where the CSS turns a panel into an overlay but React still treats it as
 * docked (or vice versa) produces a panel that covers the canvas with no way
 * to dismiss it.
 */
export const BREAKPOINTS = {
  /** Below this the side panels become dismissible overlays rather than docked columns. */
  compact: 1024,
  /** Below this the header sheds its labels and the canvas is assumed to be touch-first. */
  mobile: 768,
} as const;

function query(maxWidth: number) {
  return `(max-width: ${maxWidth - 1}px)`;
}

function useMediaQuery(mediaQuery: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(mediaQuery).matches
  );

  useEffect(() => {
    const list = window.matchMedia(mediaQuery);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [mediaQuery]);

  return matches;
}

export function useBreakpoint() {
  const isCompact = useMediaQuery(query(BREAKPOINTS.compact));
  const isMobile = useMediaQuery(query(BREAKPOINTS.mobile));
  return { isCompact, isMobile };
}
