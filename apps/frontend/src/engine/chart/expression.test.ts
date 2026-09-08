import { describe, expect, it } from 'vitest';
import { parseExpression } from './expression';

describe('parseExpression', () => {
  function evalAt(source: string, x: number): number {
    const res = parseExpression(source, 'x');
    if (!res.ok) throw new Error(`Parse failed: ${res.error.message} at ${res.error.position}`);
    return res.expression.evaluate(x);
  }

  function evalXY(source: string, x: number, y: number): number {
    const res = parseExpression(source, ['x', 'y']);
    if (!res.ok) throw new Error(`Parse failed: ${res.error.message} at ${res.error.position}`);
    return res.expression.evaluate(x, y);
  }

  describe('operator precedence and associativity', () => {
    it('evaluates -x^2 as -(x^2)', () => {
      // Exponentiation binds tighter than unary negation: -x^2 = -(x^2) = -9 at x=3
      expect(evalAt('-x^2', 3)).toBe(-9);
      expect(evalAt('-3^2', 0)).toBe(-9);
    });

    it('preserves commutativity of addition with negation and powers', () => {
      // -x^2 + 1 === 1 - x^2
      expect(evalAt('-x^2 + 1', 3)).toBe(-8);
      expect(evalAt('1 - x^2', 3)).toBe(-8);
    });

    it('respects explicit parentheses for negated base: (-x)^2', () => {
      expect(evalAt('(-x)^2', 3)).toBe(9);
      expect(evalAt('(-3)^2', 0)).toBe(9);
    });

    it('evaluates negative exponents correctly: 2^-3 = 0.125', () => {
      expect(evalAt('2^-3', 0)).toBe(0.125);
      expect(evalAt('-2^-3', 0)).toBe(-0.125);
    });

    it('is right-associative for chained powers: 2^3^2 = 2^(3^2) = 512', () => {
      expect(evalAt('2^3^2', 0)).toBe(512);
      expect(evalAt('(2^3)^2', 0)).toBe(64);
    });

    it('handles implicit multiplication with power correctly: 2x^3 = 2 * (x^3)', () => {
      expect(evalAt('2x^3', 2)).toBe(16);
      expect(evalAt('3(x+1)^2', 1)).toBe(12);
    });

    it('handles chained unary signs correctly: --x = x, -+-x = x', () => {
      expect(evalAt('--x', 5)).toBe(5);
      expect(evalAt('-+-x', 5)).toBe(5);
      expect(evalAt('---x', 5)).toBe(-5);
    });
  });

  describe('mathematical functions & notation', () => {
    it('evaluates sinc(0) to 1 without division by zero NaN', () => {
      expect(evalAt('sinc(0)', 0)).toBe(1);
      expect(evalAt('sinc(pi)', 0)).toBeCloseTo(0, 5);
    });

    it('treats log as base 10 and ln as natural logarithm', () => {
      expect(evalAt('log(100)', 0)).toBe(2);
      expect(evalAt('ln(e)', 0)).toBe(1);
      expect(evalAt('log2(8)', 0)).toBe(3);
    });

    it('supports pipe notation |x| and abs(x) for absolute value', () => {
      expect(evalAt('|-5|', 0)).toBe(5);
      expect(evalAt('|x - 7|', 3)).toBe(4);
      expect(evalAt('abs(-10)', 0)).toBe(10);
      expect(evalAt('2|x|', -3)).toBe(6);
      expect(evalXY('|x||y|', -3, 4)).toBe(12);
    });

    it('supports scientific notation without confusing with identifier e', () => {
      expect(evalAt('1e3', 0)).toBe(1000);
      expect(evalAt('2.5e-2', 0)).toBe(0.025);
      expect(evalAt('1e+2', 0)).toBe(100);
    });

    it('supports constants pi, e, tau, phi', () => {
      expect(evalAt('pi', 0)).toBe(Math.PI);
      expect(evalAt('e', 0)).toBe(Math.E);
      expect(evalAt('tau', 0)).toBe(Math.PI * 2);
      expect(evalAt('phi', 0)).toBeCloseTo(1.6180339887, 6);
    });
  });

  describe('multivariate expressions', () => {
    it('evaluates expressions with multiple variables: x^2 + y^2', () => {
      expect(evalXY('x^2 + y^2', 3, 4)).toBe(25);
      expect(evalXY('x * y^2', 2, 3)).toBe(18);
      expect(evalXY('-x^2 - y^2', 3, 4)).toBe(-25);
    });
  });

  describe('syntax errors and edge cases', () => {
    it('returns ok: false on empty expression', () => {
      const res = parseExpression('   ');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.message).toBe('Empty expression');
    });

    it('fails gracefully on unmatched parentheses', () => {
      const res = parseExpression('(x + 1');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.message).toContain('Missing ")"');
    });

    it('fails gracefully on unknown functions', () => {
      const res = parseExpression('unknownFn(x)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.message).toContain('Unknown function');
    });

    it('fails gracefully on arity mismatch', () => {
      const res = parseExpression('atan2(x)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.message).toContain('atan2 takes 2 arguments');
    });

    it('returns NaN for division by zero without crashing', () => {
      const val = evalAt('1 / x', 0);
      expect(Number.isFinite(val)).toBe(false);
    });
  });
});
