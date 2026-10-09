// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { normalizeNode } from '../../../engine/document/normalize';
import type { GridNode } from '../../../engine/model/schema';

const state = vi.hoisted(() => ({
  editable: true,
  writes: [] as { recipe: { spec: Record<string, unknown> }; commit: boolean }[],
}));
const writes = state.writes;
vi.mock('./gridActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gridActions')>()),
  writeGridRecipe: (_id: string, recipe: { spec: Record<string, unknown> }, commit: boolean) => {
    writes.push({ recipe, commit });
  },
}));
vi.mock('../../../engine/model/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../engine/model/permissions')>()),
  canEditObjects: () => state.editable,
}));

import { GridRail } from './GridRail';
import { GRID_SETTINGS_EVENT } from '../../../engine/grid/gridSettings';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  writes.length = 0;
  state.editable = true;
});

const node = normalizeNode({ id: 'g', type: 'grid', width: 400, height: 300 }) as GridNode;
const mount = () =>
  render(
    <div className="ctx-toolbar">
      <GridRail node={node} subject="grid" menuActions={{} as never} conditional={null} tail={null} tailControls={0} />
    </div>
  );

describe('grid rail popovers', () => {
  it('opens the arrangement picker at the md step and a tile writes once', () => {
    const { getByLabelText, getByRole } = mount();
    fireEvent.click(getByLabelText(/^Arrangement:/));
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('data-size')).toBe('md');
    fireEvent.click(getByLabelText('Bento'));
    expect(writes).toHaveLength(1);
    expect(writes[0].recipe.spec.kind).toBe('bento');
    expect(writes[0].commit).toBe(true);
  });

  it('opens the layout popover at the sm step and a gutter edit writes once', () => {
    const { getByLabelText, getByRole } = mount();
    fireEvent.click(getByLabelText('Layout: columns, gutter and margin'));
    expect(getByRole('dialog').getAttribute('data-size')).toBe('sm');
    const input = getByLabelText('Gutter') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '32' } });
    fireEvent.blur(input);
    expect(writes).toHaveLength(1);
    expect(writes[0].recipe.spec.gutterX).toBe(32);
    expect(writes[0].recipe.spec.gutterY).toBe(32);
  });

  it('shows viewers the arrangement and nothing editable', () => {
    state.editable = false;
    const { container, queryByLabelText } = mount();
    expect(container.querySelector('button')).toBeNull();
    expect(queryByLabelText('Edit cells')).toBeNull();
    expect(queryByLabelText('Layout: columns, gutter and margin')).toBeNull();
  });

  it('asks for the grid settings on purpose, and only then', () => {
    const heard: string[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener(GRID_SETTINGS_EVENT, on);
    const { getByLabelText } = mount();
    expect(heard).toHaveLength(0);
    fireEvent.click(getByLabelText('Grid settings'));
    window.removeEventListener(GRID_SETTINGS_EVENT, on);
    expect(heard).toEqual(['g']);
  });
});
