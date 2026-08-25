import { nanoid } from 'nanoid';
import { deleteNode, doc, nextZIndex, updateNode } from '../document';
import { editor } from '../api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { explodeGrid } from './gridNode';
import type { GridRecipe } from './gridBuild';
import type { AnyNode, GridNode } from '../model/schema';

/**
 * Putting a grid on the board, and changing one that is already there.
 *
 * ## What this file used to be
 *
 * Two hundred lines reconciling a group of loose shape nodes against a recipe:
 * `gridMembers` recovering cell order out of stacking order, `planGridUpdate`
 * pairing cell *n* with member *n*, `refitGrid` measuring where the members had
 * drifted to, `resizeGridTo` dividing a measured before-box by a measured
 * after-box to recover a scale the transformer had already applied. Every one
 * of those existed to hold two copies of one fact together, and every one of
 * them was a place they could come apart.
 *
 * A grid is now a single node whose modules are derived from its own box. There
 * is nothing to reconcile, so there is no reconciler. Changing a grid is one
 * write of one field; moving one is the same move every other object gets.
 */

/** The recipe on a node, if it is a grid. */
export function gridRecipe(nodeId: string | undefined): GridRecipe | null {
  if (!nodeId) return null;
  const node = useStore.getState().objects[nodeId];
  return node?.type === 'grid' ? node.grid : null;
}

/**
 * The grid the selection names, if it names exactly one.
 *
 * Deliberately strict about the multi-select case: with two grids selected the
 * panel would have to either edit both or pick one, and both answers are
 * surprising. Showing no grid controls is the honest third option.
 */
export function gridNodeOf(nodes: readonly AnyNode[]): GridNode | null {
  const grids = nodes.filter((n): n is GridNode => n.type === 'grid');
  return grids.length === 1 && nodes.length === 1 ? grids[0] : null;
}

/**
 * Draw a grid.
 *
 * The box the drag described becomes the node's box, unchanged. Under the group
 * model this was the first place the two copies diverged: the recipe was given
 * the drawn box, the cells were laid out inside it, and the *nodes* then
 * occupied whatever sub-box those cells happened to fill — so a manuscript or
 * radial grid was born already disagreeing with itself.
 */
export function createGrid(
  box: { x: number; y: number; width: number; height: number },
  recipe: GridRecipe
): string | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const id = nanoid();
  editor.createNode({
    id,
    type: 'grid',
    ...box,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: nextZIndex(),
    // Stored with the node's box in it so an inspector or an export reads
    // something true. Nothing depends on it: `gridSpecFor` substitutes the
    // node's box on every draw, and the read boundary overwrites it on every
    // load, so the field cannot drift into being wrong.
    grid: { ...recipe, spec: { ...recipe.spec, x: 0, y: 0, width: box.width, height: box.height } },
  } as never);
  return id;
}

/**
 * Change a grid's recipe.
 *
 * One field, one write, one history step, whatever it was that changed --
 * a palette, a gutter, the whole system. The group version of this touched
 * thirty nodes, created and deleted some of them, and had to keep their
 * stacking order in step with their cell order because that was the only record
 * of which node was which cell.
 */
export function setGridRecipe(nodeId: string, recipe: GridRecipe): void {
  const node = useStore.getState().objects[nodeId];
  if (node?.type !== 'grid') return;
  updateNode(nodeId, {
    grid: { ...recipe, spec: { ...recipe.spec, x: 0, y: 0, width: node.width, height: node.height } },
  });
}

/**
 * Turn a grid into the shapes it draws.
 *
 * The escape hatch that makes a grid being one object a trade rather than a
 * limitation: a generator is the right thing right up until you want to move
 * one module, and then it is exactly the wrong thing. Converting hands back
 * ordinary shapes with no generator behind them.
 *
 * One transaction, and the grid is removed inside it. A peer that saw the
 * shapes arrive before the grid left would briefly see the composition twice.
 *
 * @returns the ids of the new shapes, for selecting the result.
 */
export function breakApartGrid(nodeId: string): string[] {
  const node = useStore.getState().objects[nodeId];
  if (node?.type !== 'grid') return [];

  const patches = explodeGrid(node);
  if (patches.length === 0) return [];
  const ids = patches.map(() => nanoid());
  const base = nextZIndex();

  doc.transact(() => {
    patches.forEach((patch, i) => {
      editor.createNode({
        id: ids[i],
        // The grid's own placement carries over: a broken-apart grid that
        // jumped out of its frame or landed on top of the stack would be a
        // second thing the command did.
        parentId: node.parentId,
        frameId: node.frameId,
        // Ascending, so the shapes keep the order the modules were drawn in.
        zIndex: base + i,
        ...patch,
      } as never);
    });
    deleteNode(nodeId);
  });

  return ids;
}
