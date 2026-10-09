import { switchKind, withSpec, type GridRecipe } from '../../../engine/grid/gridBuild';
import { setGridRecipe } from '../../../engine/grid/gridApply';
import type { GridPreset } from '../../../engine/grid/gridPresets';
import { writePatches } from '../../panel/grammar/previewSession';
import { freeCellsFrom } from '../../../engine/grid/gridSlotApply';
import { placeFiles } from '../../../hooks/useCanvasDropZone';
import type { GridNode } from '../../../engine/model/schema';

/**
 * What the across-count is called in this kind, or null when the kind derives
 * its own: a dial has spokes, a spiral has steps, a manuscript has neither.
 */
export function trackLabel(recipe: GridRecipe): string | null {
  const { kind } = recipe.spec;
  if (kind === 'manuscript' || kind === 'baseline') return null;
  if (kind === 'radial' && recipe.spec.merged === true) return null;
  if (kind === 'radial' || kind === 'orbit') return 'Spokes';
  if (kind === 'golden') return 'Steps';
  return 'Columns';
}

/**
 * Fill a grid with pictures from disk, through the board's own placing path.
 *
 * `placeFiles` uploads, places and slots the files into the free modules from
 * the first free one on, the same act as dragging a folder onto the grid.
 */
export function fillGridFromFiles(grid: GridNode): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    void placeFiles(files, { gridId: grid.id, startCell: freeCellsFrom(grid.id, 0)[0] ?? 0 });
  };
  input.click();
}

export const MIN_TRACKS = 1;
export const MAX_TRACKS = 24;
export const MAX_GUTTER = 200;
export const MAX_MARGIN = 400;

/** The kinds with real rows and columns: the ones whose rows can grow to fit their content. */
const HUGGABLE = new Set(['columns', 'modular']);

export const canHug = (recipe: GridRecipe): boolean => HUGGABLE.has(recipe.spec.kind);

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

export type LayoutField = 'tracks' | 'gutter' | 'margin';

/** One layout field changed, clamped. Gutter sets both axes; the seed and everything else is untouched. */
export function withLayoutField(recipe: GridRecipe, field: LayoutField, value: number): GridRecipe {
  if (field === 'tracks') return withSpec(recipe, { columns: clampInt(value, MIN_TRACKS, MAX_TRACKS) });
  if (field === 'gutter') {
    const g = clampInt(value, 0, MAX_GUTTER);
    return withSpec(recipe, { gutterX: g, gutterY: g });
  }
  // A uniform margin supersedes any per-side padding.
  const spec = { ...recipe.spec };
  delete spec.padding;
  return withSpec({ ...recipe, spec }, { margin: clampInt(value, 0, MAX_MARGIN) });
}

/** Rows hug their content, or go back to fixed. Null when the kind cannot hug. */
export function withFitContent(recipe: GridRecipe, on: boolean): GridRecipe | null {
  if (!canHug(recipe)) return null;
  return withSpec(recipe, { sizing: on ? 'hug' : undefined });
}

/** A named grid: the kind first (it brings its defaults), then the preset's own numbers. */
export function withPreset(recipe: GridRecipe, preset: GridPreset): GridRecipe {
  return withSpec(switchKind(recipe, preset.kind), preset.patch);
}

/**
 * Write a recipe from a control. A settled value is one undo step; an
 * intermediate scrub value previews on the board and leaves no history.
 */
export function writeGridRecipe(nodeId: string, recipe: GridRecipe, commit: boolean): void {
  if (commit) {
    setGridRecipe(nodeId, recipe);
    return;
  }
  writePatches([{ id: nodeId, changes: { grid: recipe } }]);
}
