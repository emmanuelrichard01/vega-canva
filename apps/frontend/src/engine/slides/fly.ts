import { EASINGS } from './transitionMath';
import type { TransitionEase } from './slideMeta';

/**
 * The camera's flight between two slides.
 *
 * A straight pan between slides that sit side by side reads well. Between
 * slides at opposite ends of a board it reads as the whole board smearing
 * past, too fast to follow. So the flight rises: the camera pulls back as it
 * leaves, by more the further it has to go, and settles in on the far slide,
 * the way a map flies between cities. Adjacent slides barely lift.
 *
 * Poses are the camera's own convention: `x`/`y` are stage offsets, so the
 * world point at the stage centre is `(w/2 - x) / zoom`. Interpolating in
 * world space, not stage offsets, is what keeps the path straight while the
 * zoom changes under it.
 */
export interface Pose {
  x: number;
  y: number;
  zoom: number;
}



/** The pose at `t` (0..1) of the flight from `a` to `b` in a stage of `stage` size. */
export function flyPose(a: Pose, b: Pose, stage: { width: number; height: number }, t: number, ease: TransitionEase = 'gentle'): Pose {
  const p = EASINGS[ease](Math.min(1, Math.max(0, t)));
  const cx0 = (stage.width / 2 - a.x) / a.zoom;
  const cy0 = (stage.height / 2 - a.y) / a.zoom;
  const cx1 = (stage.width / 2 - b.x) / b.zoom;
  const cy1 = (stage.height / 2 - b.y) / b.zoom;
  const cx = cx0 + (cx1 - cx0) * p;
  const cy = cy0 + (cy1 - cy0) * p;

  // How far, in screens at the smaller zoom: a slide next door is about one.
  const view = stage.width / Math.min(a.zoom, b.zoom);
  const screens = Math.hypot(cx1 - cx0, cy1 - cy0) / Math.max(1, view);
  // Pull back by up to 60%, nothing for a move of under a screen.
  const lift = Math.min(0.6, Math.max(0, (screens - 0.9) * 0.22));
  const base = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * p);
  const zoom = base * (1 - lift * Math.sin(Math.PI * p));

  return { x: stage.width / 2 - cx * zoom, y: stage.height / 2 - cy * zoom, zoom };
}
