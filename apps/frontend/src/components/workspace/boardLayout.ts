import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { storageGet, storageSet } from '../../utils/safeStorage';

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
  // A peeking panel is an overlay, and the dock does not step aside for it.
  for (const el of document.querySelectorAll<HTMLElement>('.hierarchy-panel:not([data-peek]), .context-inspector:not([data-peek])')) {
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

/** Clear space between a flyout and the edge of the free strip. */
export const FLYOUT_EDGE = 8;
/** The flyout's corner radius plus half the notch: the notch stays this far from either end. */
export const NOTCH_CLEARANCE = 20;
/** A seat this close to the flyout's centre needs no notch to be understood. */
const NOTCH_HIDE_WITHIN = 2;

export interface DockCentring {
  /** Added to the flyout's own placement, in px, to land it on the dock's centre line. */
  dx: number;
  /** The notch's centre, in px from the flyout's left edge, or null when none is shown. */
  notch: number | null;
}

/**
 * Where a flyout, sheet or shelf goes so it is centred on the dock.
 *
 * `anchorCentre` is where the surface would sit with no correction: the centre
 * of the seat that opened it (or of the dock, for a shelf). It is moved onto
 * `dockCentre`, then held inside the free strip between the open columns with
 * `edge` to spare. The notch points back at `anchorCentre`; it is clamped clear
 * of the rounded corners and dropped when the seat is already under the centre.
 */
export function centreOnDock(input: {
  dockCentre: number;
  anchorCentre: number;
  width: number;
  viewport: number;
  insets: { left: number; right: number };
  edge?: number;
}): DockCentring {
  const { dockCentre, anchorCentre, width, viewport, insets } = input;
  const edge = input.edge ?? FLYOUT_EDGE;
  const min = insets.left + edge;
  const max = viewport - insets.right - edge - width;
  const wanted = dockCentre - width / 2;
  // A strip narrower than the flyout cannot hold it: keep it centred on the strip's left edge rule.
  const left = max < min ? min : Math.min(max, Math.max(min, wanted));
  const natural = anchorCentre - width / 2;
  const centre = left + width / 2;
  const away = Math.abs(anchorCentre - centre);
  const notch =
    away <= NOTCH_HIDE_WITHIN
      ? null
      : Math.min(width - NOTCH_CLEARANCE, Math.max(NOTCH_CLEARANCE, anchorCentre - left));
  return { dx: left - natural, notch };
}

/**
 * Centres a surface that hangs from the dock on the dock's centre line.
 *
 * Returns a ref callback for the surface. It measures the dock, the seat the
 * surface hangs from (its offset parent) and the open columns, then publishes
 * `--fly-dx` (what `dock.css` adds to the surface's own centring) and, for a
 * flyout, `--notch-x` with `data-notch`. Re-measured when the surface, the dock
 * or the window changes size, and when a column opens or closes, so a flyout
 * never moves for any reason but its own width.
 */
export function useDockCentred(notch: boolean): (el: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!el || typeof window === 'undefined') return;
      const place = () => {
        const dock = el.closest<HTMLElement>('.tool-dock');
        const anchor = el.parentElement;
        if (!dock || !anchor) return;
        const dockBox = dock.getBoundingClientRect();
        const anchorBox = el.classList.contains('tool-shelf') ? dockBox : anchor.getBoundingClientRect();
        const result = centreOnDock({
          dockCentre: dockBox.left + dockBox.width / 2,
          anchorCentre: anchorBox.left + anchorBox.width / 2,
          width: el.offsetWidth,
          viewport: window.innerWidth,
          insets: boardInsets(),
        });
        const dx = `${Math.round(result.dx * 100) / 100}px`;
        if (el.style.getPropertyValue('--fly-dx') !== dx) el.style.setProperty('--fly-dx', dx);
        if (!notch) return;
        if (result.notch === null) {
          if (el.hasAttribute('data-notch')) el.removeAttribute('data-notch');
        } else {
          const x = `${Math.round(result.notch * 100) / 100}px`;
          if (el.style.getPropertyValue('--notch-x') !== x) el.style.setProperty('--notch-x', x);
          if (!el.hasAttribute('data-notch')) el.setAttribute('data-notch', '');
        }
      };
      place();
      const dock = el.closest<HTMLElement>('.tool-dock');
      const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
      sizes?.observe(el);
      if (dock) sizes?.observe(dock);
      const attrs = new MutationObserver(place);
      attrs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-left-panel', 'data-right-panel', 'style'] });
      window.addEventListener('resize', place);
      cleanup.current = () => {
        sizes?.disconnect();
        attrs.disconnect();
        window.removeEventListener('resize', place);
      };
    },
    [notch]
  );
}

/**
 * The width of the strip between the open columns, kept current. A surface
 * that must fit above the dock (the drawing tray) reads this rather than the
 * window, so opening a column on a mid-size window can step it down a size
 * instead of sliding it under the panel. Zero until measured.
 */
export function useFreeStrip(): number {
  const [free, setFree] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const { left, right } = boardInsets();
      setFree(Math.max(0, window.innerWidth - left - right));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    for (const el of document.querySelectorAll('.hierarchy-panel, .context-inspector')) sizes?.observe(el);
    const attrs = new MutationObserver(schedule);
    attrs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-left-panel', 'data-right-panel', 'style'] });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      sizes?.disconnect();
      attrs.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return free;
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

/* ------------------------------------------------------- panels per board */

/** Which of a board's two columns are open. */
export interface PanelState {
  left: boolean;
  right: boolean;
}

/** Where each board's columns are remembered: `{ [roomId]: [left, right, lastUsed] }`. */
export const PANELS_KEY = 'vega_board_panels';
/** The most boards remembered; the longest unvisited goes first. */
export const PANELS_CAP = 200;
/** The last state set anywhere, which a board never opened before starts from. */
const LAST_LEFT = 'vega_panel_left';
const LAST_RIGHT = 'vega_panel_right';

type Remembered = Record<string, [0 | 1, 0 | 1, number]>;

interface PanelStorage {
  get: (key: string) => string | null;
  set: (key: string, value: string) => unknown;
}

const browserStorage: PanelStorage = { get: storageGet, set: storageSet };

function readAll(storage: PanelStorage): Remembered {
  try {
    const parsed: unknown = JSON.parse(storage.get(PANELS_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Remembered = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length === 3 && typeof v[2] === 'number') {
        out[id] = [v[0] ? 1 : 0, v[1] ? 1 : 0, v[2]];
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * A board's columns as they were left on it. A board never opened here starts
 * the way the last one was left, and with both closed on a first visit: the
 * board at nearly full width, with each panel a pill that says what it is.
 */
export function readPanelState(roomId: string, storage: PanelStorage = browserStorage): PanelState {
  const own = readAll(storage)[roomId];
  if (own) return { left: own[0] === 1, right: own[1] === 1 };
  return {
    left: storage.get(LAST_LEFT) === 'expanded',
    right: storage.get(LAST_RIGHT) === 'expanded',
  };
}

/** Remember a board's columns, and make them the start for boards not yet opened. */
export function writePanelState(
  roomId: string,
  state: PanelState,
  storage: PanelStorage = browserStorage,
  now: number = Date.now()
): void {
  const all = readAll(storage);
  all[roomId] = [state.left ? 1 : 0, state.right ? 1 : 0, now];
  const ids = Object.keys(all);
  if (ids.length > PANELS_CAP) {
    ids
      .sort((a, b) => all[a][2] - all[b][2])
      .slice(0, ids.length - PANELS_CAP)
      .forEach((id) => delete all[id]);
  }
  storage.set(PANELS_KEY, JSON.stringify(all));
  storage.set(LAST_LEFT, state.left ? 'expanded' : 'collapsed');
  storage.set(LAST_RIGHT, state.right ? 'expanded' : 'collapsed');
}

type Next = boolean | ((open: boolean) => boolean);

/**
 * Each column's open state for this board, remembered per board in this
 * browser. A working preference rather than a fact about the board, so it is
 * never written to the document: a collaborator's screen does not change
 * because you collapsed your own panel. Only a change is written, never the
 * state a board was opened with.
 */
export function useBoardPanels(roomId: string): {
  left: boolean;
  right: boolean;
  setLeft: (next: Next) => void;
  setRight: (next: Next) => void;
} {
  const [entry, setEntry] = useState(() => ({ roomId, ...readPanelState(roomId) }));
  // Another board in the same mount: read its own state, during render.
  let current = entry;
  if (entry.roomId !== roomId) {
    current = { roomId, ...readPanelState(roomId) };
    setEntry(current);
  }

  const update = useCallback((side: 'left' | 'right', next: Next) => {
    setEntry((prev) => {
      const value = typeof next === 'function' ? next(prev[side]) : next;
      if (value === prev[side]) return prev;
      const updated = { ...prev, [side]: value };
      writePanelState(prev.roomId, { left: updated.left, right: updated.right });
      return updated;
    });
  }, []);
  const setLeft = useCallback((next: Next) => update('left', next), [update]);
  const setRight = useCallback((next: Next) => update('right', next), [update]);

  return { left: current.left, right: current.right, setLeft, setRight };
}
