import { describe, expect, it } from 'vitest';
import { ICON_GAP, ICON_TILE_W, iconGrid } from './IconBrowserLayout';

describe('icon library grid', () => {
  it('leaves equal space either side of the grid, with a scrollbar gutter or without', () => {
    // 396px panel; no gutter, a thin gutter each side, a classic one each side.
    for (const gutter of [0, 11, 15]) {
      const viewW = 396 - 2 * gutter;
      const { inset, width } = iconGrid(viewW);
      const right = viewW - inset - width;
      expect(Math.abs(right - inset)).toBeLessThanOrEqual(1);
      expect(inset).toBeGreaterThanOrEqual(8);
    }
  });

  it('fits as many whole columns as the width allows', () => {
    expect(iconGrid(4 * ICON_TILE_W + 3 * ICON_GAP + 16).cols).toBe(4);
    expect(iconGrid(4 * ICON_TILE_W + 3 * ICON_GAP + 15).cols).toBe(3);
    expect(iconGrid(40).cols).toBe(1);
  });
});
