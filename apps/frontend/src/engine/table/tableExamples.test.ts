import { describe, expect, it } from 'vitest';
import { TABLE_EXAMPLES, TABLE_EXAMPLE_CATEGORIES } from './tableExamples';
import { normalizeTableSpec } from './tableTypes';
import { layoutTable } from './tableLayout';
import { tableToSvg } from './tableSvg';
import { TABLE_TEMPLATES } from '../templates/tableTemplates';
import { evaluateCell, isErr } from './tableFormula';

/**
 * The gallery's promises.
 *
 * An example's formatting *is* the example — a status tint, a merged
 * objective, a totals row — and `normalizeTableSpec` drops whatever it does
 * not trust. So the load-bearing check is that normalisation is lossless: a
 * merge that overlaps another, or a style keyed past the grid, would vanish on
 * the way in and the card would advertise a table nobody gets.
 */

const natural = (spec: (typeof TABLE_EXAMPLES)[number]['spec']) => ({
  w: spec.columns.reduce((a, c) => a + c.width, 0) * 150,
  h: spec.cells.length * 36,
});

describe('table examples', () => {
  it('have unique ids in known categories', () => {
    const ids = TABLE_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(TABLE_EXAMPLE_CATEGORIES.map((c) => c.id));
    for (const e of TABLE_EXAMPLES) expect(known.has(e.category), e.id).toBe(true);
    for (const c of TABLE_EXAMPLE_CATEGORIES) expect(TABLE_EXAMPLES.some((e) => e.category === c.id), c.id).toBe(true);
  });

  it.each(TABLE_EXAMPLES.map((e) => [e.id, e] as const))('%s survives normalisation intact', (_, e) => {
    const n = normalizeTableSpec(e.spec);
    expect(n.merges ?? []).toEqual(e.spec.merges ?? []);
    expect(Object.keys(n.styles ?? {}).sort()).toEqual(Object.keys(e.spec.styles ?? {}).sort());
    expect(n.columns.map((c) => c.type)).toEqual(e.spec.columns.map((c) => c.type));
    expect(n.cells).toEqual(e.spec.cells);
    expect(n.sort).toEqual(e.spec.sort);
    expect(n.theme).toBe(e.spec.theme);
  });

  it.each(TABLE_EXAMPLES.map((e) => [e.id, e] as const))('%s keeps its colour rules through normalisation', (_, e) => {
    expect(normalizeTableSpec(e.spec).rules ?? []).toEqual(e.spec.rules ?? []);
  });

  it.each(TABLE_EXAMPLES.map((e) => [e.id, e] as const))('%s computes without a single error', (_, e) => {
    // An example that ships `#REF!` is a broken promise in the gallery.
    const spec = normalizeTableSpec(e.spec);
    spec.cells.forEach((row, r) =>
      row.forEach((raw, c) => {
        if (raw[0] === '=') expect(isErr(evaluateCell(spec, r, c)), `${e.id} ${r}:${c} ${raw}`).toBe(false);
      })
    );
  });

  it.each(TABLE_EXAMPLES.map((e) => [e.id, e] as const))('%s lays out and paints, clean and sketched', (_, e) => {
    const { w, h } = natural(e.spec);
    const spec = normalizeTableSpec(e.spec);
    expect(layoutTable(spec, w, h).cells.length).toBeGreaterThan(0);
    for (const sketch of [undefined, 'medium'] as const) {
      const svg = tableToSvg(spec, w, h, { id: e.id, sketch });
      expect(svg.length).toBeGreaterThan(0);
      expect(svg).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('table templates', () => {
  it.each(TABLE_TEMPLATES.map((t) => [t.id, t] as const))('%s keeps every tile inside its frame', (_, t) => {
    const nodes = t.build() as Array<{ type: string; x: number; y: number; width: number; height: number }>;
    const frame = nodes.find((n) => n.type === 'frame')!;
    const tiles = nodes.filter((n) => n.type === 'table' || n.type === 'chart');
    expect(tiles.length).toBeGreaterThan(0);
    for (const n of tiles) {
      expect(n.x).toBeGreaterThanOrEqual(frame.x);
      expect(n.y).toBeGreaterThanOrEqual(frame.y);
      expect(n.x + n.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(n.y + n.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });
});
