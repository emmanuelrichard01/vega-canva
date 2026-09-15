/**
 * The sketch treatment's fill: hachure.
 *
 * A sketched bar used to be the crisp bar's colour poured into a wobbly
 * outline — a rough *edge* on a solid block, which reads as a rendering
 * filter rather than as a hand. Every hand-drawn chart tool this is measured
 * against (Excalidraw, rough.js, a marker on a whiteboard) fills with strokes:
 * diagonal lines, a little uneven, over a pale wash. That is what makes a
 * chart look *drawn* while every value, edge and label stays exactly where
 * the clean chart put it.
 *
 * Returned as SVG path data so the canvas and the export draw one hatch —
 * seeded like every other sketched mark, so a reload does not reshuffle it.
 */

/** A small deterministic PRNG (mulberry32), so the hatch is stable per seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Diagonal strokes across a rectangle, each slightly bowed and jittered.
 *
 * The gap scales gently with the rectangle so a small cell is not a solid
 * scribble and a large tile is not a few lonely lines.
 */
export function hachure(
  rect: { x: number; y: number; width: number; height: number },
  seed: number,
  gap?: number
): string {
  const { x, y, width: w, height: h } = rect;
  if (!(w > 1) || !(h > 1)) return '';
  const g = gap ?? Math.max(4, Math.min(8, Math.sqrt(w * h) / 12));
  const next = rng(seed);
  const jitter = () => (next() - 0.5) * 1.4;
  const out: string[] = [];

  // Lines of the form x + y = s ("/"), stepped across the rectangle.
  const step = g * Math.SQRT2;
  for (let s = x + y + step * 0.6; s < x + w + y + h; s += step) {
    const x0 = Math.max(x, s - (y + h));
    const x1 = Math.min(x + w, s - y);
    if (x1 - x0 < 1.5) continue;
    const ax = x0 + 0.6;
    const ay = s - x0 - 0.6;
    const bx = x1 - 0.6;
    const by = s - x1 + 0.6;
    const mx = (ax + bx) / 2 + jitter();
    const my = (ay + by) / 2 + jitter();
    out.push(
      `M${(ax + jitter() * 0.5).toFixed(1)} ${(ay + jitter() * 0.5).toFixed(1)}` +
        `Q${mx.toFixed(1)} ${my.toFixed(1)} ${(bx + jitter() * 0.5).toFixed(1)} ${(by + jitter() * 0.5).toFixed(1)}`
    );
  }
  return out.join('');
}

/** The hand the sketch treatment letters in, and how much larger it is set. */
export const SKETCH_FONT = 'Caveat, "Segoe Print", "Bradley Hand", cursive';
/** Caveat's x-height is small; at the clean size it reads as a footnote. */
export const SKETCH_FONT_SCALE = 1.3;
