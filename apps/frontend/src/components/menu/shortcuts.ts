/**
 * One way to write a keyboard shortcut, and two ways to show it.
 *
 * The rail said "Cmd+D", the menu said "Ctrl D", the overflow list said "⌘⇧]"
 * — three spellings of the same keys in three places a few pixels apart, and
 * two of them wrong on whichever machine was reading them.
 *
 * Shortcuts are written once, platform-neutrally, with `Mod` for the command
 * key: `'Mod+Shift+]'`. Menus show the platform's own convention — glyphs on a
 * Mac, words elsewhere — because that is what every native menu on that
 * machine does. Tooltips get words on both, because `tooltipShortcut` parses
 * the words into keycaps and has no reason to learn a second alphabet.
 */

export const IS_MAC = ((): boolean => {
  if (typeof navigator === 'undefined') return false;
  const claimed =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  return /Mac|iPhone|iPad|iPod/i.test(claimed);
})();

const MAC_GLYPH: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };
/** The order a Mac menu lists modifiers in, which is not the order they are typed. */
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];

/** For a menu row: `⇧⌘G` on a Mac, `Ctrl+Shift+G` elsewhere. */
export function menuShortcut(spec: string): string {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  if (IS_MAC) {
    const mods = [...parts].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return mods.map((m) => MAC_GLYPH[m] ?? m).join('') + key;
  }
  return [...parts.map((m) => (m === 'Mod' ? 'Ctrl' : m)), key].join('+');
}

/** For a tooltip: `Cmd+Shift+G` or `Ctrl+Shift+G`, which the tooltip draws as keycaps. */
export function hintShortcut(spec: string): string {
  return spec
    .split('+')
    .map((m) => (m === 'Mod' ? (IS_MAC ? 'Cmd' : 'Ctrl') : m === 'Alt' && IS_MAC ? 'Opt' : m))
    .join('+');
}

/** A label with its shortcut riding on the end, the form tooltips parse. */
export function withShortcut(label: string, spec?: string): string {
  return spec ? `${label} (${hintShortcut(spec)})` : label;
}

/** Every shortcut the canvas binds that a menu or the rail advertises. */
export const SHORTCUTS = {
  cut: 'Mod+X',
  copy: 'Mod+C',
  paste: 'Mod+V',
  duplicate: 'Mod+D',
  copyStyle: 'Mod+Alt+C',
  pasteStyle: 'Mod+Alt+V',
  group: 'Mod+G',
  ungroup: 'Mod+Shift+G',
  front: 'Mod+Shift+]',
  forward: 'Mod+]',
  backward: 'Mod+[',
  back: 'Mod+Shift+[',
  lock: 'Mod+Shift+L',
  hide: 'Mod+Shift+H',
  selectAll: 'Mod+A',
  export: 'Mod+Shift+E',
  zoomFit: 'Shift+1',
  zoomSelection: 'Shift+2',
  zoomReset: 'Mod+0',
  delete: 'Del',
  editPoints: 'Enter',
  undo: 'Mod+Z',
  redo: 'Mod+Shift+Z',
  search: 'Mod+K',
  bold: 'Mod+B',
  italic: 'Mod+I',
  underline: 'Mod+U',
  fitAll: 'Mod+1',
  zoomIn: 'Mod+=',
  zoomOut: 'Mod+-',
} as const;

export type ShortcutId = keyof typeof SHORTCUTS;

/** A few words for each, for the keyboard map where a key has a label's width. */
export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  duplicate: 'Duplicate',
  copyStyle: 'Copy style',
  pasteStyle: 'Paste style',
  group: 'Group',
  ungroup: 'Ungroup',
  front: 'To front',
  forward: 'Forward',
  backward: 'Backward',
  back: 'To back',
  lock: 'Lock',
  hide: 'Hide',
  selectAll: 'Select all',
  export: 'Export',
  zoomFit: 'Fit all',
  zoomSelection: 'Zoom to selection',
  zoomReset: '100%',
  delete: 'Delete',
  editPoints: 'Edit points',
  undo: 'Undo',
  redo: 'Redo',
  search: 'Search',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  fitAll: 'Fit all',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
};

// ------------------------------------------------------------ finding a key

/**
 * A key combination as a set of tokens, however it was written or pressed.
 *
 * The help page writes shortcuts for people — `Ctrl + Shift + ]`,
 * `Delete / Backspace`, `Enter / Cmd + Enter` — and a key press arrives as an
 * event. Matching one against the other needs both reduced to the same thing:
 * lowercase tokens, the command key as `mod`, modifiers in a fixed order.
 */
const ALIASES: Record<string, string> = {
  cmd: 'mod', ctrl: 'mod', command: 'mod', meta: 'mod', '⌘': 'mod', mod: 'mod',
  opt: 'alt', option: 'alt', '⌥': 'alt', alt: 'alt',
  shift: 'shift', '⇧': 'shift',
  del: 'delete', delete: 'delete', backspace: 'backspace',
  esc: 'escape', escape: 'escape', return: 'enter', enter: 'enter',
  '↑': 'arrowup', '↓': 'arrowdown', '←': 'arrowleft', '→': 'arrowright',
  space: ' ', spacebar: ' ',
  '+': '=', '−': '-', '_': '-',
};

function normalizeCombo(tokens: string[]): string {
  const mods = ['mod', 'shift', 'alt'].filter((m) => tokens.includes(m));
  const rest = tokens.filter((t) => !['mod', 'shift', 'alt'].includes(t));
  return [...mods, ...rest].join('+');
}

/** Every combination a written shortcut stands for: `A / B` is two. */
export function combosInSpec(written: string): string[] {
  return written
    .split(/\s+\/\s+/)
    .map((alt) =>
      normalizeCombo(
        alt
          .split(/\s*\+\s*(?=\S)/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .map((t) => ALIASES[t] ?? t)
      )
    )
    .filter(Boolean);
}

/**
 * The combination a key press is, in the same terms.
 *
 * The key comes from `code` where the character would lie: Shift+1 types `!`,
 * Shift+] types `}`, and Option+C on a Mac types `ç`, none of which is the key
 * anybody means.
 */
export function comboFromEvent(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt', 'OS'].includes(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === 'BracketLeft') key = '[';
  else if (e.code === 'BracketRight') key = ']';
  else if (e.code === 'Equal') key = '=';
  else if (e.code === 'Minus') key = '-';
  else if (e.code === 'Backslash') key = '\\';
  else if (e.code === 'Slash') key = '/';
  else key = e.key.toLowerCase();
  key = ALIASES[key] ?? key;
  const tokens = [
    ...(e.ctrlKey || e.metaKey ? ['mod'] : []),
    ...(e.shiftKey ? ['shift'] : []),
    ...(e.altKey ? ['alt'] : []),
    key,
  ];
  return normalizeCombo(tokens);
}

const NAMED_KEYS: Record<string, string> = {
  mod: 'Mod', shift: 'Shift', alt: 'Alt', enter: 'Enter', escape: 'Esc', delete: 'Del',
  backspace: 'Backspace', tab: 'Tab', ' ': 'Space', arrowup: '↑', arrowdown: '↓',
  arrowleft: '←', arrowright: '→',
};

/** A normalised combination back into the written form `capsFor` draws. */
export function comboToSpec(combo: string): string {
  return combo
    .split(/\+(?=.)/)
    .map((t) => NAMED_KEYS[t] ?? (t.length === 1 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1)))
    .join('+');
}

/** A written shortcut as keycaps for this machine: `⌘`, `⇧`, `⌥` on a Mac. */
export function capsFor(written: string): string[] {
  return written.split(/\s*\+\s*(?=\S)/).map((k) => {
    const t = k.trim();
    if (!IS_MAC) return t === 'Mod' ? 'Ctrl' : t;
    const lower = t.toLowerCase();
    if (lower === 'cmd' || lower === 'mod' || lower === 'command') return '⌘';
    if (lower === 'shift') return '⇧';
    if (lower === 'alt' || lower === 'opt' || lower === 'option') return '⌥';
    if (lower === 'ctrl') return '⌃';
    return t;
  });
}
