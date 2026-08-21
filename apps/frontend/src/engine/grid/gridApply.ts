import { nanoid } from 'nanoid';
import { applyGroupPlan, applyNodePatches, deleteNode, doc, groupsMap, nextZIndex } from '../document';
import { editor } from '../api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { nodesInGroup } from '../model/groupTree';
import {
  cellPatch,
  MOVED_EPSILON,
  planGridUpdate,
  recipeCells,
  refitBox,
  type GridRecipe,
} from './gridBuild';
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

/**
 * The nodes of a grid, in cell order.
 *
 * ## Why the order matters so much
 *
 * `planGridUpdate` pairs cell *n* with member *n*. Get the order wrong and a
 * gutter change does not adjust the grid, it shuffles it — every cell takes
 * some other cell's geometry, once, invisibly, and there is no way back but
 * undo.
 *
 * Ascending z is the order, because that is the order the cells were created
 * in. `nodesInGroup` follows whatever order it is handed, and the layers panel
 * hands it front-to-back — which for a grid is exactly backwards.
 */
export function gridMembers(groupId: string): string[] {
  const { objects, groups } = useStore.getState();
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

/** The box a set of nodes occupies. */
function boundsOf(ids: readonly string[]) {
  const { objects } = useStore.getState();
  const nodes = ids.map((id) => objects[id]).filter(Boolean);
  if (nodes.length === 0) return null;
  const x = Math.min(...nodes.map((n) => n.x));
  const y = Math.min(...nodes.map((n) => n.y));
  const right = Math.max(...nodes.map((n) => n.x + (n.width || 0)));
  const bottom = Math.max(...nodes.map((n) => n.y + (n.height || 0)));
  return { x, y, width: right - x, height: bottom - y };
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
 * @returns the new group's id and its members, for selecting the result.
 */
export function createGrid(recipe: GridRecipe): { groupId: string; ids: string[] } | null {
  // Laid out **once**. The first version called `planGridUpdate` inside the
  // loop, which recomputed the whole grid for every cell in it — thirty
  // layouts to place thirty rectangles.
  const cells = recipeCells(recipe);
  if (cells.length === 0) return null;

  const groupId = nanoid();
  const ids = cells.map(() => nanoid());
  // In front, not behind. `lowestZIndex` put a grid you had just drawn under
  // everything already on the board, so the usual result of the tool was a
  // composition you could not see.
  const base = nextZIndex();

  doc.transact(() => {
    // The group first: the nodes about to be created point at it, and a peer
    // observing the transaction should never see a member whose group is
    // missing.
    applyGroupPlan({ nodes: [], groups: [], create: { id: groupId, grid: recipe }, remove: [] });

    cells.forEach((cell, i) => {
      editor.createNode({
        id: ids[i],
        parentId: groupId,
        // Ascending within the grid, so cell order and stacking order are the
        // same thing — which is what `gridMembers` reads back.
        zIndex: base + i,
        ...cellPatch(cell, recipe.style),
      } as never);
    });
  });

  return { groupId, ids };
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

  /**
   * New cells stack **above** the grid's existing ones, not below.
   *
   * `gridMembers` reads cell order back out of the stacking order, so a cell
   * created underneath the others would sort to the front of the list and take
   * cell 0's geometry on the very next edit — the whole grid scrambling one
   * adjustment after it grew.
   */
  const { objects } = useStore.getState();
  const top = existing.reduce((max, id) => Math.max(max, objects[id]?.zIndex ?? 0), -Infinity);
  const base = Number.isFinite(top) ? top + 1 : nextZIndex();

  doc.transact(() => {
    groupsMap.set(groupId, { ...(groupsMap.get(groupId) ?? { id: groupId }), grid: recipe });

    if (plan.update.length > 0) applyNodePatches(plan.update);

    plan.create.forEach((node, i) => {
      editor.createNode({ id: nanoid(), parentId: groupId, zIndex: base + i, ...node } as never);
    });

    for (const id of plan.remove) deleteNode(id);
  });
}

/**
 * Carry a move or a resize of the objects back into the recipe.
 *
 * The arithmetic is `refitBox`, which is pure and tested — including the case
 * that made the measuring version wrong, where a layout's cells do not fill the
 * box they were given and re-deriving the box from them shrinks the grid a
 * little on every single edit.
 */
export function refitGrid(groupId: string): GridRecipe | null {
  const recipe = gridRecipe(groupId);
  if (!recipe) return null;
  return refitBox(recipe, gridBounds(layoutGrid(recipe.spec)), boundsOf(gridMembers(groupId)));
}

/**
 * Follow a move or a resize of the objects, and re-lay if the size changed.
 *
 * ## Why a grid must not simply scale
 *
 * The transformer folds its scale into each node's width and height, which is
 * right for a rectangle and wrong for a grid. A grid is not nine rectangles
 * that happen to be near each other, it is a *system*: gutters and corner radii
 * are absolute measurements chosen against the page, not proportions of the
 * modules. Scale the whole thing by 1.6 and the gutters go from 16px to 26px --
 * so the one property the person actually set is the one the drag destroys, and
 * the composition drifts a little further from its own spacing scale every time
 * it is resized.
 *
 * Re-laying costs one transaction and keeps the system: the modules take the
 * new box, the gutters stay where they were put, and the radii stay round
 * rather than oval.
 *
 * ## Why a move is treated differently
 *
 * Translation changes nothing about the arrangement, so re-laying would write
 * thirty node updates to produce the identical drawing. The recipe's box still
 * has to follow -- otherwise the next gutter change snaps the grid back to
 * where it used to be -- but that is one write to the group, not thirty to its
 * members.
 */
export function commitGridTransform(groupId: string): void {
  const recipe = gridRecipe(groupId);
  if (!recipe) return;

  const fitted = refitGrid(groupId);
  if (!fitted || fitted === recipe) return;

  const scaled =
    Math.abs(fitted.spec.width - recipe.spec.width) > MOVED_EPSILON ||
    Math.abs(fitted.spec.height - recipe.spec.height) > MOVED_EPSILON;

  if (scaled) {
    relayoutGrid(groupId, fitted);
    return;
  }

  // Moved only: record where it went and touch nothing else.
  groupsMap.set(groupId, { ...(groupsMap.get(groupId) ?? { id: groupId }), grid: fitted });
}

/** The box a recipe's cells will occupy, for a live preview. */
export function previewBounds(recipe: GridRecipe) {
  return gridBounds(layoutGrid(recipe.spec));
}
