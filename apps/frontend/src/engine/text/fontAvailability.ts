import { fontEntry } from './fontCatalogue';

/**
 * Whether a family can actually be drawn on this device.
 *
 * Built-in faces always can: they are bundled or fetched. Uploaded faces can,
 * because every collaborator loads them from the board. Anything else came
 * from somebody's own machine, and is either installed here too or silently
 * replaced by the fallback. Telling those two apart is the point of this
 * module: the picker shows a "missing" mark instead of letting a substitute
 * pass for the real face.
 */

export type Availability = 'builtin' | 'board' | 'local' | 'installed' | 'missing' | 'unknown';

const SAMPLE = 'mmmmmmmmmmlliWW@#0123';
const BASES = ['monospace', 'serif', 'sans-serif'] as const;
const cache = new Map<string, Availability>();

type Measure = (font: string) => number | null;

function canvasMeasure(): Measure | null {
  if (typeof document === 'undefined') return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  const c = ctx;
  return (font) => {
    c.font = font;
    return c.measureText(SAMPLE).width;
  };
}

/**
 * Installed or not, by measurement: a family the system has changes the
 * width of the sample against at least one generic fallback.
 */
export function probeInstalled(family: string, measure: Measure | null = canvasMeasure()): 'installed' | 'missing' | 'unknown' {
  if (!measure) return 'unknown';
  const safe = family.replace(/["\\]/g, '');
  for (const base of BASES) {
    const plain = measure(`72px ${base}`);
    const withFamily = measure(`72px "${safe}", ${base}`);
    if (plain === null || withFamily === null) return 'unknown';
    if (Math.abs(plain - withFamily) > 0.01) return 'installed';
  }
  return 'missing';
}

export function familyAvailability(family: string | undefined): Availability {
  if (!family) return 'builtin';
  const entry = fontEntry(family);
  if (entry?.source === 'board') return 'board';
  if (entry?.source === 'local') return 'local';
  if (entry) return 'builtin';
  const cached = cache.get(family);
  if (cached) return cached;
  const result = probeInstalled(family);
  if (result !== 'unknown') cache.set(family, result);
  return result;
}

/** Test seam. */
export function resetAvailabilityCache(): void {
  cache.clear();
}
