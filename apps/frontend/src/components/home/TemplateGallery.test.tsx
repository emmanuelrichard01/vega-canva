// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Template } from '../../engine/templates/templates';

// Pictures are drawn by a renderer the gallery's behaviour does not depend on.
vi.mock('./templatePicture', () => ({
  coverUrl: () => new Promise(() => undefined),
  cachedCover: () => undefined,
  drawnCover: () => undefined,
  boardPicture: () => new Promise(() => undefined),
  prefetchBoard: () => undefined,
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { TemplateGallery } = await import('./TemplateGallery');
const { TemplateCard } = await import('./TemplateCard');

afterEach(cleanup);

const t = (id: string, over: Partial<Template> = {}): Template => ({
  id,
  category: 'systems',
  name: `Board ${id}`,
  blurb: `What ${id} is for.`,
  teaches: ['Connectors', 'Frames', 'Cloud icons', 'Sketch mode'],
  build: () => [],
  ...over,
});

const SHOWCASE = [t('systems-a', { featured: true }), t('data-b', { category: 'data', featured: true }), t('art-c', { category: 'art', featured: true })];
const REST = [t('systems-d'), t('physics-e', { category: 'physics' })];

function gallery(over: Partial<React.ComponentProps<typeof TemplateGallery>> = {}) {
  const props: React.ComponentProps<typeof TemplateGallery> = {
    total: 5,
    matched: [...SHOWCASE, ...REST],
    category: null,
    query: '',
    showcase: SHOWCASE,
    rest: REST,
    shelfColumns: 4,
    shelfRef: () => undefined,
    peekId: null,
    onPeek: vi.fn(),
    onUse: vi.fn(),
    onCategory: vi.fn(),
    onClearQuery: vi.fn(),
    ...over,
  };
  return { props, ...render(<TemplateGallery {...props} />) };
}

describe('the showcase', () => {
  it('is a tab set the arrows move through, wrapping at the ends', () => {
    const { getAllByRole, getByRole } = gallery();
    const tabs = getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(getByRole('heading', { level: 2, name: 'Board systems-a' })).toBeTruthy();

    fireEvent.keyDown(tabs[0], { key: 'ArrowDown' });
    expect(getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(getAllByRole('tab')[1]);
    expect(getByRole('heading', { level: 2, name: 'Board data-b' })).toBeTruthy();

    fireEvent.keyDown(getAllByRole('tab')[1], { key: 'End' });
    fireEvent.keyDown(getAllByRole('tab')[2], { key: 'ArrowDown' });
    expect(getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
    // Only the selected tab is in the tab order.
    expect(getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it('uses and previews the board on stage', () => {
    const { getByRole, props } = gallery();
    fireEvent.click(getByRole('button', { name: /Use template/ }));
    expect(props.onUse).toHaveBeenCalledWith(SHOWCASE[0]);
    fireEvent.click(getByRole('button', { name: /^Preview$/ }));
    expect(props.onPeek).toHaveBeenCalledWith(SHOWCASE[0]);
  });
});

describe('a card', () => {
  const card = (template: Template) => {
    const onPeek = vi.fn();
    const onUse = vi.fn();
    const view = render(<TemplateCard template={template} peeking={false} scope="s" onPeek={onPeek} onUse={onUse} />);
    return { ...view, onPeek, onUse, hit: view.container.querySelector<HTMLButtonElement>('[data-roving]')! };
  };

  it('uses on Enter and peeks on Space, with one tab stop', () => {
    const { hit, onPeek, onUse, container } = card(t('systems-x'));
    fireEvent.keyDown(hit, { key: 'Enter' });
    expect(onUse).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(hit, { key: ' ' });
    expect(onPeek).toHaveBeenCalledTimes(1);
    const tabbable = [...container.querySelectorAll<HTMLElement>('button')].filter((b) => b.tabIndex >= 0);
    expect(tabbable).toEqual([hit]);
  });

  it('peeks on a pointer click and uses on a double click', () => {
    const { hit, onPeek, onUse } = card(t('systems-x'));
    fireEvent.click(hit, { detail: 1 });
    expect(onPeek).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(hit);
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('caps its capability chips and marks a physics board as interactive', () => {
    const { container, getByText } = card(t('physics-y', { category: 'physics' }));
    expect(container.querySelectorAll('.gchip')).toHaveLength(3);
    expect(getByText(/Interactive/)).toBeTruthy();
  });
});

describe('empty states', () => {
  it('offers to clear a search that found nothing', () => {
    const { getByRole, props } = gallery({ query: 'zebra', matched: [] });
    expect(getByRole('heading', { name: /No templates match “zebra”/ })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Clear search' }));
    expect(props.onClearQuery).toHaveBeenCalled();
  });

  it('offers every category when a filtered search found nothing', () => {
    const { getByRole, props } = gallery({ query: 'zebra', matched: [], category: 'data' });
    fireEvent.click(getByRole('button', { name: 'Search every category' }));
    expect(props.onCategory).toHaveBeenCalledWith(null);
  });

  it('says so when the catalogue itself is empty', () => {
    const { getByRole } = gallery({ total: 0, matched: [], showcase: [], rest: [] });
    expect(getByRole('heading', { name: 'No templates in this build' })).toBeTruthy();
  });

  it('ranks results into one grid with a count when searching', () => {
    const { getByRole, queryByRole } = gallery({ query: 'board', matched: REST });
    expect(getByRole('status').textContent).toContain('2 templates for “board”');
    expect(queryByRole('tablist')).toBeNull();
  });
});
