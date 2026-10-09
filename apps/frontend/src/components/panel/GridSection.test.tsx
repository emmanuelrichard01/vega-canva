// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { normalizeNode } from '../../engine/document/normalize';
import type { GridNode } from '../../engine/model/schema';

const state = vi.hoisted(() => ({
  editable: true,
  node: null as unknown,
  writes: [] as { spec: Record<string, unknown> }[],
}));

vi.mock('../../engine/grid/gridApply', () => ({
  setGridRecipe: (_id: string, recipe: { spec: Record<string, unknown> }) => {
    state.writes.push(recipe);
  },
}));
vi.mock('../../engine/model/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../engine/model/permissions')>()),
  canEditObjects: () => state.editable,
}));
vi.mock('../../hooks/useStore', () => {
  const store = { objects: {} as Record<string, unknown> };
  const useStore = (sel: (s: typeof store) => unknown) => {
    store.objects = { g: state.node };
    return sel(store);
  };
  useStore.getState = () => {
    store.objects = { g: state.node };
    return store;
  };
  return { useStore };
});

import { GridSection } from './GridSection';
import { gridEditMode } from '../../engine/grid/gridEditMode';

afterEach(() => {
  cleanup();
  state.writes.length = 0;
  state.editable = true;
  gridEditMode.exit();
});

state.node = normalizeNode({ id: 'g', type: 'grid', width: 400, height: 300 }) as GridNode;

describe('the grid section', () => {
  it('names its sections in the order of questions, with the mode up top', () => {
    const { container, getByText } = render(<GridSection nodeId="g" />);
    const titles = [...container.querySelectorAll('.pg-section__label')].map((n) => n.textContent);
    expect(titles.slice(0, 3)).toEqual(['Grid', 'Structure', 'Spacing']);
    expect(getByText('Edit cells', { selector: '.gsec-mode__title' })).toBeTruthy();
    // Never the class the Get started checklist owns.
    expect(container.querySelector('.gs')).toBeNull();
  });

  it('writes once when a system tile is chosen', () => {
    const { getByRole } = render(<GridSection nodeId="g" />);
    const group = getByRole('radiogroup', { name: 'Grid system' });
    const bento = [...group.querySelectorAll('button')].find((b) => b.textContent === 'Bento')!;
    fireEvent.click(bento);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].spec.kind).toBe('bento');
  });

  it('writes once when row sizing changes', () => {
    const { getByRole } = render(<GridSection nodeId="g" />);
    fireEvent.click(getByRole('radio', { name: /Hug content/ }));
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].spec.sizing).toBe('hug');
  });

  it('enters and leaves Edit cells from the mode card', () => {
    const { getByRole } = render(<GridSection nodeId="g" />);
    fireEvent.click(getByRole('button', { name: 'Edit cells' }));
    expect(gridEditMode.get().gridId).toBe('g');
    fireEvent.click(getByRole('button', { name: 'Done' }));
    expect(gridEditMode.get().gridId).toBeNull();
  });

  it('is read-only for people who cannot edit', () => {
    state.editable = false;
    const { container, getByText } = render(<GridSection nodeId="g" />);
    expect(getByText(/View only/)).toBeTruthy();
    expect(container.querySelector('.gsec')!.hasAttribute('inert')).toBe(true);
    expect((container.querySelector('.gsec-action') as HTMLButtonElement).disabled).toBe(true);
  });
});
