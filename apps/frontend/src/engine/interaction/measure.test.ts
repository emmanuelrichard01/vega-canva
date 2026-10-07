import { describe, it, expect } from 'vitest';
import { formatDistance, measureBetween } from './measure';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('measureBetween', () => {
  it('measures the gap between boxes side by side, through their overlap', () => {
    const segs = measureBetween(box(0, 0, 100, 100), box(150, 20, 50, 50));
    expect(segs).toEqual([{ orientation: 'horizontal', position: 45, from: 100, to: 150, value: 50 }]);
  });

  it('measures both axes for a diagonal neighbour', () => {
    const segs = measureBetween(box(0, 0, 100, 100), box(130, 160, 20, 20));
    expect(segs.map((s) => [s.orientation, s.value])).toEqual([
      ['horizontal', 30],
      ['vertical', 60],
    ]);
  });

  it('measures to the left and above as well', () => {
    const segs = measureBetween(box(200, 200, 50, 50), box(0, 210, 100, 20));
    expect(segs).toEqual([{ orientation: 'horizontal', position: 220, from: 100, to: 200, value: 100 }]);
  });

  it('measures the four insets when one box contains the other', () => {
    const segs = measureBetween(box(20, 30, 10, 10), box(0, 0, 100, 100));
    expect(segs.map((s) => s.value).sort((a, b) => a - b)).toEqual([20, 30, 60, 70]);
    const outward = measureBetween(box(0, 0, 100, 100), box(20, 30, 10, 10));
    expect(outward.map((s) => s.value).sort((a, b) => a - b)).toEqual([20, 30, 60, 70]);
  });

  it('measures edge to edge for overlapping boxes, skipping edges that line up', () => {
    const segs = measureBetween(box(0, 0, 100, 100), box(50, 0, 100, 100));
    expect(segs.map((s) => [s.orientation, s.value])).toEqual([
      ['horizontal', 50],
      ['horizontal', 50],
    ]);
  });
});

describe('formatDistance', () => {
  it('rounds, keeping one decimal for small fractional values', () => {
    expect(formatDistance(12.6)).toBe('13');
    expect(formatDistance(2.25)).toBe('2.3');
    expect(formatDistance(4)).toBe('4');
  });
});
