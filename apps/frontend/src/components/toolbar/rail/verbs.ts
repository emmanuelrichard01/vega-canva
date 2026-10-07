import type React from 'react';

/** Arrange in grid from the keyboard (⌥⇧G); bound by the rail's frame while several objects are selected. */
export const ARRANGE_IN_GRID_KEYS = 'Alt+Shift+G';

/** No rail carries more than this many controls; the rest live in `⋯` and the panel. */
export const RAIL_CONTROL_CAP = 9;

/** One entry in the verbs slot, with how many controls it puts on the rail. */
export interface RailVerb {
  id: string;
  node: React.ReactNode;
  /** Buttons and triggers it renders on the rail itself, not inside its popover. */
  controls: number;
}

/**
 * Keep verbs, in priority order, while they fit in what the cap leaves over.
 *
 * Verbs arrive most important first, so what falls off the end is the least
 * used — and everything a rail can drop is still in `⋯` and the panel.
 */
export function fitVerbs(verbs: readonly RailVerb[], budget: number): RailVerb[] {
  const kept: RailVerb[] = [];
  let used = 0;
  for (const verb of verbs) {
    if (used + verb.controls > budget) continue;
    kept.push(verb);
    used += verb.controls;
  }
  return kept;
}
