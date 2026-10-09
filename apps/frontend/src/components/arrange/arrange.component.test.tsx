// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { normalizeNode } from '../../engine/document/normalize';
import type { AnyNode } from '../../engine/model/schema';
import { MultiRail } from '../toolbar/rail/MultiRail';
import { RailMenuButton } from '../toolbar/RailBase';
import { arrangeSession } from '../../engine/arrange/session';
import { alignKey, setAlignKey } from '../../engine/arrange/preview';
import { liveTransformStore } from '../../engine/model/liveTransformStore';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  arrangeSession.cancel();
  liveTransformStore.clear();
  setAlignKey({ target: 'selection', key: null, picking: null });
});

const shape = (id: string, x: number, color: string): AnyNode =>
  normalizeNode({ id, type: 'shape', x, y: 0, width: 100, height: 60, geometry: { kind: 'rect' }, appearance: { fill: [{ type: 'solid', color }] } });

const rail = (nodes: AnyNode[]) =>
  render(
    <div className="ctx-toolbar">
      <MultiRail nodes={nodes} ids={nodes.map((n) => n.id)} conditional={null} tail={<RailMenuButton entries={() => []} />} tailControls={1} />
    </div>
  );

const shapes = [shape('a', 0, '#ffffff'), shape('b', 150, '#000000'), shape('c', 330, '#ffffff')];

describe('multi-selection rail arrangement', () => {
  it('leads with a selection chip that says what is shared, honestly', () => {
    const { getByLabelText, getByText } = rail(shapes);
    fireEvent.click(getByLabelText('Selection'));
    expect(getByText('3 shapes')).toBeTruthy();
    expect(getByText('Mixed')).toBeTruthy();
    expect(getByText('Frame selection')).toBeTruthy();
  });

  it('puts the order Align, Group, Lock, Combine, Tidy, Grid on a set of shapes', () => {
    const { container } = rail(shapes);
    const verbs = Array.from(container.querySelectorAll('[data-slot="verbs"] > * > button, [data-slot="verbs"] > button')).map((b) =>
      b.getAttribute('aria-label')
    );
    expect(verbs.slice(0, 6)).toEqual(['Align and distribute', 'Group', 'Lock all', 'Combine shapes', 'Tidy up', 'Arrange in grid']);
  });

  it('says why aligning to a frame cannot happen when there is none', () => {
    setAlignKey({ target: 'frame' });
    const { getByLabelText } = rail(shapes);
    fireEvent.click(getByLabelText('Align and distribute'));
    const left = getByLabelText('Align left') as HTMLButtonElement;
    expect(left.disabled).toBe(true);
    expect(left.getAttribute('data-tooltip')).toMatch(/frame/);
  });

  it('offers the key object and holds it while the panel is open', () => {
    setAlignKey({ target: 'key' });
    const { getByLabelText } = rail(shapes);
    fireEvent.click(getByLabelText('Align and distribute'));
    expect(alignKey.get().picking?.map((p) => p.key)).toEqual(['a', 'b', 'c']);
    expect(alignKey.get().key).toBe('a');
  });

  it('shows Combine off, with the reason, when a note is in the selection', () => {
    const note = normalizeNode({ id: 'n', type: 'sticky', x: 500, text: 'Idea' });
    const { getByLabelText, getByText } = rail([...shapes, note]);
    fireEvent.click(getByLabelText('Combine shapes'));
    expect(getByText("The note can't be combined. Select only shapes and paths.")).toBeTruthy();
    expect((getByText('Union').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens a live grid, and Escape puts it back and closes the panel', () => {
    const { getByLabelText, queryByLabelText } = rail(shapes);
    fireEvent.click(getByLabelText('Arrange in grid'));
    expect(arrangeSession.activeFor(['a', 'b', 'c'])).toBe(true);
    expect(getByLabelText('Columns')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(arrangeSession.get()).toBeNull();
    expect(queryByLabelText('Columns')).toBeNull();
    expect(liveTransformStore.size).toBe(0);
  });
});
