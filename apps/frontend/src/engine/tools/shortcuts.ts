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
  'shape-line': 'L',
  frame: 'F',
  grid: 'G',
  chart: 'K',
  connector: 'X',
  sticky: 'S',
  comment: 'C',
  image: 'I',
  audio: 'M',
};

/**
 * The two tools that share the dock's line seat.
 *
 * Written here rather than imported from `shapePresetTypes`, which lives under
 * `components/`: the engine does not depend on the UI, and a shortcut map that
 * reached upward for two string literals would be the first crack in that.
 * `shortcuts.test.ts` checks the pair against the dock's own list, so the
 * duplication cannot drift silently — which is the only thing that made the
 * duplication acceptable.
 */
export const LINE_SEAT: readonly string[] = ['shape-line', 'shape-arrow'];

/**
 * What pressing the line key does, given what is already armed.
 *
 * ## Why one key drives two tools
 *
 * The help screen advertised `L / R` for "Line tool / Arrow tool" and **neither
 * was ever bound** — `R` arms the generic Shape seat and `L` did nothing at
 * all. That is precisely the failure `toolNames.ts` opens by describing: a help
 * screen holding its own copy of the shortcuts, read by someone who is already
 * unsure, and wrong. The Tools section is generated from this map and was
 * correct; one hand-written row three sections further down was not.
 *
 * Binding both letters was the obvious repair and it is the wrong one, because
 * `R` is Shape and taking it back would break a key people already use to fix
 * a key nobody could. Nor is there a second mnemonic letter free — `A` is
 * Direct Select.
 *
 * Line and arrow already *share a seat* in the dock and already switch between
 * each other there; they differ by which end carries a head. So one key arms
 * that seat, and pressing it again switches within it. Mnemonic, no collision,
 * and it matches the control the key is a shortcut for — which is the property
 * that stops a keyboard map and a toolbar becoming two different products.
 */
export function lineSeatFor(activeTool: string): string {
  return activeTool === LINE_SEAT[0] ? LINE_SEAT[1] : LINE_SEAT[0];
}

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
