import { useLayoutEffect, useState } from 'react';

/**
 * How many tracks a CSS grid lays out, followed as its width changes.
 *
 * For a row that should be exactly one row: the seam of suggested templates
 * shows as many cards as the grid has columns at this width, so it never ends
 * in a half-empty second row.
 */
export function useGridColumns(element: HTMLElement | null, fallback: number): number {
  const [columns, setColumns] = useState(fallback);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const tracks = getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length;
      if (tracks > 0) setColumns(tracks);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return columns;
}
