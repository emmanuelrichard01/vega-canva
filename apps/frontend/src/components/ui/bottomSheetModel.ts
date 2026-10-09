/**
 * Where a bottom sheet comes to rest, as pure functions so the gesture can be
 * tested without a finger.
 *
 * A sheet has up to three resting heights: `peek` (a strip that keeps the
 * board in view), `half` and `full`. A drag moves it freely; letting go
 * settles it on one of them, or dismisses it.
 *
 * - **A flick decides direction.** Released faster than `FLICK_VELOCITY`, the
 *   sheet goes one step the way it was thrown: up to the next snap above, down
 *   to the next below, and off the screen from the lowest one.
 * - **A slow release goes to the nearest snap**, unless it has been pulled to
 *   less than half the lowest snap, which reads as putting it away.
 */

export type SnapName = 'peek' | 'half' | 'full';

/** px per ms. About what a deliberate thumb flick reaches; a slow drag stays under it. */
export const FLICK_VELOCITY = 0.5;

/** Below this share of the lowest snap, a slow release dismisses. */
export const DISMISS_FRACTION = 0.5;

/** How much of the room above the bottom edge each snap takes. */
const SNAP_SHARE: Record<SnapName, number> = { peek: 0.32, half: 0.56, full: 1 };

/** The order snaps are listed in, lowest first. */
const ORDER: SnapName[] = ['peek', 'half', 'full'];

/**
 * Each snap's height in px for a viewport `room` px tall (the visual viewport
 * less the top safe area and a margin), lowest first and without duplicates.
 */
export function snapHeights(snaps: readonly SnapName[], room: number): { name: SnapName; height: number }[] {
  return ORDER.filter((name) => snaps.includes(name)).map((name) => ({
    name,
    height: Math.round(room * SNAP_SHARE[name]),
  }));
}

/**
 * Where a released sheet goes: the index of a snap in `heights` (ascending),
 * or `'dismiss'`.
 *
 * `velocity` is in px per ms, positive when the sheet was moving down
 * (getting shorter).
 */
export function resolveRelease(
  height: number,
  velocity: number,
  heights: readonly number[],
  dismissible = true
): number | 'dismiss' {
  if (heights.length === 0) return 'dismiss';
  if (velocity > FLICK_VELOCITY) {
    for (let i = heights.length - 1; i >= 0; i--) if (heights[i] < height - 1) return i;
    return dismissible ? 'dismiss' : 0;
  }
  if (velocity < -FLICK_VELOCITY) {
    for (let i = 0; i < heights.length; i++) if (heights[i] > height + 1) return i;
    return heights.length - 1;
  }
  if (dismissible && height < heights[0] * DISMISS_FRACTION) return 'dismiss';
  let best = 0;
  for (let i = 1; i < heights.length; i++) {
    if (Math.abs(heights[i] - height) < Math.abs(heights[best] - height)) best = i;
  }
  return best;
}

/**
 * One drag on the sheet's handle: where the sheet stands while the finger
 * moves, and how fast it was going when it let go.
 *
 * Velocity is read over the last `WINDOW_MS` of samples rather than the last
 * two, so a finger that pauses before lifting reads as a slow release and a
 * single jittery sample does not read as a flick.
 */
export class SheetDrag {
  static readonly WINDOW_MS = 80;
  private samples: { y: number; t: number }[] = [];
  private readonly startY: number;
  private readonly startHeight: number;
  private readonly maxHeight: number;

  constructor(startY: number, startHeight: number, maxHeight: number, t: number) {
    this.startY = startY;
    this.startHeight = startHeight;
    this.maxHeight = maxHeight;
    this.samples.push({ y: startY, t });
  }

  /** The sheet's height for a finger at `y`. Past the top it resists rather than stopping dead. */
  move(y: number, t: number): number {
    this.samples.push({ y, t });
    const cutoff = t - SheetDrag.WINDOW_MS * 2;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
    return this.heightAt(y);
  }

  heightAt(y: number): number {
    const raw = this.startHeight + (this.startY - y);
    if (raw <= this.maxHeight) return Math.max(0, raw);
    return this.maxHeight + (raw - this.maxHeight) * 0.2;
  }

  /** px per ms, positive when moving down the screen. */
  velocity(t: number): number {
    const recent = this.samples.filter((s) => s.t >= t - SheetDrag.WINDOW_MS);
    const from = recent.length >= 2 ? recent[0] : this.samples[Math.max(0, this.samples.length - 2)];
    const to = this.samples[this.samples.length - 1];
    const dt = to.t - from.t;
    if (dt <= 0) return 0;
    // A finger that has been still since its last sample is not moving.
    if (t - to.t > SheetDrag.WINDOW_MS) return 0;
    return (to.y - from.y) / dt;
  }

  /** Whether the finger travelled far enough for this to be a drag rather than a tap. */
  moved(y: number): boolean {
    return Math.abs(y - this.startY) > 6;
  }
}
