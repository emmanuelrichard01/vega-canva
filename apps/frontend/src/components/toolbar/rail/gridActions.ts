import type { GridRecipe } from '../../../engine/grid/gridBuild';
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
