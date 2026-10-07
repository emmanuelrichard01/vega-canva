import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { nextCell, type GridKey } from './library';

const GRID_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const SELECTOR = '[data-roving]';

/**
 * One Tab stop for a wall of cards, and arrow keys to move through it.
 *
 * Every card marks its focus target with `data-roving`. Exactly one of them
 * is in the tab order at a time — the last one used — so Tab moves past the
 * whole library in one press rather than forty. Arrows move by where the
 * cards actually are on screen (see `nextCell`).
 *
 * `version` changes whenever the set of cards does, so the tab stop is
 * re-assigned after a search, a sort or a layout change.
 */
export function useRovingGrid(version: unknown) {
  const containerRef = useRef<HTMLElement | null>(null);
  const activeId = useRef<string | null>(null);

  const cells = useCallback(
    () => Array.from(containerRef.current?.querySelectorAll<HTMLElement>(SELECTOR) ?? []),
    []
  );

  /** Put exactly one cell in the tab order: the active one, else the first. */
  const assign = useCallback(() => {
    const list = cells();
    if (list.length === 0) return;
    let active = list.find((el) => el.dataset.roving === activeId.current) ?? list[0];
    if (!active) active = list[0];
    for (const el of list) el.tabIndex = el === active ? 0 : -1;
    activeId.current = active.dataset.roving ?? null;
  }, [cells]);

  useEffect(() => {
    assign();
  }, [assign, version]);

  const onFocus = useCallback((event: React.FocusEvent) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>(SELECTOR);
    if (!cell || !containerRef.current?.contains(cell)) return;
    activeId.current = cell.dataset.roving ?? null;
    for (const el of cells()) el.tabIndex = el === cell ? 0 : -1;
  }, [cells]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!GRID_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
    const list = cells();
    const from = list.findIndex((el) => el === target || el.contains(target));
    if (from < 0) return;
    const to = nextCell(list.map((el) => {
      const r = el.closest<HTMLElement>('[data-cell]')?.getBoundingClientRect() ?? el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }), from, event.key as GridKey);
    if (to < 0 || to === from) return;
    event.preventDefault();
    const next = list[to];
    next.focus({ preventScroll: true });
    next.closest<HTMLElement>('[data-cell]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cells]);

  return { containerRef, onFocus, onKeyDown };
}
