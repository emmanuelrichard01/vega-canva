import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../engine/emoji/emojiIndex';
import { buildRows, CELL, HEADER, rowAt, verticalStep } from './pickerRows';

const entry = (i: number, g: number) => ({ c: (0x1f600 + i).toString(16), u: String.fromCodePoint(0x1f600 + i), n: `face ${i}`, k: [], g });
const index = buildIndex({
  version: 't',
  categories: [
    { id: 'smileys', label: 'Smileys' },
    { id: 'people', label: 'People' },
  ],
  // 10 smileys (a full row of 8 and a short row of 2), then 3 people.
  emoji: [...Array.from({ length: 10 }, (_, i) => entry(i, 0)), ...Array.from({ length: 3 }, (_, i) => entry(10 + i, 1))],
});

describe('the picker grid', () => {
  it('lays sections out with headings and running offsets', () => {
    const rows = buildRows(index, '', [], 8);
    expect(rows.map((r) => r.kind)).toEqual(['header', 'cells', 'cells', 'header', 'cells']);
    expect(rows[1].top).toBe(HEADER);
    expect(rows[3].top).toBe(HEADER + 2 * CELL);
    expect(rows[4].kind === 'cells' && rows[4].first).toBe(10);
  });

  it('leads with recents that exist in the catalogue, once each', () => {
    const rows = buildRows(index, '', ['😃', '😃', 'not-an-emoji'], 8);
    expect(rows[0]).toMatchObject({ kind: 'header', id: 'recent' });
    expect(rows[1].kind === 'cells' && rows[1].entries.map((e) => e.u)).toEqual(['😃']);
  });

  it('shows one section of results for a query, and nothing for no match', () => {
    expect(buildRows(index, 'face 1', [], 8)[0]).toMatchObject({ id: 'results' });
    expect(buildRows(index, 'zzz', [], 8)).toEqual([]);
  });

  it('keeps the column moving down, and lands on a short row’s last cell', () => {
    const rows = buildRows(index, '', [], 8);
    expect(rowAt(rows, 9)?.first).toBe(8);
    expect(verticalStep(rows, 1, 1)).toBe(9);
    expect(verticalStep(rows, 5, 1)).toBe(9);
    // Across the heading into the next section.
    expect(verticalStep(rows, 9, 1)).toBe(11);
    expect(verticalStep(rows, 11, -1)).toBe(9);
    expect(verticalStep(rows, 0, -1)).toBe(0);
  });
});
