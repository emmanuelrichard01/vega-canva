import type { TransitionDirection, TransitionEase, TransitionKind, TransitionSpec } from './slideMeta';

/**
 * The arithmetic of slide transitions, apart from anything that draws.
 *
 * The player (`components/slides/transitionPlayer`) moves the camera, tweens
 * Konva nodes and animates pictures; every number it uses comes from here, so
 * the curves, the push and slide offsets, the dive into a slide and the
 * starting pose of a smart-moved object are all tested without a browser.
 */

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Gentle: a long, even swell. Standard: slow in, slow out. Snappy: off the mark at once, settling softly. */
export const EASINGS: Record<TransitionEase, (t: number) => number> = {
  gentle: (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2,
  standard: (t) => {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  },
  snappy: (t) => 1 - Math.pow(1 - clamp01(t), 4),
};

/** The same curves for the Web Animations API and CSS. */
export const CSS_EASINGS: Record<TransitionEase, string> = {
  gentle: 'cubic-bezier(0.37, 0, 0.63, 1)',
  standard: 'cubic-bezier(0.65, 0, 0.35, 1)',
  snappy: 'cubic-bezier(0.25, 1, 0.5, 1)',
};

/** Konva's tween signature (elapsed, start, change, duration) around one of our curves. */
export function konvaEasing(ease: TransitionEase): (t: number, b: number, c: number, d: number) => number {
  const f = EASINGS[ease];
  return (t, b, c, d) => b + c * f(d > 0 ? t / d : 1);
}

// ---------------------------------------------------------------------------
// What will actually play
// ---------------------------------------------------------------------------

/** Under reduced motion every transition is this: a short fade. */
export const REDUCED_TRANSITION: TransitionSpec = { kind: 'dissolve', direction: 'left', ms: 160, ease: 'standard' };

/**
 * The transition that plays, given the slide's own and the viewer's settings.
 * Reduced motion turns everything that moves into a quick dissolve, and a cut
 * stays a cut.
 */
export function playableTransition(spec: TransitionSpec, reduced: boolean): TransitionSpec {
  if (spec.kind === 'none') return { ...spec, ms: 0 };
  if (reduced) return REDUCED_TRANSITION;
  return spec;
}

/** Whether a transition needs pictures of the slides (and so a stage to take them from). */
export const needsPictures = (kind: TransitionKind) => kind === 'dissolve' || kind === 'push' || kind === 'slide' || kind === 'zoom';

// ---------------------------------------------------------------------------
// Push and slide
// ---------------------------------------------------------------------------

/** Where the incoming slide starts, in slide widths and heights, for a push or slide towards `dir`. */
export function entryOffset(dir: TransitionDirection): { x: number; y: number } {
  switch (dir) {
    case 'left':
      return { x: 1, y: 0 };
    case 'right':
      return { x: -1, y: 0 };
    case 'up':
      return { x: 0, y: 1 };
    case 'down':
      return { x: 0, y: -1 };
  }
}

export interface PanePose {
  /** Offset in slide widths and heights. */
  x: number;
  y: number;
  opacity: number;
  scale: number;
}

/**
 * Both slides at progress `e` (already eased) of a push or a slide.
 *
 * A push moves the two together, the new one shoving the old one off. A slide
 * brings the new one in over the old, which stays put, sinks a little and
 * dims, so the new slide reads as arriving on top.
 */
export function paneFrame(kind: 'push' | 'slide', dir: TransitionDirection, e: number): { from: PanePose; to: PanePose } {
  const off = entryOffset(dir);
  const k = clamp01(e);
  const to: PanePose = { x: off.x * (1 - k), y: off.y * (1 - k), opacity: 1, scale: 1 };
  if (kind === 'push') return { from: { x: -off.x * k, y: -off.y * k, opacity: 1, scale: 1 }, to };
  return { from: { x: 0, y: 0, opacity: 1 - 0.35 * k, scale: 1 - 0.04 * k }, to };
}

// ---------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------

export interface Pose {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The camera between two poses at `p` (already eased): the point at the
 * stage centre travels in a straight line through the world, and the zoom
 * changes geometrically, so a dive of ten times feels as even as a dive of two.
 */
export function lerpPose(a: Pose, b: Pose, stage: { width: number; height: number }, p: number): Pose {
  const cx0 = (stage.width / 2 - a.x) / a.zoom;
  const cy0 = (stage.height / 2 - a.y) / a.zoom;
  const cx1 = (stage.width / 2 - b.x) / b.zoom;
  const cy1 = (stage.height / 2 - b.y) / b.zoom;
  const zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * p);
  // The centre moves with the zoom's own progress, so the target stays put on
  // screen while the camera closes on it instead of sliding past it.
  const s = a.zoom === b.zoom ? p : (zoom - a.zoom) / (b.zoom - a.zoom);
  const cx = cx0 + (cx1 - cx0) * s;
  const cy = cy0 + (cy1 - cy0) * s;
  return { x: stage.width / 2 - cx * zoom, y: stage.height / 2 - cy * zoom, zoom };
}

/** How much of a zoom is the dive; the rest is the new slide coming up through the old. */
export const DIVE_SHARE = 0.68;

/**
 * A zoom at progress `t` (raw time, 0..1): the camera dives towards the
 * portal for the first part, then the new slide fades in over the close-up.
 * Returns the dive's own eased progress and how far the fade has come.
 */
export function zoomPhase(t: number, ease: TransitionEase): { dive: number; reveal: number } {
  const x = clamp01(t);
  return {
    dive: EASINGS[ease === 'snappy' ? 'standard' : ease](Math.min(1, x / DIVE_SHARE)),
    reveal: x <= DIVE_SHARE ? 0 : EASINGS.standard((x - DIVE_SHARE) / (1 - DIVE_SHARE)),
  };
}

// ---------------------------------------------------------------------------
// Smart move: where a traveller starts
// ---------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/**
 * The transform that draws a traveller, whose resting box is `rest` on the new
 * slide, where it stood on the old one (`start`, already mapped into the new
 * slide's coordinates). It is tweened from here back to `node`.
 *
 * The box is scaled about the traveller's top-left and moved there, which is
 * exact for an unrotated node whatever its own offset, and rotation is carried
 * across separately.
 */
export function travellerStart(node: NodeTransform, rest: Box, start: Box, startRotation: number): NodeTransform {
  const kx = start.width / Math.max(1e-6, rest.width);
  const ky = start.height / Math.max(1e-6, rest.height);
  return {
    x: start.x + kx * (node.x - rest.x),
    y: start.y + ky * (node.y - rest.y),
    scaleX: node.scaleX * kx,
    scaleY: node.scaleY * ky,
    rotation: startRotation,
  };
}

/** `#RRGGBB` between two colours at `t`, for a fill changing as it moves. Non-hex input returns `b`. */
export function lerpColor(a: string, b: string, t: number): string {
  const pa = /^#([0-9a-f]{6})$/i.exec(a.trim());
  const pb = /^#([0-9a-f]{6})$/i.exec(b.trim());
  if (!pa || !pb) return b;
  const na = parseInt(pa[1], 16);
  const nb = parseInt(pb[1], 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  const mix = (s: number) => Math.round(ch(na, s) + (ch(nb, s) - ch(na, s)) * clamp01(t));
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Interruption
// ---------------------------------------------------------------------------

/** A transition in flight. `finish` jumps it to its last frame and tidies up; it is safe to call twice. */
export interface TransitionHandle {
  finish: () => void;
  readonly done: Promise<void>;
}

/**
 * At most one transition at a time. Starting another, or pressing on while
 * one plays, finishes the current one at once: the slide it was heading for
 * is shown complete, and only then does the next one begin. A presenter who
 * taps through three slides quickly sees three clean arrivals, never two
 * animations fighting over the camera.
 */
export class TransitionRunner {
  private current: TransitionHandle | null = null;

  get running(): boolean {
    return this.current !== null;
  }

  /** Finish whatever is playing. */
  settle(): void {
    const playing = this.current;
    this.current = null;
    playing?.finish();
  }

  /** Begin a transition, finishing any still playing first. */
  start(begin: () => TransitionHandle): TransitionHandle {
    this.settle();
    const handle = begin();
    this.current = handle;
    void handle.done.then(() => {
      if (this.current === handle) this.current = null;
    });
    return handle;
  }
}

/** A handle for work that is already complete. */
export const DONE: TransitionHandle = { finish: () => {}, done: Promise.resolve() };

/**
 * Make a handle from a `finish` that may be called by the transition itself
 * (on its last frame) or from outside (interrupted). Runs `finish` once.
 */
export function handle(finish: () => void): TransitionHandle & { complete: () => void; settled: () => boolean } {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  let finished = false;
  const complete = () => {
    if (finished) return;
    finished = true;
    finish();
    resolve();
  };
  return { finish: complete, complete, done, settled: () => finished };
}
