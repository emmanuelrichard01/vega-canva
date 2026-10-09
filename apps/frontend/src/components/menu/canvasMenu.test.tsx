// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { normalizeNode } from '../../engine/document/normalize';
import type { AnyNode } from '../../engine/model/schema';
import { boardMenu, selectionMenu, type CanvasContextMenuActions, type CanvasMenuInput } from './canvasMenu';
import { filterMenu, isNavigable, type MenuEntry } from './menuModel';

const actions = new Proxy({}, { get: () => vi.fn() }) as CanvasContextMenuActions;

const rect = (id: string, x = 0, extra: Record<string, unknown> = {}) =>
  normalizeNode({ id, type: 'shape', x, y: 0, width: 100, height: 60, geometry: { kind: 'rect' }, ...extra });
const connector = (id: string) => normalizeNode({ id, type: 'connector', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
const frame = (id: string) => normalizeNode({ id, type: 'frame', x: -50, y: -50, width: 800, height: 600 });

function board(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

function menuFor(nodes: AnyNode[], opts: Partial<CanvasMenuInput> = {}, all = board(...nodes)): MenuEntry[] {
  const input: CanvasMenuInput = { nodes, allObjects: all, actions, canEdit: true, style: null, atPointer: true, ...opts };
  return nodes.length ? selectionMenu(input) : boardMenu(input);
}

/** Every id the menu reaches, submenus and strip tiles included. */
function ids(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((e) => [
    e.id,
    ...(e.kind === 'submenu' && e.entries ? ids(e.entries) : []),
    ...(e.kind === 'strip' ? e.items.map((i) => `${e.id}/${i.id}`) : []),
  ]);
}

const find = (entries: readonly MenuEntry[], id: string) => entries.find((e) => e.id === id);

/** The menu's drawn height, from the stylesheet's row metrics: rows 30, strips 36, rules 11, padding 10. */
function height(entries: readonly MenuEntry[]): number {
  return entries.reduce(
    (h, e) =>
      h +
      (e.kind === 'separator'
        ? 11
        : e.kind === 'strip'
          ? 36
          : e.kind === 'heading'
            ? 22
            : 30 + (e.kind === 'item' && (e.detail || (e.disabled && e.disabledReason)) ? 16 : 0)),
    10
  );
}

describe('selection menu', () => {
  it('leads with what only this selection can do and ends with Delete', () => {
    const menu = menuFor([rect('a')]);
    expect(menu[0].id).toBe('swap-shape');
    expect(menu[menu.length - 1].id).toBe('delete');
    expect(find(menu, 'clipboard')?.kind).toBe('strip');
  });

  it('fits a laptop screen without scrolling for one object and for several', () => {
    expect(height(menuFor([rect('a')]))).toBeLessThan(700);
    expect(height(menuFor([rect('a'), rect('b', 200), rect('c', 400)]))).toBeLessThan(700);
  });

  it('offers Mermaid only for a diagram, not for one shape on its own', () => {
    expect(ids(menuFor([rect('a')]))).not.toContain('edit-mermaid');
    expect(ids(menuFor([rect('a')]))).not.toContain('mermaid');
    expect(ids(menuFor([rect('a'), connector('c')]))).toContain('edit-mermaid');
    expect(ids(menuFor([rect('a'), rect('b', 200)]))).toContain('mermaid');
  });

  it('offers Frame selection, with its shortcut, for several objects only', () => {
    const several = menuFor([rect('a'), rect('b', 200)]);
    const row = find(several, 'frame-selection');
    expect(row?.kind === 'item' && row.shortcut).toBe('Mod+Alt+G');
    expect(ids(menuFor([rect('a')]))).not.toContain('frame-selection');
    expect(ids(menuFor([connector('c'), connector('d')]))).not.toContain('frame-selection');
  });

  it('gives a frame its own rows: what it holds, and whether it clips', () => {
    const f = frame('f');
    const inside = rect('in', 0, { frameId: 'f' });
    const menu = menuFor([f], {}, board(f, inside));
    const contents = find(menu, 'frame-contents');
    expect(contents?.kind === 'item' && contents.detail).toBe('1 object');
    const clip = find(menu, 'frame-clip');
    expect(clip?.kind === 'item' && clip.checked).toBe(true);
  });

  it('says why Select contents is off on an empty frame', () => {
    const contents = find(menuFor([frame('f')]), 'frame-contents');
    expect(contents && !isNavigable(contents)).toBe(true);
    expect(contents?.kind === 'item' && contents.disabledReason).toBe('This frame is empty');
  });
});

describe('roles', () => {
  const viewer = { canEdit: false, canComment: false };
  const commenter = { canEdit: false, canComment: true };

  it('gives a viewer the ways to look and take away, and nothing that changes the board', () => {
    const menu = menuFor([rect('a')], viewer);
    const all = ids(menu);
    for (const id of ['delete', 'swap-shape', 'copy-style', 'paste-style', 'order', 'lock', 'comment', 'frame-clip']) {
      expect(all).not.toContain(id);
    }
    for (const id of ['copy-as', 'export', 'zoom-selection', 'history']) expect(all).toContain(id);
    // Copy is the clipboard a viewer can use: a row, with no greyed tiles around it.
    expect(find(menu, 'clipboard')).toBeUndefined();
    expect(find(menu, 'copy')?.kind).toBe('item');
  });

  it('lets a commenter comment on an object, and nothing more', () => {
    const all = ids(menuFor([rect('a')], commenter));
    expect(all).toContain('comment');
    expect(all).not.toContain('delete');
  });

  it('gives a commenter Comment here on the board, without the editor’s add row', () => {
    const menu = menuFor([], commenter, board(rect('a')));
    expect(ids(menu)).toContain('comment');
    expect(ids(menu)).not.toContain('add');
    expect(ids(menuFor([], viewer, board(rect('a'))))).not.toContain('comment');
  });

  it('keeps a frame’s Select contents for a viewer, but not Clip content', () => {
    const all = ids(menuFor([frame('f')], viewer));
    expect(all).toContain('frame-contents');
    expect(all).not.toContain('frame-clip');
  });
});

describe('board menu', () => {
  it('is about adding on an empty board, with nothing that would act on nothing', () => {
    const all = ids(menuFor([], {}, {}));
    for (const id of ['select-all', 'zoom-fit', 'copy-board', 'export', 'present']) expect(all).not.toContain(id);
    for (const id of ['add', 'paste', 'zoom-reset']) expect(all).toContain(id);
  });

  it('offers the whole board once there is something on it', () => {
    const all = ids(menuFor([], {}, board(rect('a'))));
    for (const id of ['select-all', 'zoom-fit', 'copy-board', 'export']) expect(all).toContain(id);
  });
});

describe('searching the menu', () => {
  it('reaches a command inside a submenu, and says where it lives', () => {
    const hits = filterMenu(menuFor([rect('a')]), 'front');
    const first = hits[0];
    expect(first.kind === 'item' && first.label).toBe('Bring to front');
    expect(first.kind === 'item' && first.detail).toBe('Order');
  });

  it('turns strip tiles into rows', () => {
    const hits = filterMenu(menuFor([rect('a')]), 'dup');
    expect(hits.map((h) => h.kind === 'item' && h.label)).toEqual(['Duplicate']);
  });

  it('finds a picker by its own name', () => {
    expect(filterMenu(menuFor([rect('a')]), 'change').map((h) => h.id)).toContain('swap-shape');
  });
});
