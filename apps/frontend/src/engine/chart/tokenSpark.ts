import { parseExpression } from './expression';
import { EXPRESSION_TOKENS, tokenFor, type ExpressionToken } from './expressionHelp';

/**
 * What a function *looks like*, as a path a reference row can draw.
 *
 * ## Why a reference should draw
 *
 * The old help answered "does `cbrt` exist" and nothing else. Prose fixed part
 * of that — "the standard normal bell", "the saturating S curve" — but a
 * sentence about a shape is a description of a picture, and the picture is
 * eighty bytes.
 *
 * `tanh` is the clearest case. "Hyperbolic tangent" tells you nothing unless
 * you already know; *the S* tells you immediately, and tells you the thing
 * that matters about it — that it saturates. Same for `sinc`'s ringing,
 * `gauss`'s bell, `floor`'s staircase and `mod`'s sawtooth. Four of those are
 * chosen *because* of their shape, so the shape is the definition.
 *
 * This is the same principle the example browser runs on — the preview is the
 * thing — applied to the other popover in the same section.
 *
 * ## Cheap enough to do for all of them
 *
 * Forty-eight samples of one compiled expression, once per function per
 * lifetime of the module. The whole set is well under a millisecond, which is
 * why there is no laziness here and a `Map` is the entire optimisation: it is
 * three orders of magnitude cheaper than an example thumbnail, and pretending
 * otherwise would be machinery for its own sake.
 */

const SAMPLES = 48;

/** The box a spark is drawn in, in its own coordinates. */
export const SPARK_W = 34;
export const SPARK_H = 16;

const cache = new Map<string, string | null>();

/**
 * The domain each function is worth seeing over.
 *
 * Chosen per function rather than shared, because a single window flatters
 * none of them: `exp` over −6..6 is a vertical line against the axis, and
 * `asin` outside −1..1 is undefined and would draw nothing at all.
 */
const DOMAIN: Record<string, [number, number]> = {
  asin: [-1, 1],
  acos: [-1, 1],
  exp: [-2, 2],
  ln: [0.05, 6],
  log: [0.05, 20],
  log2: [0.05, 12],
  sqrt: [0, 6],
  cbrt: [-4, 4],
  pow: [-2, 2],
  gauss: [-3, 3],
  sinc: [-10, 10],
  mod: [0, 8],
  tan: [-1.3, 1.3],
  sinh: [-2.5, 2.5],
  cosh: [-2.5, 2.5],
};

/**
 * One function as an SVG path, or `null` where a curve says nothing.
 *
 * A constant has no shape — `pi` is a number, and a flat line across a box
 * would imply it varies and happens to be level. Those rows show their value
 * instead, which is what a constant's reference entry is *for*.
 */
export function tokenSpark(token: ExpressionToken): string | null {
  const cached = cache.get(token.name);
  if (cached !== undefined) return cached;

  const path = build(token);
  cache.set(token.name, path);
  return path;
}

function build(token: ExpressionToken): string | null {
  if (token.group === 'Constants') return null;

  const source = tokenFor(token, 'x');
  const parsed = parseExpression(source, ['x']);
  if (!parsed.ok) return null;

  const [lo, hi] = DOMAIN[token.name] ?? [-6, 6];
  const step = (hi - lo) / (SAMPLES - 1);

  const points: Array<{ x: number; y: number } | null> = [];
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < SAMPLES; i += 1) {
    const x = lo + i * step;
    const y = parsed.expression.evaluate(x);
    if (!Number.isFinite(y)) {
      // A hole rather than a straight line across it, which is the same rule
      // the plotter follows at an asymptote.
      points.push(null);
      continue;
    }
    points.push({ x, y });
    if (y < min) min = y;
    if (y > max) max = y;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  /**
   * A flat function still needs a range, or every sample lands on one row and
   * the divide is by zero. Half a unit either side keeps `sign`'s plateaus
   * apart without stretching a genuinely flat curve into noise.
   */
  if (max - min < 1e-6) {
    min -= 0.5;
    max += 0.5;
  }

  const pad = 1.5;
  const sx = (x: number) => pad + ((x - lo) / (hi - lo)) * (SPARK_W - pad * 2);
  // Screen y grows downward and a function's does not.
  const sy = (y: number) => SPARK_H - pad - ((y - min) / (max - min)) * (SPARK_H - pad * 2);

  let d = '';
  let pen = false;
  for (const point of points) {
    if (!point) {
      pen = false;
      continue;
    }
    const cmd = pen ? 'L' : 'M';
    d += `${cmd}${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)}`;
    pen = true;
  }

  return d || null;
}

/** Every function's spark, warmed in one pass. For a test, and for a preload. */
export function warmSparks(): void {
  for (const token of EXPRESSION_TOKENS) tokenSpark(token);
}
