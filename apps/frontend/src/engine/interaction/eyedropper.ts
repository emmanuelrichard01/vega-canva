/**
 * Sampling a colour from anywhere on screen.
 *
 * Built on the browser's own `EyeDropper`, which is the only way to read a
 * pixel that is not ours — the specification asks for "any point on the canvas
 * **or screen**", and a canvas-only implementation would be the easy half of
 * the feature wearing the name of the whole one. The native picker also brings
 * the magnifier, the escape handling and the cross-platform cursor, none of
 * which are worth reimplementing worse.
 *
 * ## The control hides when the API is missing
 *
 * Firefox and Safari have no `EyeDropper` at this writing. Rather than ship a
 * pipette that does nothing there, `isEyedropperAvailable()` gates the button —
 * the same rule the object registry applies to renderer capabilities. A
 * fallback that sampled only our own canvas would be a *different* feature
 * behind the same icon, which is worse than its absence.
 */

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperApi {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}

type EyeDropperWindow = typeof globalThis & {
  EyeDropper?: new () => EyeDropperApi;
};

export function isEyedropperAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (window as EyeDropperWindow).EyeDropper === 'function';
}

/**
 * Open the picker and resolve with a hex colour, or null.
 *
 * Null covers both ways this ends without a colour: the user pressed Escape,
 * and the browser refused. Neither is an error worth propagating — a cancelled
 * pick is the ordinary outcome of changing your mind, and a caller that had to
 * catch for it would end up swallowing real failures alongside.
 */
export async function sampleColor(): Promise<string | null> {
  const ctor = (window as EyeDropperWindow).EyeDropper;
  if (!ctor) return null;

  try {
    const { sRGBHex } = await new ctor().open();
    // The API is specified to return `#rrggbb`, but it is the one value here
    // that comes from outside our own code, and every colour downstream is
    // parsed as a hex.
    return /^#[0-9a-fA-F]{6}$/.test(sRGBHex) ? sRGBHex.toUpperCase() : null;
  } catch {
    return null;
  }
}
