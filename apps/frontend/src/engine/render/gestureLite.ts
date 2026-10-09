/**
 * The board's render budget, applied to Konva, and the gesture shortcut.
 *
 * Installed once by the canvas module, before any stage exists, so every
 * canvas Konva creates uses the capped pixel ratio.
 *
 * On a lite budget, while the board is moving (the camera panning or zooming,
 * or an object being dragged) shapes draw without their shadows and `<html>`
 * carries `data-gesture`, which takes backdrop blur off the chrome over the
 * board. Both come back on the frame after the motion stops. A shadow blur is
 * the most expensive thing Konva draws, and a backdrop blur over a canvas that
 * changes every frame is recomposited every frame.
 */
import Konva from 'konva';
import { engineEvents } from '../EventBus';
import { readRenderBudget } from './renderBudget';

/** How long after the last camera change the board counts as still. */
export const GESTURE_LINGER_MS = 160;

let moving = false;
let drags = 0;
let lastMotion = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Whether shadows are standing down for motion. */
export function gestureLiteActive(): boolean {
  return moving;
}

function setMoving(next: boolean) {
  if (next === moving) return;
  moving = next;
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root) {
    if (next) root.dataset.gesture = '';
    else delete root.dataset.gesture;
  }
  // Shadows return on the next frame; while moving, the motion itself redraws.
  if (!next) Konva.stages.forEach((stage) => stage.batchDraw());
}

function settle() {
  timer = null;
  if (drags > 0) return;
  const idle = performance.now() - lastMotion;
  if (idle >= GESTURE_LINGER_MS) setMoving(false);
  else timer = setTimeout(settle, GESTURE_LINGER_MS - idle);
}

/** Note a frame of motion. Cheap enough to call on every camera change. */
export function noteMotion() {
  lastMotion = performance.now();
  setMoving(true);
  if (!timer) timer = setTimeout(settle, GESTURE_LINGER_MS);
}

let installed = false;

export function installRenderBudget() {
  if (installed) return;
  installed = true;
  const budget = readRenderBudget();
  Konva.pixelRatio = budget.pixelRatio;
  if (!budget.lite || typeof window === 'undefined') return;

  const proto = Konva.Shape.prototype as unknown as { hasShadow: () => boolean };
  const hasShadow = proto.hasShadow;
  proto.hasShadow = function (this: Konva.Shape) {
    return !moving && hasShadow.call(this);
  };

  engineEvents.on('CameraChanged', noteMotion);
  window.addEventListener('canvas-drag-start', () => {
    drags++;
    noteMotion();
  });
  const end = () => {
    if (drags === 0) return;
    drags = Math.max(0, drags - 1);
    if (drags === 0) noteMotion();
  };
  window.addEventListener('canvas-drag-end', end);
  // A drag whose end was never announced is over when the pointer comes up.
  window.addEventListener(
    'pointerup',
    () => {
      if (drags === 0) return;
      drags = 0;
      noteMotion();
    },
    true
  );
}
