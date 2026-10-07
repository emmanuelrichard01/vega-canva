import { cameraSystem } from '../../../engine/CameraSystem';
import type { GridRecipe } from '../../../engine/grid/gridBuild';
import { cellAtPoint } from '../../../engine/grid/gridSlotApply';
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
 * Fill a grid with pictures from disk, through the board's own drop path.
 *
 * The drop handler already uploads, places and slots files into the free
 * modules from wherever they land; aiming the drop at a module of this grid
 * makes "fill with images" the same act as dragging a folder onto it.
 */
export function fillGridFromFiles(grid: GridNode): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    let at = { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 };
    search: for (let iy = 1; iy < 6; iy++) {
      for (let ix = 1; ix < 6; ix++) {
        const p = { x: grid.x + (grid.width * ix) / 6, y: grid.y + (grid.height * iy) / 6 };
        if (cellAtPoint(grid, p) !== null) {
          at = p;
          break search;
        }
      }
    }
    const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
    if (!stage) return;
    const data = new DataTransfer();
    files.forEach((f) => data.items.add(f));
    window.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: data,
        clientX: stage.left + at.x * cameraSystem.zoom + cameraSystem.x,
        clientY: stage.top + at.y * cameraSystem.zoom + cameraSystem.y,
        bubbles: true,
        cancelable: true,
      })
    );
  };
  input.click();
}
