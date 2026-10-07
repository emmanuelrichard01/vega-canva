/**
 * The three freehand brushes, as stroke recipes.
 *
 * - **Pen** is the pressure-sensitive ink line: it narrows with pressure or
 *   speed and tapers where the hand lifts.
 * - **Marker** is a felt tip: one even width, round ends, a little more
 *   smoothing, so quick diagram annotations read as deliberate.
 * - **Highlighter** is a wide, flat-ended, translucent band that multiplies
 *   with what is under it, so highlighted text stays readable.
 *
 * A brush is chosen before drawing and written onto the stroke when the pen
 * lifts, so every client renders the stroke the same way whatever brush they
 * hold.
 */
export type Brush = 'pen' | 'marker' | 'highlighter';

export const BRUSHES: readonly Brush[] = ['pen', 'marker', 'highlighter'];

export function isBrush(value: unknown): value is Brush {
  return value === 'pen' || value === 'marker' || value === 'highlighter';
}

export interface StrokeRecipeInput {
  /** The nib setting, in world units. */
  size: number;
  /** The smoothing setting, 0–1. */
  smoothing: number;
  /** Whether the device is reporting real pressure. */
  realPressure: boolean;
  /** False while the stroke is still being drawn. */
  last: boolean;
}

/** `perfect-freehand` options for a brush. */
export interface StrokeOptions {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
  last: boolean;
  start?: { cap?: boolean; taper?: number };
  end?: { cap?: boolean; taper?: number };
}

/** The width a brush lays down for a given nib setting. */
export function brushWidth(brush: Brush, size: number): number {
  switch (brush) {
    case 'marker':
      return Math.max(3, size * 1.5);
    case 'highlighter':
      return Math.max(14, size * 3);
    default:
      return size;
  }
}

export function strokeOptions(brush: Brush, input: StrokeRecipeInput): StrokeOptions {
  const { smoothing, realPressure, last } = input;
  const size = brushWidth(brush, input.size);
  // A stylus reports real positions at a real rate and needs less help than a
  // mouse at every setting.
  const relief = realPressure ? 0.8 : 1;
  const streamline = smoothing * relief;
  const curve = (0.25 + smoothing * 0.45) * relief;

  if (brush === 'marker') {
    return {
      size,
      thinning: 0,
      smoothing: Math.min(0.85, curve + 0.1),
      streamline: Math.min(0.9, streamline + 0.1),
      simulatePressure: false,
      last,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
    };
  }

  if (brush === 'highlighter') {
    return {
      size,
      thinning: 0,
      smoothing: Math.min(0.9, curve + 0.15),
      streamline: Math.min(0.92, streamline + 0.15),
      simulatePressure: false,
      last,
      // Flat ends: a highlighter's chisel tip leaves a square-cut stroke.
      start: { cap: false, taper: 0 },
      end: { cap: false, taper: 0 },
    };
  }

  return {
    size,
    // A mouse has no pressure, and inferring it from cursor velocity at full
    // strength turns the OS's bursty event timing into bulges in the line.
    thinning: realPressure ? 0.5 : 0.12,
    smoothing: curve,
    streamline,
    simulatePressure: !realPressure,
    last,
  };
}

/** How a finished stroke of this brush is composited onto the board. */
export function brushPaint(brush: Brush | undefined, dark: boolean): {
  opacity: number;
  globalCompositeOperation?: GlobalCompositeOperation;
} {
  if (brush === 'highlighter') {
    // Multiply keeps ink under the band crisp on a light board. On a dark board
    // multiply would darken the band to nothing, so it is a plain translucent
    // wash there instead.
    return dark ? { opacity: 0.38 } : { opacity: 0.5, globalCompositeOperation: 'multiply' };
  }
  return { opacity: 1 };
}

/** Turn `perfect-freehand`'s outline polygon into SVG path data. */
export function svgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q'] as (string | number)[]
  );
  d.push('Z');
  return d.join(' ');
}
