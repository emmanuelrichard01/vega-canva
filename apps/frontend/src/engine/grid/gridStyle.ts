import { rng, type GridCell } from './gridLayout';

/**
 * What fills the cells: shape, colour, corner, stroke.
 *
 * ## Why this is separate from the layout
 *
 * They change on completely different rhythms. You settle a layout once and
 * then try eight palettes against it; or you keep a palette and try the layout
 * five ways. Computing both from one function would mean re-rolling one to
 * change the other, which is the single most annoying thing a generator can do.
 *
 * Both halves are pure and both are seeded, so a grid is fully described by two
 * small records — and "give me another" is an increment rather than a shrug.
 */

export type CellShape = 'rect' | 'ellipse' | 'triangle' | 'hexagon' | 'star' | 'diamond';

export const CELL_SHAPES: readonly CellShape[] = ['rect', 'ellipse', 'triangle', 'hexagon', 'star', 'diamond'];

export const SHAPE_LABELS: Record<CellShape, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  hexagon: 'Hexagon',
  star: 'Star',
  diamond: 'Diamond',
};

/**
 * How colour is handed out across the cells.
 *
 * Four rules rather than one, because they answer different questions and the
 * one everybody implements first — cycle through the palette — is the one that
 * looks worst on a grid, since it produces diagonal stripes on any layout whose
 * row length is a multiple of the palette length.
 */
export type ColorMode =
  /** Palette order, cell by cell. Predictable, and stripes on a regular grid. */
  | 'sequence'
  /** Seeded scatter, never repeating a colour next to itself. */
  | 'scatter'
  /** Palette ramped across the grid's diagonal. */
  | 'gradient'
  /** Palette ramped by cell *area*, so the biggest module leads. */
  | 'weight'
  /** Two colours alternating like a chequerboard. */
  | 'alternate'
  /** One colour for everything. */
  | 'solid';

export const COLOR_MODES: readonly ColorMode[] = ['sequence', 'scatter', 'gradient', 'weight', 'alternate', 'solid'];

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  sequence: 'In order',
  scatter: 'Scattered',
  gradient: 'Across',
  weight: 'By size',
  alternate: 'Alternating',
  solid: 'One colour',
};

export interface GridStyle {
  /** Every shape, or a seeded mix drawn from `shapes`. */
  shapeMode: 'uniform' | 'mixed';
  shapes: CellShape[];
  palette: string[];
  colorMode: ColorMode;
  /** Corner radius in px, applied to the shapes that have corners. */
  radius: number;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  /** Drives every seeded draw here, independently of the layout's seed. */
  seed: number;
}

export interface StyledCell extends GridCell {
  index: number;
  shape: CellShape;
  points?: number;
  fill: string;
  radius: number;
}

/**
 * Palettes worth shipping.
 *
 * A generator whose default output is six greys is a generator nobody uses
 * twice, and "pick your own colours" as the only option is a blank page at the
 * exact moment someone wanted a shortcut. These are ordered light-to-dark
 * within each set so the `gradient` and `weight` modes ramp rather than
 * jitter — which is the property that makes a palette usable as a ramp at all,
 * and the one a random assortment of nice colours does not have.
 */
export const GRID_PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: 'ember', name: 'Ember', colors: ['#FFF1E0', '#FFD9A8', '#FFAE5C', '#F97316', '#C2410C', '#7C2D12'] },
  { id: 'tide', name: 'Tide', colors: ['#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0284C7', '#075985'] },
  { id: 'moss', name: 'Moss', colors: ['#ECFDF5', '#BBF7D0', '#86EFAC', '#34D399', '#059669', '#065F46'] },
  { id: 'orchid', name: 'Orchid', colors: ['#FAF5FF', '#E9D5FF', '#D8B4FE', '#A855F7', '#7E22CE', '#581C87'] },
  { id: 'clay', name: 'Clay', colors: ['#FAF7F2', '#EADDC8', '#D6BFA0', '#B79268', '#8A6642', '#5B4028'] },
  { id: 'graphite', name: 'Graphite', colors: ['#F8FAFC', '#E2E8F0', '#CBD5E1', '#94A3B8', '#475569', '#1E293B'] },
  { id: 'punch', name: 'Punch', colors: ['#FDE68A', '#FCA5A5', '#F472B6', '#818CF8', '#22D3EE', '#4ADE80'] },
];

/**
 * Which colour each cell takes.
 *
 * Returned as a list rather than assigned inline, because `scatter` needs to
 * know what it gave the *previous* cell and `gradient` needs the grid's extent
 * — neither of which a per-cell function can see.
 */
export function assignColors(cells: readonly GridCell[], style: GridStyle): string[] {
  const palette = style.palette.length > 0 ? style.palette : ['#94A3B8'];
  const n = palette.length;
  const next = rng(style.seed);

  if (style.colorMode === 'solid') return cells.map(() => palette[0]);
  if (style.colorMode === 'sequence') return cells.map((_, i) => palette[i % n]);
  if (style.colorMode === 'alternate') {
    // Chequerboard rather than "every other cell in the list", which on a grid
    // of even width produces vertical stripes instead of a chequer.
    return cells.map((c) => palette[(c.row + c.col) % Math.min(2, n)]);
  }

  if (style.colorMode === 'weight') {
    return cells.map((c) => palette[Math.min(n - 1, Math.floor(c.weight * n))]);
  }

  if (style.colorMode === 'gradient') {
    const xs = cells.map((c) => c.x + c.y);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const span = hi - lo || 1;
    return cells.map((c) => palette[Math.min(n - 1, Math.floor(((c.x + c.y - lo) / span) * n))]);
  }

  // Scatter: never the same colour twice running, which is the difference
  // between a scatter that reads as deliberate and one that reads as a bug.
  let last = -1;
  return cells.map(() => {
    if (n === 1) return palette[0];
    let pick = Math.floor(next() * n);
    if (pick === last) pick = (pick + 1) % n;
    last = pick;
    return palette[pick];
  });
}

/** How much of a block's short side a corner radius may claim. See `styleCells`. */
export const MAX_ROUNDING = 1 / 3;

/** Star and polygon need a point count; the rest are shapes on their own. */
const POINTS: Partial<Record<CellShape, number>> = {
  triangle: 3,
  diamond: 4,
  hexagon: 6,
  star: 5,
};

/**
 * Everything a cell needs to become an object.
 *
 * Shapes are drawn from the chosen set rather than from all of them, so "mixed"
 * means *these three mixed* rather than a lucky dip — which is the difference
 * between a control and a slot machine.
 */
export function styleCells(cells: readonly GridCell[], style: GridStyle): StyledCell[] {
  const colors = assignColors(cells, style);
  const shapes = style.shapes.length > 0 ? style.shapes : (['rect'] as CellShape[]);
  const next = rng(style.seed ^ 0x5f3759df);

  return cells.map((cell, index) => {
    const shape = style.shapeMode === 'uniform'
      ? shapes[0]
      : shapes[Math.floor(next() * shapes.length)];
    return {
      ...cell,
      index,
      shape,
      points: POINTS[shape],
      fill: colors[index],
      /**
       * Rounded, never round.
       *
       * Clamping at half the cell lets the radius turn a small block into a
       * circle -- which is what a 12px radius does to a 20px cell, and why a
       * ring of blocks came out looking like a ring of dots. A third of the
       * short side is as far as a corner can go and still read as a corner.
       *
       * Nothing is lost by refusing the rest: a grid of circles is a grid of
       * **ellipses**, and that is a shape you pick above, not a radius you
       * drive a rectangle into.
       */
      radius: Math.min(style.radius, Math.min(cell.width, cell.height) * MAX_ROUNDING),
    };
  });
}

/** A style with everything filled in. */
export function defaultStyle(): GridStyle {
  return {
    shapeMode: 'uniform',
    shapes: ['rect'],
    palette: GRID_PALETTES[0].colors,
    colorMode: 'gradient',
    radius: 12,
    strokeColor: 'transparent',
    strokeWidth: 0,
    opacity: 1,
    seed: 1,
  };
}
