import { describe, it, expect } from 'vitest';
import { TYPE_LABEL, TYPE_ORDER, nodeLabel } from './nodeLabel';
import { NODE_TYPES, type AnyNode } from './schema';
import { CHART_KINDS } from '../chart/chartTypes';
import { CHART_LABELS } from '../chart/chartKinds';

describe('type chips', () => {
  it('offers a chip for every node type the schema declares', () => {
    // `connector` was missing from both lists, so a board built out of
    // connectors had no way to filter for them. A list that has to stay in
    // step with another list does not stay in step on its own.
    expect([...TYPE_ORDER].sort()).toEqual([...NODE_TYPES].sort());
    NODE_TYPES.forEach((t) => expect(TYPE_LABEL[t]).toBeTruthy());
  });

  it('names each type once', () => {
    expect(new Set(TYPE_ORDER).size).toBe(TYPE_ORDER.length);
  });
});

describe('naming a shape by what it is', () => {
  const shape = (geometry: Record<string, unknown>): AnyNode =>
    ({ id: 's', type: 'shape', geometry } as unknown as AnyNode);

  it('gives each primitive its own name instead of all of them "Shape"', () => {
    expect(nodeLabel(shape({ kind: 'rect' }))).toBe('Rectangle');
    expect(nodeLabel(shape({ kind: 'ellipse' }))).toBe('Ellipse');
    expect(nodeLabel(shape({ kind: 'star' }))).toBe('Star');
    expect(nodeLabel(shape({ kind: 'line' }))).toBe('Line');
    expect(nodeLabel(shape({ kind: 'arrow' }))).toBe('Arrow');
  });

  it('names a polygon by its side count where the word is common', () => {
    expect(nodeLabel(shape({ kind: 'polygon', points: 6 }))).toBe('Hexagon');
    expect(nodeLabel(shape({ kind: 'polygon', points: 3 }))).toBe('Triangle');
    // Nobody calls a nine-sided polygon a nonagon in a layer list.
    expect(nodeLabel(shape({ kind: 'polygon', points: 9 }))).toBe('Polygon');
  });

  it('names a path by what the user did, not by how it is stored', () => {
    const path = (geometry: Record<string, unknown>): AnyNode =>
      ({ id: 'p', type: 'path', geometry } as unknown as AnyNode);
    expect(nodeLabel(path({ kind: 'freehand' }))).toBe('Drawing');
    expect(nodeLabel(path({ kind: 'bezier', closed: false }))).toBe('Path');
    expect(nodeLabel(path({ kind: 'compound' }))).toBe('Compound path');
  });

  it('still lets a user-given title win over the derived name', () => {
    expect(nodeLabel({ ...shape({ kind: 'rect' }), title: 'Header bar' } as AnyNode)).toBe('Header bar');
  });
});

/**
 * Charts fell through to the bare type word for all twenty-four kinds, so a
 * board of them was a column of rows saying "Chart" -- the failure the grid
 * case in this file was written to fix, repeated on a node type added later.
 */
describe('charts', () => {
  const chart = (over: Record<string, unknown>) =>
    ({ id: 'c', type: 'chart', x: 0, y: 0, width: 100, height: 100, chart: over }) as never;

  it('prefers the title the chart is drawn with', () => {
    expect(nodeLabel(chart({ kind: 'bar', title: 'Revenue by quarter' }))).toBe('Revenue by quarter');
  });

  it('falls back to the kind, so no two kinds read alike', () => {
    expect(nodeLabel(chart({ kind: 'bar' }))).toBe('Bar chart');
    expect(nodeLabel(chart({ kind: 'pie' }))).toBe('Pie chart');
    expect(nodeLabel(chart({ kind: 'waterfall' }))).toBe('Waterfall chart');
  });

  it('calls a plot a plot', () => {
    /**
     * The *suffix* is the rule; the name in front of it belongs to
     * `CHART_LABELS` and is read from there.
     *
     * This spelled the names out, and one of them drifted: `heatmap` was
     * renamed to "Surface map" when `matrix` took the word "Heatmap" — a
     * deliberate change, documented where it was made, because "heatmap" said
     * plainly means a table of values painted by size. The test kept asserting
     * the old string and so failed over a rename it had no opinion about.
     *
     * Asking `CHART_LABELS` means this can only fail for the thing it is
     * actually about: a plot being called a chart, or the reverse.
     */
    expect(nodeLabel(chart({ kind: 'function' }))).toBe(`${CHART_LABELS.function} plot`);
    expect(nodeLabel(chart({ kind: 'vectorField' }))).toBe(`${CHART_LABELS.vectorField} plot`);
    // A surface of F(x, y) is a plot of a function, not a chart of a table.
    expect(nodeLabel(chart({ kind: 'heatmap' }))).toBe(`${CHART_LABELS.heatmap} plot`);
    // And the table of values it was renamed away from is a chart, not a plot.
    expect(nodeLabel(chart({ kind: 'matrix' }))).toBe(`${CHART_LABELS.matrix} chart`);
  });

  it('never calls two different kinds the same thing', () => {
    const names = CHART_KINDS.map((kind) => nodeLabel(chart({ kind })));
    expect(new Set(names).size).toBe(CHART_KINDS.length);
  });

  it('trims a title down rather than letting one row run away', () => {
    const long = 'A title far longer than any row in the layers panel can show';
    expect(nodeLabel(chart({ kind: 'bar', title: long })).length).toBeLessThanOrEqual(24);
  });
});
