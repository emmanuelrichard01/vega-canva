import { describe, expect, it } from 'vitest';
import { defaultSpec, layoutGrid, type GridCell } from './gridLayout';
import {
  assignColors,
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
  it('gives every cell one shape when uniform', () => {
    const styled = styleCells(grid(), style({ shapeMode: 'uniform', shapes: ['ellipse', 'star'] }));
    expect(new Set(styled.map((c) => c.shape))).toEqual(new Set(['ellipse']));
  });

  it('draws only from the chosen set when mixed', () => {
    // "Mixed" means *these three mixed*, not a lucky dip — which is the
    // difference between a control and a slot machine.
    const chosen = ['rect', 'hexagon'] as const;
    const styled = styleCells(grid(5, 5), style({ shapeMode: 'mixed', shapes: [...chosen], seed: 8 }));
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
