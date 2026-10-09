import { describe, expect, it, vi } from 'vitest';
import { parseZoomInput, zoomMenuEntries, type ZoomMenuActions } from './zoomMenu';
import { SHORTCUTS } from '../menu/shortcuts';
import type { MenuItemEntry } from '../menu/menuModel';

const LIMITS = { minZoom: 0.05, maxZoom: 5 };

describe('parseZoomInput', () => {
  it('reads a bare number as a percentage', () => {
    expect(parseZoomInput('150', LIMITS)).toBe(1.5);
    expect(parseZoomInput(' 75 % ', LIMITS)).toBe(0.75);
  });

  it('reads a multiplier', () => {
    expect(parseZoomInput('2x', LIMITS)).toBe(2);
    expect(parseZoomInput('.5X', LIMITS)).toBe(0.5);
  });

  it('accepts a comma as the decimal point', () => {
    expect(parseZoomInput('1,5x', LIMITS)).toBe(1.5);
    expect(parseZoomInput('62,5%', LIMITS)).toBe(0.625);
  });

  it('clamps to the camera rather than refusing', () => {
    expect(parseZoomInput('1000', LIMITS)).toBe(5);
    expect(parseZoomInput('1', LIMITS)).toBe(0.05);
  });

  it('refuses what is not a zoom', () => {
    for (const text of ['', 'abc', '0', '-50', '10%%', '1.2.3']) {
      expect(parseZoomInput(text, LIMITS)).toBeNull();
    }
  });
});

describe('zoomMenuEntries', () => {
  const actions = (): ZoomMenuActions => ({
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitAll: vi.fn(),
    zoomToSelection: vi.fn(),
    setZoom: vi.fn(),
  });
  const item = (entries: ReturnType<typeof zoomMenuEntries>, id: string) =>
    entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.id === id)!;

  it('binds every row it advertises a shortcut for to the shared map', () => {
    const entries = zoomMenuEntries({ hasSelection: true, percent: 100 }, actions());
    expect(item(entries, 'zoom-fit').shortcut).toBe(SHORTCUTS.zoomFit);
    expect(item(entries, 'zoom-selection').shortcut).toBe(SHORTCUTS.zoomSelection);
    expect(item(entries, 'zoom-100').shortcut).toBe(SHORTCUTS.zoomReset);
  });

  it('disables zoom to selection, with a reason, when nothing is selected', () => {
    const row = item(zoomMenuEntries({ hasSelection: false, percent: 80 }, actions()), 'zoom-selection');
    expect(row.disabled).toBe(true);
    expect(row.disabledReason).toBe('Select something first');
  });

  it('ticks the preset the view is at, and sets the matching factor', () => {
    const a = actions();
    const entries = zoomMenuEntries({ hasSelection: false, percent: 200 }, a);
    expect(item(entries, 'zoom-200').checked).toBe(true);
    expect(item(entries, 'zoom-50').checked).toBeUndefined();
    item(entries, 'zoom-50').onSelect();
    expect(a.setZoom).toHaveBeenCalledWith(0.5);
  });
});

describe('zoomMenuEntries at the edges', () => {
  const noop = { zoomIn() {}, zoomOut() {}, fitAll() {}, zoomToSelection() {}, setZoom() {} };
  const row = (entries: ReturnType<typeof zoomMenuEntries>, id: string) =>
    entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.id === id)!;

  it('turns off the step that cannot go further, saying why', () => {
    const atMax = zoomMenuEntries({ hasSelection: false, percent: 500, atMax: true }, noop);
    expect(row(atMax, 'zoom-in').disabled).toBe(true);
    expect(row(atMax, 'zoom-in').disabledReason).toBe('Already at the closest zoom');
    expect(row(atMax, 'zoom-out').disabled).toBeUndefined();
    const atMin = zoomMenuEntries({ hasSelection: false, percent: 5, atMin: true }, noop);
    expect(row(atMin, 'zoom-out').disabledReason).toBe('Already at the farthest zoom');
  });

  it('offers Fit all only when there is something to fit', () => {
    expect(row(zoomMenuEntries({ hasSelection: false, percent: 100, hasContent: false }, noop), 'zoom-fit').disabledReason).toBe(
      'Nothing on the board yet'
    );
    expect(row(zoomMenuEntries({ hasSelection: false, percent: 100 }, noop), 'zoom-fit').disabled).toBeUndefined();
  });
});
