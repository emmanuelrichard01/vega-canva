import {
  GRID_KINDS,
  GRID_LABELS,
  KIND_DEFAULTS,
  layoutGrid,
  rng,
  type GridSpec,
} from './gridLayout';
import {
  CELL_SHAPES,
  COLOR_MODES,
  COLOR_MODE_LABELS,
  GRID_PALETTES,
  styleCells,
  type CellShape,
  type GridStyle,
  type StyledCell,
} from './gridStyle';
import type { ShapeKind } from '../model/schema';
import { fromAnchors } from '../model/pathGeometry';

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
 * The fields one cell contributes to a **shape** node.
 *
 * The one thing left of the old document-writing path, and it earns its keep
 * for exactly one caller: `explodeGrid`, which turns a grid into the loose
 * shapes it draws. Nothing writes cells to the document any more -- a grid node
 * derives its modules on every draw -- so this is a conversion, not a builder.
 *
 * The corner radius comes from the **cell**, not from `style`: `styleCells`
 * clamped it against that cell's own size, and reading the raw value again here
 * would be a second, unclamped answer to one question.
 *
 * Geometry and paint only, never `id`, `zIndex` or `parentId`. Those belong to
 * the document and are the caller's to assign.
 */
export function cellPatch(cell: StyledCell, style: GridStyle): Record<string, unknown> {
  const shape = SHAPE_KIND[cell.shape] ?? SHAPE_KIND.rect;

  /**
   * A cell with an outline becomes a **path**, not a rectangle.
   *
   * Break apart has to hand back what was on the screen. A ring sector broken
   * into rectangles would be a different composition wearing the same colours,
   * and the one gesture whose entire promise is "the same thing, now editable"
   * would be the one that changed it.
   *
   * Closed and unstroked-by-default, matching how the grid drew it.
   */
  if (cell.outline) {
    return {
      type: 'path',
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      rotation: 0,
      opacity: style.opacity,
      // Anchors with no handles: a Bezier path whose every run is straight,
      // which is a polygon. The pen tool, the boolean ops and the direct
      // selection tool all understand it without a special case, so a
      // broken-apart sector is editable the same way anything else is.
      geometry: fromAnchors(cell.outline.map((p) => ({ x: p.x, y: p.y })), true),
      appearance: {
        fill: [{ type: 'solid', color: cell.fill }],
        ...(style.strokeWidth > 0
          ? { stroke: { color: style.strokeColor, width: style.strokeWidth } }
          : {}),
      },
    };
  }

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
  /**
   * Mixed shapes are a strong statement, so they turn up sometimes rather than
   * half the time.
   *
   * One roll, and a second shape that is guaranteed to differ. This used to
   * draw a `shapeMode` and a set of shapes from separate calls against the same
   * threshold -- so a quarter of the time they disagreed -- and the two-shape
   * branch could pick the same shape twice, which is a mix of one.
   */
  const shapes = ((): CellShape[] => {
    const first = pick(CELL_SHAPES);
    if (next() >= 0.25) return [first];
    return [first, pick(CELL_SHAPES.filter((s) => s !== first))];
  })();

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
      shapes,
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
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];

  return Array.from({ length: count }, () => {
    if (mode === 'everything') return randomiseRecipe(recipe, seed());

    if (mode === 'colour') {
      const palette = pick(GRID_PALETTES);
      return {
        // The layout is held *exactly*: the point of the mode is that you have
        // settled the arrangement and are trying colour against it.
        spec: recipe.spec,
        style: {
          ...recipe.style,
          seed: seed(),
          palette: palette.colors,
          colorMode: pick(COLOR_MODES),
          // Corner treatment belongs to how a grid *looks* rather than to its
          // structure, so it varies here rather than under Layout -- and it
          // changes the character of a wall more than a re-scatter does.
          radius: pick([0, 0, 4, 8, 16, 32, 999]),
        },
      };
    }

    /**
     * Layout: the *arrangement*, not merely another shuffle of the same one.
     *
     * Re-seeding alone is a poor offer on half the kinds. A modular grid has no
     * randomness at all, so five re-seeds are five identical tiles; columns and
     * golden are the same. Even where the seed does something — bento, masonry
     * — five draws from one distribution look like five draws from one
     * distribution, which is a picker showing one idea five times.
     *
     * So a layout variant may also move the tracks and the dial. Those are the
     * knobs that change what the grid *is* while leaving it the same system,
     * which is exactly the promise of the mode: still a bento wall, genuinely a
     * different bento wall.
     */
    const base = KIND_DEFAULTS[recipe.spec.kind];
    const drift = (n: number, by: number) =>
      Math.max(1, Math.round(n + (next() - 0.5) * 2 * by));

    return {
      spec: {
        ...recipe.spec,
        seed: seed(),
        rows: drift(recipe.spec.rows, recipe.spec.rows > 2 ? 1 : 0),
        columns: drift(recipe.spec.columns, recipe.spec.columns > 3 ? 2 : 1),
        // Around the kind's own looseness rather than the current setting, so a
        // dial pinned at zero can still be offered something with life in it.
        variation: Math.min(1, Math.max(0, base.variation + (next() - 0.5) * 0.7)),
      },
      style: recipe.style,
    };
  });
}

/**
 * What a candidate *is*, in the few words a tooltip holds.
 *
 * ## Why a thumbnail is not enough on its own
 *
 * Nine grids at sixty pixels are distinguishable but not identifiable. You can
 * see that one is denser and one is rounder; you cannot see that it is a bento
 * wall rather than a modular grid, or that the palette is Ember rather than
 * Dusk, and those are the two facts that decide whether you want it. The tile
 * shows you the composition and this says what you are looking at, which is
 * the same division of labour the system picker upstairs already uses: ten
 * miniatures, and a caption naming the one you are on.
 *
 * It is also the accessible name. "Use variation 3" told a screen reader
 * nothing at all -- nine buttons that differ only by an ordinal are nine
 * buttons you cannot choose between without sight.
 *
 * ## Why the mode decides what is said
 *
 * Colour holds the arrangement exactly, so naming the system on every tile
 * would print the same words nine times and say nothing. The useful sentence
 * is always about what the mode is free to change.
 */
export function describeRecipe(recipe: GridRecipe, mode: VariantMode): string {
  if (mode === 'colour') {
    const named = GRID_PALETTES.find((p) => p.colors.join() === recipe.style.palette.join());
    return `${named?.name ?? 'Custom'} \u00b7 ${COLOR_MODE_LABELS[recipe.style.colorMode]}`;
  }
  // Laid out rather than multiplied: most kinds do not multiply their tracks.
  // See `GridSection`'s module count for the same reasoning at more length.
  const modules = recipeCells(recipe).length;
  return `${GRID_LABELS[recipe.spec.kind]} \u00b7 ${modules} ${modules === 1 ? 'module' : 'modules'}`;
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

