import type { ViewportState } from './PresenceTypes';

/**
 * The camera that shows what someone else is looking at.
 *
 * Pure, because the arithmetic here is the whole feature and it is the kind
 * that looks right in source and lands half a screen off — which is exactly
 * what happened three times when `viewport.x`/`y` was passed straight to a
 * "centre on this point" navigator.
 */

/** What `CameraSystem` holds: a screen-space offset and a scale. */
export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Fit, rather than copy the zoom.
 *
 * Two people rarely have the same window size, and a follower with a narrower
 * window who simply adopts the leader's zoom sees *less* than the leader does —
 * so the leader points at something near their own edge and the follower is
 * looking at a screen that does not contain it. Fitting the leader's visible
 * world rectangle into the follower's window guarantees the follower sees at
 * least everything the leader sees, which is the one property follow mode
 * exists to provide.
 *
 * The cost is that a follower with a differently-shaped window sees some extra
 * margin on one axis. That is the right trade: extra context is harmless,
 * missing the thing being pointed at is not.
 */
export function followPose(
  viewport: ViewportState,
  screenWidth: number,
  screenHeight: number,
  limits: { minZoom: number; maxZoom: number }
): CameraPose | null {
  const theirZoom = viewport.zoom || 1;
  if (!Number.isFinite(theirZoom) || theirZoom <= 0) return null;
  if (!(screenWidth > 0) || !(screenHeight > 0)) return null;

  // Their visible rectangle, in world units.
  const worldWidth = (viewport.width ?? 0) / theirZoom;
  const worldHeight = (viewport.height ?? 0) / theirZoom;

  // A peer on an older build publishes no width/height. There is nothing to
  // fit, so match their zoom and centre on what `viewportCenter` can work out.
  const zoom =
    worldWidth > 0 && worldHeight > 0
      ? Math.min(screenWidth / worldWidth, screenHeight / worldHeight)
      : theirZoom;

  const clamped = Math.max(limits.minZoom, Math.min(zoom, limits.maxZoom));
  if (!Number.isFinite(clamped) || clamped <= 0) return null;

  const centreX = viewport.x + worldWidth / 2;
  const centreY = viewport.y + worldHeight / 2;
  if (!Number.isFinite(centreX) || !Number.isFinite(centreY)) return null;

  // `CameraSystem` maps world to screen as `screen = world * zoom + offset`,
  // so the offset that puts a world point in the middle of the screen is:
  return {
    x: screenWidth / 2 - centreX * clamped,
    y: screenHeight / 2 - centreY * clamped,
    zoom: clamped,
  };
}

/**
 * Ease a camera toward a target by `alpha`, with zoom eased multiplicatively.
 *
 * Zoom is a ratio, not a distance: easing it linearly from 0.1 to 4 spends
 * almost the whole animation in the top half of that range and arrives in a
 * rush, and the same interpolation reads as a different speed depending on
 * where it started. Interpolating the logarithm makes each frame a constant
 * *proportion* of the remaining ratio, which is how zoom is perceived and how
 * `zoomBy` already treats it.
 */
export function easePose(from: CameraPose, to: CameraPose, alpha: number): CameraPose {
  const a = Math.max(0, Math.min(1, alpha));
  const fromZoom = from.zoom > 0 ? from.zoom : to.zoom;
  return {
    x: from.x + (to.x - from.x) * a,
    y: from.y + (to.y - from.y) * a,
    zoom: fromZoom * Math.pow(to.zoom / fromZoom, a),
  };
}

/**
 * Whether a camera has been moved by something other than the follow driver.
 *
 * Taking the wheel is how you leave follow mode in every tool that has it, and
 * detecting it this way — comparing the live camera against the pose the
 * driver last wrote — means no input path has to know follow mode exists. A
 * handler added later cannot forget to break the follow, because it does not
 * have to remember to.
 *
 * The tolerance covers the driver's own float residue only. It is in screen
 * pixels, and a real pan or wheel notch moves the camera by far more.
 */
export function poseWasDisturbed(
  live: CameraPose,
  lastWritten: CameraPose,
  tolerance = 0.5
): boolean {
  return (
    Math.abs(live.x - lastWritten.x) > tolerance ||
    Math.abs(live.y - lastWritten.y) > tolerance ||
    // Zoom is a ratio, so compare it as one: a fixed epsilon is far too coarse
    // at 0.05 and far too fine at 5.
    Math.abs(Math.log(live.zoom / lastWritten.zoom)) > 0.001
  );
}
