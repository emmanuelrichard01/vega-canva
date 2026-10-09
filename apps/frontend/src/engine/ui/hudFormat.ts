/**
 * How every heads-up readout on the board writes a number.
 *
 * One formatter for the transform badge, the drawing readouts, the Alt
 * measurement and the spacing pills, so a width reads the same everywhere it
 * appears. Units are board pixels and degrees. Pixels carry no suffix, as in
 * Figma: the board has one unit, so "px" after every value is noise. Degrees
 * always carry the ° because an angle and a length can share a pill.
 */

/** The parts of a pill, so separators and axis letters can be quieter than values. */
export interface HudPart {
  text: string;
  /** `value` is the number itself; `muted` is a separator, an axis letter or a unit. */
  role: 'value' | 'muted';
}

export interface HudText {
  /** The whole reading as one string, for tests, titles and copy. */
  text: string;
  parts: HudPart[];
}

/**
 * Decimal places worth showing for this value at this zoom.
 *
 * - At 400% and above a screen pixel is a quarter of a board unit or less, so
 *   a tenth is something the pointer can actually place.
 * - Below ten units a tenth is a large share of the value: a 0.4 gap rounded
 *   to "0" would claim two objects touch when they do not.
 *
 * Otherwise a decimal is the pointer's sub-pixel noise, and it makes the
 * readout flicker while the value is in fact steady.
 */
export function hudDecimals(zoom = 1, value = Infinity): 0 | 1 {
  return zoom >= 4 || Math.abs(value) < 10 ? 1 : 0;
}

const MINUS = '−';

/** A board length: rounded for the zoom, a true minus sign, never "-0" or "12.0". */
export function formatHudNumber(value: number, zoom = 1): string {
  if (!Number.isFinite(value)) return '—';
  const decimals = hudDecimals(zoom, value);
  const factor = decimals === 1 ? 10 : 1;
  const rounded = Math.round(value * factor) / factor;
  if (rounded === 0) return '0';
  const body = Math.abs(rounded).toFixed(decimals).replace(/\.0$/, '');
  return rounded < 0 ? `${MINUS}${body}` : body;
}

/** Whole degrees in [0, 360): what a rotation reads as. */
export function normaliseDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const whole = Math.round(deg);
  const wrapped = ((whole % 360) + 360) % 360;
  return wrapped === 0 ? 0 : wrapped;
}

/** An angle as given (signed or not), whole degrees, with the sign as a true minus. */
export function formatDegrees(deg: number): string {
  if (!Number.isFinite(deg)) return '—°';
  const whole = Math.round(deg);
  if (whole === 0) return '0°';
  return whole < 0 ? `${MINUS}${Math.abs(whole)}°` : `${whole}°`;
}

/** Whether a whole-degree angle sits on the 15° grid that Shift snaps to. */
export function onSnapAngle(deg: number, step = 15): boolean {
  if (!Number.isFinite(deg)) return false;
  return Math.round(deg) % step === 0;
}

const v = (text: string): HudPart => ({ text, role: 'value' });
const m = (text: string): HudPart => ({ text, role: 'muted' });

function join(parts: HudPart[]): HudText {
  return { text: parts.map((p) => p.text).join(''), parts };
}

/** What a readout says. Shared with the store in `hud.ts`. */
export type HudReadout =
  /**
   * Width and height of the thing being drawn or resized: "240 × 180".
   * With a `count` above one, the selection's size of several: "3 objects · 240 × 180".
   */
  | { kind: 'size'; value: { width: number; height: number; count?: number; noun?: string } }
  /** A run's length, and its direction if known: "128 · 45°". */
  | { kind: 'length'; value: { length: number; angle?: number } }
  /** A rotation: "45°". Pass the angle the person should read; it is shown as given, rounded. */
  | { kind: 'angle'; value: number }
  /** A position on the board: "X 120  Y 80". */
  | { kind: 'position'; value: { x: number; y: number } }
  /**
   * How far something has been dragged from where it started: "ΔX 12  ΔY −4".
   * With a `count` above one, prefixed by it: "24 points · ΔX 12  ΔY −4".
   */
  | { kind: 'delta'; value: { dx: number; dy: number; count?: number; noun?: string } }
  /** A distance between two things: "24". Drawn in the measurement colour. */
  | { kind: 'distance'; value: number }
  /** A short state word, when there is no number to give: "Connect". */
  | { kind: 'label'; value: string };

export type HudKind = HudReadout['kind'];

/** The readout as parts, ready to draw. */
export function formatHud(readout: HudReadout, zoom = 1): HudText {
  switch (readout.kind) {
    case 'size':
      return join([
        ...(readout.value.count !== undefined && readout.value.count > 1
          ? [v(String(readout.value.count)), m(` ${readout.value.noun ?? 'objects'} · `)]
          : []),
        v(formatHudNumber(Math.abs(readout.value.width), zoom)),
        m(' × '),
        v(formatHudNumber(Math.abs(readout.value.height), zoom)),
      ]);
    case 'length': {
      const parts = [v(formatHudNumber(Math.abs(readout.value.length), zoom))];
      if (readout.value.angle !== undefined) parts.push(m(' · '), v(formatDegrees(readout.value.angle)));
      return join(parts);
    }
    case 'angle':
      return join([v(formatDegrees(readout.value))]);
    case 'position':
      return join([
        m('X '),
        v(formatHudNumber(readout.value.x, zoom)),
        m('  Y '),
        v(formatHudNumber(readout.value.y, zoom)),
      ]);
    case 'delta':
      return join([
        ...(readout.value.count !== undefined && readout.value.count > 1
          ? [v(String(readout.value.count)), m(` ${readout.value.noun ?? 'objects'} · `)]
          : []),
        m('ΔX '),
        v(formatHudNumber(readout.value.dx, zoom)),
        m('  ΔY '),
        v(formatHudNumber(readout.value.dy, zoom)),
      ]);
    case 'distance':
      return join([v(formatHudNumber(Math.abs(readout.value), zoom))]);
    case 'label':
      return join([v(readout.value)]);
  }
}
