import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLYOUT_INSET, FLYOUT_WIDTHS, MAX_SCROLLBAR, MENU_FLYOUT_SIZE, SHEET_LAYOUT, sheetGrid, sheetWidth, trayLayout, type TrayMode } from './flyoutScale';

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

describe('the seat sheets', () => {
  const sheetCss = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');

  it.each(Object.entries(SHEET_LAYOUT))('%s: its grid fits the md panel with a classic scrollbar on both sides', (_, layout) => {
    // The body spans the whole panel (the sheet plus its two insets) and
    // reserves the gutter either side; the grid is centred in what is left.
    const span = sheetWidth('md') + 2 * FLYOUT_INSET;
    expect(sheetGrid(layout)).toBeLessThanOrEqual(span - 2 * MAX_SCROLLBAR);
    // And uses the step: no more than one tile's worth of the width left over.
    expect(sheetWidth('md') - sheetGrid(layout)).toBeLessThan(layout.tile);
  });

  it.each(Object.entries(SHEET_LAYOUT))('%s: a card holds its picture with room round it', (_, layout) => {
    expect(layout.pic.width).toBeLessThanOrEqual(layout.tile - 8);
    // Room for a 56 x 42 illustrated tile.
    expect(layout.pic.height).toBeGreaterThanOrEqual(44);
  });

  it('lays the grid out in fixed tiles, centred, with the gutter on both sides', () => {
    expect(sheetCss).toMatch(/\.dock-sheet__grid\s*\{[^}]*repeat\(var\(--sheet-cols\),\s*var\(--sheet-tile\)\)/);
    expect(sheetCss).toMatch(/\.dock-sheet__body\s*\{[^}]*scrollbar-gutter:\s*stable both-edges/);
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

  it.each<TrayMode>(['art', 'glyph'])('in %s mode builds its rack from five pens and the pad', (mode) => {
    const t = trayLayout(mode);
    const pad = mode === 'art' ? 4 : 0;
    expect(t.rack).toBe(5 * t.tool + t.stickyTool + 5 * 2 + 2 * pad);
  });

  it('gives the pad a slot wider than its 40px art with the art on, and a pen’s with glyphs', () => {
    expect(trayLayout('art').stickyTool).toBeGreaterThanOrEqual(40 + 4);
    expect(trayLayout('art').stickyTool).toBeGreaterThan(trayLayout('art').tool);
    expect(trayLayout('glyph').stickyTool).toBe(trayLayout('glyph').tool);
  });

  it('is lg with the art and md with glyphs', () => {
    expect(trayLayout('art').size).toBe('lg');
    expect(trayLayout('glyph').size).toBe('md');
  });

  it('keeps the options row at a fixed height whatever the mode', () => {
    expect(trayLayout('art').optionsHeight).toBe(trayLayout('glyph').optionsHeight);
  });
});
