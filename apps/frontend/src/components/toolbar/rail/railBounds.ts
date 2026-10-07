import type { Bounds } from '../../../engine/interaction/railPlacement';

/** Keep this far from any edge of the window and from any chrome. */
export const EDGE_MARGIN = 16;
/** Fallback for the top chrome when neither `--inset-top` nor `--header-h` can be read. */
export const DEFAULT_HEADER_H = 48;

/** The board chrome the rail has to stay clear of, as measured. */
export interface ChromeMetrics {
  /** How far down the window the top chrome reaches: `--inset-top`, else `--header-h`. */
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

/** The frame tokens the shell publishes on the root, in pixels; null where one is not set. */
export interface FrameTokens {
  insetTop: number | null;
  insetLeft: number | null;
  insetRight: number | null;
  headerH: number | null;
}

/** What a probe reads back for a token that is not set. */
const UNSET = -99999;

let probe: HTMLElement | null = null;

/**
 * The shell's frame tokens, resolved to pixels.
 *
 * `--inset-left` is a `calc()` of other tokens, and a custom property reads back
 * as the text it was written with, so each token is resolved through a length
 * property on a hidden probe instead. Each token gets a property that nothing
 * else on the probe can over-constrain. Called when the chrome changes, never
 * per placement.
 */
export function readFrameTokens(): FrameTokens {
  if (typeof document === 'undefined' || !document.body) {
    return { insetTop: null, insetLeft: null, insetRight: null, headerH: null };
  }
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      `margin-left:var(--inset-left,${UNSET}px);margin-top:var(--inset-top,${UNSET}px);` +
      `text-indent:var(--inset-right,${UNSET}px);outline-offset:var(--header-h,${UNSET}px);`;
    document.body.appendChild(probe);
  }
  const style = getComputedStyle(probe);
  const read = (raw: string): number | null => {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > UNSET / 2 ? Math.max(0, n) : null;
  };
  return {
    insetLeft: read(style.marginLeft),
    insetTop: read(style.marginTop),
    insetRight: read(style.textIndent),
    headerH: read(style.outlineOffset),
  };
}

/**
 * The chrome, from the shell's tokens where it publishes them and from the
 * panels' measured edges where it does not.
 *
 * The top is `--inset-top`, falling back to `--header-h` and then the default.
 * A side token of 0 means that column is shrunk to a pill, so only the plain
 * margin is kept there.
 */
export function chromeFromTokens(
  tokens: FrameTokens,
  measured: { insetLeft: number; insetRight: number }
): Pick<ChromeMetrics, 'headerH' | 'insetLeft' | 'insetRight'> {
  return {
    headerH: tokens.insetTop ?? tokens.headerH ?? DEFAULT_HEADER_H,
    insetLeft: tokens.insetLeft !== null ? Math.max(EDGE_MARGIN, tokens.insetLeft) : measured.insetLeft,
    insetRight: tokens.insetRight !== null ? Math.max(EDGE_MARGIN, tokens.insetRight) : measured.insetRight,
  };
}
