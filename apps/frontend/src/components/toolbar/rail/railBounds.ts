import type { Bounds } from '../../../engine/interaction/railPlacement';

/** Keep this far from any edge of the window and from any chrome. */
export const EDGE_MARGIN = 16;
/** Fallback for `--header-h` when it cannot be read. */
export const DEFAULT_HEADER_H = 48;

/** The board chrome the rail has to stay clear of, as measured. */
export interface ChromeMetrics {
  /** `--header-h`. */
  headerH: number;
  /** How far the dock reaches up from the window's bottom, shelf included. 0 when hidden. */
  dockH: number;
  /** How far the left and right panels reach into the window. */
  insetLeft: number;
  insetRight: number;
}

/** A pixel length from a custom property, or the fallback when it is unset or unreadable. */
export function readPx(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseFloat(raw ?? '');
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The free strip the rail may stand in: under the header, above the dock,
 * between the side panels.
 *
 * With the chrome hidden (presentation mode) only the plain margin is kept.
 */
export function freeStrip(
  chrome: ChromeMetrics,
  viewport: { width: number; height: number },
  chromeVisible: boolean
): Bounds {
  if (!chromeVisible) {
    return {
      top: EDGE_MARGIN,
      bottom: viewport.height - EDGE_MARGIN,
      left: EDGE_MARGIN + 4,
      right: viewport.width - EDGE_MARGIN - 4,
    };
  }
  return {
    top: chrome.headerH + EDGE_MARGIN,
    bottom: viewport.height - chrome.dockH - EDGE_MARGIN,
    left: chrome.insetLeft + 4,
    right: viewport.width - chrome.insetRight - 4,
  };
}

/**
 * How far the chrome on one side reaches into the window.
 *
 * Measured rather than assumed, because the panels collapse, resize and hide
 * independently. Never less than the plain margin, so a panel mid-transition
 * cannot let the rail sit against the window edge.
 */
export function chromeInset(rect: { left: number; right: number; width: number; height: number } | null, side: 'left' | 'right', viewportWidth: number): number {
  if (!rect || rect.width === 0 || rect.height === 0) return EDGE_MARGIN;
  const reach = side === 'left' ? rect.right : viewportWidth - rect.left;
  return Math.max(EDGE_MARGIN, reach);
}
