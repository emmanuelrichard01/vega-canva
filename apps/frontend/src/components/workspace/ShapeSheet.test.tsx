// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const placeShapeAt = vi.fn();
vi.mock('../../engine/tools/ShapeTool', () => ({ placeShapeAt: (...args: unknown[]) => placeShapeAt(...args) }));

import { ShapeSheet } from './ShapeSheet';
import { getPinnedShapes, togglePinnedShape } from '../../engine/tools/recentShapes';

// The first render draws every glyph from its contour; jsdom on a loaded
// machine can take longer than the default to do it.
vi.setConfig({ testTimeout: 20000 });

afterEach(() => {
  cleanup();
  placeShapeAt.mockClear();
  for (const p of [...getPinnedShapes()]) togglePinnedShape(p);
});

const tile = (name: string) => screen.getAllByRole('menuitemradio', { name: new RegExp(`^${name}\\.`) })[0];

describe('the shape library', () => {
  it('arms and closes on a click', () => {
    const onPick = vi.fn();
    render(<ShapeSheet value={null} onPick={onPick} />);
    fireEvent.click(tile('Hexagon'));
    expect(onPick).toHaveBeenCalledWith('hexagon');
  });

  it('arms and stays open on a Shift+click', () => {
    const onPick = vi.fn();
    const armed: string[] = [];
    const listen = (e: Event) => armed.push((e as CustomEvent<string>).detail);
    window.addEventListener('legacy_tool_change', listen);
    render(<ShapeSheet value={null} onPick={onPick} />);
    fireEvent.click(tile('Hexagon'), { shiftKey: true });
    window.removeEventListener('legacy_tool_change', listen);
    expect(onPick).not.toHaveBeenCalled();
    expect(armed).toEqual(['shape-hexagon']);
  });

  it('rings the armed shape and focuses the search on open', () => {
    render(<ShapeSheet value="diamond" onPick={() => {}} focusSearch />);
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search shapes' }));
    const ringed = screen.getAllByRole('menuitemradio', { checked: true });
    expect(ringed.length).toBeGreaterThan(0);
    for (const el of ringed) expect(el.getAttribute('aria-label')).toMatch(/^Diamond\./);
  });

  it('filters by alias, and says so when nothing matches', () => {
    render(<ShapeSheet value={null} onPick={() => {}} />);
    const search = screen.getByRole('searchbox', { name: 'Search shapes' });
    fireEvent.change(search, { target: { value: 'db' } });
    expect(screen.getAllByRole('menuitemradio')[0].getAttribute('aria-label')).toMatch(/^Database\./);
    fireEvent.change(search, { target: { value: 'zzqx' } });
    expect(screen.getByRole('status').textContent).toBe('No shapes match “zzqx”');
    // Nothing near enough to be a typo, so the common shapes are offered.
    expect(screen.getByRole('group', { name: 'Common shapes' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'hexgonn' } });
    expect(screen.getByRole('group', { name: 'Closest names' })).toBeTruthy();
  });

  it('places a shape in the view on Enter, and keeps the library open', () => {
    const onPick = vi.fn();
    render(<ShapeSheet value={null} onPick={onPick} />);
    fireEvent.keyDown(tile('Octagon'), { key: 'Enter' });
    expect(placeShapeAt).toHaveBeenCalledTimes(1);
    expect(placeShapeAt.mock.calls[0][1]).toBe('octagon');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('pins from the keyboard, and the pin leads the sheet', () => {
    render(<ShapeSheet value={null} onPick={() => {}} />);
    fireEvent.keyDown(tile('Cloud'), { key: '*' });
    expect(getPinnedShapes()).toContain('cloud');
    expect(screen.getByRole('group', { name: 'Pinned' })).toBeTruthy();
  });

  it('moves down a row with the arrow keys', () => {
    render(<ShapeSheet value={null} onPick={() => {}} />);
    const basic = screen.getByRole('group', { name: 'Basic' });
    const tiles = Array.from(basic.querySelectorAll<HTMLButtonElement>('.shape-lib__tile'));
    tiles[1].focus();
    fireEvent.keyDown(tiles[1], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tiles[9]);
  });
});
