import { useEffect, type RefObject } from 'react';

/**
 * The board's frame, published as CSS on `<html>`.
 *
 * A board has no top bar; it has a left column, the canvas edge to edge, and a
 * right column, each of which can be open or shrunk to a pill. Everything
 * placed against that frame (the dock, the contextual rail, notices) reads
 * these instead of measuring the panels:
 *
 * - `--header-h` is `0px` on a board. The dashboard keeps its own.
 * - `--inset-left` / `--inset-right` are how much of each side an open column
 *   covers, and `0px` while it is a pill.
 * - `--inset-top` is the band across the top that chrome always covers: the
 *   horizontal ruler, when it is showing.
 * - `--board-pill-h` is a closed column's pill, which sits `--space-2` below
 *   `--inset-top` in its corner.
 *
 * The CSS lives in `shell.css`. Script that needs the same numbers (a camera
 * fit that must not frame work under a panel) measures them with
 * `boardInsets()`, because the tokens are `calc()` expressions.
 *
 * Set on the root element, not the board's container, because portaled
 * surfaces and `getComputedStyle(document.documentElement)` read from there.
 */
export function usePublishBoardLayout(leftOpen: boolean, rightOpen: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = 'board';
    return () => {
      delete root.dataset.surface;
      delete root.dataset.leftPanel;
      delete root.dataset.rightPanel;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.leftPanel = leftOpen ? 'open' : 'closed';
    root.dataset.rightPanel = rightOpen ? 'open' : 'closed';
  }, [leftOpen, rightOpen]);
}

/**
 * How much of the canvas each open column covers, in screen pixels, measured
 * from the columns themselves. Zero for a side whose column is a pill.
 */
export function boardInsets(): { left: number; right: number } {
  if (typeof document === 'undefined') return { left: 0, right: 0 };
  const root = document.documentElement;
  const left =
    root.dataset.leftPanel === 'open'
      ? document.querySelector<HTMLElement>('.hierarchy-panel')?.getBoundingClientRect().right ?? 0
      : 0;
  const inspector =
    root.dataset.rightPanel === 'open' ? document.querySelector<HTMLElement>('.context-inspector') : null;
  const right = inspector ? Math.max(0, window.innerWidth - inspector.getBoundingClientRect().left) : 0;
  return { left: Math.max(0, left), right };
}

/** A horizontal stretch of the screen something occupies, in pixels. */
export interface Span {
  left: number;
  right: number;
}

/** Clear space kept between the dock and a column it is nudged away from. */
const DOCK_GAP = 8;

/**
 * Where the dock's left edge goes, as a whole pixel.
 *
 * Centred on the window, never on the canvas between the columns: opening,
 * closing or resizing a column must not move it. Only a column that actually
 * overlaps the dock's row (`obstacles`) can move it, and then by the least
 * that clears it. If it cannot clear both sides it stays centred.
 */
export function dockLeft(viewport: number, width: number, obstacles: readonly Span[], gap = DOCK_GAP): number {
  const w = Math.ceil(width);
  const centred = Math.round((viewport - w) / 2);
  let min = -Infinity;
  let max = Infinity;
  const middle = viewport / 2;
  for (const o of obstacles) {
    if (o.right <= middle) min = Math.max(min, Math.ceil(o.right + gap));
    else if (o.left >= middle) max = Math.min(max, Math.floor(o.left - gap - w));
  }
  if (min > max) return centred;
  return Math.min(max, Math.max(min, centred));
}

/** The open columns, as spans, that share any height with `row`. */
function columnsBeside(row: DOMRect): Span[] {
  const spans: Span[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.hierarchy-panel, .context-inspector')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom <= row.top || r.top >= row.bottom) continue;
    spans.push({ left: r.left, right: r.right });
  }
  return spans;
}

/**
 * Keeps the dock where `dockLeft` says, by a whole-pixel `--dock-shift` that
 * `shell.css` applies as `translate`. The dock's own box is centred on the
 * window by CSS; this only corrects the half pixel an odd width leaves and,
 * on a narrow window, steps it clear of a column it would run under.
 */
export function useDockPlacement(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const dock = ref.current;
    if (!dock || typeof window === 'undefined') return;
    let frame = 0;
    let settle = 0;
    const place = () => {
      frame = 0;
      const current = Number.parseFloat(dock.style.getPropertyValue('--dock-shift')) || 0;
      const rect = dock.getBoundingClientRect();
      const natural = rect.left - current;
      const target = dockLeft(window.innerWidth, rect.width, columnsBeside(rect));
      // Exact, so the box lands on the whole pixel `target` names.
      const shift = Math.round((target - natural) * 100) / 100;
      const next = `${shift}px`;
      if (dock.style.getPropertyValue('--dock-shift') === next) return;
      // A step of a pixel or more, out or back, is animated; the fraction an
      // odd width leaves is not.
      const stepping = Math.abs(shift) >= 1 || Math.abs(current) >= 1;
      if (stepping) dock.dataset.shifted = '';
      dock.style.setProperty('--dock-shift', next);
      window.clearTimeout(settle);
      if (Math.abs(shift) < 1) settle = window.setTimeout(() => delete dock.dataset.shifted, 250);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const sizes = new ResizeObserver(schedule);
    sizes.observe(dock);
    // A column opening, closing or being dragged wider changes these.
    const frameAttrs = new MutationObserver(schedule);
    frameAttrs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-left-panel', 'data-right-panel', 'style'] });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      sizes.disconnect();
      frameAttrs.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [ref]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The regions F6 moves between, in reading order. */
export function boardRegions(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-region]')).sort(
    (a, b) => Number(a.dataset.region) - Number(b.dataset.region)
  );
}

/** The region `F6` (or `Shift+F6`) lands on from `current`, wrapping. */
export function nextRegion(regions: readonly HTMLElement[], current: Element | null, back: boolean): HTMLElement | null {
  if (regions.length === 0) return null;
  const at = regions.findIndex((r) => current !== null && r.contains(current));
  const from = at === -1 ? (back ? 0 : -1) : at;
  return regions[(from + (back ? -1 : 1) + regions.length) % regions.length];
}

/**
 * F6 and Shift+F6 cycle between the board's regions — left panel, canvas,
 * dock, right panel — as they do between a desktop app's panes. Focus goes to
 * the first control in the region, or to the region itself.
 */
export function useRegionCycle(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = nextRegion(boardRegions(), document.activeElement, e.shiftKey);
      if (!target) return;
      e.preventDefault();
      const first = target.matches('[role="application"]') ? null : target.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? target).focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
