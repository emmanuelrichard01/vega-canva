import { useEffect } from 'react';

/**
 * The panel never scrolls sideways.
 *
 * Every row truncates, wraps or shrinks to fit the narrowest panel (240px).
 * Something wider than the column is a bug in that row, and hiding it behind
 * `overflow-x: hidden` only moves the bug: focusing a control past the edge
 * still scrolls the panel sideways. These helpers find what sticks out, so
 * development builds can say so the moment it happens.
 */

/** True when `scroller` is wider inside than it is on screen. */
export function overflowsSideways(scroller: HTMLElement): boolean {
  return scroller.scrollWidth > scroller.clientWidth + 1;
}

/**
 * The outermost elements under `scroller` that extend past its left or right
 * edge. Anything inside its own sideways scroller (a real data grid) is that
 * scroller's business and is skipped.
 */
export function sidewaysOffenders(scroller: HTMLElement): HTMLElement[] {
  const box = scroller.getBoundingClientRect();
  const found: HTMLElement[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1)) {
        found.push(child);
        continue;
      }
      const ox = getComputedStyle(child).overflowX;
      if (ox === 'auto' || ox === 'scroll') continue;
      walk(child);
    }
  };
  walk(scroller);
  return found;
}

function describe(el: HTMLElement): string {
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  const section = el.closest('[data-section]')?.getAttribute('data-section');
  return `${el.tagName.toLowerCase()}${cls}${section ? ` in section "${section}"` : ''}`;
}

/**
 * In development, warn when `el` becomes wider than itself,
 * naming what sticks out. Checked after layout settles, on resize and on DOM
 * changes; free in production, where it is not installed.
 */
export function useSidewaysOverflowCheck(el: HTMLElement | null): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let last = '';
    const check = () => {
      frame = 0;
      if (!overflowsSideways(el)) {
        last = '';
        return;
      }
      const report = sidewaysOffenders(el).map(describe).join(', ') || 'unknown';
      if (report === last) return;
      last = report;
      console.warn(
        `[panel] ${el.scrollWidth}px of content in a ${el.clientWidth}px panel. Too wide: ${report}`
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    const mutations = new MutationObserver(schedule);
    mutations.observe(el, { childList: true, subtree: true });
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [el]);
}
