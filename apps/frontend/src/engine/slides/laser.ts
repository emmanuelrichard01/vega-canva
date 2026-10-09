/**
 * The laser pointer's trail: where the dot has been in the last moment.
 *
 * Points are kept for `LASER_TRAIL_MS` and drawn thinner and fainter with age,
 * so a quick circle round a number reads as a gesture and then clears itself.
 * Pure, so the pruning and the taper are tested without a canvas.
 */
export const LASER_TRAIL_MS = 280;
/** A press held this long on the slide is a laser, not a click to advance. */
export const LASER_HOLD_MS = 180;
/** Moving this far (CSS pixels) while pressed is a laser too. */
export const LASER_DRAG_PX = 6;

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export class LaserTrail {
  points: TrailPoint[] = [];
  /** Whether the dot itself is showing; the trail can outlive it by a moment. */
  on = false;

  push(x: number, y: number, t: number): void {
    const last = this.points[this.points.length - 1];
    // A pointer that has not moved adds nothing but cost.
    if (last && Math.abs(last.x - x) < 0.5 && Math.abs(last.y - y) < 0.5) {
      last.t = t;
      return;
    }
    this.points.push({ x, y, t });
    if (this.points.length > 96) this.points.splice(0, this.points.length - 96);
  }

  prune(now: number): void {
    let drop = 0;
    while (drop < this.points.length - 1 && now - this.points[drop].t > LASER_TRAIL_MS) drop++;
    if (drop) this.points.splice(0, drop);
    if (!this.on && this.points.length && now - this.points[this.points.length - 1].t > LASER_TRAIL_MS) this.points = [];
  }

  /** Whether anything is left to draw, so the drawing loop knows when to park. */
  get alive(): boolean {
    return this.on || this.points.length > 0;
  }

  /** Segments with their age as 0 (new) to 1 (about to vanish). */
  segments(now: number): Array<{ a: TrailPoint; b: TrailPoint; age: number }> {
    const out: Array<{ a: TrailPoint; b: TrailPoint; age: number }> = [];
    for (let i = 1; i < this.points.length; i++) {
      const age = Math.min(1, Math.max(0, (now - this.points[i].t) / LASER_TRAIL_MS));
      out.push({ a: this.points[i - 1], b: this.points[i], age });
    }
    return out;
  }
}
