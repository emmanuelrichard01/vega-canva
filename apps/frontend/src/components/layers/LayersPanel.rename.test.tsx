// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const updateNode = vi.fn();
vi.mock('../../engine/document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/document')>();
  return { ...actual, updateNode: (...args: unknown[]) => updateNode(...args) };
});

import { LayersPanel } from '../LayersPanel';

// jsdom has no ResizeObserver; the list virtualiser only needs it to exist.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoopResizeObserver;

afterEach(() => {
  cleanup();
  updateNode.mockClear();
});

const objects = {
  a: {
    id: 'a',
    type: 'shape',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    zIndex: 1,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    hidden: false,
    locked: false,
    title: 'Hero card',
    geometry: { kind: 'rect' },
  },
};

function renderPanel() {
  return render(
    <LayersPanel selectedIds={[]} overrideObjects={objects} setSelectedId={() => {}} setSelectedIds={() => {}} />
  );
}

describe('Layers rename', () => {
  it('Escape cancels without writing', () => {
    renderPanel();
    fireEvent.doubleClick(screen.getByText('Hero card'));
    const input = screen.getByRole('textbox', { name: /Rename/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(updateNode).not.toHaveBeenCalled();
    expect(screen.getByText('Hero card')).toBeTruthy();
  });

  it('Enter writes a changed name, and an empty or unchanged one writes nothing', () => {
    renderPanel();
    fireEvent.doubleClick(screen.getByText('Hero card'));
    let input = screen.getByRole('textbox', { name: /Rename/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateNode).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByText('Hero card'));
    input = screen.getByRole('textbox', { name: /Rename/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Pricing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateNode).toHaveBeenCalledWith('a', { title: 'Pricing' });
  });

  it('F2 on the tree opens the cursor row for renaming', () => {
    render(
      <LayersPanel selectedIds={['a']} overrideObjects={objects} setSelectedId={() => {}} setSelectedIds={() => {}} />
    );
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'F2' });
    expect((screen.getByRole('textbox', { name: /Rename/ }) as HTMLInputElement).value).toBe('Hero card');
  });
});
