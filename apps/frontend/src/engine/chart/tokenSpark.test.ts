import { describe, expect, it } from 'vitest';
import { EXPRESSION_TOKENS } from './expressionHelp';
import { SPARK_H, SPARK_W, tokenSpark } from './tokenSpark';

/**
 * The reference draws every function it lists.
 *
 * A missing spark is not a crash — the row renders without one — which is
 * exactly why it needs a test. A domain that puts `asin` outside −1..1, or a
 * two-argument signature inserted as documentation rather than as a working
 * call, both fail silently as a blank cell nobody notices until a reader does.
 */

/** Every coordinate a path command carries. */
function coords(d: string): number[] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].flatMap((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

describe('tokenSpark', () => {
  it('draws every function, and no constant', () => {
    for (const token of EXPRESSION_TOKENS) {
      const spark = tokenSpark(token);
      if (token.group === 'Constants') {
        // A flat line across a box would imply `pi` varies and happens to be
        // level. The row shows the glyph instead.
        expect(spark, token.name).toBeNull();
      } else {
        expect(spark, token.name).toBeTruthy();
      }
    }
  });

  it('keeps every point inside the box it is drawn in', () => {
    for (const token of EXPRESSION_TOKENS) {
      const spark = tokenSpark(token);
      if (!spark) continue;
      const values = coords(spark);
      expect(values.length, token.name).toBeGreaterThan(0);
      for (let i = 0; i < values.length; i += 2) {
        expect(values[i], `${token.name} x`).toBeGreaterThanOrEqual(0);
        expect(values[i], `${token.name} x`).toBeLessThanOrEqual(SPARK_W);
        expect(values[i + 1], `${token.name} y`).toBeGreaterThanOrEqual(0);
        expect(values[i + 1], `${token.name} y`).toBeLessThanOrEqual(SPARK_H);
      }
    }
  });

  it('uses the full height, so no curve is a hairline against an edge', () => {
    for (const token of EXPRESSION_TOKENS) {
      const spark = tokenSpark(token);
      if (!spark) continue;
      const ys = coords(spark).filter((_, i) => i % 2 === 1);
      const spread = Math.max(...ys) - Math.min(...ys);
      // The drawable band is SPARK_H less 1.5px of padding either side. A
      // curve filling less than half of it is a domain that flatters it badly
      // — which is the bug `exp` over −6..6 had.
      expect(spread, token.name).toBeGreaterThan((SPARK_H - 3) * 0.5);
    }
  });

  it('lifts the pen at a pole rather than drawing across it', () => {
    // `tan` is sampled across a domain that contains no pole, so the interesting
    // case is that a finite window still draws one unbroken stroke.
    const tan = EXPRESSION_TOKENS.find((t) => t.name === 'tan')!;
    const spark = tokenSpark(tan)!;
    expect(spark.startsWith('M')).toBe(true);
    // Every non-finite sample becomes a fresh M, so a path with more than one
    // is a curve that was correctly broken rather than bridged.
    expect(spark).not.toContain('NaN');
    expect(spark).not.toContain('Infinity');
  });

  it('answers the same string twice', () => {
    const sin = EXPRESSION_TOKENS.find((t) => t.name === 'sin')!;
    expect(tokenSpark(sin)).toBe(tokenSpark(sin));
  });
});
