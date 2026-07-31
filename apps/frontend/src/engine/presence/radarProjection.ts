/**
 * Framing the radar: which slice of an infinite canvas it shows, and how a
 * world coordinate maps onto its little rectangle.
 *
 * All pure, and separated from the painting for one specific reason. The old
 * radar recomputed its bounds **every frame** from every object plus every
 * viewport, and then fitted to them exactly. Because your own viewport is part
 * of that union, panning the canvas changed the framing on every frame: the
 * whole map rescaled continuously, so objects that had not moved at all
 * appeared to swim around under the viewport rectangle. It looked like drift
 * in the data. It was drift in the projection.
 *
 * The fix is in `shouldRefit` and `easeBox` below — hold a frame until it is
 * genuinely wrong, then move to the new one over a few hundred milliseconds —
 * and it is the kind of thing that is very hard to judge by watching and very
 * easy to pin down with a test.
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RadarView {
  /** The world box being shown. */
  box: Box;
  /** Radar pixels per world unit. */
  scale: number;
  /** Where the scaled box starts inside the radar, in radar pixels. */
  offsetX: number;
  offsetY: number;
}

/** Anything with axis-aligned bounds. Deliberately not the node schema. */
export interface Bounded {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
}

export const boxWidth = (b: Box) => b.maxX - b.minX;
export const boxHeight = (b: Box) => b.maxY - b.minY;

export function boxOf(item: Bounded): Box {
  const w = item.width * Math.abs(item.scaleX ?? 1);
  const h = item.height * Math.abs(item.scaleY ?? 1);
  return { minX: item.x, minY: item.y, maxX: item.x + w, maxY: item.y + h };
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function padBox(b: Box, pad: number): Box {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

/**
 * Grow a box to at least `minSpan` on both axes, about its centre.
 *
 * Without this, a board holding one sticky note frames a 200px world in a
 * 260px map — a 1.3× *magnification*, on a widget whose whole job is to show
 * you more than the screen does. It also stops the scale exploding toward
 * infinity as the content approaches a point.
 */
export function atLeast(b: Box, minSpan: number): Box {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const halfW = Math.max(boxWidth(b), minSpan) / 2;
  const halfH = Math.max(boxHeight(b), minSpan) / 2;
  return { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH };
}

/**
 * Fit a world box into a radar of `width`×`height` radar pixels.
 *
 * One scale for both axes, so nothing on the radar is stretched: an object
 * that is square on the canvas is square here, which is most of what makes a
 * minimap legible at a glance.
 */
export function fit(box: Box, width: number, height: number): RadarView {
  const worldW = Math.max(boxWidth(box), 1e-6);
  const worldH = Math.max(boxHeight(box), 1e-6);
  const scale = Math.min(width / worldW, height / worldH);
  return {
    box,
    scale,
    offsetX: (width - worldW * scale) / 2,
    offsetY: (height - worldH * scale) / 2,
  };
}

export function project(view: RadarView, x: number, y: number) {
  return {
    x: (x - view.box.minX) * view.scale + view.offsetX,
    y: (y - view.box.minY) * view.scale + view.offsetY,
  };
}

export function unproject(view: RadarView, x: number, y: number) {
  return {
    x: (x - view.offsetX) / view.scale + view.box.minX,
    y: (y - view.offsetY) / view.scale + view.box.minY,
  };
}

function contains(outer: Box, inner: Box): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/**
 * Should the radar re-frame from `current` to `desired`?
 *
 * Two reasons, and only two:
 *
 * - **Something is outside the frame.** Non-negotiable; the radar is lying.
 * - **The frame is much larger than it needs to be.** Otherwise it would stay
 *   zoomed out forever after one object was briefly dragged far away, or after
 *   a collaborator visited a distant corner and came back.
 *
 * Anything short of that is held, because re-framing is *visible* — everything
 * on the map moves — and a map that re-frames on every small change is a map
 * you cannot read. `slack` is how much bigger than necessary the frame is
 * allowed to get before it tightens up.
 */
export function shouldRefit(current: Box, desired: Box, slack = 1.45): boolean {
  const cw = boxWidth(current);
  const ch = boxHeight(current);
  if (!(cw > 0) || !(ch > 0)) return true;
  if (!contains(current, desired)) return true;
  return cw > boxWidth(desired) * slack && ch > boxHeight(desired) * slack;
}

/**
 * Move `from` a fraction `alpha` of the way to `to`.
 *
 * Frame-rate independence comes from the caller (`smoothingFactor`), same as
 * every other interpolation in the app. Below a pixel of world distance it
 * snaps, so the projection settles exactly rather than approaching forever and
 * keeping the canvas repainting.
 */
export function easeBox(from: Box, to: Box, alpha: number, epsilon = 0.5): Box {
  const next = {
    minX: from.minX + (to.minX - from.minX) * alpha,
    minY: from.minY + (to.minY - from.minY) * alpha,
    maxX: from.maxX + (to.maxX - from.maxX) * alpha,
    maxY: from.maxY + (to.maxY - from.maxY) * alpha,
  };
  const settled =
    Math.abs(to.minX - next.minX) < epsilon &&
    Math.abs(to.minY - next.minY) < epsilon &&
    Math.abs(to.maxX - next.maxX) < epsilon &&
    Math.abs(to.maxY - next.maxY) < epsilon;
  return settled ? { ...to } : next;
}

export function boxesEqual(a: Box, b: Box, epsilon = 0.01): boolean {
  return (
    Math.abs(a.minX - b.minX) < epsilon &&
    Math.abs(a.minY - b.minY) < epsilon &&
    Math.abs(a.maxX - b.maxX) < epsilon &&
    Math.abs(a.maxY - b.maxY) < epsilon
  );
}
