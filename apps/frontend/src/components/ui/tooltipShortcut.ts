/**
 * Splitting a tooltip's label from the keyboard shortcut riding on the end of it.
 *
 * Roughly half the `data-tooltip` strings in this app end in a parenthesised
 * accelerator — "Undo (Ctrl+Z)" — written that way because the attribute is a
 * single string and there was nowhere else to put it. That is a keyboard
 * shortcut wearing prose punctuation: it reads as an aside when it is usually
 * the most useful thing in the tip.
 *
 * Its own module rather than a second export from `TooltipLayer`, because a
 * file that exports both a component and a helper opts out of Fast Refresh for
 * the component — and because every other piece of pure logic in this codebase
 * lives somewhere it can be asserted without a DOM.
 */

const ACCEL = /\s*\(([^()]{1,18})\)\s*$/;

/**
 * The punctuation keys are spelled out rather than left to a loose `\W`,
 * because the set of single characters that are plausibly a keyboard shortcut
 * is small and the set that are plausibly the end of a sentence is not. `?` is
 * in it — the help control's tip is literally "Shortcuts and help (?)".
 */
const LOOKS_LIKE_KEY =
  /^(?:(?:Ctrl|Cmd|Shift|Alt|Opt|Meta)\s*\+\s*)*(?:F\d{1,2}|Esc|Tab|Enter|Space|Del|Backspace|[A-Za-z0-9]|[[\]\\/?.,;'`=*-])$/i;

/**
 * Deliberately conservative. It matches only a trailing parenthetical that
 * looks like an accelerator, so "Radar (the whole board)" keeps its
 * parenthesis and stays prose, because it is prose.
 */
export function splitShortcut(raw: string): { text: string; shortcut?: string } {
  const m = raw.match(ACCEL);
  if (!m) return { text: raw };
  const inner = m[1].trim();
  if (!LOOKS_LIKE_KEY.test(inner)) return { text: raw };
  return { text: raw.slice(0, m.index).trim(), shortcut: inner };
}

/**
 * A shortcut as the keys to draw, for this machine.
 *
 * `Ctrl+Z` and `Cmd+Z` both mean "the command key", so a Mac shows `⌘ Z` and
 * everything else shows `Ctrl Z`; Shift and Alt become `⇧` and `⌥` on a Mac and
 * stay words elsewhere. Anything that is not a modifier is left as written.
 */
export function keycaps(shortcut: string, mac: boolean): string[] {
  return shortcut.split(/\s*\+\s*(?=\S)/).map((raw) => {
    const k = raw.trim();
    const lower = k.toLowerCase();
    const command = lower === 'ctrl' || lower === 'cmd' || lower === 'mod' || lower === 'meta' || lower === 'command';
    if (mac) {
      if (command) return '⌘';
      if (lower === 'shift') return '⇧';
      if (lower === 'alt' || lower === 'opt' || lower === 'option') return '⌥';
      return k;
    }
    if (command) return 'Ctrl';
    if (lower === 'opt' || lower === 'option') return 'Alt';
    return k;
  });
}
