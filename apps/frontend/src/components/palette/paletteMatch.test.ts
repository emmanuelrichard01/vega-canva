import { describe, it, expect } from 'vitest';
import { fuzzyScore, groupRuns, labelMatches, rankItems, scoreItem, type PaletteItem } from './paletteMatch';

const item = (id: string, label: string, group: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  id, label, group, icon: null, perform: () => {}, ...extra,
});

describe('fuzzyScore', () => {
  it('ranks a prefix above a scattered subsequence and refuses a non-match', () => {
    expect(fuzzyScore('Add Shape', 'add')).toBe(1000);
    const scattered = fuzzyScore('Add Shape', 'shp');
    expect(scattered).not.toBeNull();
    expect(scattered!).toBeLessThan(1000);
    expect(fuzzyScore('Add Shape', 'xyz')).toBeNull();
    expect(fuzzyScore('anything', '')).toBe(0);
  });
});

describe('scoreItem', () => {
  it('prefers a label match to a keyword match', () => {
    const byLabel = scoreItem(item('a', 'Increase contrast', 'Settings'), 'contrast')!;
    const byKeyword = scoreItem(item('b', 'Brainstorm', 'Templates', { keywords: 'contrast ideas' }), 'contrast')!;
    expect(byLabel.onLabel).toBe(true);
    expect(byKeyword.onLabel).toBe(false);
    expect(byLabel.score).toBeGreaterThan(byKeyword.score);
  });

  it('still finds rows by their group and detail', () => {
    expect(scoreItem(item('a', 'Add sticky note', 'Create'), 'create')).not.toBeNull();
    expect(scoreItem(item('a', 'Q4 roadmap', 'Your boards', { detail: 'Pinned' }), 'pinned')).not.toBeNull();
  });
});

describe('labelMatches', () => {
  it('marks a label only when the label itself matched', () => {
    expect(labelMatches('Brainstorm', 'brain')).toBe(true);
    expect(labelMatches('Brainstorm', 'contrast')).toBe(false);
    expect(labelMatches('Brainstorm', '  ')).toBe(false);
  });
});

describe('groupRuns', () => {
  it('keeps each group together, in order of first appearance', () => {
    const rows = [item('1', 'a', 'Start'), item('2', 'b', 'Settings'), item('3', 'c', 'Start'), item('4', 'd', 'Boards')];
    expect(groupRuns(rows).map((r) => r.id)).toEqual(['1', '3', '2', '4']);
  });
});

describe('rankItems', () => {
  const rows = [
    item('t1', 'Brainstorm', 'Templates', { keywords: 'sticky notes' }),
    item('b1', 'Sticky retro', 'Your boards'),
    item('t2', 'Sticky wall', 'Templates'),
    item('s1', 'New board', 'Start'),
  ];

  it('returns one run per group, so no heading is printed twice', () => {
    const groups = rankItems(rows, 'sticky').map((r) => r.group);
    const runs = groups.filter((g, i) => g !== groups[i - 1]);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it('keeps everything, grouped, when the query is empty', () => {
    expect(rankItems(rows, '')).toHaveLength(4);
  });

  it('drops rows that match nowhere', () => {
    expect(rankItems(rows, 'qqq')).toEqual([]);
  });
});
