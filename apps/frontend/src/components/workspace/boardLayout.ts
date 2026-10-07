import { useEffect } from 'react';

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
