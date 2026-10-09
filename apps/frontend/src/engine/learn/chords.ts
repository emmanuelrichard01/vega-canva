/**
 * The key combinations the lessons teach, written once.
 *
 * ## Why this exists next to `TOOL_SHORTCUTS`
 *
 * A single key that arms a tool is looked up in `TOOL_SHORTCUTS`. A *chord* that
 * does something to the selection (arrange a grid, present the frames, organise
 * notes) is bound inside the component that owns the behaviour, so there is no
 * map to read. Teaching text that typed those combinations itself would be the
 * second copy `toolNames.ts` warns about.
 *
 * So the combinations are written here, platform-neutrally as `menu/shortcuts`
 * writes them (`Mod` for the command key), and everything that shows one -- the
 * lesson copy, the demo keycaps -- asks for it. `chords.test.ts` then reads the
 * file that binds each chord and fails when the binding and this table
 * disagree, which is the check a missing shared map cannot give.
 *
 * ## Why not import the menu's formatter
 *
 * The engine does not depend on `components/`. The formatting here is small,
 * takes the platform as an argument so it can be tested on both, and a test
 * pins it to the menu's own output so the two cannot spell one chord twice.
 */

export const CHORDS = {
  /** Arrange the selection into the nearest grid. */
  arrangeInGrid: 'Alt+Shift+G',
  /** Start presenting the board's frames. */
  present: 'Mod+Alt+Enter',
  /** Shrink or grow a frame to the objects it holds. */
  fitFrame: 'Mod+Alt+Shift+R',
  /** Tidy selected notes by colour. */
  organiseByTheme: 'Mod+Alt+O',
  /** Tidy selected notes by who wrote them. */
  organiseByAuthor: 'Mod+Alt+Shift+O',
  /** Fill the selected range from its first row. */
  fillDown: 'Mod+D',
  /** Fill the selected range from its first column. */
  fillRight: 'Mod+R',
  /** Open the menu for the current column. */
  columnMenu: 'Alt+ArrowDown',
  /** Select everything with the same type, fill, stroke or font. */
  similarType: 'Alt+Shift+T',
  similarFill: 'Alt+Shift+F',
  similarStroke: 'Alt+Shift+S',
  similarFont: 'Alt+Shift+N',
  /** Finish a note and start the next one beside or below it. */
  chainRight: 'Tab',
  chainDown: 'Shift+Tab',
  finishNote: 'Mod+Enter',
  /** With a shape or note selected: grow the diagram, or step back along it. */
  quickNext: 'Tab',
  quickBack: 'Shift+Tab',
  /** Slide view: every frame as a slide, in one grid. */
  slideView: 'Mod+Alt+S',
  /** Laser pointer, while presenting. */
  laser: 'L',
  /** Draw the whole board by hand, or back to clean lines. */
  sketchBoard: 'Shift+S',
  /** Physics, with the last force used. */
  physicsPlay: 'Shift+P',
  /** Hold both and click to ping. */
  pingMods: 'Shift+Alt',
  /** Voice note, while recording. */
  voicePause: 'Space',
  voiceKeep: 'Enter',
  voiceDiscard: 'Escape',
  /** Hold while dragging a grid border to switch snapping off. */
  noSnap: 'Mod',
  /** Export the selection or the board. */
  exportBoard: 'Mod+Shift+E',
  /** Open cursor chat. */
  cursorChat: '/',
  /** Merge or split the selected grid cells. */
  mergeCells: 'M',
  splitCells: 'Shift+M',
  /** Move forward through the stack at one point. */
  selectBehind: 'Alt',
  deepSelect: 'Mod',
  addToSelection: 'Shift',
  measure: 'Alt',
} as const;

export type ChordId = keyof typeof CHORDS;

const MAC_GLYPH: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };
/** The order a Mac lists modifiers in, which is not the order they are typed. */
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];

const KEY_GLYPH: Record<string, string> = {
  Enter: '↵',
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
};

export const IS_MAC = ((): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
})();

/**
 * One key per cap, in the order a person presses them.
 *
 * Words on Windows and Linux, glyphs on a Mac, because that is what every
 * native menu on that machine does.
 */
export function chordCaps(spec: string, mac: boolean = IS_MAC): string[] {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  const mods = mac ? [...parts].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b)) : parts;
  const modifier = (m: string) => (mac ? (MAC_GLYPH[m] ?? m) : m === 'Mod' ? 'Ctrl' : m);
  // A chord can be a lone modifier ("hold Alt"), which is spelt as a modifier.
  const named = (k: string) => (k in MAC_GLYPH ? modifier(k) : (KEY_GLYPH[k] ?? k));
  return [...mods.map(modifier), named(key)];
}

/** For prose: `⌥⇧G` on a Mac, `Alt+Shift+G` elsewhere. */
export function chordText(spec: string, mac: boolean = IS_MAC): string {
  return chordCaps(spec, mac).join(mac ? '' : '+');
}

/** A chord by id, as prose for this machine. */
export const chord = (id: ChordId, mac: boolean = IS_MAC): string => chordText(CHORDS[id], mac);

/** A chord by id, as keycaps for this machine. */
export const caps = (id: ChordId, mac: boolean = IS_MAC): string[] => chordCaps(CHORDS[id], mac);
