import { describe, expect, it } from 'vitest';
import {
  aimingAt,
  firstIndex,
  lastIndex,
  placeAtPoint,
  placeAtRect,
  placeSubmenu,
  stepIndex,
  tidy,
  typeahead,
  type MenuEntry,
} from './menuModel';
import { hintShortcut } from './shortcuts';
import { splitShortcut } from '../ui/tooltipShortcut';

const item = (id: string, label = id, disabled = false): MenuEntry => ({
  kind: 'item', id, label, disabled, onSelect: () => {},
});
const rule = (id: string): MenuEntry => ({ kind: 'separator', id });

describe('tidy', () => {
  it('drops leading, trailing and doubled rules and empty submenus', () => {
    const out = tidy([
      rule('a'), item('copy'), rule('b'), rule('c'), false,
      { kind: 'submenu', id: 'empty', label: 'Empty', entries: [] },
      item('paste'), rule('d'),
    ]);
    expect(out.map((e) => e.id)).toEqual(['copy', 'b', 'paste']);
  });

  it('drops a heading with nothing under it', () => {
    const out = tidy([{ kind: 'heading', id: 'h', label: 'Align' }, rule('r'), item('x')]);
    expect(out.map((e) => e.id)).toEqual(['x']);
  });
});

describe('keyboard movement', () => {
  const entries = [item('a'), rule('r'), item('b', 'b', true), item('c')];

  it('skips rules and disabled rows, and wraps', () => {
    expect(stepIndex(entries, 0, 1)).toBe(3);
    expect(stepIndex(entries, 3, 1)).toBe(0);
    expect(stepIndex(entries, 0, -1)).toBe(3);
    expect(firstIndex(entries)).toBe(0);
    expect(lastIndex(entries)).toBe(3);
  });

  it('jumps to a typed prefix, cycling on a repeated letter', () => {
    const rows = [item('lock', 'Lock'), item('copy', 'Copy'), item('layers', 'Layers'), item('cut', 'Cut')];
    expect(typeahead(rows, -1, 'l')).toBe(0);
    expect(typeahead(rows, 0, 'l')).toBe(2);
    expect(typeahead(rows, 0, 'cu')).toBe(3);
    // "cc" is the letter c pressed twice: the next c after Copy.
    expect(typeahead(rows, 1, 'cc')).toBe(3);
    expect(typeahead(rows, 0, 'zz')).toBe(-1);
  });
});

describe('placement', () => {
  const view = { width: 1000, height: 800, margin: 8 };

  it('opens down and right of the pointer when there is room', () => {
    expect(placeAtPoint({ x: 100, y: 100 }, { width: 240, height: 300 }, view)).toEqual({
      x: 100, y: 100, origin: 'top left', maxHeight: undefined,
    });
  });

  it('flips to the left of the pointer rather than sliding under it', () => {
    const p = placeAtPoint({ x: 900, y: 100 }, { width: 240, height: 300 }, view);
    expect(p.x).toBe(660);
    expect(p.origin).toBe('top right');
  });

  it('flips upward near the bottom and scrolls when taller than the window', () => {
    expect(placeAtPoint({ x: 100, y: 700 }, { width: 240, height: 300 }, view).y).toBe(400);
    const tall = placeAtPoint({ x: 100, y: 50 }, { width: 240, height: 2000 }, view);
    expect(tall.y).toBe(8);
    expect(tall.maxHeight).toBe(784);
  });

  it('hangs a button menu above when asked and there is room', () => {
    const rect = { left: 500, right: 530, top: 400, bottom: 430 };
    expect(placeAtRect(rect, { width: 240, height: 200 }, view, 'above').y).toBe(194);
    expect(placeAtRect(rect, { width: 240, height: 200 }, view, 'below').y).toBe(436);
  });

  it('opens a submenu on the left when the right has no room', () => {
    const p = placeSubmenu({ top: 100, bottom: 130 }, { left: 700, right: 940 }, { width: 240, height: 100 }, view);
    expect(p.side).toBe('left');
    expect(p.x).toBe(464);
  });
});

describe('aim toward a submenu', () => {
  const panel = { left: 300, right: 540, top: 100, bottom: 400 };

  it('reads a diagonal move toward the submenu as aiming', () => {
    expect(aimingAt({ x: 200, y: 110 }, { x: 220, y: 140 }, panel, 'right')).toBe(true);
  });

  it('reads a move away, or straight down past it, as not', () => {
    expect(aimingAt({ x: 200, y: 110 }, { x: 180, y: 140 }, panel, 'right')).toBe(false);
    expect(aimingAt({ x: 200, y: 110 }, { x: 201, y: 500 }, panel, 'right')).toBe(false);
  });
});

describe('shortcut spelling', () => {
  it('writes tooltips in words the tooltip layer draws as keycaps', () => {
    const text = `Bring to front (${hintShortcut('Mod+Shift+]')})`;
    expect(splitShortcut(text).shortcut).toBe(hintShortcut('Mod+Shift+]'));
    expect(splitShortcut(`Paste style (${hintShortcut('Mod+Alt+V')})`).text).toBe('Paste style');
  });
});

import { comboFromEvent, combosInSpec } from './shortcuts';

describe('finding a shortcut from a key press', () => {
  const press = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
    comboFromEvent({ key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  it('reads the physical key, so Shift and Option do not change it', () => {
    expect(press('}', 'BracketRight', { ctrlKey: true, shiftKey: true })).toBe('mod+shift+]');
    expect(press('ç', 'KeyC', { metaKey: true, altKey: true })).toBe('mod+alt+c');
    expect(press('!', 'Digit1', { shiftKey: true })).toBe('shift+1');
    expect(press('Shift', 'ShiftLeft', { shiftKey: true })).toBeNull();
  });

  it('matches the way the help page writes them, alternatives included', () => {
    expect(combosInSpec('Ctrl + Shift + ]')).toEqual(['mod+shift+]']);
    expect(combosInSpec('Delete / Backspace')).toEqual(['delete', 'backspace']);
    expect(combosInSpec('Enter / Cmd + Enter')).toEqual(['enter', 'mod+enter']);
    expect(combosInSpec('Ctrl + + / −')).toEqual(['mod+=', '-']);
    expect(combosInSpec('Mod+Alt+V')).toEqual(['mod+alt+v']);
  });
});
