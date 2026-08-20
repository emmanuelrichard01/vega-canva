/**
 * The single-key shortcut for each tool, in one place.
 *
 * ## Why this is not just a constant in the dock
 *
 * These letters existed twice: as a `switch` in `Room` that actually bound the
 * key, and as hand-written text inside each dock tooltip — `"Select (V)"`,
 * `"Comment (C)"`. Nothing tied the two together, so a tooltip could advertise
 * a key that was never bound, and two of them did exactly that for a while.
 * A shortcut hint that lies is worse than no hint: it teaches something wrong
 * and costs a press to find out.
 *
 * Now the dock renders its badges from this map and `Room` resolves keystrokes
 * through it, so the label and the binding cannot disagree.
 *
 * Single keys only. Anything with a modifier is an editing command rather than
 * a tool, lives with the command palette, and does not belong on a dock button.
 */
export const TOOL_SHORTCUTS: Record<string, string> = {
  select: 'V',
  'direct-select': 'A',
  hand: 'H',
  pen: 'N',
  'bezier-pen': 'P',
  eraser: 'E',
  text: 'T',
  shape: 'R',
  frame: 'F',
  grid: 'G',
  connector: 'X',
  sticky: 'S',
  comment: 'C',
  image: 'I',
  audio: 'M',
};

/**
 * Which tool a bare keypress selects.
 *
 * Derived rather than written out again — the inverse of a map is exactly the
 * kind of thing that rots when it is maintained by hand.
 */
export const TOOL_FOR_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_SHORTCUTS).map(([tool, key]) => [key.toLowerCase(), tool])
);

/** The badge text for a tool, or nothing if it has no single-key shortcut. */
export const shortcutFor = (toolId: string): string | undefined => TOOL_SHORTCUTS[toolId];

/**
 * Whether clicking an object with this tool selects it.
 *
 * ## Why this is shared rather than an inline check
 *
 * `Canvas.handleObjectSelect` opened with `if (activeTool !== 'select') return`
 * and silently dropped the click — while the hover outline in `ObjectRenderer`
 * had no such condition and lit up regardless. So with a shape variant, the
 * connector, or the hand tool armed, an object would highlight under the
 * pointer, promising it was clickable, and then do nothing when clicked. The
 * two behaviours disagreed because they were two separate decisions.
 *
 * One predicate, read by both, means the affordance cannot promise something
 * the click will refuse: if a tool cannot select, the object does not light up.
 *
 * The rule itself is unchanged and correct — a drawing tool that also selected
 * would fight the stroke you are trying to start.
 */
export const canSelectWith = (toolId: string): boolean =>
  toolId === 'select' || toolId === 'direct-select';

/**
 * Whether a click with this tool opens a path for anchor editing.
 *
 * Separate from `canSelectWith` because direct selection does *both*: it opens
 * a path when it lands on one, and it selects like the arrow when it lands on
 * anything else — an editor that appears inert on half the board is worse than
 * one that does something reasonable.
 */
export const opensPathWith = (toolId: string): boolean => toolId === 'direct-select';
