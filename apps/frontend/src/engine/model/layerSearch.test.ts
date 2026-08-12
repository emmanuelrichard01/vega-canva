import { describe, it, expect } from 'vitest';
import { highlightRuns, isFiltering, matchNode, scoreLabel } from './layerSearch';
import type { AnyNode } from './schema';

const node = (partial: Partial<AnyNode>): AnyNode =>
  ({ id: 'n', type: 'shape', title: undefined, ...partial }) as AnyNode;

describe('scoreLabel', () => {
  it('matches a subsequence, which is what a command palette does', () => {
    expect(scoreLabel('sbm', 'Submit Button')).not.toBeNull();
    expect(scoreLabel('submit', 'Submit Button')).not.toBeNull();
  });

  it('refuses when a character is missing or out of order', () => {
    expect(scoreLabel('sbz', 'Submit Button')).toBeNull();
    expect(scoreLabel('tims', 'Submit')).toBeNull();
  });

  it('ranks a consecutive run above a scattered one', () => {
    const consecutive = scoreLabel('but', 'Button')!.score;
    const scattered = scoreLabel('but', 'Blue Utility')!.score;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('ranks a match at the start of a word above one in the middle', () => {
    expect(scoreLabel('but', 'Button')!.score).toBeGreaterThan(scoreLabel('but', 'Distribute')!.score);
  });

  it('finds a word boundary inside camelCase, which is how layers get named', () => {
    const camel = scoreLabel('b', 'submitButton')!.score;
    const middle = scoreLabel('b', 'abc')!.score;
    expect(camel).toBeGreaterThan(middle);
  });

  it('is case-insensitive but reports positions in the original', () => {
    expect(scoreLabel('SB', 'Submit Button')!.positions).toEqual([0, 7]);
  });

  it('treats an empty query as no opinion rather than no match', () => {
    expect(scoreLabel('', 'anything')).toEqual({ score: 0, positions: [] });
  });
});

describe('matchNode', () => {
  it('applies the type filter absolutely, whatever the name says', () => {
    const text = node({ type: 'text', title: 'Rectangle' });
    expect(matchNode(text, 'rect', 'text')).not.toBeNull();
    expect(matchNode(text, 'rect', 'shape')).toBeNull();
  });

  it('passes everything when nothing is being filtered', () => {
    expect(matchNode(node({}), '', 'all')).not.toBeNull();
  });
});

describe('isFiltering', () => {
  it('ignores a query of only whitespace', () => {
    expect(isFiltering('   ', 'all')).toBe(false);
    expect(isFiltering('', 'text')).toBe(true);
  });
});

describe('highlightRuns', () => {
  it('splits into runs rather than one span per character', () => {
    expect(highlightRuns('Submit', [0, 1])).toEqual([
      { text: 'Su', hit: true },
      { text: 'bmit', hit: false },
    ]);
  });

  it('returns the whole label as one run when nothing matched', () => {
    expect(highlightRuns('Submit', [])).toEqual([{ text: 'Submit', hit: false }]);
  });

  it('handles a match at the very end', () => {
    expect(highlightRuns('abc', [2])).toEqual([
      { text: 'ab', hit: false },
      { text: 'c', hit: true },
    ]);
  });
});
