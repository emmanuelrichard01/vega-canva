import { nanoid } from 'nanoid';
import { applyGroupPlan, applyNodePatches, deleteNode, doc, groupsMap, lowestZIndex } from '../document';
import { editor } from '../api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { nodesInGroup } from '../model/groupTree';
import { planGridUpdate, recipeCells, type GridRecipe } from './gridBuild';
import { gridBounds, layoutGrid } from './gridLayout';

/**
 * Writing a grid to the board, and re-writing it when the recipe changes.
 *
 * The document side of `gridBuild`, kept apart from it so the arithmetic stays
 * runnable in a test without a CRDT — which is most of what makes a generator
 * this configurable trustworthy at all.
 *
 * Every function here is one transaction. A grid is one act: thirty cells
 * moving because a gutter changed is one thing that happened, and letting it
 * land as thirty updates would put thirty steps in the history and show a peer
 * the grid halfway through re-laying itself.
 */

/** The nodes of a grid, in cell order. */
export function gridMembers(groupId: string): string[] {
  const { objects, groups } = useStore.getState();
  /**
   * Cell order is *ascending* z: cell 0 was created first and so sits lowest.
   *
   * `nodesInGroup` follows the order it is given, and the layers panel gives it
   * front-to-back — which for a grid is exactly backwards, and would silently
   * pair cell 0's geometry with the last node in the grid.
   */
  const order = Object.values(objects)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
    .map((n) => n.id);
  return nodesInGroup(order, objects, groups, groupId);
}

/** The recipe on a group, if it is a grid. */
export function gridRecipe(groupId: string | undefined): GridRecipe | null {
  if (!groupId) return null;
  return useStore.getState().groups[groupId]?.grid ?? null;
}

/**
 * Create a grid, as one group of shapes.
 *
 * Grouped rather than loose, because a grid *is* a set of objects that belong
 * together — that is what makes it a grid rather than thirty rectangles — and
 * because the group is where the recipe lives. Nesting means a grid can then be
 * grouped with other things without losing what it is, which the flat model
 * could not have done.
 *
 * @returns the new group's id.
 */
export function createGrid(recipe: GridRecipe): string | null {
  const cells = recipeCells(recipe);
  if (cells.length === 0) return null;

  const groupId = nanoid();
  const base = lowestZIndex();

  doc.transact(() => {
    // The group first: the nodes about to be created point at it, and a peer
    // observing the transaction should never see a member whose group is
    // missing.
    applyGroupPlan({ nodes: [], groups: [], create: { id: groupId, grid: recipe }, remove: [] });

    cells.forEach((cell, i) => {
      editor.createNode({
        id: nanoid(),
        parentId: groupId,
        // Below whatever is already on the board, ascending within the grid so
        // cell order and stacking order are the same thing. `gridMembers` reads
        // that back, and a grid whose cells were stacked in some other order
        // would re-lay itself scrambled.
        zIndex: base - cells.length + i,
        ...planGridUpdate(recipe, []).create[i],
      } as never);
    });
  });

  return groupId;
}

/**
 * Re-lay an existing grid from a changed recipe.
 *
 * Reconciled rather than regenerated — see `planGridUpdate`. Nodes are matched
 * by cell index, so one more column updates what is there and adds three,
 * rather than deleting everything and starting over: recreating would break
 * connectors bound to those ids and turn one adjustment into thirty deletions.
 */
export function relayoutGrid(groupId: string, recipe: GridRecipe): void {
  const existing = gridMembers(groupId);
  const plan = planGridUpdate(recipe, existing);
  const base = lowestZIndex();

  doc.transact(() => {
    groupsMap.set(groupId, { ...(groupsMap.get(groupId) ?? { id: groupId }), grid: recipe });

    if (plan.update.length > 0) applyNodePatches(plan.update);

    plan.create.forEach((node, i) => {
      editor.createNode({
        id: nanoid(),
        parentId: groupId,
        zIndex: base - plan.create.length + i,
        ...node,
      } as never);
    });

    for (const id of plan.remove) deleteNode(id);
  });
}

/**
 * Re-read the recipe's box from where the grid actually sits.
 *
 * The transformer scales the *nodes*; the recipe still describes the box the
 * grid used to occupy, so the next gutter change would snap everything back.
 * Called when a grid group has been moved or resized, which is the only time
 * the two can disagree.
 */
export function refitGrid(groupId: string): GridRecipe | null {
  const recipe = gridRecipe(groupId);
  if (!recipe) return null;
  const { objects } = useStore.getState();
  const nodes = gridMembers(groupId).map((id) => objects[id]).filter(Boolean);
  if (nodes.length === 0) return null;

  const x = Math.min(...nodes.map((n) => n.x));
  const y = Math.min(...nodes.map((n) => n.y));
  const right = Math.max(...nodes.map((n) => n.x + (n.width || 0)));
  const bottom = Math.max(...nodes.map((n) => n.y + (n.height || 0)));

  // The recipe's box includes its margin; the cells sit inside it. Adding the
  // margin back is what keeps a refit from shrinking the grid by 2×margin on
  // every pass — a slow leak that only shows after the third adjustment.
  const m = recipe.spec.margin;
  return {
    ...recipe,
    spec: { ...recipe.spec, x: x - m, y: y - m, width: right - x + m * 2, height: bottom - y + m * 2 },
  };
}

/** The box a recipe's cells will occupy, for a live preview. */
export function previewBounds(recipe: GridRecipe) {
  return gridBounds(layoutGrid(recipe.spec));
}
