import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLYOUT_INSET, FLYOUT_WIDTHS, MENU_FLYOUT_SIZE, sheetWidth, trayLayout, type TrayMode } from './flyoutScale';

const css = readFileSync(fileURLToPath(new URL('./dock.css', import.meta.url)), 'utf8');

describe('the flyout width scale', () => {
  it('publishes the same three steps the script uses', () => {
    for (const [size, px] of Object.entries(FLYOUT_WIDTHS)) {
      expect(css).toContain(`--flyout-w-${size}: ${px}px;`);
    }
  });

  it('rises in order, so a bigger menu never gets a narrower panel', () => {
    expect(FLYOUT_WIDTHS.sm).toBeLessThan(FLYOUT_WIDTHS.md);
    expect(FLYOUT_WIDTHS.md).toBeLessThan(FLYOUT_WIDTHS.lg);
  });

  it('gives every menu a step, and the tray the widest', () => {
    for (const size of Object.values(MENU_FLYOUT_SIZE)) expect(FLYOUT_WIDTHS).toHaveProperty(size);
    expect(MENU_FLYOUT_SIZE.pen).toBe('lg');
    // The libraries and sheets share one width with the seat menus.
    for (const menu of ['shape', 'frame', 'data', 'media', 'more'] as const) expect(MENU_FLYOUT_SIZE[menu]).toBe('md');
  });

  it('leaves room inside an md panel for nine 40px shape tiles at equal insets', () => {
    expect(sheetWidth('md')).toBe(FLYOUT_WIDTHS.md - 2 * FLYOUT_INSET);
    expect(sheetWidth('md')).toBeGreaterThanOrEqual(9 * 40 + 8 * 2);
  });
});

describe('the drawing tray', () => {
  it.each<TrayMode>(['art', 'glyph'])('in %s mode is a step on the scale, its parts summing to it exactly', (mode) => {
    const t = trayLayout(mode);
    expect(t.width).toBe(FLYOUT_WIDTHS[t.size]);
    expect(t.inset + t.rack + t.ruleMargin + 1 + t.ruleMargin + t.well + t.inset).toBe(t.width);
  });

  it.each<TrayMode>(['art', 'glyph'])('in %s mode fits every ink in the well with room between them', (mode) => {
    const t = trayLayout(mode);
    expect(t.well).toBeGreaterThanOrEqual(t.slots * t.swatch + (t.slots - 1) * t.minSwatchGap);
    // Every swatch clears the 24px target floor.
    expect(t.swatch).toBeGreaterThanOrEqual(24);
  });

  it('is lg with the art and md with glyphs', () => {
    expect(trayLayout('art').size).toBe('lg');
    expect(trayLayout('glyph').size).toBe('md');
  });

  it('keeps the options row at a fixed height whatever the mode', () => {
    expect(trayLayout('art').optionsHeight).toBe(trayLayout('glyph').optionsHeight);
  });
});
