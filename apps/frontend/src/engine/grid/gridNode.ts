import { layoutGrid, type GridKind, type GridSpec, KIND_DEFAULTS } from './gridLayout';
import { styleCells, CELL_SHAPES, COLOR_MODES, GRID_PALETTES, type StyledCell } from './gridStyle';
import { cellPatch, type GridRecipe } from './gridBuild';

/**
 * A grid node's cells, derived.
 *
 * ## The whole point of the rewrite, in one function
 *
 * Nothing here reads a stored cell position, because none is stored. A grid
 * node holds a box and a recipe; the modules are a *function* of those two,
 * recomputed on every draw the way a connector's points are recomputed from the
 * objects it joins.
 *
 * That is what removes the bug class. Under the old group model the recipe held
 * a box and thirty shape nodes held thirty positions, and keeping them equal
 * was an obligation spread across drag, resize, nudge, duplicate, align, snap
 * and the layers panel — seven chances to drift, and drift is exactly what the
 * gaps did. Two copies of one fact cannot disagree if there is only one copy.
 */

/**
 * The spec to lay out, with the node's box substituted in.
 *
 * `GridSpec` carries its own box because the same type lays out a 96px preview
 * thumbnail, where there is no node to ask. On a node that field is dead
 * weight, and dead weight that *looks* authoritative is how the old model went
 * wrong — so it is overwritten rather than trusted, both here and at the read
 * boundary. Whichever one you happen to read, you get the node's box.
 *
 * Local coordinates, not world: the renderer draws inside a Konva group that is
 * already positioned and rotated, so a cell at `(0, 0)` is the grid's own top
 * left. Laying out in world space would mean re-laying the grid on every move.
 */
export function gridSpecFor(node: { width: number; height: number; grid: GridRecipe }): GridSpec {
  return { ...node.grid.spec, x: 0, y: 0, width: node.width, height: node.height };
}

/** The modules a grid node draws, in its own coordinates. */
export function gridCellsOf(node: { width: number; height: number; grid: GridRecipe }): StyledCell[] {
  return styleCells(layoutGrid(gridSpecFor(node)), node.grid.style);
}

/**
 * The loose shapes a grid draws, for Break apart.
 *
 * The escape hatch that makes "a grid is one object" acceptable rather than
 * limiting: the moment you want to nudge one module or recolour three, you
 * convert, and from then on they are ordinary shapes with no generator behind
 * them. One-way on purpose — re-deriving a recipe from shapes somebody has
 * since edited would either discard their edits or lie about what the recipe
 * produces.
 *
 * World coordinates, because the results are top-level nodes rather than
 * children of the grid's group.
 */
export function explodeGrid(node: {
  x: number;
  y: number;
  width: number;
  height: number;
  grid: GridRecipe;
}): Record<string, unknown>[] {
  return gridCellsOf(node).map((cell) => {
    const patch = cellPatch(cell, node.grid.style);
    return { ...patch, x: node.x + (patch.x as number), y: node.y + (patch.y as number) };
  });
}

// ---------------------------------------------------------------------------
// The read boundary
// ---------------------------------------------------------------------------

const KINDS = new Set<string>(Object.keys(KIND_DEFAULTS));

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function colour(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/**
 * A recipe off the wire, made safe to lay out.
 *
 * Total, like every other normalizer here: any input produces *a* grid. The
 * layout functions divide by track counts and take square roots of box
 * dimensions, so a `columns: 0` or a `width: NaN` arriving from an older
 * document, a partial write or a malicious peer would not throw — it would
 * quietly produce cells at `NaN`, which Konva renders as nothing at all. A grid
 * that silently disappears is the worst of the available failures.
 *
 * The box arguments are the node's, and they win. Whatever box the stored spec
 * claims is discarded here, which is what keeps the two from ever disagreeing.
 */
export function normalizeRecipe(raw: unknown, width: number, height: number): GridRecipe {
  const r = (raw ?? {}) as { spec?: Record<string, unknown>; style?: Record<string, unknown> };
  const spec = r.spec ?? {};
  const style = r.style ?? {};

  const kind = (KINDS.has(spec.kind as string) ? spec.kind : 'modular') as GridKind;
  const defaults = KIND_DEFAULTS[kind];

  const shapes = Array.isArray(style.shapes)
    ? style.shapes.filter((s) => (CELL_SHAPES as readonly string[]).includes(s as string))
    : [];
  const palette = Array.isArray(style.palette)
    ? style.palette.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];

  return {
    spec: {
      kind,
      x: 0,
      y: 0,
      width,
      height,
      // Floored to one track, not to zero. Zero rows is not an empty grid, it
      // is a division by zero.
      rows: clamp(Math.round(num(spec.rows, defaults.rows)), 1, 200),
      columns: clamp(Math.round(num(spec.columns, defaults.columns)), 1, 200),
      gutterX: clamp(num(spec.gutterX, defaults.gutterX), 0, 400),
      gutterY: clamp(num(spec.gutterY, defaults.gutterY), 0, 400),
      margin: clamp(num(spec.margin, 0), 0, 400),
      variation: clamp(num(spec.variation, defaults.variation), 0, 1),
      seed: num(spec.seed, 1),
      // Absent rather than `false`, so a document written before merged rings
      // existed keeps neither the key nor a CRDT field saying "not a ring".
      ...(spec.merged === true ? { merged: true } : null),
      // A full step is a whole module's worth of turn, which lands back where
      // it started -- so that is the far end of the range rather than an
      // arbitrary cap.
      ...(num(spec.stagger, 0) !== 0 ? { stagger: clamp(num(spec.stagger, 0), 0, 1) } : null),
    },
    style: {
      // A document written before shapes carried the mix on their own may still
      // have a `shapeMode` beside them. It is dropped rather than honoured: the
      // only case where it disagreed with the list was `uniform` over several
      // shapes, and reading that as "mix these" is what the person picking them
      // asked for.
      shapes: shapes.length > 0 ? (shapes as GridRecipe['style']['shapes']) : ['rect'],
      palette: palette.length > 0 ? palette : GRID_PALETTES[0].colors,
      colorMode: (COLOR_MODES as readonly string[]).includes(style.colorMode as string)
        ? (style.colorMode as GridRecipe['style']['colorMode'])
        : 'sequence',
      radius: clamp(num(style.radius, 0), 0, 400),
      strokeColor: colour(style.strokeColor, '#111827'),
      strokeWidth: clamp(num(style.strokeWidth, 0), 0, 40),
      opacity: clamp(num(style.opacity, 1), 0, 1),
      seed: num(style.seed, 1),
    },
  };
}
