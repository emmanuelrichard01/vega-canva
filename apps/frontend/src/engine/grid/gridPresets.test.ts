import { describe, expect, it } from 'vitest';
import { GRID_PRESETS, gridPreset, gridPresetMatching } from './gridPresets';
import { GRID_KINDS, KIND_DEFAULTS, type GridSpec } from './gridLayout';

/**
 * The kind picker answers *arrangement*; a preset answers *proportion*.
 *
 * `KIND_DEFAULTS` are chosen to show each system at its best, which is the
 * right default and is not a configuration. A twelve-column, 24-gutter grid is
 * four separate edits away, and every one of them is a number somebody has to
 * already know.
 */

const spec = (over: Partial<GridSpec>): GridSpec => ({
  kind: 'columns',
  x: 0, y: 0, width: 1200, height: 800,
  rows: 1, columns: 4, gutterX: 16, gutterY: 16, margin: 24,
  variation: 0, seed: 1,
  ...over,
});

describe('the list is coherent', () => {
  it('has no duplicate ids', () => {
    const ids = GRID_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names a kind the layout engine knows', () => {
    for (const p of GRID_PRESETS) expect(GRID_KINDS, p.id).toContain(p.kind);
  });

  it('says what each one is for', () => {
    // The hint is the picker's only text. A preset whose name is its whole
    // explanation is one nobody picks on purpose.
    for (const p of GRID_PRESETS) expect(p.hint.length, p.id).toBeGreaterThan(20);
  });

  it('sets no field to something the panel would refuse', () => {
    for (const p of GRID_PRESETS) {
      if (p.patch.rows !== undefined) expect(p.patch.rows, p.id).toBeGreaterThanOrEqual(1);
      if (p.patch.columns !== undefined) expect(p.patch.columns, p.id).toBeLessThanOrEqual(24);
      if (p.patch.margin !== undefined) expect(p.patch.margin, p.id).toBeLessThanOrEqual(400);
      if (p.patch.variation !== undefined) {
        expect(p.patch.variation, p.id).toBeGreaterThanOrEqual(0);
        expect(p.patch.variation, p.id).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('a preset is a patch, not a whole grid', () => {
  it('says nothing about position or size', () => {
    /**
     * Picking "Twelve column" is a statement about tracks, not about where the
     * grid sits. Applying one never moves or resizes what you are looking at,
     * which is what makes trying three in a row a comparison rather than a
     * series of accidents.
     */
    for (const p of GRID_PRESETS) {
      const keys = Object.keys(p.patch);
      for (const forbidden of ['x', 'y', 'width', 'height', 'seed']) {
        expect(keys, p.id).not.toContain(forbidden);
      }
    }
  });
});

describe('recognising the grid in front of you', () => {
  it('names a spec built from a preset', () => {
    const twelve = gridPreset('twelve')!;
    expect(gridPresetMatching(spec({ kind: twelve.kind, ...twelve.patch }))?.id).toBe('twelve');
  });

  it('is blind to the fields a preset does not set', () => {
    // A grid that has been moved, resized or reseeded is still the preset it
    // was built from — those are not things a preset has an opinion about.
    const twelve = gridPreset('twelve')!;
    const moved = spec({ kind: twelve.kind, ...twelve.patch, x: 900, y: 40, width: 300, seed: 77 });
    expect(gridPresetMatching(moved)?.id).toBe('twelve');
  });

  it('refuses a near miss', () => {
    // One column off is a grid somebody adjusted on purpose, and naming it
    // anyway would be the panel claiming what the numbers do not say.
    const twelve = gridPreset('twelve')!;
    expect(gridPresetMatching(spec({ kind: 'columns', ...twelve.patch, columns: 11 }))).toBeUndefined();
  });

  it('refuses the right numbers on the wrong kind', () => {
    const thirds = gridPreset('thirds')!;
    expect(gridPresetMatching(spec({ kind: 'bento', ...thirds.patch }))).toBeUndefined();
  });

  it('answers nothing for a kind default', () => {
    /**
     * The point of the whole list: arriving at a kind is not arriving at a
     * configuration, so a freshly switched grid matches no preset and the
     * panel says "Custom" rather than pretending a default is a decision.
     */
    expect(gridPresetMatching(spec({ kind: 'bento', ...KIND_DEFAULTS.bento }))).toBeUndefined();
  });
});

describe('lookup', () => {
  it('finds by id', () => {
    expect(gridPreset('swiss')?.kind).toBe('modular');
  });

  it('answers nothing for nothing', () => {
    expect(gridPreset(undefined)).toBeUndefined();
    expect(gridPreset('nope')).toBeUndefined();
  });
});
