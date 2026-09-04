import { describe, expect, it } from 'vitest';
import { CHART_HINTS, CHART_LABELS, CHART_PICKER_ORDER } from './chartKinds';
import { CHART_KINDS } from './chartTypes';

/**
 * Three lists describe one set, and this is what holds them together.
 *
 * Invariant 7: one source of truth, or a test that holds the copies together.
 * `CHART_LABELS` and `CHART_HINTS` are typed `Record<ChartKind, string>` so the
 * compiler catches a *missing* entry — but `CHART_PICKER_ORDER` is an array and
 * the compiler has nothing to say about one that is short. A kind added to the
 * schema and forgotten there is a chart type nothing in the interface can
 * reach, which is the dead-capability rule wearing a different hat.
 */
describe('the chart kind lists agree', () => {
  it('offers every kind the schema declares, exactly once', () => {
    expect([...CHART_PICKER_ORDER].sort()).toEqual([...CHART_KINDS].sort());
    expect(new Set(CHART_PICKER_ORDER).size).toBe(CHART_PICKER_ORDER.length);
  });

  it('names and explains every kind', () => {
    for (const kind of CHART_KINDS) {
      expect(CHART_LABELS[kind]?.length).toBeGreaterThan(0);
      expect(CHART_HINTS[kind]?.length).toBeGreaterThan(0);
    }
  });

  it('leads with bar, because it is the answer most of the time', () => {
    expect(CHART_PICKER_ORDER[0]).toBe('bar');
  });

  it('keeps the hints lower case and short enough for a menu row', () => {
    /**
     * They sit under a label in a narrow flyout. A hint that wraps to three
     * lines makes the picker taller than the dock it hangs off.
     */
    for (const kind of CHART_KINDS) {
      const hint = CHART_HINTS[kind];
      expect(hint[0]).toBe(hint[0].toLowerCase());
      expect(hint.length).toBeLessThanOrEqual(48);
    }
  });
});
