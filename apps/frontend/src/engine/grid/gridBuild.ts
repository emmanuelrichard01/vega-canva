import { layoutGrid, type GridSpec } from './gridLayout';
import { styleCells, type CellShape, type GridStyle, type StyledCell } from './gridStyle';
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
 * Another arrangement, same everything else.
 *
 * Two seeds rather than one, incremented together: the layout's randomness and
 * the palette's are separate questions, and a single "re-roll" that moved both
 * would make it impossible to keep an arrangement you liked while trying
 * colours against it — which is most of what anyone does with a generator.
 */
export function reroll(recipe: GridRecipe, what: 'layout' | 'colour' | 'both'): GridRecipe {
  const layout = what !== 'colour' ? recipe.spec.seed + 1 : recipe.spec.seed;
  const colour = what !== 'layout' ? recipe.style.seed + 1 : recipe.style.seed;
  return {
    spec: { ...recipe.spec, seed: layout },
    style: { ...recipe.style, seed: colour },
  };
}

/**
 * Move and resize a whole grid, keeping its proportions.
 *
 * The transformer scales the *nodes*, which leaves the recipe describing a box
 * the grid no longer occupies — so the next gutter change would snap everything
 * back to where it used to be. Rewriting the spec's box from the group's actual
 * bounds is what keeps the two agreeing.
 */
export function refit(
  recipe: GridRecipe,
  box: { x: number; y: number; width: number; height: number }
): GridRecipe {
  return withSpec(recipe, box);
}
