import { describe, expect, it } from 'vitest';
import {
  addTag,
  matchesTagFilter,
  MAX_TAGS_PER_NODE,
  normalizeTag,
  removeTag,
  tagCounts,
} from './tags';

describe('normalizeTag', () => {
  it('folds case and spacing so one idea is one tag', () => {
    // Otherwise "Needs Design" and "needs-design" filter separately, which is
    // what makes free-text tagging useless within a week.
    expect(normalizeTag('Needs Design')).toBe('needs-design');
    expect(normalizeTag('needs-design')).toBe('needs-design');
    expect(normalizeTag('  NEEDS   design ')).toBe('needs-design');
  });

  it('accepts a leading hash without keeping it', () => {
    expect(normalizeTag('#risk')).toBe('risk');
    expect(normalizeTag('##risk')).toBe('risk');
  });

  it('strips punctuation that would break a chip or a URL', () => {
    expect(normalizeTag('risk!!')).toBe('risk');
    expect(normalizeTag('a/b')).toBe('ab');
  });

  it('collapses and trims hyphens', () => {
    expect(normalizeTag('a---b')).toBe('a-b');
    expect(normalizeTag('-edge-')).toBe('edge');
  });

  it('returns empty for anything with nothing left in it', () => {
    expect(normalizeTag('')).toBe('');
    expect(normalizeTag('   ')).toBe('');
    expect(normalizeTag('!!!')).toBe('');
    expect(normalizeTag('#')).toBe('');
  });

  it('caps the length', () => {
    expect(normalizeTag('x'.repeat(50))).toHaveLength(24);
  });
});

describe('addTag / removeTag', () => {
  it('adds normalised', () => {
    expect(addTag([], 'Needs Design')).toEqual(['needs-design']);
  });

  it('will not add the same tag twice, however it was typed', () => {
    expect(addTag(['risk'], '#RISK')).toEqual(['risk']);
  });

  it('ignores an empty tag', () => {
    expect(addTag(['risk'], '  ')).toEqual(['risk']);
  });

  it('stops at the cap', () => {
    const full = Array.from({ length: MAX_TAGS_PER_NODE }, (_, i) => `t${i}`);
    expect(addTag(full, 'one-more')).toEqual(full);
  });

  it('removes exactly one tag', () => {
    expect(removeTag(['a', 'b'], 'a')).toEqual(['b']);
    expect(removeTag(['a', 'b'], 'zzz')).toEqual(['a', 'b']);
  });
});

describe('tagCounts', () => {
  it('counts across nodes, most used first', () => {
    const nodes = [
      { tags: ['risk', 'ui'] },
      { tags: ['risk'] },
      { tags: [] },
      {},
      { tags: ['risk', 'ui'] },
    ];
    expect(tagCounts(nodes)).toEqual([
      { tag: 'risk', count: 3 },
      { tag: 'ui', count: 2 },
    ]);
  });

  it('breaks ties alphabetically so the list does not shuffle', () => {
    expect(tagCounts([{ tags: ['beta', 'alpha'] }]).map((t) => t.tag)).toEqual(['alpha', 'beta']);
  });

  it('is empty for an untagged board', () => {
    expect(tagCounts([{ tags: [] }, {}])).toEqual([]);
  });
});

describe('matchesTagFilter', () => {
  it('matches everything when nothing is selected', () => {
    expect(matchesTagFilter({ tags: [] }, new Set())).toBe(true);
    expect(matchesTagFilter({}, new Set())).toBe(true);
  });

  it('matches any selected tag, not all of them', () => {
    // An all-of filter over hand-typed tags returns nothing almost every time.
    const active = new Set(['risk', 'blocked']);
    expect(matchesTagFilter({ tags: ['risk'] }, active)).toBe(true);
    expect(matchesTagFilter({ tags: ['blocked', 'ui'] }, active)).toBe(true);
    expect(matchesTagFilter({ tags: ['ui'] }, active)).toBe(false);
  });

  it('excludes untagged nodes once a filter is on', () => {
    expect(matchesTagFilter({ tags: [] }, new Set(['risk']))).toBe(false);
    expect(matchesTagFilter({}, new Set(['risk']))).toBe(false);
  });
});
