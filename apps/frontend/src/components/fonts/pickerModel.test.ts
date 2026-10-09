import { describe, expect, it, vi } from 'vitest';
import { FONTS, weightsFor } from '../../engine/text/fontCatalogue';
import {
  buildSections, createPreview, fuzzyScore, layout, rankRows, stepCursor, stepWeight, visibleItems, builtinRow,
} from './pickerModel';

const none = { query: '', recents: [] as string[], inUse: [] as string[], uploaded: [], device: [] };

describe('search ranking', () => {
  it('ranks prefix over word start over substring over subsequence', () => {
    const q = 'rob';
    expect(fuzzyScore('Roboto', q)).toBeGreaterThan(fuzzyScore('Big Roboto', q));
    expect(fuzzyScore('Big Roboto', q)).toBeGreaterThan(fuzzyScore('Xrobo', q));
    expect(fuzzyScore('Xrobo', q)).toBeGreaterThan(fuzzyScore('Rxoxb', q));
    expect(fuzzyScore('Inter', 'zzz')).toBe(0);
  });
  it('matches by category intent', () => {
    const rows = rankRows(FONTS, 'narrow', () => 'condensed narrow');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('sections', () => {
  it('builds board, recent and categories without a query', () => {
    const s = buildSections({ ...none, inUse: ['Inter'], recents: ['Caveat', 'Nope'] });
    const keys = s.map((x) => x.key);
    expect(keys.slice(0, 2)).toEqual(['inuse', 'recent']);
    expect(s.find((x) => x.key === 'recent')!.rows.map((r) => r.family)).toEqual(['Caveat']);
    expect(keys.length).toBeGreaterThan(4);
  });
  it('collapses to one ranked list while searching and hides recents', () => {
    const s = buildSections({ ...none, recents: ['Caveat'], query: 'inter' });
    expect(s.some((x) => x.key === 'recent')).toBe(false);
    const res = s.find((x) => x.key === 'results')!;
    expect(res.rows[0].family.toLowerCase().startsWith('inter')).toBe(true);
  });
});

describe('layout and virtualisation', () => {
  it('only returns items near the viewport', () => {
    const { items, height } = layout(buildSections(none));
    expect(visibleItems(items, 0, 300).length).toBeLessThan(items.length);
    expect(height).toBeGreaterThan(300);
  });
  it('indexes selectable rows only', () => {
    const l = layout(buildSections(none));
    expect(l.rows.map((r) => r.index)).toEqual(l.rows.map((_, i) => i));
  });
});

describe('keyboard', () => {
  it('wraps the cursor', () => {
    expect(stepCursor(0, -1, 5)).toBe(4);
    expect(stepCursor(4, 1, 5)).toBe(0);
    expect(stepCursor(0, 1, 0)).toBe(0);
  });
  it('steps through the weights a family really has', () => {
    const w = weightsFor('Bebas Neue');
    expect(stepWeight(w, w[0], 1)).toBe(w[w.length > 1 ? 1 : 0]);
    expect(stepWeight([300, 400, 700], 400, 1)).toBe(700);
    expect(stepWeight([300, 400, 700], 700, 1)).toBe(700);
    expect(stepWeight([300, 400, 700], 500, -1)).toBe(400);
  });
  it('every row has at least one style', () => {
    expect(FONTS.every((f) => builtinRow(f).styles >= 1)).toBe(true);
  });
});

describe('hover preview', () => {
  it('previews without committing, then restores once', () => {
    const io = { begin: vi.fn(), end: vi.fn(), apply: vi.fn() };
    const p = createPreview(io);
    p.show('Lora');
    p.show('Lora');
    p.show('Inter');
    expect(io.begin).toHaveBeenCalledTimes(1);
    p.restore();
    p.restore();
    expect(io.end).toHaveBeenCalledTimes(1);
  });
  it('commits exactly once after a preview', () => {
    const io = { begin: vi.fn(), end: vi.fn(), apply: vi.fn() };
    const p = createPreview(io);
    p.show('Lora');
    p.commit('Lora');
    expect(io.end).toHaveBeenCalledTimes(1);
    expect(io.apply).toHaveBeenCalledTimes(2);
    p.restore();
    expect(io.end).toHaveBeenCalledTimes(1);
  });
});
