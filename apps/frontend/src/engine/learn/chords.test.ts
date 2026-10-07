import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHORDS, chord, chordCaps, chordText, type ChordId } from './chords';
import { menuShortcut } from '../../components/menu/shortcuts';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('chordCaps', () => {
  it('spells a chord in words off a Mac and glyphs on one', () => {
    expect(chordCaps('Mod+Alt+Shift+R', false)).toEqual(['Ctrl', 'Alt', 'Shift', 'R']);
    expect(chordCaps('Mod+Alt+Shift+R', true)).toEqual(['⌥', '⇧', '⌘', 'R']);
  });

  it('draws named keys as glyphs', () => {
    expect(chordCaps('Alt+ArrowDown', false)).toEqual(['Alt', '↓']);
    expect(chordCaps('Mod+Alt+Enter', true)).toEqual(['⌥', '⌘', '↵']);
  });

  it('agrees with the menu on every chord whose key is a letter', () => {
    // One spelling of a chord across the product. The menu's formatter is the
    // reference, so a change there is a failure here rather than a drift.
    for (const spec of Object.values(CHORDS)) {
      if (!/\+[A-Z]$/.test(spec)) continue;
      expect(chordText(spec, false), spec).toBe(menuShortcut(spec));
    }
  });

  it('reads as prose', () => {
    expect(chord('arrangeInGrid', false)).toBe('Alt+Shift+G');
    expect(chord('arrangeInGrid', true)).toBe('⌥⇧G');
  });
});

/**
 * The binding for each chord, checked against the file that owns it.
 *
 * A chord has no shared map to read, so the table in `chords.ts` is a claim the
 * product has to keep true. Each pattern is the smallest fragment that proves
 * the key is bound; when one fails, either the binding moved (update `CHORDS`)
 * or the feature went (retire the lesson that teaches it).
 */
const BOUND: Partial<Record<ChordId, { file: string; pattern: RegExp }>> = {
  present: { file: '../../components/canvas/useContentShortcuts.ts', pattern: /mod && e\.altKey && !e\.shiftKey && e\.key === 'Enter'/ },
  fitFrame: { file: '../../components/canvas/useContentShortcuts.ts', pattern: /mod && e\.altKey && e\.shiftKey && e\.code === 'KeyR'/ },
  organiseByTheme: { file: '../../components/canvas/useContentShortcuts.ts', pattern: /e\.code === 'KeyO'/ },
  organiseByAuthor: { file: '../../components/canvas/useContentShortcuts.ts', pattern: /e\.shiftKey \? 'author' : 'theme'/ },
  arrangeInGrid: { file: '../../hooks/useRoomShortcuts.ts', pattern: /e\.altKey && e\.shiftKey && !hasModifier && e\.code === 'KeyG'/ },
  fillDown: { file: '../../components/sheet/useSheet.ts', pattern: /key === 'd' \|\| key === 'r'/ },
  fillRight: { file: '../../components/sheet/useSheet.ts', pattern: /key === 'd' \|\| key === 'r'/ },
  columnMenu: { file: '../../components/table/TableEditor.tsx', pattern: /e\.altKey && e\.key === 'ArrowDown'/ },
  similarType: { file: '../../hooks/useCanvasSelection.ts', pattern: /KeyT: 'type'/ },
  similarFill: { file: '../../hooks/useCanvasSelection.ts', pattern: /KeyF: 'fill'/ },
  similarStroke: { file: '../../hooks/useCanvasSelection.ts', pattern: /KeyS: 'stroke'/ },
  similarFont: { file: '../../hooks/useCanvasSelection.ts', pattern: /KeyN: 'font'/ },
  chainRight: { file: '../../components/canvas/nodeEditorKeys.ts', pattern: /e\.key === 'Tab' && sticky/ },
  chainDown: { file: '../../components/canvas/nodeEditorKeys.ts', pattern: /e\.shiftKey \? 'down' : 'right'/ },
  quickNext: { file: '../../components/canvas/QuickCreateMagnets.tsx', pattern: /e\.key !== 'Tab' \|\| e\.altKey/ },
  quickBack: { file: '../../components/canvas/QuickCreateMagnets.tsx', pattern: /if \(e\.shiftKey\) \{\s+const back = previousInChain/ },
  cursorChat: { file: '../../engine/presence/CursorChatComposer.tsx', pattern: /e\.key !== '\/'/ },
  mergeCells: { file: '../../components/canvas/renderers/GridEditOverlay.tsx', pattern: /e\.key === 'm' \|\| e\.key === 'M'/ },
  splitCells: { file: '../../components/canvas/renderers/GridEditOverlay.tsx', pattern: /if \(e\.shiftKey\) splitCells/ },
};

describe('the chords the lessons teach', () => {
  for (const [id, { file, pattern }] of Object.entries(BOUND)) {
    it(`${id} is bound where the table says`, () => {
      expect(source(file), `${id} (${CHORDS[id as ChordId]}) is no longer bound in ${file}`).toMatch(pattern);
    });
  }

  it('finishes a note with Cmd+Enter', () => {
    expect(source('../../components/canvas/nodeEditorKeys.ts')).toMatch(/Enter/);
  });
});
