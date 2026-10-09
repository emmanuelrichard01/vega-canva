// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Menu } from './Menu';
import { countCommands, filterMenu, matchScore, type MenuEntry } from './menuModel';

afterEach(cleanup);

const item = (id: string, label: string, onSelect = () => {}, extra: Partial<MenuEntry> = {}): MenuEntry =>
  ({ kind: 'item', id, label, onSelect, ...extra }) as MenuEntry;

/** A board-sized menu: fourteen commands, four of them inside Order. */
function longMenu(spy = vi.fn()): MenuEntry[] {
  return [
    {
      kind: 'strip',
      id: 'clipboard',
      label: 'Clipboard',
      items: ['Cut', 'Copy', 'Paste', 'Duplicate'].map((label) => ({ id: label.toLowerCase(), label, icon: null, onSelect: () => {} })),
    },
    { kind: 'separator', id: 's1' },
    item('copy-style', 'Copy style'),
    item('paste-style', 'Paste style', () => {}, { disabled: true, disabledReason: 'Copy a style first' }),
    {
      kind: 'submenu',
      id: 'order',
      label: 'Order',
      entries: [
        item('front', 'Bring to front', spy),
        item('forward', 'Bring forward'),
        item('backward', 'Send backward'),
        item('back', 'Send to back'),
      ],
    },
    item('lock', 'Lock'),
    item('hide', 'Hide'),
    item('zoom', 'Zoom to selection'),
    { kind: 'separator', id: 's2' },
    item('delete', 'Delete'),
  ];
}

function open(entries: MenuEntry[], onClose = vi.fn(), searchable = true) {
  const view = render(
    <Menu label="Test" entries={entries} anchor={{ kind: 'point', x: 10, y: 10 }} onClose={onClose} searchable={searchable} focusFirst />
  );
  const panel = document.querySelector<HTMLElement>('.menu')!;
  const type = (keys: string) => {
    for (const key of keys) act(() => void fireEvent.keyDown(document.activeElement ?? panel, { key }));
  };
  const press = (key: string) => act(() => void fireEvent.keyDown(document.activeElement ?? panel, { key }));
  const labels = () => Array.from(panel.querySelectorAll('.menu__label')).map((n) => n.textContent);
  return { ...view, panel, type, press, labels };
}

describe('filterMenu', () => {
  const entries = longMenu();

  it('ranks a label that starts with the query before one that only contains it', () => {
    const hits = filterMenu([item('a', 'Zoom to front'), item('b', 'Front matter')], 'front');
    expect(hits.map((h) => h.id)).toEqual(['b', 'a']);
  });

  it('matches every typed word against the starts of words, accents and ellipses aside', () => {
    expect(matchScore('Bring to front', [], 'to fr')).toBe(1);
    expect(matchScore('Export…', [], 'export')).toBe(0);
    expect(matchScore('Résumé', [], 'resume')).toBe(0);
    expect(matchScore('Send to back', ['Order'], 'order back')).toBe(3);
    expect(matchScore('Lock', [], 'zz')).toBeNull();
  });

  it('puts disabled hits after the ones that work, keeping their reason', () => {
    const hits = filterMenu(entries, 'style');
    expect(hits.map((h) => h.id)).toEqual(['copy-style', 'paste-style']);
  });

  it('counts commands through submenus and strips', () => {
    expect(countCommands(entries)).toBe(14);
  });

  it('finds nothing for nothing', () => {
    expect(filterMenu(entries, '')).toEqual([]);
    expect(filterMenu(entries, 'qqq')).toEqual([]);
  });
});

describe('menu search', () => {
  it('filters as you type, reaching into submenus, and Enter runs the match', () => {
    const spy = vi.fn();
    const onClose = vi.fn();
    const { type, press, labels, panel } = open(longMenu(spy), onClose);
    type('front');
    expect(labels()).toEqual(['Bring to front']);
    expect(panel.querySelector('.menu__query')?.textContent).toBe('front');
    press('Enter');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('edits the query with Backspace, and Escape clears it before it closes anything', () => {
    const onClose = vi.fn();
    const { type, press, labels } = open(longMenu(), onClose);
    type('lockx');
    expect(labels()).toEqual([]);
    expect(document.querySelector('.menu__empty')).not.toBeNull();
    press('Backspace');
    expect(labels()).toEqual(['Lock']);
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(labels()).toContain('Delete');
    press('Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('takes a space as part of the query once one has begun', () => {
    const { type, labels, panel } = open(longMenu());
    type('send');
    expect(labels()).toEqual(['Send backward', 'Send to back']);
    type(' to');
    expect(panel.querySelector('.menu__query')?.textContent).toBe('send to');
    expect(labels()).toEqual(['Send to back']);
  });

  it('keeps type-ahead on a short menu', () => {
    const { type, panel } = open([item('a', 'Alpha'), item('b', 'Beta'), item('c', 'Charlie')]);
    type('c');
    expect(panel.querySelector('.menu__search')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Charlie');
  });

  it('keeps type-ahead where search was not asked for, however long the menu', () => {
    const { type, panel } = open(longMenu(), vi.fn(), false);
    type('l');
    expect(panel.querySelector('.menu__search')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Lock');
  });
});
