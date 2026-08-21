import { GRID_KINDS, KIND_DEFAULTS, layoutGrid, rng, type GridSpec } from './gridLayout';
import {
  CELL_SHAPES,
  COLOR_MODES,
  GRID_PALETTES,
  styleCells,
  type CellShape,
  type GridStyle,
  type StyledCell,
} from './gridStyle';
import type { ShapeKind } from '../model/schema';

/**
 * A grid, as objects on the board.
 *
 * ## Why the recipe is kept
 *
 * A generator that hands you thirty rectangles and forgets what it was doing
 * is a one-shot. Every real question about a grid arrives *after* you have
 * looked at it — one more column, a tighter gutter, that palette instead of
 * this one — and answering any of them by deleting and regenerating loses
 * every edit you made in the meantime and every id that anything else pointed
 * at.
 *
 * So the recipe lives on the group the grid made, in the document, where it
 * syncs and undoes with everything else. A collaborator opening the board
 * finds a grid they can still adjust rather than a pile of shapes.
 *
 * ## Reconciliation, not regeneration
 *
 * Changing a spec re-lays the grid **onto the objects that already exist**.
 * Nodes are matched by cell index, so going from nine cells to twelve updates
 * nine and creates three, rather than deleting nine and creating twelve. That
 * matters for more than tidiness: recreating them would break connectors bound
 * to those ids, drop anything clipped inside them, and turn one adjustment
 * into thirty deletions in the history.
 */

export interface GridRecipe {
  spec: GridSpec;
  style: GridStyle;
}

/** How a cell shape maps onto the board's own shape kinds. */
const SHAPE_KIND: Record<CellShape, { kind: ShapeKind; points?: number }> = {
  rect: { kind: 'rect' },
  ellipse: { kind: 'ellipse' },
  triangle: { kind: 'polygon', points: 3 },
  diamond: { kind: 'polygon', points: 4 },
  hexagon: { kind: 'polygon', points: 6 },
  star: { kind: 'star', points: 5 },
};

/**
 * The board geometry a cell becomes.
 *
 * Exported so anything that has to *draw* a cell — the variations picker, most
 * of all — reads the same mapping the document write does. A preview that
 * built its own idea of what a "hexagon" cell looks like would be a second
 * answer to a question with one, and the picker would offer arrangements the
 * canvas then declined to produce.
 */
export function cellGeometry(cell: StyledCell): { kind: ShapeKind; points?: number } {
  return SHAPE_KIND[cell.shape] ?? SHAPE_KIND.rect;
}

/** The cells a recipe describes, laid out and styled. */
export function recipeCells(recipe: GridRecipe): StyledCell[] {
  return styleCells(layoutGrid(recipe.spec), recipe.style);
}

/**
 * The fields one cell contributes to a node.
 *
 * The corner radius comes from the **cell**, not from `style`: `styleCells`
 * clamped it against that cell's own size, and reading the raw value again
 * here would be a second, unclamped answer to one question. `style` supplies
 * only what is uniform across the grid.
 *
 * Geometry and paint only — never `id`, `zIndex` or `parentId`. Those belong to
 * the document and are the caller's to assign; a builder that set them would
 * make re-laying a grid silently restack it, and moving the grid in the layers
 * panel would then be undone by the next gutter change.
 */
export function cellPatch(cell: StyledCell, style: GridStyle): Record<string, unknown> {
  const shape = SHAPE_KIND[cell.shape] ?? SHAPE_KIND.rect;
  return {
    type: 'shape',
    x: cell.x,
    y: cell.y,
    width: cell.width,
    height: cell.height,
    rotation: 0,
    opacity: style.opacity,
    geometry: { kind: shape.kind, ...(shape.points ? { points: shape.points } : {}) },
    appearance: {
      fill: [{ type: 'solid', color: cell.fill }],
      // A zero-width stroke is not a thin stroke, it is no stroke — and
      // writing one anyway leaves a `stroke` block that the properties panel
      // then shows as present with a width of nothing.
      ...(style.strokeWidth > 0
        ? { stroke: { color: style.strokeColor, width: style.strokeWidth } }
        : {}),
      // Only rectangles have corners to round. Setting it on an ellipse is
      // harmless and confusing: the control appears to do nothing.
      ...(shape.kind === 'rect' ? { cornerRadius: cell.radius } : {}),
    },
  };
}

export interface GridUpdate {
  /** Cell patches for nodes that already exist, keyed by node id. */
  update: { id: string; changes: Record<string, unknown> }[];
  /** Cells with no node yet, in cell order. The caller assigns ids. */
  create: Record<string, unknown>[];
  /** Nodes whose cell no longer exists. */
  remove: string[];
}

/**
 * Re-lay a recipe onto the nodes it already made.
 *
 * @param existing The grid's current member ids, **in cell order**. The caller
 *   holds that order because it is the document's stacking order, and rebuilding
 *   it from geometry would guess wrong the moment anyone moved one cell.
 */
export function planGridUpdate(recipe: GridRecipe, existing: readonly string[]): GridUpdate {
  const cells = recipeCells(recipe);

  return {
    update: cells
      .slice(0, existing.length)
      .map((cell, i) => ({ id: existing[i], changes: cellPatch(cell, recipe.style) })),
    create: cells.slice(existing.length).map((cell) => cellPatch(cell, recipe.style)),
    remove: existing.slice(cells.length),
  };
}

/**
 * Change one field of a recipe's spec, and re-roll nothing else.
 *
 * Written out rather than left to callers spreading objects, because a spread
 * that forgets to carry `seed` re-rolls every random draw in the grid — and it
 * does so *invisibly*, since the change the user asked for also happened.
 */
export function withSpec(recipe: GridRecipe, patch: Partial<GridSpec>): GridRecipe {
  return { ...recipe, spec: { ...recipe.spec, ...patch } };
}

export function withStyle(recipe: GridRecipe, patch: Partial<GridStyle>): GridRecipe {
  return { ...recipe, style: { ...recipe.style, ...patch } };
}

/**
 * A different composition entirely, from one draw.
 *
 * ## Why this is not just a new seed
 *
 * A new seed gives another arrangement *of the same system*. That is the right
 * question once you have decided what you are making. Before that, the useful
 * one is broader -- what would this look like as a dial, or a cascade, or a
 * card wall -- and answering it by hand means changing the kind, then the
 * tracks it wants, then the gutters, then finding a palette. Four decisions to
 * see one idea.
 *
 * So this makes all four at once, and stays *inside the ranges that look
 * deliberate*: tracks come from the kind's own defaults with a small jitter
 * rather than a uniform draw, gutters are picked from a spacing scale rather
 * than any integer, and the palette is one of the shipped ramps. A randomiser
 * that produces a seventeen-column grid with a nineteen-pixel gutter is a
 * randomiser people press once.
 *
 * The box is untouched: this is about what fills the space, not where it is.
 */
export function randomiseRecipe(recipe: GridRecipe, seed: number): GridRecipe {
  const next = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];

  const kind = pick(GRID_KINDS);
  const base = KIND_DEFAULTS[kind];
  // Around the kind's own number rather than an arbitrary one, so a dial still
  // gets a dozen spokes and a golden spiral still gets about five squares.
  const jitter = (n: number, by: number) => Math.max(1, Math.round(n + (next() - 0.5) * 2 * by));
  const gutter = pick([0, 4, 8, 12, 16, 24, 32]);
  const palette = pick(GRID_PALETTES);

  return {
    spec: {
      ...recipe.spec,
      kind,
      rows: jitter(base.rows, base.rows > 2 ? 1 : 0),
      columns: jitter(base.columns, base.columns > 4 ? 2 : 1),
      gutterX: gutter,
      // Matching more often than not: two different gutters is a deliberate
      // choice, and a randomiser that made it every time would look careless.
      gutterY: next() < 0.7 ? gutter : pick([0, 4, 8, 12, 16, 24, 32]),
      variation: Math.min(1, Math.max(0, base.variation + (next() - 0.5) * 0.5)),
      seed: Math.floor(next() * 10000),
    },
    style: {
      ...recipe.style,
      palette: palette.colors,
      colorMode: pick(COLOR_MODES.filter((m) => m !== 'solid')),
      // Mixed shapes are a strong statement, so they turn up sometimes rather
      // than half the time.
      shapeMode: next() < 0.25 ? 'mixed' : 'uniform',
      shapes: next() < 0.25
        ? ([pick(CELL_SHAPES), pick(CELL_SHAPES)] as CellShape[])
        : ([pick(CELL_SHAPES)] as CellShape[]),
      radius: pick([0, 0, 4, 8, 12, 24, 999]),
      seed: Math.floor(next() * 10000),
    },
  };
}

/** What a set of candidate variations is allowed to change. */
export type VariantMode = 'arrangement' | 'colour' | 'everything';

export const VARIANT_MODES: readonly VariantMode[] = ['arrangement', 'colour', 'everything'];

export const VARIANT_LABELS: Record<VariantMode, string> = {
  arrangement: 'Layout',
  colour: 'Colour',
  everything: 'Anything',
};

/**
 * Candidate grids to choose between, rather than one to accept blind.
 *
 * ## Why a set and not a button
 *
 * Re-rolling was four buttons that each committed a change you could not see
 * until it had happened. That is a slot machine, and it has the failure every
 * slot machine has: press twice and the arrangement you liked is gone. The only
 * way back was undo, which on a thirty-cell grid is a coarse instrument aimed
 * at the wrong thing.
 *
 * Generating several and showing them is the whole fix. You compare instead of
 * gambling, what you are on stays on screen while you look, and nothing is
 * written until you pick. It also makes the three modes legible: what varies
 * between the tiles *is* what the mode changes, which no amount of labelling a
 * button could have said as clearly.
 *
 * Seeds come from one stream rather than by incrementing, so the tiles differ
 * from each other as much as from the original. Five consecutive seeds would be
 * five near-identical thumbnails and a picker worth nothing.
 */
export function variantsOf(
  recipe: GridRecipe,
  mode: VariantMode,
  salt: number,
  count = 5
): GridRecipe[] {
  const next = rng(salt);
  const seed = () => Math.floor(next() * 100000);

  return Array.from({ length: count }, () => {
    if (mode === 'everything') return randomiseRecipe(recipe, seed());
    if (mode === 'colour') {
      const palette = GRID_PALETTES[Math.floor(next() * GRID_PALETTES.length)];
      return {
        // The layout is held *exactly*, which is the point of the mode: you
        // have settled the arrangement and you are trying colour against it.
        spec: recipe.spec,
        style: {
          ...recipe.style,
          seed: seed(),
          palette: palette.colors,
          colorMode: COLOR_MODES[Math.floor(next() * COLOR_MODES.length)],
        },
      };
    }
    // Layout only: the palette is held, so the tiles differ in shape alone.
    return { spec: { ...recipe.spec, seed: seed() }, style: recipe.style };
  });
}

/**
 * Bring a kind's own track counts with it when the kind changes.
 *
 * See `KIND_DEFAULTS` for why: the same two fields mean twelve spokes to a dial
 * and three modules to a modular grid, so carrying the old numbers across shows
 * most kinds at their worst.
 */
export function switchKind(recipe: GridRecipe, kind: GridSpec['kind']): GridRecipe {
  return withSpec(recipe, { kind, ...KIND_DEFAULTS[kind] });
}

/** Ignore differences below this many world units when deciding if a grid moved. */
export const MOVED_EPSILON = 0.5;

export interface Box { x: number; y: number; width: number; height: number }

/**
 * Carry a move or a resize of the objects back into the recipe's box.
 *
 * ## Why this compares rather than measures
 *
 * The obvious implementation reads the members' bounding box and calls that the
 * grid's box. It is wrong for every layout whose cells do not fill the box they
 * were given — manuscript stands its block in air, radial leaves the corners
 * empty, masonry can fall short — because the measured box is then *smaller
 * than the spec's*, and writing it back shrinks the grid. Every subsequent
 * adjustment shrinks it again, so changing the palette four times walks the
 * grid quietly in from its own edges.
 *
 * So this asks a different question: not "where is the grid" but "what did the
 * user do to it". `expected` is where the recipe says its cells belong;
 * `actual` is where they are. The difference between them *is* the transform
 * the transformer applied, and applying that same transform to the box that
 * produced them is exact for every layout, including the ones that leave slack.
 *
 * An untouched grid yields the identity and the recipe comes back unchanged,
 * which is the property the measuring version could not have.
 */
export function refitBox(recipe: GridRecipe, expected: Box | null, actual: Box | null): GridRecipe {
  if (!expected || !actual) return recipe;

  const sx = expected.width > MOVED_EPSILON ? actual.width / expected.width : 1;
  const sy = expected.height > MOVED_EPSILON ? actual.height / expected.height : 1;
  const dx = actual.x - expected.x;
  const dy = actual.y - expected.y;

  const still =
    Math.abs(dx) < MOVED_EPSILON &&
    Math.abs(dy) < MOVED_EPSILON &&
    Math.abs(sx - 1) * expected.width < MOVED_EPSILON &&
    Math.abs(sy - 1) * expected.height < MOVED_EPSILON;
  if (still) return recipe;

  // The same affine the cells underwent, applied to the box that produced them.
  return withSpec(recipe, {
    x: (recipe.spec.x - expected.x) * sx + actual.x,
    y: (recipe.spec.y - expected.y) * sy + actual.y,
    width: recipe.spec.width * sx,
    height: recipe.spec.height * sy,
  });
}
