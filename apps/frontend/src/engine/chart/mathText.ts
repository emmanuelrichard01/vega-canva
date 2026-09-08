/**
 * An expression, set the way it would be written by hand.
 *
 * ## Why this is Unicode and not KaTeX
 *
 * A chart's formulae are drawn in two places that are not the DOM: Konva's
 * `Text`, which takes a string and paints it on a canvas, and the SVG
 * exporter's `<text>`. KaTeX and MathJax both produce **HTML** — nested spans
 * with their own fonts and CSS — so neither can be drawn by either of them.
 * The usual escape, `<foreignObject>`, is not one: a great many SVG consumers
 * (most design tools, most PDF converters, every rasteriser that is not a
 * browser) ignore it, so an exported chart would come back with a blank space
 * where the legend used to be — the worst kind of failure, because the file
 * looks fine until somebody else opens it.
 *
 * So the canvas and the export get *typography*, not typesetting: real
 * superscripts, real Greek, a real multiplication dot, a real minus. That
 * covers everything this expression language can express — it has no
 * fractions, no integrals and no matrices in its *input* — and it costs no
 * dependency, no font loading, and nothing at export time.
 *
 * A DOM surface can do better, and the properties panel is a DOM surface.
 * KaTeX belongs there if it belongs anywhere; this module is what makes the
 * *chart* read well, which is where a formula is actually looked at.
 *
 * ## Display only
 *
 * Nothing here is reversible and nothing should be fed back to the parser.
 * The stored source stays exactly as it was typed — this is a second
 * *rendering* of it, not a second *representation*, which is the distinction
 * that keeps it from becoming a source of truth nobody meant to create.
 */

/** Digits and the few symbols with real superscript characters. */
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  n: 'ⁿ',
  i: 'ⁱ',
};

/**
 * The names the parser knows, as the symbols they stand for.
 *
 * Only these four, because only these four are constants in the expression
 * language — writing `θ` for a variable the parser has never heard of would be
 * a chart labelled in a notation it cannot read back.
 */
const SYMBOLS: Array<[RegExp, string]> = [
  [/\bpi\b/g, 'π'],
  [/\btau\b/g, 'τ'],
  [/\bphi\b/g, 'φ'],
  // The polar plot's angle variable, which is written `a` and read as theta.
  [/\btheta\b/g, 'θ'],
];

/** Everything a superscript run can be made of. */
function toSuperscript(run: string): string | null {
  let out = '';
  for (const ch of run) {
    const sup = SUPERSCRIPT[ch];
    // One character without a superscript form and the whole run stays flat:
    // `x²ᐟ³` half-raised is harder to read than `x^(2/3)`.
    if (!sup) return null;
    out += sup;
  }
  return out;
}

/**
 * `x^2` as `x²`, and `x^(n+1)` as `x⁽ⁿ⁺¹⁾` where every character has a form.
 *
 * Parenthesised exponents keep their brackets, raised, because `x^(n+1)`
 * without them is `xⁿ⁺¹` — which reads as the same thing only if you already
 * know it was bracketed.
 */
function raiseExponents(text: string): string {
  return text.replace(/\^\(([^()]{1,12})\)|\^(-?[0-9a-z]{1,4})/g, (whole, bracketed, bare) => {
    const body = bracketed ?? bare;
    const raised = toSuperscript(body);
    if (!raised) return whole;
    return bracketed ? `⁽${raised}⁾` : raised;
  });
}

/**
 * `sqrt(x)` as `√x`, keeping the brackets only where they are load-bearing.
 *
 * `√x` is unambiguous and `√(x + 1)` is not, so the rule is the same one a
 * person writing it out follows: drop the brackets around a single term.
 */
function roots(text: string): string {
  return text.replace(/\bsqrt\(([^()]*)\)/g, (_, body: string) =>
    /^[\w.]+$/.test(body) ? `√${body}` : `√(${body})`
  );
}

/** `abs(x)` as `|x|`, which is what everybody writes and nobody reads as a function. */
function absolute(text: string): string {
  return text.replace(/\babs\(([^()]*)\)/g, (_, body: string) => `|${body}|`);
}

/**
 * An expression as it should be *displayed*.
 *
 * Total: anything it cannot improve it returns unchanged, so a formula the
 * parser rejects still shows the text that was typed rather than a mangled
 * half-translation of it.
 */
export function mathText(source: string): string {
  if (!source) return source;

  let out = source;
  out = absolute(out);
  out = roots(out);
  out = raiseExponents(out);

  for (const [pattern, symbol] of SYMBOLS) out = out.replace(pattern, symbol);

  // A multiplication dot rather than an asterisk, which is a footnote mark
  // everywhere except in code.
  out = out.replace(/\s*\*\s*/g, '·');
  // The real operators, which are single characters in every typeface that
  // has them and two ASCII approximations everywhere else.
  out = out.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠');
  /**
   * A minus sign, not a hyphen — every one of them.
   *
   * There is no third case to protect: an identifier in this language cannot
   * contain a hyphen, so each one is an operator or a sign. An earlier version
   * guarded against names like `log2-scale` and got the *operators* wrong
   * instead — the guard wanted an operand immediately after the sign, so
   * `x^2 - y^2` kept its hyphen because a space came first.
   */
  out = out.replace(/-/g, '−');

  /**
   * One space around a **binary** plus or minus, and none around a sign.
   *
   * `x²−3x+1` reads as one long token, and `− x` reads as a subtraction that
   * has lost its left-hand side, so the two need different treatment. What
   * separates them is whether anything precedes the operator that could be
   * subtracted *from*.
   */
  out = out.replace(/([\w)|²³⁴⁵⁶⁷⁸⁹⁰ⁿⁱ⁾])\s*([+−])\s*/g, '$1 $2 ');

  return out.trim();
}

/**
 * The same, for a label that has to fit somewhere narrow.
 *
 * Identical output; named separately so a caller reads as what it means and
 * so the two can diverge if a legend ever needs a shorter form than a HUD.
 */
export const mathLabel = mathText;
