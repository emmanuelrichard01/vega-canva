/**
 * How much drawing a device can afford.
 *
 * Two answers, both read once the board starts:
 *
 * - **The pixel ratio the canvas draws at.** A phone at 3x fills nine
 *   backing pixels per CSS pixel; at 2x it fills four and nobody can tell at
 *   arm's length. A device that reports 4 GB of memory or less, or a phone,
 *   is capped at 2x; 2 GB or less at 1.5x.
 * - **Whether the board draws lite.** Lite means text too small to read is
 *   drawn as blocks, charts far away are drawn from a bitmap, and shadows and
 *   backdrop blur stand down while the board is moving. It is on for a coarse
 *   pointer (phones and tablets) and for a device with 4 GB or less. A desktop
 *   with a mouse draws exactly as it always has.
 *
 * Pure apart from `readRenderBudget`, so the rules can be tested.
 */
import { getDevice, type DeviceClass } from '../ui/device';

export interface RenderBudget {
  /** The pixel ratio Konva's canvases use. */
  pixelRatio: number;
  /** Level of detail and gesture shortcuts are on. */
  lite: boolean;
}

/** The cap for a device's pixel ratio. `deviceMemory` is in GB, undefined where the browser does not say. */
export function pixelRatioCap(dpr: number, deviceMemory: number | undefined, deviceClass: DeviceClass): number {
  const ratio = dpr > 0 ? dpr : 1;
  if (deviceMemory !== undefined && deviceMemory <= 2) return Math.min(ratio, 1.5);
  if ((deviceMemory !== undefined && deviceMemory <= 4) || deviceClass === 'phone') return Math.min(ratio, 2);
  return ratio;
}

export function budgetFor(input: {
  dpr: number;
  deviceMemory: number | undefined;
  deviceClass: DeviceClass;
  coarse: boolean;
}): RenderBudget {
  return {
    pixelRatio: pixelRatioCap(input.dpr, input.deviceMemory, input.deviceClass),
    lite: input.coarse || (input.deviceMemory !== undefined && input.deviceMemory <= 4),
  };
}

let budget: RenderBudget | null = null;

/** The budget for this device, decided on first read and kept for the session. */
export function readRenderBudget(): RenderBudget {
  if (budget) return budget;
  const device = getDevice();
  const memory =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  budget = budgetFor({
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    deviceMemory: typeof memory === 'number' ? memory : undefined,
    deviceClass: device.deviceClass,
    coarse: device.isCoarse,
  });
  return budget;
}

/** Whether level of detail applies. */
export function isLiteRender(): boolean {
  return readRenderBudget().lite;
}

/** The pixel ratio for a cached bitmap that should look like the canvas around it. */
export function renderPixelRatio(): number {
  return readRenderBudget().pixelRatio;
}
