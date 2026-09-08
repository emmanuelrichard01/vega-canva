import { EXPRESSION_CONSTANTS, EXPRESSION_FUNCTIONS } from './expression';

/**
 * What you can write, as something you can press.
 *
 * ## What this replaces
 *
 * A disclosure labelled "What you can write", containing a sentence about
 * operators and then `EXPRESSION_FUNCTIONS.join('  ')` — thirty function names
 * in a row, with no arities, no descriptions and nothing to click. It answered
 * "does `cbrt` exist" and no other question: not what `sinc` is for, not
 * whether `log` is base ten (it is, and `ln` is natural, which is the single
 * most surprising thing about this parser), not how many arguments `atan2`
 * takes.
 *
 * Above it sat a separate row of eleven buttons that *did* insert, covering
 * a third of the functions. So the reference and the way to use it were two
 * different controls, one of which was hidden, and neither was complete.
 *
 * One list now: every function, each with its signature and a line saying
 * what it is for, and pressing one writes it into the formula. A reference
 * you can act on is the only kind anybody reads twice.
 *
 * ## Held to the parser
 *
 * `everyTokenIsDocumented` in the test file walks `EXPRESSION_FUNCTIONS` and
 * fails on anything missing from this table — so a function added to the
 * parser cannot quietly go undocumented, which is how the old list came to be
 * out of date in the first place.
 */

export interface ExpressionToken {
  /** As it is written. */
  name: string;
  /** The call as *documentation*: `atan2(y, x)` rather than `atan2`. */
  signature: string;
  /**
   * The call as *insertion*, which is not the same string.
   *
   * A signature names its arguments, and `y` is not a variable on a
   * single-variable plot — so inserting `atan2(y, x)` wrote a formula that
   * would not parse, and the reference handed the reader an error to find.
   * Two-argument functions carry a working skeleton instead: a second
   * argument that is a number, chosen so the result is something you can see
   * rather than a flat line.
   */
  insert: string;
  /** One line. What it is *for*, not what it computes. */
  note: string;
  group: 'Trigonometry' | 'Exponentials' | 'Rounding' | 'Arithmetic' | 'Shapes' | 'Constants';
}

/** One-argument, where what you read and what you get are the same. */
const F = (
  name: string,
  signature: string,
  group: ExpressionToken['group'],
  note: string
): ExpressionToken => ({ name, signature, insert: signature, note, group });

/** Two-argument, where they are not. */
const F2 = (
  name: string,
  signature: string,
  insert: string,
  group: ExpressionToken['group'],
  note: string
): ExpressionToken => ({ name, signature, insert, note, group });

export const EXPRESSION_TOKENS: ExpressionToken[] = [
  // ── Trigonometry ───────────────────────────────────────────────────────
  F('sin', 'sin(x)', 'Trigonometry', 'Sine, in radians'),
  F('cos', 'cos(x)', 'Trigonometry', 'Cosine, in radians'),
  F('tan', 'tan(x)', 'Trigonometry', 'Tangent; has poles, which the plot breaks at'),
  F('asin', 'asin(x)', 'Trigonometry', 'Inverse sine, defined on −1 to 1'),
  F('acos', 'acos(x)', 'Trigonometry', 'Inverse cosine, defined on −1 to 1'),
  F('atan', 'atan(x)', 'Trigonometry', 'Inverse tangent, flattening toward ±π/2'),
  F2('atan2', 'atan2(y, x)', 'atan2(x, 1)', 'Trigonometry', 'The angle of a point, with its quadrant kept'),
  F('sinh', 'sinh(x)', 'Trigonometry', 'Hyperbolic sine'),
  F('cosh', 'cosh(x)', 'Trigonometry', 'Hyperbolic cosine — the shape a hanging chain takes'),
  F('tanh', 'tanh(x)', 'Trigonometry', 'Hyperbolic tangent; the saturating S curve'),

  // ── Exponentials ───────────────────────────────────────────────────────
  F('exp', 'exp(x)', 'Exponentials', 'e to the x'),
  // The one genuinely surprising thing in the parser, so it says so here.
  F('ln', 'ln(x)', 'Exponentials', 'Natural log, base e'),
  F('log', 'log(x)', 'Exponentials', 'Log base 10 — not the natural one'),
  F('log2', 'log2(x)', 'Exponentials', 'Log base 2'),
  F('sqrt', 'sqrt(x)', 'Exponentials', 'Square root'),
  F('cbrt', 'cbrt(x)', 'Exponentials', 'Cube root, which accepts negatives'),
  F2('pow', 'pow(a, b)', 'pow(x, 2)', 'Exponentials', 'a to the b; `a^b` is the same thing'),

  // ── Rounding ───────────────────────────────────────────────────────────
  F('floor', 'floor(x)', 'Rounding', 'Down to the next whole number'),
  F('ceil', 'ceil(x)', 'Rounding', 'Up to the next whole number'),
  F('round', 'round(x)', 'Rounding', 'To the nearest whole number'),
  F('sign', 'sign(x)', 'Rounding', '−1, 0 or 1, by which side of zero'),
  F('abs', 'abs(x)', 'Rounding', 'Distance from zero'),

  // ── Arithmetic ─────────────────────────────────────────────────────────
  F2('min', 'min(a, b)', 'min(x, 1)', 'Arithmetic', 'The smaller of two — clips a curve from above'),
  F2('max', 'max(a, b)', 'max(x, 0)', 'Arithmetic', 'The larger of two — clips a curve from below'),
  F2('mod', 'mod(a, b)', 'mod(x, 2)', 'Arithmetic', 'Remainder — the sawtooth of periodic plots'),

  // ── Shapes ─────────────────────────────────────────────────────────────
  F('sinc', 'sinc(x)', 'Shapes', 'sin(x)/x, and 1 at zero; the diffraction curve'),
  F('gauss', 'gauss(x)', 'Shapes', 'The standard normal bell, area one'),

  // ── Constants ──────────────────────────────────────────────────────────
  F('pi', 'pi', 'Constants', '3.14159…'),
  F('e', 'e', 'Constants', "2.71828…, the natural log's base"),
  F('tau', 'tau', 'Constants', 'Two pi — one whole turn'),
  F('phi', 'phi', 'Constants', 'The golden ratio, 1.61803…'),
];

/**
 * The token, with the caller's variable in place of the placeholder.
 *
 * The reference is written against `x` because that is what most plots use,
 * and a parametric curve is in `t` and a polar one in `a`. Substituting means
 * pressing `sin` on a polar plot writes `sin(a)` — the thing that will
 * actually draw — instead of `sin(x)`, which is an error the person then has
 * to notice and fix.
 */
export function tokenFor(token: ExpressionToken, variable: string): string {
  if (token.group === 'Constants') return token.name;
  return token.insert.replace(/\bx\b/g, variable);
}

/** Grouped, in the order the groups are declared above. */
export function tokenGroups(): Array<{ group: ExpressionToken['group']; tokens: ExpressionToken[] }> {
  const order: Array<ExpressionToken['group']> = [];
  for (const token of EXPRESSION_TOKENS) {
    if (!order.includes(token.group)) order.push(token.group);
  }
  return order.map((group) => ({
    group,
    tokens: EXPRESSION_TOKENS.filter((t) => t.group === group),
  }));
}

/** What the parser knows, for the test that holds this table to it. */
export const PARSER_NAMES = [...EXPRESSION_FUNCTIONS, ...EXPRESSION_CONSTANTS];
