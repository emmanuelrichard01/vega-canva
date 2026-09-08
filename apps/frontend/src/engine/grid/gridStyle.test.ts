import { describe, expect, it } from 'vitest';
import { defaultSpec, layoutGrid, type GridCell } from './gridLayout';
import {
  assignColors,
  cellLabel,
  cellPaint,
  COLOR_MODES,
  COLOR_MODE_LABELS,
  defaultStyle,
  GRID_PALETTES,
  SHAPE_LABELS,
  styleCells,
  type GridStyle,
} from './gridStyle';

const style = (over: Partial<GridStyle> = {}): GridStyle => ({ ...defaultStyle(), ...over });

const grid = (rows = 3, columns = 3): GridCell[] =>
  layoutGrid({ ...defaultSpec({ x: 0, y: 0, width: 300, height: 300 }), kind: 'modular', rows, columns });

const PALETTE = ['#000', '#111', '#222', '#333'];

describe('assignColors', () => {
  it('gives every cell a colour, in every mode', () => {
    const cells = grid();
    for (const colorMode of COLOR_MODES) {
      const colors = assignColors(cells, style({ colorMode, palette: PALETTE }));
      expect(colors).toHaveLength(cells.length);
      expect(colors.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
      expect(COLOR_MODE_LABELS[colorMode]).toBeTruthy();
    }
  });

  it('walks the palette in order for `sequence`', () => {
    const colors = assignColors(grid(1, 4), style({ colorMode: 'sequence', palette: PALETTE }));
    expect(colors).toEqual(PALETTE);
  });

  it('chequers rather than striping for `alternate`', () => {
    // "Every other cell in the list" produces vertical stripes on a grid of
    // even width, which is not what alternating means.
    const cells = grid(2, 2);
    const colors = assignColors(cells, style({ colorMode: 'alternate', palette: ['#a', '#b'] }));
    const at = (row: number, col: number) => colors[cells.findIndex((c) => c.row === row && c.col === col)];
    expect(at(0, 0)).toBe(at(1, 1));
    expect(at(0, 0)).not.toBe(at(0, 1));
  });

  it('never repeats a colour next to itself when scattering', () => {
    // The difference between a scatter that reads as deliberate and one that
    // reads as a bug.
    const colors = assignColors(grid(6, 6), style({ colorMode: 'scatter', palette: PALETTE, seed: 12 }));
    for (let i = 1; i < colors.length; i += 1) expect(colors[i]).not.toBe(colors[i - 1]);
  });

  it('ramps across the diagonal for `gradient`', () => {
    const cells = grid(1, 4);
    const colors = assignColors(cells, style({ colorMode: 'gradient', palette: PALETTE }));
    expect(colors[0]).toBe(PALETTE[0]);
    expect(colors[colors.length - 1]).toBe(PALETTE[PALETTE.length - 1]);
  });

  it('gives the biggest module the strongest colour for `weight`', () => {
    const cells = layoutGrid({
      ...defaultSpec({ x: 0, y: 0, width: 400, height: 400 }),
      kind: 'hierarchical', rows: 4, columns: 4, variation: 1,
    });
    const colors = assignColors(cells, style({ colorMode: 'weight', palette: PALETTE }));
    const hero = cells.findIndex((c) => c.weight === 1);
    expect(colors[hero]).toBe(PALETTE[PALETTE.length - 1]);
  });

  it('uses one colour for `solid`', () => {
    const colors = assignColors(grid(), style({ colorMode: 'solid', palette: PALETTE }));
    expect(new Set(colors).size).toBe(1);
  });

  it('is reproducible from its seed', () => {
    const cells = grid(4, 4);
    const a = assignColors(cells, style({ colorMode: 'scatter', palette: PALETTE, seed: 3 }));
    const b = assignColors(cells, style({ colorMode: 'scatter', palette: PALETTE, seed: 3 }));
    expect(a).toEqual(b);
    expect(a).not.toEqual(assignColors(cells, style({ colorMode: 'scatter', palette: PALETTE, seed: 4 })));
  });

  it('survives a one-colour and an empty palette', () => {
    expect(new Set(assignColors(grid(), style({ colorMode: 'scatter', palette: ['#a'] }))).size).toBe(1);
    expect(assignColors(grid(), style({ palette: [] }))).toHaveLength(9);
  });
});

describe('styleCells', () => {
  it('gives every cell the same shape when only one is chosen', () => {
    /**
     * The property that let `shapeMode` go. A seeded draw from a set of one has
     * one outcome, so "uniform" is not a mode the style has to carry — it is
     * what a list of length one already means, at every seed.
     */
    for (const seed of [1, 8, 99, 4242]) {
      const styled = styleCells(grid(5, 5), style({ shapes: ['ellipse'], seed }));
      expect(new Set(styled.map((c) => c.shape))).toEqual(new Set(['ellipse']));
    }
  });

  it('draws only from the chosen set when several are', () => {
    // "Mixed" means *these three mixed*, not a lucky dip — which is the
    // difference between a control and a slot machine.
    const chosen = ['rect', 'hexagon'] as const;
    const styled = styleCells(grid(5, 5), style({ shapes: [...chosen], seed: 8 }));
    expect(styled.every((c) => chosen.includes(c.shape as (typeof chosen)[number]))).toBe(true);
    expect(new Set(styled.map((c) => c.shape)).size).toBeGreaterThan(1);
  });

  it('carries a point count for the shapes that need one', () => {
    const styled = styleCells(grid(1, 1), style({ shapes: ['star'] }));
    expect(styled[0].points).toBe(5);
    expect(styleCells(grid(1, 1), style({ shapes: ['rect'] }))[0].points).toBeUndefined();
  });

  it('clamps the radius to half the cell', () => {
    // Past a stadium the control silently stops changing anything, which reads
    // as it being broken.
    const styled = styleCells(grid(3, 3), style({ radius: 9999 }));
    for (const c of styled) expect(c.radius).toBeLessThanOrEqual(Math.min(c.width, c.height) / 2);
  });

  it('numbers the cells so a bulk edit can name one', () => {
    const styled = styleCells(grid(2, 3), style());
    expect(styled.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('falls back to a rectangle when no shape is chosen', () => {
    expect(styleCells(grid(1, 1), style({ shapes: [] }))[0].shape).toBe('rect');
  });
});

describe('palettes', () => {
  it('ships several, each named and non-empty', () => {
    expect(GRID_PALETTES.length).toBeGreaterThan(3);
    for (const p of GRID_PALETTES) {
      expect(p.name).toBeTruthy();
      expect(p.colors.length).toBeGreaterThan(1);
      expect(p.colors.every((c) => /^#[0-9A-Fa-f]{3,8}$/.test(c))).toBe(true);
    }
  });

  it('has unique ids, so the picker can key on them', () => {
    expect(new Set(GRID_PALETTES.map((p) => p.id)).size).toBe(GRID_PALETTES.length);
  });
});

describe('labels', () => {
  it('names every shape', () => {
    for (const key of Object.keys(SHAPE_LABELS)) expect(SHAPE_LABELS[key as never]).toBeTruthy();
  });
});

/**
 * One resolver, because there were two.
 *
 * `cellPaint` exists so the Konva renderer and the SVG exporter cannot answer
 * "what colour is this module" differently. These assert the properties the
 * two painters rely on rather than the literals themselves, so re-picking the
 * guide hue is a one-line change and not a test edit.
 */
describe('cellPaint', () => {
  const base = defaultStyle();
  const cell = styleCells(layoutGrid({ kind: 'modular', x: 0, y: 0, width: 400, height: 300, rows: 2, columns: 2, gutterX: 8, gutterY: 8, margin: 0, variation: 0, seed: 1 }), base);

  it('paints a surface with the cell own fill', () => {
    expect(cellPaint(cell[0], base).fill).toBe(cell[0].fill);
  });

  it('tints a guide rather than filling it, and gives it an edge', () => {
    const paint = cellPaint(cell[0], { ...base, mode: 'guide' });
    expect(paint.fill).not.toBe(cell[0].fill);
    expect(paint.strokeWidth).toBeGreaterThan(0);
    expect(paint.stroke).toBeTruthy();
  });

  it('leaves a wireframe unfilled but drawn', () => {
    const paint = cellPaint(cell[0], { ...base, mode: 'wireframe' });
    expect(paint.fill).toBe('rgba(0,0,0,0)');
    expect(paint.strokeWidth).toBeGreaterThan(0);
  });

  it('lets an author own stroke win over the mode default', () => {
    const styled = { ...base, mode: 'guide' as const, strokeColor: '#00FF00', strokeWidth: 3 };
    const paint = cellPaint(cell[0], styled);
    expect(paint.stroke).toBe('#00FF00');
    expect(paint.strokeWidth).toBe(3);
  });
});

describe('cellLabel', () => {
  const base = defaultStyle();
  const cells = styleCells(layoutGrid({ kind: 'modular', x: 0, y: 0, width: 400, height: 300, rows: 3, columns: 3, gutterX: 8, gutterY: 8, margin: 0, variation: 0, seed: 1 }), base);

  it('names the top row by column', () => {
    const top = cells.filter((c) => c.row === 0).sort((a, b) => a.col - b.col);
    expect(top.map(cellLabel)).toEqual(['C1', 'C2', 'C3']);
  });

  it('names the left column by row', () => {
    const left = cells.filter((c) => c.col === 0 && c.row > 0).sort((a, b) => a.row - b.row);
    expect(left.map(cellLabel)).toEqual(['R2', 'R3']);
  });

  it('leaves the field unlabelled', () => {
    expect(cells.filter((c) => c.row > 0 && c.col > 0).every((c) => cellLabel(c) === null)).toBe(true);
  });
});
