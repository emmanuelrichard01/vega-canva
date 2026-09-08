import { describe, expect, it } from 'vitest';
import { EXPRESSION_TOKENS, PARSER_NAMES, tokenFor, tokenGroups } from './expressionHelp';
import { parseExpression } from './expression';

/**
 * The reference is held to the parser, in both directions.
 *
 * The old help was `EXPRESSION_FUNCTIONS.join('  ')` — a wall of names that
 * could not go out of date because it *was* the parser's list, and told the
 * reader nothing beyond existence. Writing a real description per function
 * buys that information at the cost of a second list, and a second list drifts
 * — so it is checked.
 */
describe('the expression reference', () => {
  it('documents everything the parser accepts', () => {
    const documented = new Set(EXPRESSION_TOKENS.map((t) => t.name));
    const undocumented = PARSER_NAMES.filter((name) => !documented.has(name));
    expect(undocumented, 'in the parser, missing from the reference').toEqual([]);
  });

  it('claims nothing the parser does not have', () => {
    const known = new Set(PARSER_NAMES);
    const invented = EXPRESSION_TOKENS.map((t) => t.name).filter((n) => !known.has(n));
    expect(invented, 'in the reference, unknown to the parser').toEqual([]);
  });

  /**
   * Every signature has to actually parse. A typo in an argument list is a
   * button that writes a broken formula into somebody's chart — which is
   * worse than no button, because it looks like the app suggested it.
   */
  it('offers only tokens that parse', () => {
    for (const token of EXPRESSION_TOKENS) {
      const result = parseExpression(tokenFor(token, 'x'), ['x']);
      expect(result.ok, `${token.signature}: ${result.ok ? '' : result.error.message}`).toBe(true);
    }
  });

  /**
   * A polar plot is in `a` and a parametric one in `t`. Pressing `sin` there
   * must write `sin(a)`, not `sin(x)` — otherwise the reference hands you an
   * error to notice and fix yourself.
   */
  it('writes in the variable the plot actually uses', () => {
    const sin = EXPRESSION_TOKENS.find((t) => t.name === 'sin')!;
    expect(tokenFor(sin, 'a')).toBe('sin(a)');
    expect(tokenFor(sin, 't')).toBe('sin(t)');

    for (const variable of ['a', 't']) {
      for (const token of EXPRESSION_TOKENS) {
        const result = parseExpression(tokenFor(token, variable), [variable]);
        expect(result.ok, `${token.name} in ${variable}`).toBe(true);
      }
    }
  });

  /** A constant has no argument to substitute into. */
  it('leaves constants alone', () => {
    const pi = EXPRESSION_TOKENS.find((t) => t.name === 'pi')!;
    expect(tokenFor(pi, 'a')).toBe('pi');
  });

  it('sorts every token into exactly one group', () => {
    const grouped = tokenGroups().flatMap((g) => g.tokens);
    expect(grouped).toHaveLength(EXPRESSION_TOKENS.length);
  });

  /**
   * A note that repeats the name is not a note. The length floor is low
   * because a constant's whole description is its value -- `pi` is
   * "3.14159…", and there is nothing to add.
   */
  it('gives every token a note that says something', () => {
    for (const token of EXPRESSION_TOKENS) {
      expect(token.note.trim().length, token.name).toBeGreaterThan(4);
      expect(token.note.trim().toLowerCase(), token.name).not.toBe(token.name.toLowerCase());
    }
  });

  /**
   * The signature and the inserted text are allowed to differ, and for the
   * two-argument functions they must: `atan2(y, x)` documents the call and
   * does not parse on a plot that has no `y`.
   */
  it('documents two-argument calls by name and inserts them working', () => {
    const atan2 = EXPRESSION_TOKENS.find((t) => t.name === 'atan2')!;
    expect(atan2.signature).toContain('y');
    expect(parseExpression(tokenFor(atan2, 'x'), ['x']).ok).toBe(true);
  });
});
