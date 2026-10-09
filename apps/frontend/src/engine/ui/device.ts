/**
 * What kind of device the board is running on, as one signal.
 *
 * Everything that behaves differently for a finger than for a mouse — hit
 * sizes, gestures, the phone shell — reads it from here rather than asking
 * `matchMedia` on its own, so two parts of the UI cannot disagree about
 * whether this is a tablet.
 *
 * The same answer is published on `<html>` as `data-pointer` (`coarse` or
 * `fine`), `data-device` (`phone`, `tablet` or `desktop`) and, once a stylus
 * has been used, `data-pen`, so CSS can follow it without JavaScript.
 */

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export interface DeviceSignal {
  /** The primary pointer is a finger. */
  isCoarse: boolean;
  /** A stylus has been used in this session. */
  hasPen: boolean;
  deviceClass: DeviceClass;
  /** Data saver is on, or the user asked for reduced data. */
  prefersReducedData: boolean;
}

/** The smallest side, in CSS px, below which a coarse device is a phone. */
export const PHONE_MAX = 600;

/** The touch target every handle grows to on a coarse pointer, in screen px. */
export const TOUCH_TARGET = 44;

/** Which class a viewport belongs to. Pure, so it can be tested. */
export function classify(coarse: boolean, width: number, height: number): DeviceClass {
  if (!coarse) return 'desktop';
  return Math.min(width, height) < PHONE_MAX ? 'phone' : 'tablet';
}

/**
 * The extra hit stroke, in screen px, a handle drawn `visualPx` across needs
 * to be a full touch target. Zero on a fine pointer, so desktop hit areas stay
 * exactly what they were.
 *
 * A Konva shape's hit region extends half its hit stroke on each side, so a
 * shape `visualPx` wide with this stroke is `TOUCH_TARGET` wide to a finger.
 */
export function touchHitPad(visualPx: number, coarse = isCoarse()): number {
  return coarse ? Math.max(0, TOUCH_TARGET - visualPx) : 0;
}

/** A screen-px tolerance, grown to half a touch target on a coarse pointer. */
export function touchTolerance(basePx: number, coarse = isCoarse()): number {
  return coarse ? Math.max(basePx, TOUCH_TARGET / 2) : basePx;
}

const query = (q: string): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  } catch {
    return false;
  }
};

let current: DeviceSignal = {
  isCoarse: false,
  hasPen: false,
  deviceClass: 'desktop',
  prefersReducedData: false,
};
const listeners = new Set<(d: DeviceSignal) => void>();

function read(): DeviceSignal {
  const coarse = query('(pointer: coarse)');
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  const connection = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    : undefined;
  return {
    isCoarse: coarse,
    hasPen: current.hasPen,
    deviceClass: classify(coarse, w, h),
    prefersReducedData: query('(prefers-reduced-data: reduce)') || connection?.saveData === true,
  };
}

function publish(next: DeviceSignal) {
  const changed =
    next.isCoarse !== current.isCoarse ||
    next.hasPen !== current.hasPen ||
    next.deviceClass !== current.deviceClass ||
    next.prefersReducedData !== current.prefersReducedData;
  current = next;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.pointer = next.isCoarse ? 'coarse' : 'fine';
    root.dataset.device = next.deviceClass;
    if (next.hasPen) root.dataset.pen = 'true';
  }
  if (changed) listeners.forEach((fn) => fn(next));
}

/** The current answer. */
export function getDevice(): DeviceSignal {
  return current;
}

export function isCoarse(): boolean {
  return current.isCoarse;
}

/** Called for every change; returns an unsubscribe. */
export function subscribeDevice(fn: (d: DeviceSignal) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Record that a stylus is in use. Sticky for the session. */
export function notePen() {
  if (!current.hasPen) publish({ ...current, hasPen: true });
}

/** How long after the last resize the layout counts as settled. */
const RESIZE_SETTLE_MS = 250;

let installed = false;

/**
 * Start following the device: media-query changes (a tablet docked to a
 * keyboard and trackpad), resizes and rotations, and the first stylus.
 * Idempotent.
 */
export function installDeviceSignal() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const refresh = () => publish(read());
  refresh();
  try {
    window.matchMedia?.('(pointer: coarse)').addEventListener?.('change', refresh);
  } catch {
    /* an old engine without MediaQueryList events keeps the first answer */
  }
  // A rotation or a split-view drag marks `data-resizing` until it settles, so
  // CSS can land the layout in one step rather than animating every piece.
  let settle: ReturnType<typeof setTimeout> | null = null;
  const resized = () => {
    refresh();
    const root = document.documentElement;
    root.dataset.resizing = '';
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      delete root.dataset.resizing;
    }, RESIZE_SETTLE_MS);
  };
  window.addEventListener('resize', resized);
  window.addEventListener('orientationchange', resized);
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'pen') notePen();
    },
    true
  );
}

// Read once at load so the first render already knows.
if (typeof window !== 'undefined') current = read();

/**
 * How far, in screen px, to lift the board so an editor box clears the
 * on-screen keyboard.
 *
 * `visibleTop` and `visibleBottom` are the visual viewport's edges in client
 * coordinates (`offsetTop` and `offsetTop + height`), which shrink when the
 * keyboard opens. A box taller than what is left is lifted only until its top
 * reaches the top, so the caret's first line stays in view. Zero when the box
 * already fits.
 */
export function keyboardLift(
  box: { top: number; bottom: number },
  visibleTop: number,
  visibleBottom: number,
  margin = 16
): number {
  const overflow = box.bottom - (visibleBottom - margin);
  if (overflow <= 0) return 0;
  const room = box.top - (visibleTop + margin);
  return Math.max(0, Math.min(overflow, room));
}
