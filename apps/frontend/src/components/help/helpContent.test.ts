import { describe, expect, it } from 'vitest';
import { TOOL_SHORTCUTS } from '../../engine/tools/shortcuts';
import { LESSONS } from '../../engine/learn/lessons';
import { SHORTCUTS, combosInSpec } from '../menu/shortcuts';
import {
  HELP_PAGES,
  buildKeyMap,
  buildShortcutGroups,
  keyAndLayer,
  layerOf,
  pageForLesson,
  searchGroups,
  type ModLayer,
} from './helpContent';
import { DRAWN_KEYS } from './HelpKeyboard';

const groups = buildShortcutGroups();
const map = buildKeyMap(groups, DRAWN_KEYS);

/** Whether the keyboard map shows something for a written shortcut. */
function onMap(written: string): boolean {
  return combosInSpec(written).every((combo) => {
    const at = keyAndLayer(combo, DRAWN_KEYS);
    return Boolean(at && map.get(at.key)?.get(at.layer)?.length);
  });
}

describe('the keyboard map', () => {
  it('shows every tool key', () => {
    for (const key of Object.values(TOOL_SHORTCUTS)) expect(onMap(key), key).toBe(true);
  });

  it('shows every shortcut the menus advertise', () => {
    for (const [id, spec] of Object.entries(SHORTCUTS)) expect(onMap(spec), id).toBe(true);
  });

  it.each([
    ['/', 'cursor chat'],
    ['?', 'help'],
    ['Mod + \\', 'fold panels'],
    ['\\', 'hide the interface'],
    ['Mod + .', 'hide the interface'],
    ['F6', 'next region'],
    ['Shift + F6', 'previous region'],
    ['Alt + Shift + T', 'select same type'],
    ['Alt + Shift + F', 'select same fill'],
    ['Alt + Shift + S', 'select same stroke'],
    ['Alt + Shift + N', 'select same font'],
    ['Alt + Shift + G', 'arrange in grid'],
    ['Alt + Shift + V', 'view settings'],
    ['Shift + I', 'icon library'],
    ['Mod + Alt + O', 'organise stickies'],
    ['Mod + Alt + Shift + O', 'organise by author'],
    ['Mod + Alt + Shift + R', 'fit frames'],
    ['Mod + Alt + Enter', 'present'],
    ['Mod + Shift + 7', 'numbered list'],
    ['Mod + Shift + .', 'larger text'],
    ['Mod + Shift + E', 'export'],
  ])('shows %s (%s)', (written) => {
    expect(onMap(written)).toBe(true);
  });

  it('keeps two different meanings of one chord', () => {
    const actions = map.get('l')?.get('mod+shift') ?? [];
    expect(actions.map((a) => a.label)).toEqual(expect.arrayContaining(['Lock', 'Align left']));
  });

  it('shows Shift+I as the icon browser, apart from the Image tool on I', () => {
    expect(map.get('i')?.get('shift')?.[0]?.label).toBe('Icons');
    expect(map.get('i')?.get('')?.[0]?.label).toBe('Image');
  });

  it('reads a shifted character as Shift on its own key', () => {
    expect(keyAndLayer('?', DRAWN_KEYS)).toEqual({ key: '/', layer: 'shift' });
  });

  it('leaves out gestures that are not keys', () => {
    expect(keyAndLayer('click', DRAWN_KEYS)).toBeNull();
    expect(keyAndLayer('shift+drag', DRAWN_KEYS)).toBeNull();
  });

  it('names layers in one order however the modifiers arrive', () => {
    const layer: ModLayer = layerOf({ shift: true, mod: true, alt: true });
    expect(layer).toBe('mod+alt+shift');
  });

  it('keeps keys that mean something only inside an editor off the map', () => {
    // K plays history replay, but on the board it is the chart tool.
    expect(map.get('k')?.get('')?.map((a) => a.label)).toEqual(['Chart']);
  });
});

describe('the help pages', () => {
  it('puts every group on a page that exists', () => {
    const ids = new Set(HELP_PAGES.map((p) => p.id));
    for (const g of groups) expect(ids.has(g.page), g.id).toBe(true);
  });

  it('files every lesson under a page', () => {
    const ids = new Set(HELP_PAGES.map((p) => p.id));
    for (const lesson of LESSONS) expect(ids.has(pageForLesson(lesson)), lesson.id).toBe(true);
    expect(pageForLesson(LESSONS.find((l) => l.id === 'chart-data')!)).toBe('data');
    expect(pageForLesson(LESSONS.find((l) => l.id === 'comment-thread')!)).toBe('collab');
    const chat = LESSONS.find((l) => l.id === 'cursor-chat');
    if (chat) expect(pageForLesson(chat)).toBe('collab');
    for (const recipe of LESSONS.filter((l) => l.recipe)) expect(pageForLesson(recipe), recipe.id).toBe('recipes');
  });

  it('searches rows by what they do and by their keys, and keeps a matching group whole', () => {
    const byWord = searchGroups(groups, 'organise');
    expect(byWord.flatMap((g) => g.rows).every((r) => r.what.toLowerCase().includes('organise'))).toBe(true);
    const whole = searchGroups(groups, 'sticky notes');
    expect(whole.find((g) => g.id === 'stickies')?.rows.length).toBe(groups.find((g) => g.id === 'stickies')!.rows.length);
    expect(searchGroups(groups, 'zzzz')).toEqual([]);
  });
});
