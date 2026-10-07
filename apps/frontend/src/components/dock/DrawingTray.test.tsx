// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DrawingTray } from './DrawingTray';
import { drawSettings } from '../../engine/tools/drawSettings';

afterEach(() => {
  cleanup();
  drawSettings.set({ brush: 'pen', ink: null });
});

const tray = (activeToolId: string, onArm = vi.fn()) => render(<DrawingTray activeToolId={activeToolId} onArm={onArm} />);

/** What fixes the tray's size: its width step, and the top row's make-up. */
function frame(container: HTMLElement) {
  const inner = container.querySelector<HTMLElement>('.dock-tray__inner')!;
  return {
    size: inner.dataset.size,
    width: inner.style.getPropertyValue('--tray-w'),
    options: inner.style.getPropertyValue('--tray-options-h'),
    tools: inner.querySelectorAll('.dock-tray__rack .dock-tray__tool').length,
    swatches: inner.querySelectorAll('.dock-ink__swatch').length,
  };
}

describe('the drawing tray', () => {
  it('keeps one width and one top row whichever tool is in hand', () => {
    const { container, rerender } = tray('pen');
    const first = frame(container);
    expect(first).toMatchObject({ size: 'lg', width: '480px', tools: 6, swatches: 6 });
    for (const tool of ['eraser', 'bezier-pen', 'select', 'pen']) {
      rerender(<DrawingTray activeToolId={tool} onArm={vi.fn()} />);
      expect(frame(container)).toEqual(first);
    }
  });

  it('shows the options for the tool in hand in the row under the tools', () => {
    const { rerender } = tray('pen');
    expect(screen.getByRole('group', { name: 'Brush size and snapping' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Size' })).toBeTruthy();
    rerender(<DrawingTray activeToolId="eraser" onArm={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Eraser size and mode' })).toBeTruthy();
    rerender(<DrawingTray activeToolId="bezier-pen" onArm={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Vector pen weight' })).toBeTruthy();
  });

  it('offers the highlighter its own inks in the same well', () => {
    drawSettings.set({ brush: 'highlighter' });
    const { container } = tray('pen');
    expect(screen.getByRole('radiogroup', { name: 'Highlighter colour' })).toBeTruthy();
    expect(container.querySelectorAll('.dock-ink__swatch').length).toBe(5);
  });

  it('picks the brush back up when an ink is chosen with the eraser in hand', () => {
    const onArm = vi.fn();
    tray('eraser', onArm);
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(drawSettings.get().ink).toBe('#1971C2');
    expect(onArm).toHaveBeenCalledWith('pen');
  });

  it('does not re-arm the pen when an ink is chosen with it already in hand', () => {
    const onArm = vi.fn();
    tray('pen', onArm);
    fireEvent.click(screen.getByRole('radio', { name: 'Red' }));
    expect(onArm).not.toHaveBeenCalled();
  });
});
