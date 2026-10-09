/**
 * The touch gesture recogniser: raw pointers in, intentions out.
 *
 * Pure — no DOM, no timers, no camera — so every rule below is a unit test.
 * The caller feeds it pointer events and calls `tick` when `nextDeadline()`
 * comes due, and applies the effects it returns.
 *
 * The rules, after Figma, Freeform and Procreate:
 *
 * - **One finger** belongs to the active tool (`owner === 'touch'`).
 * - **Two or more fingers** pan and pinch around their centroid. The baseline
 *   is taken again whenever a finger lands or lifts, so the board never jumps
 *   when a finger arrives; nothing moves until the fingers clear the tap slop.
 * - A second finger landing **cancels** the one-finger action in progress.
 * - **Long-press** — `LONG_PRESS_MS` with under `LONG_PRESS_SLOP` px of travel —
 *   cancels the tool's press and asks for the context menu there.
 * - **Double-tap** is reported; **two-finger tap** is undo, **three-finger
 *   tap** is redo.
 * - **Pen:** a stylus draws or selects (`owner === 'pen'`). While it is down,
 *   touches are a resting palm and are ignored; once a stylus has been used, a
 *   single finger pans instead of driving the tool.
 *
 * A mouse is not a gesture and is ignored entirely, which is what keeps the
 * desktop exactly as it was.
 */

export type PointerKind = 'mouse' | 'pen' | 'touch';

export interface GestureInput {
  kind: 'down' | 'move' | 'up' | 'cancel';
  id: number;
  pointerType: PointerKind | string;
  x: number;
  y: number;
  /** Milliseconds, from any monotonic clock. */
  t: number;
}

export type GestureEffect =
  /** Stop the one-finger tool action that is in progress, without finishing it. */
  | { type: 'cancel-primary' }
  /** Pan by (panX, panY) screen px, then zoom by `scale` about (cx, cy). */
  | { type: 'camera'; panX: number; panY: number; scale: number; cx: number; cy: number }
  | { type: 'long-press'; x: number; y: number }
  | { type: 'double-tap'; x: number; y: number }
  | { type: 'undo' }
  | { type: 'redo' };

/** Who the stage's touch events belong to right now. */
export type ToolOwner = 'none' | 'touch' | 'pen';

export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP = 8;
/** A press shorter than this, that never moved, is a tap. */
export const TAP_MS = 300;
export const TAP_SLOP = 10;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_DISTANCE = 30;

type Mode = 'idle' | 'primary' | 'navigate' | 'pan' | 'spent';

interface Track {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface Baseline {
  cx: number;
  cy: number;
  dist: number;
}

export class GestureRecognizer {
  private touches = new Map<number, Track>();
  private mode: Mode = 'idle';
  private penId: number | null = null;
  private penSeen = false;
  private toolOwner: ToolOwner = 'none';

  private pressT = 0;
  private pressMoved = false;
  private longPressAt: number | null = null;

  private navStartT = 0;
  private navMax = 0;
  private navMoved = false;
  private base: Baseline | null = null;

  private lastTap: { x: number; y: number; t: number } | null = null;

  /**
   * Who the stage's touch events belong to. Set when a contact lands and kept
   * after it lifts, because the stage hears the release after the recogniser
   * does and must still deliver it.
   */
  get owner(): ToolOwner {
    return this.toolOwner;
  }

  /** A pinch, a pan or a spent long-press holds the touches. */
  get navigating(): boolean {
    return this.mode === 'navigate' || this.mode === 'pan' || this.mode === 'spent';
  }

  /** A stylus has been used: a lone finger now pans. */
  get penMode(): boolean {
    return this.penSeen;
  }

  /** When `tick` next needs to run, or null. */
  nextDeadline(): number | null {
    return this.mode === 'primary' ? this.longPressAt : null;
  }

  reset() {
    this.touches.clear();
    this.mode = 'idle';
    this.penId = null;
    this.toolOwner = 'none';
    this.longPressAt = null;
    this.base = null;
    this.lastTap = null;
  }

  tick(t: number): GestureEffect[] {
    if (this.mode !== 'primary' || this.longPressAt === null || t < this.longPressAt) return [];
    const [only] = this.touches.values();
    this.mode = 'spent';
    this.toolOwner = 'none';
    this.longPressAt = null;
    this.lastTap = null;
    if (!only) return [];
    return [{ type: 'cancel-primary' }, { type: 'long-press', x: only.x, y: only.y }];
  }

  handle(input: GestureInput): GestureEffect[] {
    if (input.pointerType === 'pen') return this.pen(input);
    if (input.pointerType !== 'touch') return [];
    switch (input.kind) {
      case 'down':
        return this.touchDown(input);
      case 'move':
        return this.touchMove(input);
      default:
        return this.touchUp(input);
    }
  }

  private pen(input: GestureInput): GestureEffect[] {
    if (input.kind === 'down') {
      this.penSeen = true;
      this.penId = input.id;
      this.toolOwner = 'pen';
      this.lastTap = null;
      // The palm landed before the pen: whatever it started is not wanted.
      const out: GestureEffect[] = this.mode === 'primary' ? [{ type: 'cancel-primary' }] : [];
      if (this.touches.size > 0) this.mode = 'spent';
      this.longPressAt = null;
      return out;
    }
    if ((input.kind === 'up' || input.kind === 'cancel') && input.id === this.penId) {
      this.penId = null;
      if (this.touches.size === 0) this.mode = 'idle';
    }
    return [];
  }

  private touchDown(input: GestureInput): GestureEffect[] {
    this.touches.set(input.id, { x: input.x, y: input.y, startX: input.x, startY: input.y });
    // A palm resting while the pen is down.
    if (this.penId !== null || this.mode === 'spent') {
      if (this.mode === 'idle') this.mode = 'spent';
      return [];
    }

    const n = this.touches.size;
    if (n === 1) {
      this.base = this.metrics();
      this.pressT = input.t;
      this.pressMoved = false;
      if (this.penSeen) {
        this.mode = 'pan';
        this.toolOwner = 'none';
        this.longPressAt = null;
      } else {
        this.mode = 'primary';
        this.toolOwner = 'touch';
        this.longPressAt = input.t + LONG_PRESS_MS;
      }
      return [];
    }

    const out: GestureEffect[] = [];
    if (this.mode === 'primary') {
      out.push({ type: 'cancel-primary' });
      // The tap clock starts with the first finger: two fingers set down a
      // beat apart are still one tap.
      this.navStartT = this.pressT;
      this.navMoved = this.pressMoved;
      this.navMax = n;
    } else if (this.mode === 'pan') {
      this.navStartT = this.pressT;
      this.navMoved = true;
      this.navMax = n;
    } else {
      this.navMax = Math.max(this.navMax, n);
    }
    this.mode = 'navigate';
    this.toolOwner = 'none';
    this.longPressAt = null;
    this.lastTap = null;
    this.base = this.metrics();
    return out;
  }

  private touchMove(input: GestureInput): GestureEffect[] {
    const track = this.touches.get(input.id);
    if (!track) return [];
    track.x = input.x;
    track.y = input.y;

    if (this.mode === 'primary') {
      if (Math.hypot(track.x - track.startX, track.y - track.startY) > LONG_PRESS_SLOP) {
        this.pressMoved = true;
        this.longPressAt = null;
      }
      return [];
    }

    if (this.mode !== 'navigate' && this.mode !== 'pan') return [];
    const next = this.metrics();
    const prev = this.base;
    if (!prev) {
      this.base = next;
      return [];
    }
    if (!this.navMoved && this.mode === 'navigate') {
      const travelled = Math.max(
        ...[...this.touches.values()].map((p) => Math.hypot(p.x - p.startX, p.y - p.startY))
      );
      if (travelled <= TAP_SLOP) return [];
      // Clearing the slop applies everything since the fingers landed, so the
      // board stays under them. Re-baselining here instead would snapshot a
      // half-updated frame — the browser moves one finger per event — and
      // turn a straight two-finger pan into a zoom.
      this.navMoved = true;
    }
    this.base = next;
    const scale = prev.dist > 0 && next.dist > 0 ? next.dist / prev.dist : 1;
    const panX = next.cx - prev.cx;
    const panY = next.cy - prev.cy;
    if (panX === 0 && panY === 0 && scale === 1) return [];
    return [{ type: 'camera', panX, panY, scale, cx: next.cx, cy: next.cy }];
  }

  private touchUp(input: GestureInput): GestureEffect[] {
    const track = this.touches.get(input.id);
    if (!track) return [];
    this.touches.delete(input.id);
    const remaining = this.touches.size;
    const cancelled = input.kind === 'cancel';

    if (this.mode === 'primary') {
      this.mode = 'idle';
      this.longPressAt = null;
      const quick = input.t - this.pressT <= TAP_MS;
      if (cancelled || this.pressMoved || !quick) {
        this.lastTap = null;
        return [];
      }
      const last = this.lastTap;
      if (
        last &&
        input.t - last.t <= DOUBLE_TAP_MS &&
        Math.hypot(input.x - last.x, input.y - last.y) <= DOUBLE_TAP_DISTANCE
      ) {
        this.lastTap = null;
        return [{ type: 'double-tap', x: input.x, y: input.y }];
      }
      this.lastTap = { x: input.x, y: input.y, t: input.t };
      return [];
    }

    if (this.mode === 'navigate') {
      if (remaining > 0) {
        // Lifting a finger re-baselines rather than jumping to the others.
        this.base = this.metrics();
        return [];
      }
      this.mode = this.penId !== null ? 'spent' : 'idle';
      this.base = null;
      if (cancelled || this.navMoved || input.t - this.navStartT > TAP_MS) return [];
      if (this.navMax === 2) return [{ type: 'undo' }];
      if (this.navMax === 3) return [{ type: 'redo' }];
      return [];
    }

    if (remaining === 0 && this.penId === null) this.mode = 'idle';
    else if (this.mode === 'pan') this.base = this.metrics();
    return [];
  }

  private metrics(): Baseline {
    const pts = [...this.touches.values()];
    if (pts.length === 0) return { cx: 0, cy: 0, dist: 0 };
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    // Mean distance from the centroid: the spread of any number of fingers,
    // and equal to half the span for two.
    const dist = pts.length < 2 ? 0 : pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
    return { cx, cy, dist };
  }
}
