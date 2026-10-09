import { describe, expect, it } from 'vitest';
import { normalizeNode } from '../../../engine/document/normalize';
import type { GridNode } from '../../../engine/model/schema';
import { switchKind } from '../../../engine/grid/gridBuild';
import { GRID_PRESETS, gridPresetMatching } from '../../../engine/grid/gridPresets';
import { canHug, withFitContent, withLayoutField, withPreset } from './gridActions';

const recipe = () => (normalizeNode({ id: 'g', type: 'grid', width: 400, height: 300 }) as GridNode).grid;

describe('grid rail actions', () => {
  it('sets both gutters together and clamps them', () => {
    const r = withLayoutField(recipe(), 'gutter', 9999);
    expect(r.spec.gutterX).toBe(200);
    expect(r.spec.gutterY).toBe(200);
    expect(withLayoutField(recipe(), 'gutter', -5).spec.gutterX).toBe(0);
  });

  it('clamps and rounds the track count, and never moves the seed', () => {
    const base = recipe();
    expect(withLayoutField(base, 'tracks', 0).spec.columns).toBe(1);
    expect(withLayoutField(base, 'tracks', 99).spec.columns).toBe(24);
    expect(withLayoutField(base, 'tracks', 5.6).spec.columns).toBe(6);
    expect(withLayoutField(base, 'tracks', 5).spec.seed).toBe(base.spec.seed);
  });

  it('a margin supersedes per-side padding', () => {
    const base = recipe();
    const padded = { ...base, spec: { ...base.spec, padding: { top: 1, right: 2, bottom: 3, left: 4 } } };
    const r = withLayoutField(padded, 'margin', 20);
    expect(r.spec.margin).toBe(20);
    expect(r.spec.padding).toBeUndefined();
  });

  it('fit content applies to row-and-column kinds only', () => {
    const cols = switchKind(recipe(), 'columns');
    expect(canHug(cols)).toBe(true);
    expect(withFitContent(cols, true)?.spec.sizing).toBe('hug');
    expect(withFitContent({ ...cols, spec: { ...cols.spec, sizing: 'hug' } }, false)?.spec.sizing).toBeUndefined();
    const dial = switchKind(recipe(), 'radial');
    expect(canHug(dial)).toBe(false);
    expect(withFitContent(dial, true)).toBeNull();
  });

  it('a named grid lands on its own preset and keeps the grid box', () => {
    const base = recipe();
    for (const preset of GRID_PRESETS) {
      const r = withPreset(base, preset);
      expect(gridPresetMatching(r.spec)?.id).toBe(preset.id);
      expect(r.spec.width).toBe(base.spec.width);
    }
  });
});
