import { useEffect, useRef, useState } from 'react';

export interface VirtualWindow {
  /** Index of the first row to render. */
  start: number;
  /** Index one past the last row to render. */
  end: number;
  /** Spacer height above the rendered rows, in px. */
  offsetTop: number;
  /** Total scrollable height, in px. */
  totalHeight: number;
}

/**
 * Fixed-height row virtualization.
 *
 * Only the rows inside the scroll viewport (plus a small overscan) are
 * rendered. Everything above and below is represented by two spacer elements,
 * so the scrollbar still reflects the full list.
 *
 * Uniform row height is a deliberate constraint rather than a limitation:
 * measuring variable heights would mean either a second layout pass or a
 * resize observer per row, and the list this serves is flattened to uniform
 * rows precisely so it can avoid both.
 */
export function useVirtualRows(
  rowCount: number,
  rowHeight: number,
  // Generous enough that a fast flick doesn't outrun React's commit and show
  // a band of empty space before the new rows land.
  overscan = 14
): { containerRef: React.RefObject<HTMLDivElement | null>; window: VirtualWindow } {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    setViewportHeight(el.clientHeight);

    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  // Before the container has been measured, render a reasonable first screen
  // rather than nothing — otherwise the list flashes empty on mount.
  const effectiveHeight = viewportHeight || 480;

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(effectiveHeight / rowHeight) + overscan * 2;
  const end = Math.min(rowCount, start + visibleCount);

  return {
    containerRef,
    window: {
      start,
      end,
      offsetTop: start * rowHeight,
      totalHeight: rowCount * rowHeight,
    },
  };
}
