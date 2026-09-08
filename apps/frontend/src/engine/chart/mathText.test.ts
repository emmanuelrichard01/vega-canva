import { describe, expect, it } from 'vitest';
import { mathText } from './mathText';
import { parseExpression } from './expression';

/**
 * Typography, not typesetting — and the difference is that this has to survive
 * being drawn by Konva and written into an SVG `<text>`, neither of which can
 * render HTML. See the module header for why that rules KaTeX out of the
 * canvas and the export.
 */
describe('mathText', () => {
  it('raises an exponent', () => {
    expect(mathText('x^2')).toBe('x²');
    expect(mathText('x^10')).toBe('x¹⁰');
    expect(mathText('x^n')).toBe('xⁿ');
  });

  it('keeps a bracketed exponent bracketed, raised', () => {
    // `x^(n+1)` flattened to `xⁿ⁺¹` reads as the same thing only if you
    // already knew it was bracketed.
    expect(mathText('x^(n+1)')).toBe('x⁽ⁿ⁺¹⁾');
  });

  it('leaves an exponent it cannot raise alone', () => {
    // Half-raised is worse than flat: `x²ᐟ³` is harder to read than `x^(2/3)`.
    expect(mathText('x^(2/3)')).toContain('^');
  });

  it('writes a root, and keeps the brackets only where they carry weight', () => {
    expect(mathText('sqrt(x)')).toBe('√x');
    expect(mathText('sqrt(x + 1)')).toBe('√(x + 1)');
  });

  it('writes an absolute value the way it is written by hand', () => {
    expect(mathText('abs(x)')).toBe('|x|');
  });

  it('writes the constants it knows as their symbols', () => {
    expect(mathText('2 * pi')).toBe('2·π');
    expect(mathText('tau')).toBe('τ');
    expect(mathText('phi')).toBe('φ');
  });

  it('uses a multiplication dot and the real comparison operators', () => {
    expect(mathText('3 * x')).toBe('3·x');
    expect(mathText('x >= 2')).toContain('≥');
    expect(mathText('x <= 2')).toContain('≤');
  });

  /** A hyphen is not a minus sign, and the difference shows at any size. */
  it('sets a minus rather than a hyphen', () => {
    expect(mathText('x^2 - y^2')).toBe('x² − y²');
    expect(mathText('-x')).toBe('−x');
  });

  it('spaces the binary operators so a long expression is readable', () => {
    expect(mathText('x^2-3x+1')).toBe('x² − 3x + 1');
  });

  /**
   * There is no third case. An identifier in this language cannot contain a
   * hyphen, so every one is an operator or a sign — and the version that
   * guarded against names got the operators wrong instead.
   */
  it('leaves a name alone, and treats every hyphen as maths', () => {
    expect(mathText('log2(x)')).toBe('log2(x)');
    expect(mathText('(-3)')).toBe('(−3)');
    expect(mathText('a-b')).toBe('a − b');
  });

  /**
   * Total, and display-only.
   *
   * A formula the parser rejects still has to show what was typed — a mangled
   * half-translation of a broken expression is worse than the broken
   * expression, because it hides the typo.
   */
  it('returns anything it cannot improve unchanged', () => {
    expect(mathText('')).toBe('');
    expect(mathText('((')).toBe('((');
    expect(mathText('wat(')).toBe('wat(');
  });

  /**
   * The stored source is never replaced by this. Asserted by parsing the
   * *original* after rendering, because the failure this guards is somebody
   * later writing the pretty form back into the document.
   */
  it('does not touch the source it was given', () => {
    const source = 'sin(x) * cos(x)';
    const before = source;
    mathText(source);
    expect(source).toBe(before);
    expect(parseExpression(source, ['x']).ok).toBe(true);
  });

  it('is not itself parseable, which is why it must stay on the surface', () => {
    // Proof that the two forms are different things: the rendered one is for
    // eyes only, and the test says so rather than a comment hoping so.
    expect(parseExpression(mathText('x^2'), ['x']).ok).toBe(false);
  });
});
