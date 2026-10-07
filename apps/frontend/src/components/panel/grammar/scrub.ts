/**
 * Scrubbing: dragging a number field's glyph sideways to change its value.
 *
 * Pure so the maths can be tested without a pointer. The field calls
 * `scrubValue` on every move with the distance travelled since the press, and
 * the modifiers held *now*, so pressing Shift halfway through a drag changes
 * the rate from that moment without a jump: the rate applies to the whole
 * distance, which is what Figma does and what reads as "faster", not "skip".
 */

/** Pixels of pointer travel per base step. */
export const PX_PER_STEP = 2;

export interface ScrubModifiers {
  /** Coarse: ten steps per unit of travel. */
  shift?: boolean;
  /** Fine: a tenth of a step per unit of travel. */
  alt?: boolean;
}

export interface ScrubOptions {
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places kept. Defaults to what the step implies (0 for 1, 1 for 0.1). */
  precision?: number;
}

/** How much one base step is worth under the modifiers. */
export function scrubRate(step: number, mods: ScrubModifiers): number {
  if (mods.shift) return step * 10;
  if (mods.alt) return step / 10;
  return step;
}

/** Decimal places a step implies: 1 → 0, 0.5 → 1, 0.01 → 2. */
export function stepPrecision(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * The value after dragging `dx` pixels from a press at `start`.
 *
 * Alt adds a decimal place, so a fine drag on an integer field still moves.
 */
export function scrubValue(start: number, dx: number, mods: ScrubModifiers, opts: ScrubOptions = {}): number {
  const step = opts.step && opts.step > 0 ? opts.step : 1;
  const rate = scrubRate(step, mods);
  const steps = Math.trunc(dx / PX_PER_STEP);
  const base = opts.precision ?? stepPrecision(step);
  const places = mods.alt ? Math.max(base, stepPrecision(rate)) : base;
  const raw = roundTo(start + steps * rate, places);
  const lo = opts.min ?? -Infinity;
  const hi = opts.max ?? Infinity;
  return Math.min(hi, Math.max(lo, raw));
}
