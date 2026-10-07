import { TOOL_SHORTCUTS } from '../../engine/tools/shortcuts';
import { TOOL_NAMES } from '../../engine/tools/toolNames';
import { SHORTCUTS, SHORTCUT_LABELS, combosInSpec, type ShortcutId } from '../menu/shortcuts';
import type { Lesson } from '../../engine/learn/lessons';

/**
 * What the help centre says, kept apart from how it is drawn.
 *
 * Shortcuts are written once, platform-neutrally, with `Mod` for the command
 * key (`'Mod + Shift + E'`). `capsFor` turns that into this machine's keycaps
 * and `combosInSpec` into something a key press can be matched against, so the
 * list, the keyboard map and the "press a key to find it" lookup all read the
 * same rows.
 */

export type HelpPageId = 'start' | 'recipes' | 'tools' | 'shortcuts' | 'collab' | 'data' | 'new';

export interface HelpPage {
  id: HelpPageId;
  label: string;
  /** One line under the page title. */
  lede: string;
}

export const HELP_PAGES: readonly HelpPage[] = [
  { id: 'start', label: 'Getting started', lede: 'Where things are, and the handful of moves every session uses.' },
  { id: 'recipes', label: 'Recipes', lede: 'Small projects that use several tools together. Each one can walk you through it on the board.' },
  { id: 'tools', label: 'Tools', lede: 'Every tool has one key. The ones with a gesture worth knowing show it.' },
  { id: 'shortcuts', label: 'Shortcuts', lede: 'Point at a key to see what it does. Hold a modifier to see its layer.' },
  { id: 'collab', label: 'Collaboration', lede: 'Sharing, comments and working on one board at the same time.' },
  { id: 'data', label: 'Data tools', lede: 'Tables, charts, grids and diagrams written as code.' },
  { id: 'new', label: "What's new", lede: 'This release, in brief.' },
];

export interface ShortcutRow {
  /** Written for people: `Mod + Shift + E`, `Delete / Backspace`. */
  keys: string;
  what: string;
  /** A few words for a keycap on the keyboard map. Defaults to the start of `what`. */
  short?: string;
  /**
   * A second meaning for a chord the menus already name (Mod+Shift+L locks a
   * selection and aligns text being typed). Without it, a row whose chord is
   * in `TOOL_SHORTCUTS` or `SHORTCUTS` is the same binding said twice, and the
   * map keeps the menu's wording.
   */
  also?: true;
}

export interface ShortcutGroup {
  id: string;
  title: string;
  blurb?: string;
  /** The topic page this group also appears on. Every group is on Shortcuts. */
  page: HelpPageId;
  /**
   * Whether these keys work anywhere on the board, and so belong on the
   * keyboard map. Keys that only mean something inside one editor (the line
   * points, the code block, the Layers tree) stay in the list.
   */
  global: boolean;
  rows: ShortcutRow[];
}

/** A keycap's worth of a tool's name. The full names are the descriptions. */
const TOOL_SHORT: Record<string, string> = {
  select: 'Select',
  'direct-select': 'Direct',
  hand: 'Hand',
  pen: 'Pencil',
  'bezier-pen': 'Pen',
  eraser: 'Eraser',
  text: 'Text',
  shape: 'Shape',
  'shape-line': 'Line',
  frame: 'Frame',
  grid: 'Grid',
  chart: 'Chart',
  table: 'Table',
  connector: 'Connect',
  sticky: 'Note',
  comment: 'Comment',
  image: 'Image',
  audio: 'Voice',
};

export function toolShort(id: string): string {
  return TOOL_SHORT[id] ?? (TOOL_NAMES[id] ?? id).split(/[:/]/)[0].trim();
}

export function buildShortcutGroups(): ShortcutGroup[] {
  return [
    {
      id: 'tools',
      title: 'Tools',
      blurb: 'One key each, no modifier. Press it anywhere on the board.',
      page: 'tools',
      global: true,
      rows: [
        ...Object.entries(TOOL_SHORTCUTS).map(([id, key]) => ({
          keys: key,
          what: TOOL_NAMES[id] ?? id,
          short: toolShort(id),
        })),
        { keys: 'Shift + P', what: 'Physics, with the last force you used (editors)', short: 'Physics' },
        { keys: 'Shift + S', what: 'Draw the whole board by hand, or back to clean lines (editors)', short: 'Sketch board' },
        { keys: 'Q', what: 'Keep the armed tool after it places something (or double-click its seat)', short: 'Keep tool' },
        { keys: 'Hold a tool key', what: 'Use that tool, then let go to go back to the last one' },
      ],
    },
    {
      id: 'interface',
      title: 'The interface',
      blurb: 'The board has a column on each side. Both fold to a pill in their corner.',
      page: 'start',
      global: true,
      rows: [
        { keys: '?', what: 'Open this help', short: 'Help' },
        { keys: 'Mod + K', what: 'Command palette: search for any command or object', short: 'Search' },
        { keys: 'Mod + \\', what: 'Fold both side columns to their corners, or open them again', short: 'Fold panels' },
        { keys: '\\ / Mod + .', what: 'Hide or show the whole interface', short: 'Hide UI' },
        { keys: 'F6 / Shift + F6', what: 'Move between the layers, the board, the dock and properties', short: 'Next region' },
        { keys: 'Alt + Shift + V', what: 'View settings: grid, rulers, snapping and theme', short: 'View' },
        { keys: 'Shift + I', what: 'Open the icon library: AWS, Azure, Google Cloud and Kubernetes', short: 'Icons' },
      ],
    },
    {
      id: 'navigation',
      title: 'Moving around',
      blurb: 'The board has no edges. You cannot run out of space in any direction.',
      page: 'start',
      global: true,
      rows: [
        { keys: 'Scroll', what: 'Pan up, down and sideways' },
        { keys: 'Pinch', what: 'Zoom in and out at the pointer' },
        { keys: 'Mod + Scroll', what: 'Zoom with a mouse wheel' },
        { keys: 'Space + Drag', what: 'Pan without putting the current tool down' },
        { keys: 'Arrows', what: 'Pan, when nothing is selected' },
        { keys: '+ / −', what: 'Zoom in and out', short: 'Zoom' },
        { keys: '0', what: 'Back to the origin at 100%', short: '100%' },
        { keys: 'Mod + 0', what: 'Reset zoom and position to 100%', short: '100%' },
        { keys: 'Shift + 1', what: 'Fit everything on screen', short: 'Fit all' },
        { keys: 'Mod + 1', what: 'Zoom to fit all objects', short: 'Fit all' },
        { keys: 'Shift + 2', what: 'Zoom to the selection', short: 'Zoom to selection' },
      ],
    },
    {
      id: 'selection',
      title: 'Selecting',
      page: 'start',
      global: true,
      rows: [
        { keys: 'Click', what: 'Select one object' },
        { keys: 'Shift + Click', what: 'Add to or take away from the selection' },
        { keys: 'Drag on empty board', what: 'Select everything inside the box' },
        { keys: 'Mod + A', what: 'Select every object on the board', short: 'Select all' },
        { keys: 'Esc', what: 'Deselect, or leave the editor you are in', short: 'Deselect' },
        { keys: 'Double-click', what: 'Go inside: text, line points, path anchors, image crop' },
        { keys: 'Enter', what: 'Edit the selected text or note, or open a line’s points', short: 'Edit' },
        { keys: 'Alt + Drag', what: 'Duplicate the object instead of moving it' },
        { keys: 'Alt + Shift + T', what: 'Select everything of the same type', short: 'Same type' },
        { keys: 'Alt + Shift + F', what: 'Select everything with the same fill', short: 'Same fill' },
        { keys: 'Alt + Shift + S', what: 'Select everything with the same stroke', short: 'Same stroke' },
        { keys: 'Alt + Shift + N', what: 'Select everything in the same font', short: 'Same font' },
        { keys: 'Right-click', what: 'Everything the selection can do, or add something where you clicked' },
        { keys: 'Shift + F10', what: 'Open that menu from the keyboard (or the Menu key)', short: 'Menu' },
        { keys: 'Alt + F10', what: 'Move the keyboard onto the selection’s toolbar', short: 'Toolbar' },
      ],
    },
    {
      id: 'editing',
      title: 'Editing',
      page: 'start',
      global: true,
      rows: [
        { keys: 'Mod + Z', what: 'Undo', short: 'Undo' },
        { keys: 'Mod + Shift + Z / Mod + Y', what: 'Redo', short: 'Redo' },
        { keys: 'Mod + C', what: 'Copy. Works across boards and tabs', short: 'Copy' },
        { keys: 'Mod + X', what: 'Cut', short: 'Cut' },
        { keys: 'Mod + V', what: 'Paste. SVG arrives as editable vectors', short: 'Paste' },
        { keys: 'Mod + D', what: 'Duplicate, offset slightly', short: 'Duplicate' },
        { keys: 'Mod + G', what: 'Group', short: 'Group' },
        { keys: 'Mod + Shift + G', what: 'Ungroup', short: 'Ungroup' },
        { keys: 'Delete / Backspace', what: 'Delete the selection. A frame takes its contents with it', short: 'Delete' },
        { keys: 'Arrows / Shift + Arrows', what: 'Nudge by 1 or 10 pixels' },
        { keys: 'Shift + H', what: 'Flip horizontally', short: 'Flip H' },
        { keys: 'Shift + V', what: 'Flip vertically', short: 'Flip V' },
        { keys: 'Mod + ]', what: 'Bring forward, past the next object it overlaps', short: 'Forward' },
        { keys: 'Mod + [', what: 'Send backward, under the next object it overlaps', short: 'Backward' },
        { keys: 'Mod + Shift + ]', what: 'Bring to front', short: 'To front' },
        { keys: 'Mod + Shift + [', what: 'Send to back', short: 'To back' },
        { keys: 'Mod + Alt + C', what: 'Copy the selected object’s style', short: 'Copy style' },
        { keys: 'Mod + Alt + V', what: 'Paste that style onto the selection', short: 'Paste style' },
        { keys: 'Mod + Shift + L', what: 'Lock or unlock', short: 'Lock' },
        { keys: 'Mod + Shift + H', what: 'Hide or show', short: 'Hide' },
      ],
    },
    {
      id: 'text',
      title: 'Text and formatting',
      blurb: 'On text, shape labels and sticky notes, selected or while typing.',
      page: 'tools',
      global: true,
      rows: [
        { keys: 'Mod + B', what: 'Bold', short: 'Bold' },
        { keys: 'Mod + I', what: 'Italic', short: 'Italic' },
        { keys: 'Mod + U', what: 'Underline', short: 'Underline' },
        { keys: 'Mod + Shift + X', what: 'Strikethrough', short: 'Strike' },
        { keys: 'Mod + Shift + 7', what: 'Numbered list', short: 'Numbers' },
        { keys: 'Mod + Shift + 8', what: 'Bulleted list', short: 'Bullets' },
        { keys: 'Mod + Shift + .', what: 'One size larger', short: 'Larger' },
        { keys: 'Mod + Shift + ,', what: 'One size smaller', short: 'Smaller' },
        { keys: 'Mod + Shift + L', what: 'Align left, while typing', short: 'Align left', also: true },
        { keys: 'Mod + Shift + E', what: 'Align centre, while typing', short: 'Centre', also: true },
        { keys: 'Mod + Shift + R', what: 'Align right, while typing', short: 'Align right' },
      ],
    },
    {
      id: 'stickies',
      title: 'Sticky notes',
      page: 'tools',
      global: true,
      rows: [
        { keys: 'S, then click', what: 'Place a note, ready to type' },
        { keys: 'Tab', what: 'Chain another note beside the one you are typing in', short: 'Next note' },
        { keys: 'Esc', what: 'Finish typing. An empty note removes itself' },
        { keys: '1 – 8', what: 'Recolour the selected notes' },
        { keys: 'Mod + Alt + O', what: 'Organise the selected notes by colour', short: 'Organise' },
        { keys: 'Mod + Alt + Shift + O', what: 'Organise the selected notes by author', short: 'By author' },
      ],
    },
    {
      id: 'frames',
      title: 'Frames and presenting',
      page: 'tools',
      global: true,
      rows: [
        { keys: 'F', what: 'Frame tool' },
        { keys: 'Mod + Alt + Shift + R', what: 'Resize the selected frames to fit what they hold', short: 'Fit frame' },
        { keys: 'Mod + Alt + Enter', what: 'Present the frames as slides, from the selected one', short: 'Present' },
      ],
    },
    {
      id: 'lines',
      title: 'Lines and arrows',
      blurb: 'Drag for a straight line. Click for one with corners.',
      page: 'tools',
      global: false,
      rows: [
        { keys: 'L', what: 'Line or arrow: press again to switch between them' },
        { keys: 'Drag', what: 'A straight line from where you pressed to where you let go' },
        { keys: 'Click, click, click', what: 'Place a corner with each click' },
        { keys: 'Enter / Esc', what: 'Finish the line you are drawing' },
        { keys: 'Backspace', what: 'Take back the corner you just placed' },
        { keys: 'Shift', what: 'Constrain the next corner to 15° steps' },
        { keys: 'Alt + Click a segment', what: 'Add a corner there, once the line is open for editing' },
        { keys: 'Drag a curve handle', what: 'Bend that segment into an arc' },
      ],
    },
    {
      id: 'pen',
      title: 'The Pen and anchors',
      blurb: 'P draws Bézier paths. A edits anchors on any path.',
      page: 'tools',
      global: false,
      rows: [
        { keys: 'Click', what: 'Place a corner point' },
        { keys: 'Drag', what: 'Place a smooth point and pull its handles' },
        { keys: 'Alt + Drag', what: 'Break the handles apart for a cusp' },
        { keys: 'Click the first point', what: 'Close the path' },
        { keys: 'Shift', what: 'Constrain to 45° steps' },
        { keys: 'Enter', what: 'Finish as an open path' },
        { keys: 'Esc', what: 'Discard the path' },
        { keys: 'Double-click an anchor', what: 'Switch it between corner and smooth' },
        { keys: 'Delete', what: 'Delete the selected anchors and bridge the gap' },
      ],
    },
    {
      id: 'links',
      title: 'Links and code',
      blurb: 'Paste a web address and it becomes a card. Paste a fenced block and it becomes code.',
      page: 'tools',
      global: false,
      rows: [
        { keys: 'Enter', what: 'Open the selected link or code block, or play a video in place' },
        { keys: 'Tab / Shift + Tab', what: 'Indent or outdent, inside a code block' },
        { keys: 'Mod + /', what: 'Comment or uncomment lines, inside a code block' },
        { keys: 'Alt + ↑ / Alt + ↓', what: 'Move lines up or down, inside a code block' },
        { keys: 'Esc / Mod + Enter', what: 'Done. A code block left empty removes itself' },
      ],
    },
    {
      id: 'collab',
      title: 'Working together',
      page: 'collab',
      global: true,
      rows: [
        { keys: '/', what: 'Cursor chat: type a line beside your pointer', short: 'Chat' },
        { keys: 'Shift + Alt + click', what: 'Ping: draw everyone’s eye to that spot', short: 'Ping' },
        { keys: 'C', what: 'Comment tool: pin a thread to anything', short: 'Comment' },
        { keys: 'Click a face', what: 'Follow that person’s view. Click again, or move, to stop' },
        { keys: 'Mod + Shift + E', what: 'Export the selection, or the board', short: 'Export' },
        { keys: 'Right-click', what: 'Copy as PNG or SVG, straight to the clipboard' },
      ],
    },
    {
      id: 'data',
      title: 'Tables, charts and grids',
      page: 'data',
      global: true,
      rows: [
        { keys: 'B', what: 'Table: rows, columns and formulas' },
        { keys: 'K', what: 'Chart: bars, lines and pies' },
        { keys: 'G', what: 'Grid: lay out a composition' },
        { keys: 'Alt + Shift + G', what: 'Arrange the selection in a grid', short: 'Arrange' },
        { keys: 'Mod + K', what: 'Find “Diagram from code” to write a flowchart as Mermaid' },
        { keys: 'Mod + Enter', what: 'Add the diagram to the board, from the diagram editor' },
      ],
    },
    {
      id: 'layers',
      title: 'The Layers panel',
      blurb: 'Click into the tree first. The arrows work from there.',
      page: 'shortcuts',
      global: false,
      rows: [
        { keys: '↑ / ↓', what: 'Move through the rows. Shift extends the selection' },
        { keys: '← / →', what: 'Fold and unfold a frame or group' },
        { keys: 'Mod + ↑ / Mod + ↓', what: 'Move one place forward or back in the stack' },
        { keys: 'Enter', what: 'Rename the layer' },
        { keys: 'Space', what: 'Show or hide the layer' },
      ],
    },
    {
      id: 'history',
      title: 'Time travel',
      blurb: 'While history replay is open. The live board is kept as it is.',
      page: 'shortcuts',
      global: false,
      rows: [
        { keys: '← / →', what: 'Step one moment through history' },
        { keys: 'K / Space', what: 'Play or pause' },
        { keys: 'Home / End', what: 'Jump to the start or the end' },
      ],
    },
  ];
}

// ------------------------------------------------------------ keyboard map

/**
 * Which modifiers are down, in one fixed order: `mod`, `alt`, `shift`.
 * The empty string is the bare key.
 */
export type ModLayer = '' | 'shift' | 'alt' | 'alt+shift' | 'mod' | 'mod+shift' | 'mod+alt' | 'mod+alt+shift';

export const MOD_LAYERS: readonly ModLayer[] = ['', 'shift', 'alt', 'alt+shift', 'mod', 'mod+shift', 'mod+alt', 'mod+alt+shift'];

export interface KeyAction {
  label: string;
  what: string;
  kind: 'tool' | 'command';
}

/** key token → layer → what it does there. Several actions can share a key in context. */
export type KeyMap = Map<string, Map<ModLayer, KeyAction[]>>;

export function layerOf(mods: { mod?: boolean; alt?: boolean; shift?: boolean }): ModLayer {
  return [mods.mod && 'mod', mods.alt && 'alt', mods.shift && 'shift'].filter(Boolean).join('+') as ModLayer;
}

/** Characters typed with Shift on the key they are printed on. */
const SHIFTED: Record<string, string> = { '?': '/', '!': '1', '<': ',', '>': '.', '{': '[', '}': ']', '|': '\\', _: '-' };

/**
 * A normalised combination (`mod+shift+e`, from `combosInSpec`) as a key and a
 * layer, or `null` when it is not a key at all (a click, a drag, a scroll).
 */
export function keyAndLayer(combo: string, keys: ReadonlySet<string>): { key: string; layer: ModLayer } | null {
  const tokens = combo.split(/\+(?=.)/);
  let key = tokens.pop() ?? '';
  const mods = new Set(tokens);
  if (![...mods].every((m) => m === 'mod' || m === 'alt' || m === 'shift')) return null;
  if (SHIFTED[key]) {
    key = SHIFTED[key];
    mods.add('shift');
  }
  if (!keys.has(key)) return null;
  return { key, layer: layerOf({ mod: mods.has('mod'), alt: mods.has('alt'), shift: mods.has('shift') }) };
}

/** The first few words of a description, for a keycap with no label of its own. */
function shortOf(what: string): string {
  const head = what.split(/[:,.(]/)[0].trim();
  const words = head.split(/\s+/);
  return words.length <= 2 ? head : words.slice(0, 2).join(' ');
}

/**
 * Everything bound to a key, by layer.
 *
 * Tools first, then the menu table (`SHORTCUTS`), then the reference's global
 * rows, so a key's first action is the one a keycap shows. A second action on
 * the same key and layer is kept when it says something different (Mod+Shift+L
 * locks a selection and aligns text you are typing).
 */
export function buildKeyMap(groups: readonly ShortcutGroup[], keys: ReadonlySet<string>): KeyMap {
  const map: KeyMap = new Map();
  const add = (combo: string, action: KeyAction) => {
    const at = keyAndLayer(combo, keys);
    if (!at) return;
    let layers = map.get(at.key);
    if (!layers) map.set(at.key, (layers = new Map()));
    const list = layers.get(at.layer) ?? [];
    const label = action.label.toLowerCase();
    if (list.some((a) => a.label.toLowerCase() === label || a.what.toLowerCase() === action.what.toLowerCase())) return;
    list.push(action);
    layers.set(at.layer, list);
  };

  for (const [id, key] of Object.entries(TOOL_SHORTCUTS)) {
    for (const combo of combosInSpec(key)) add(combo, { label: toolShort(id), what: TOOL_NAMES[id] ?? id, kind: 'tool' });
  }
  for (const [id, spec] of Object.entries(SHORTCUTS) as Array<[ShortcutId, string]>) {
    for (const combo of combosInSpec(spec)) {
      add(combo, { label: SHORTCUT_LABELS[id], what: SHORTCUT_LABELS[id], kind: 'command' });
    }
  }
  // Which key and layer the tools and the menu table already speak for.
  const named = new Set<string>();
  for (const [key, layers] of map) for (const layer of layers.keys()) named.add(`${layer}|${key}`);
  for (const group of groups) {
    if (!group.global) continue;
    for (const row of group.rows) {
      for (const combo of combosInSpec(row.keys)) {
        const at = keyAndLayer(combo, keys);
        if (at && named.has(`${at.layer}|${at.key}`) && !row.also) continue;
        add(combo, { label: row.short ?? shortOf(row.what), what: row.what, kind: 'command' });
      }
    }
  }
  return map;
}

// ----------------------------------------------------------------- lessons

/** Which page a lesson belongs on, by the tools that raise it. */
export function pageForLesson(lesson: Lesson): HelpPageId {
  if (lesson.recipe) return 'recipes';
  if (lesson.trigger.on === 'library') {
    if (lesson.id === 'diagram-code') return 'data';
    if (lesson.id === 'offline' || lesson.id === 'cursor-chat') return 'collab';
    return 'tools';
  }
  const tools = lesson.trigger.tools;
  if (tools.some((t) => t === 'table' || t === 'chart' || t === 'grid')) return 'data';
  if (tools.some((t) => t === 'comment' || t === 'audio')) return 'collab';
  return 'tools';
}

// ---------------------------------------------------------------- search

export function rowMatches(row: ShortcutRow, q: string): boolean {
  return row.what.toLowerCase().includes(q) || row.keys.toLowerCase().includes(q);
}

export function lessonMatches(lesson: Lesson, q: string): boolean {
  return [lesson.title, lesson.gist, ...lesson.steps.flatMap((s) => [s.act, s.gives])]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

/** Groups narrowed to the rows that match. A group whose title matches keeps every row. */
export function searchGroups(groups: readonly ShortcutGroup[], q: string): ShortcutGroup[] {
  if (!q) return [...groups];
  return groups
    .map((g) => (g.title.toLowerCase().includes(q) ? g : { ...g, rows: g.rows.filter((r) => rowMatches(r, q)) }))
    .filter((g) => g.rows.length > 0);
}

// -------------------------------------------------------------- what's new

export interface ReleaseNote {
  title: string;
  body: string;
  /** Keys worth trying, written like the shortcut rows. */
  keys?: string[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    title: 'A new layout with no top bar',
    body: 'The board now runs edge to edge. Layers and the board’s name live in the left column, properties in the right, and the tools in the dock at the bottom, where Insert ＋ adds pictures, links, icons and media and All tools lists every tool. Fold both columns to pills in their corners when you want the room.',
    keys: ['Mod + \\', '\\', 'F6'],
  },
  {
    title: 'New tools',
    body: 'A Pen for Bézier paths and Direct select for their anchors, tables with formulas, charts that read from a table, layout grids, connectors that route around what is in the way, voice notes, and a library of cloud architecture icons.',
    keys: ['P', 'A', 'B', 'K', 'G', 'Shift + I'],
  },
  {
    title: 'More shapes',
    body: 'The shape picker carries flowchart, logic and diagram symbols alongside the basics, each with handles for its own proportions, and a hand-drawn sketch style for any of them.',
    keys: ['R'],
  },
  {
    title: 'Music while you work',
    body: 'Six stations of recorded focus music, from ambient to retro, play in the music panel. Spotify sits beside them, and people on the board can see what you are listening to.',
  },
  {
    title: 'Fonts',
    body: 'Pick from a larger built-in library, upload your own fonts to a board, or use fonts installed on this device. Uploaded fonts travel with SVG exports, and fonts from your device can too when you choose.',
  },
];
