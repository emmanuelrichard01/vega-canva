/**
 * Level of detail at distance, for a lite render budget (see `renderBudget`).
 *
 * Renderers ask one question: "is this too small on screen to be worth
 * drawing properly?" They re-render only when the answer flips, never per
 * camera frame: the zoom is watched in steps of 20%, and the listeners run
 * only when it crosses into another step.
 */
import { useSyncExternalStore } from 'react';
import { cameraSystem } from '../CameraSystem';
import { engineEvents } from '../EventBus';
import { isLiteRender } from './renderBudget';

/** Type smaller than this on screen, in px, is drawn as blocks. */
export const TEXT_BLOCK_PX = 4.5;

/** At or below this zoom, a chart is drawn from a bitmap. */
export const CHART_BITMAP_ZOOM = 0.5;

/** Whether `worldPx` of type would be drawn as blocks at `zoom`. Pure. */
export function textAsBlocks(worldPx: number, zoom: number, lite: boolean): boolean {
  return lite && worldPx * zoom < TEXT_BLOCK_PX;
}

const STEP = Math.log(1.2);
const stepOf = (zoom: number) => Math.floor(Math.log(Math.max(zoom, 1e-6)) / STEP);

const listeners = new Set<() => void>();
let step = Number.NaN;
let unhook: (() => void) | null = null;

function onCamera() {
  const next = stepOf(cameraSystem.zoom);
  if (next === step) return;
  step = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  if (!isLiteRender()) return () => {};
  listeners.add(fn);
  if (!unhook) {
    step = stepOf(cameraSystem.zoom);
    unhook = engineEvents.on('CameraChanged', onCamera);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && unhook) {
      unhook();
      unhook = null;
    }
  };
}

const never = () => false;

/** True while type of `fontSize` world px is too small on screen to draw as glyphs. */
export function useTextAsBlocks(fontSize: number): boolean {
  return useSyncExternalStore(subscribe, () => textAsBlocks(fontSize, cameraSystem.zoom, isLiteRender()), never);
}

/** True while the board is far enough out that a chart is drawn from a bitmap. */
export function useChartBitmap(): boolean {
  return useSyncExternalStore(subscribe, () => isLiteRender() && cameraSystem.zoom <= CHART_BITMAP_ZOOM, never);
}
