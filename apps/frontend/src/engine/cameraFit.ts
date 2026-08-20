export interface FitBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
}

export interface FitOptions {
  /** Screen-space breathing room on every side, in pixels. */
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}

/** Enough that content never touches the edge, and the chrome does not cover it. */
const DEFAULT_PADDING = 64;

/**
 * The camera pose that shows a world rectangle, whole and centred.
 *
 * ## Why this is not inline in `zoomToFit`
 *
 * Because `zoomToFit` had it wrong, in three ways, under a comment calling
 * itself "simplistic":
 *
 *  1. **The pan was never scaled by the zoom.** It wrote `x = -minX + 50`,
 *     which is a *world* offset assigned to a field the renderer multiplies
 *     against — `screen = world * zoom + x`. That is only correct at zoom 1,
 *     so fitting anything that actually needed zooming put the content
 *     somewhere off screen. The further the fit was from 1:1, the further off.
 *  2. **It measured the window, not the canvas.** `window.innerWidth` is not
 *     the stage: the stage is inset by the rulers and the panels take several
 *     hundred pixels beside it. Fitting to the window therefore fitted to a
 *     viewport the board does not have, and pushed content under the chrome.
 *  3. **It anchored top-left rather than centring**, so a wide board sat hard
 *     against one corner with all the slack on the other side.
 *
 * There is a correct implementation of the same arithmetic in `followPose` —
 * fit a world rectangle into a screen and centre it — which is what made the
 * divergence worth removing rather than patching in place.
 *
 * Pure, so the arithmetic that decides whether anything is visible at all can
 * be asserted without a browser.
 */
export function fitPose(
  bounds: FitBounds,
  viewportWidth: number,
  viewportHeight: number,
  options: FitOptions = {}
): CameraPose | null {
  const { padding = DEFAULT_PADDING, minZoom = 0.05, maxZoom = 5 } = options;

  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return null;
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;

  // A zero-sized box is a single point, which is a legitimate thing to centre
  // on — it simply cannot constrain the zoom, so it takes 1:1.
  const width = Math.max(bounds.width, 0);
  const height = Math.max(bounds.height, 0);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

  /**
   * Padding is taken off the *viewport*, not added to the content.
   *
   * Adding it to the content box makes the margin scale with the zoom, so a
   * fitted board would get a hairline of padding and a fitted sticky note an
   * inch of it. Screen-space padding is a constant number of pixels whatever
   * is being framed, which is what "breathing room" means.
   */
  const usableW = Math.max(viewportWidth - padding * 2, 1);
  const usableH = Math.max(viewportHeight - padding * 2, 1);

  const raw =
    width > 0 && height > 0
      ? Math.min(usableW / width, usableH / height)
      : width > 0
        ? usableW / width
        : height > 0
          ? usableH / height
          : 1;

  /**
   * Never magnified past 1:1 by a fit.
   *
   * `maxZoom` is 5, and fitting a lone sticky note to the window would happily
   * take it — filling the screen with one note is not "fit to view", it is a
   * zoom nobody asked for and it destroys any sense of where that note sits on
   * the board. Fitting can always zoom *out*; it only zooms in as far as
   * actual size.
   */
  const zoom = Math.max(minZoom, Math.min(raw, 1, maxZoom));
  if (!Number.isFinite(zoom) || zoom <= 0) return null;

  const centreX = bounds.x + width / 2;
  const centreY = bounds.y + height / 2;

  // `CameraSystem` maps world to screen as `screen = world * zoom + offset`,
  // so the offset that puts a world point in the middle of the screen is:
  return {
    x: viewportWidth / 2 - centreX * zoom,
    y: viewportHeight / 2 - centreY * zoom,
    zoom,
  };
}

/**
 * Grow a box to contain another. `null` starts one.
 *
 * Used to accumulate the extent a session ever occupied, so a replay can be
 * framed once and never clip anything at any point along it.
 */
export function unionBounds(box: FitBounds | null, next: FitBounds): FitBounds {
  if (!box) return { ...next };
  const minX = Math.min(box.x, next.x);
  const minY = Math.min(box.y, next.y);
  const maxX = Math.max(box.x + box.width, next.x + next.width);
  const maxY = Math.max(box.y + box.height, next.y + next.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
