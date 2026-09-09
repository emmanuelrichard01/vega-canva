import { describe, expect, it } from 'vitest';
import { LINE_SEAT, TOOL_FOR_KEY, TOOL_SHORTCUTS, lineSeatFor } from './shortcuts';
import { LINE_PRESETS as LINE_KINDS, shapeToolId } from '../../components/workspace/shapeCatalog';

describe('the line key', () => {
  it('is bound at all, which it was not', () => {
    /**
     * The report: "R for Shape conflicts with L / R for Line tool / Arrow
     * tool, L doesn't work." Half right and worse than it sounded. `R` was
     * never double-bound — it arms the Shape seat and always has. `L` was
     * bound to nothing whatsoever. What claimed both was a hand-written row in
     * the help modal's Lines section, three sections below a Tools list that
     * is generated from this map and was correct throughout.
     *
     * That is the failure `toolNames.ts` opens by describing, arriving exactly
     * where it said it would: the one screen someone reads when they are
     * already lost, telling them to press a key that does nothing.
     */
    expect(TOOL_FOR_KEY['l']).toBe('shape-line');
    expect(TOOL_SHORTCUTS['shape-line']).toBe('L');
  });

  it('does not take a letter another tool owns', () => {
    // `R` stays Shape. Reclaiming a working key to repair a broken one trades
    // a bug nobody could hit for a bug everybody would.
    expect(TOOL_SHORTCUTS.shape).toBe('R');
    const keys = Object.values(TOOL_SHORTCUTS).map((k) => k.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('switches within the seat when the seat is already armed', () => {
    // One key for two tools that share one dock button. Pressing it while
    // neither is armed picks the line; pressing it again gives the arrow.
    expect(lineSeatFor('select')).toBe('shape-line');
    expect(lineSeatFor('shape-line')).toBe('shape-arrow');
    expect(lineSeatFor('shape-arrow')).toBe('shape-line');
    // Two tools, so a third press is back where it started. It toggles rather
    // than walking a longer list — which is what makes the key predictable
    // once you have pressed it twice.
    expect(lineSeatFor(lineSeatFor(lineSeatFor('select')))).toBe('shape-line');
  });

  it('names the same two tools the dock seats together', () => {
    /**
     * `LINE_SEAT` is a second copy of the dock's `LINE_KINDS`, written in the
     * engine so a shortcut map does not have to import from `components/`.
     * The duplication is only acceptable while something fails when the two
     * disagree, which is this.
     */
    expect(LINE_SEAT).toEqual(LINE_KINDS.map(shapeToolId));
  });
});
