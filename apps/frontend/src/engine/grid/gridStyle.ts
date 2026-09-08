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

/**
 * Named for what you get, not for how it works.
 *
 * "Across" and "By size" were descriptions of the *algorithm* -- across what,
 * and by the size of what? A menu is read once, at the moment of choosing,
 * with no way to try each option but to try each option.
 */
export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  sequence: 'Palette in order',
  scatter: 'Random',
  gradient: 'Ramp across the grid',
  weight: 'Biggest cells darkest',
  alternate: 'Chequerboard',
  solid: 'One colour',
};

/**
 * What a grid is being used *as*.
 *
 * The same recipe answers three different questions, and the answer decides
 * how it should be painted rather than what it contains:
 *
 * - `surface` -- the modules are the artwork. Paint them.
 * - `guide` -- the modules are scaffolding for something laid over them, the
 *   way a column guide sits under a page. Tint, don't fill.
 * - `wireframe` -- only the division of the space matters. Draw the edges.
 *
 * It is a display concern and nothing else: the layout, the palette and the
 * seed are untouched by it, so switching to a guide and back returns exactly
 * the grid you had rather than a re-rolled one.
 */
export type GridDisplayMode = 'surface' | 'guide' | 'wireframe';

export const GRID_DISPLAY_MODES: readonly GridDisplayMode[] = ['surface', 'guide', 'wireframe'];

export const GRID_DISPLAY_LABELS: Record<GridDisplayMode, string> = {
  surface: 'Surface',
  guide: 'Guide',
  wireframe: 'Wireframe',
};

/** What each is *for*, not what it looks like -- the rule `GRID_HINTS` follows. */
export const GRID_DISPLAY_HINTS: Record<GridDisplayMode, string> = {
  surface: 'The modules are the artwork. Palette and shapes apply.',
  guide: 'Scaffolding to lay a composition over. Tinted tracks, hairline edges.',
  wireframe: 'The division of the space alone. Edges, no fill.',
};

/**
 * The guide ink, in one place.
 *
 * One hue at three strengths rather than three unrelated colours: the tint,
 * the hairline and the label are one mark seen at three weights, and picking
 * them separately is how a guide ends up with a red edge round a pink fill.
 * Red because a guide has to lose to whatever is laid over it and still be
 * findable -- the same reason print software has used it for margins for
 * thirty years.
 */
const GUIDE_TINT = 'rgba(239, 68, 68, 0.12)';
const GUIDE_EDGE = 'rgba(239, 68, 68, 0.45)';
const GUIDE_LABEL = '#EF4444';

/** The wireframe's edge: a mid slate that reads on both themes. */
const WIRE_EDGE = '#64748B';

export interface GridStyle {
  /**
   * The shapes a module may take -- and, by how many there are, whether they mix.
   *
   * One entry means every module is that shape; more than one means a seeded
   * draw from exactly those. There was a `shapeMode: 'uniform' | 'mixed'` beside
   * this field and it was a second copy of a fact the list already carries, so
   * the two could disagree and did: `uniform` over three shapes drew the first
   * and silently ignored the other two, and `randomiseRecipe` rolled the mode
   * and the set from separate draws against the same threshold, which produced
   * a "mixed" grid with one shape in it about a quarter of the time.
   *
   * Deriving it cannot disagree with itself, and the two readings coincide
   * exactly rather than approximately: a seeded draw from a set of one has one
   * outcome, so removing the special case changed no grid that had one shape.
   */
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
  /**
   * Display mode:
   * - 'surface': solid or gradient generative tiles (default)
   * - 'guide': architectural layout guide with translucent column tint & hairlines
   * - 'wireframe': structural outlines only
   */
  mode?: GridDisplayMode;
  /** Whether to render track index badges (C1, C2...) */
  showLabels?: boolean;
}

export interface StyledCell extends GridCell {
  index: number;
  shape: CellShape;
  points?: number;
  fill: string;
  radius: number;
}

/**
 * The curated ramps, under the name the grid has always used for them.
 *
 * The list itself moved to `model/colorRamp`, because the general colour picker
 * now offers the same ramps and two copies of a palette set is two palette sets
 * that will drift. Re-exported rather than renamed at every call site: the grid
 * recipes, the panel and the variations picker all say `GRID_PALETTES`, and
 * making them all say something else would be churn in return for nothing.
 */
export { CURATED_PALETTES as GRID_PALETTES } from '../model/colorRamp';
import { CURATED_PALETTES } from '../model/colorRamp';
const GRID_PALETTES = CURATED_PALETTES;

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
    /**
     * A cell with an outline keeps it, and the shape picker does not apply.
     *
     * The picker asks "what shape is a module", and for a ring sector the
     * answer is already decided by the arrangement -- a sector *is* the module.
     * Drawing a star in its place would not be a styled sector, it would be a
     * star sitting in a sector's bounding box, which is the mistake the old
     * radial kind made for its whole life.
     *
     * `rect` is what the shape field carries, because every reader that does
     * not understand outlines falls back to the box, and a box is the honest
     * approximation of one.
     */
    // A set of one draws that one every time, so there is no uniform case left
    // to special-case -- see `GridStyle.shapes`.
    const shape = cell.outline
      ? ('rect' as CellShape)
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

/** How one module is actually painted, once the display mode has had its say. */
export interface CellPaint {
  fill: string;
  stroke?: string;
  strokeWidth: number;
}

/**
 * The paint for one module -- the *only* place display mode is resolved.
 *
 * Both painters call this. They did not: the Konva renderer and the SVG
 * exporter each carried their own copy of the mode branch, down to the same
 * three colour literals typed out twice, which is this codebase's standing
 * defect -- one answer derived in two places, drifting the first time either
 * is edited. A guide that was pink in the file and red on the board would
 * have been nobody's bug until an export went out.
 *
 * A stroke the author has chosen always wins. In `guide` and `wireframe` the
 * edge is the whole drawing, so a grid with no stroke set is given one rather
 * than vanishing -- but a grid that *does* carry a stroke keeps its own,
 * because the mode is a lens over the style and not a replacement for it.
 */
export function cellPaint(cell: StyledCell, style: GridStyle): CellPaint {
  const hasStroke = style.strokeWidth > 0;

  switch (style.mode ?? 'surface') {
    case 'guide':
      return {
        fill: GUIDE_TINT,
        stroke: hasStroke ? style.strokeColor : GUIDE_EDGE,
        strokeWidth: hasStroke ? style.strokeWidth : 1,
      };
    case 'wireframe':
      return {
        // Transparent rather than absent: the module still has to occupy its
        // box, so the label has something to sit against and the silhouette
        // still describes the division of the space.
        fill: 'rgba(0,0,0,0)',
        stroke: hasStroke ? style.strokeColor : WIRE_EDGE,
        strokeWidth: hasStroke ? style.strokeWidth : 1,
      };
    default:
      return {
        fill: cell.fill,
        stroke: hasStroke ? style.strokeColor : undefined,
        strokeWidth: style.strokeWidth,
      };
  }
}

/** The ink a track label is drawn in, so the two painters cannot disagree. */
export function labelInk(style: GridStyle): string {
  return (style.mode ?? 'surface') === 'guide' ? GUIDE_LABEL : WIRE_EDGE;
}

/** Where a label sits inside its module, and how big. Shared by both painters. */
export const LABEL_INSET = 5;
export const LABEL_SIZE = 10;

/**
 * The track label for one module, or nothing.
 *
 * Only the edges are named. Every cell carried a running index before, which
 * on a forty-module grid is forty numbers over the artwork answering a
 * question nobody asked -- the useful fact is which *track* a module is in,
 * and that is what the top row and the left column say. It is also what print
 * software labels, and for the same reason: you count in from an edge.
 *
 * Interior modules return `null` rather than an empty string, so a caller
 * skips them instead of drawing an invisible text node per cell.
 */
export function cellLabel(cell: StyledCell): string | null {
  if (cell.row === 0) return `C${cell.col + 1}`;
  if (cell.col === 0) return `R${cell.row + 1}`;
  return null;
}

/** A style with everything filled in. */
export function defaultStyle(): GridStyle {
  return {
    shapes: ['rect'],
    palette: GRID_PALETTES[0].colors,
    colorMode: 'gradient',
    /**
     * Square, like every other new shape in this app.
     *
     * This was 12, and a rounded module is a *decision* — it says the grid is
     * a set of cards rather than a division of a space. Making it the default
     * meant every grid arrived having made that decision, and a modular grid
     * or a set of thirds laid over a picture is not a set of cards.
     *
     * It is also the same rule `ShapeTool` follows: a new rectangle has square
     * corners, and a grid of rectangles that did not would be the one place
     * the app rounded something nobody asked it to.
     */
    radius: 0,
    strokeColor: 'transparent',
    strokeWidth: 0,
    opacity: 1,
    seed: 1,
    mode: 'surface',
    showLabels: false,
  };
}
