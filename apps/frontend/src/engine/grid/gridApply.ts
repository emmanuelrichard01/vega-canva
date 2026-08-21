import { nanoid } from 'nanoid';
import { applyGroupPlan, applyNodePatches, deleteNode, doc, groupsMap, nextZIndex } from '../document';
import { editor } from '../api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { nodesInGroup } from '../model/groupTree';
import { cellPatch, planGridUpdate, recipeCells, refitBox, type GridRecipe } from './gridBuild';
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
 * Move a grid's recipe by the same delta the gesture moved its objects.
 *
 * ## Why this is told rather than measured
 *
 * The first version read the members' bounding box after the drag and inferred
 * the transform from it. That looks equivalent and is not, because the drag
 * writes one node per call and the reading happened before every write had
 * reached the store: the box it measured was half the cells in their new
 * positions and half in their old, which is *wider* than either. A phantom
 * scale came out of the division, the grid re-laid to fit a box it had never
 * occupied, and the whole thing jumped somewhere else and came apart.
 *
 * A move already knows its own delta. Taking it as an argument removes the
 * race, the measurement and the arithmetic in one go, and it cannot be wrong
 * about a gesture it was handed.
 *
 * One write to the group, not thirty to its members: translation changes
 * nothing about the arrangement, so there is nothing to re-lay.
 */
export function translateGrid(groupId: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const recipe = gridRecipe(groupId);
  if (!recipe) return;
  groupsMap.set(groupId, {
    ...(groupsMap.get(groupId) ?? { id: groupId }),
    grid: { ...recipe, spec: { ...recipe.spec, x: recipe.spec.x + dx, y: recipe.spec.y + dy } },
  });
}

/**
 * Re-lay a grid into the box a resize just gave it.
 *
 * `actual` is the box the caller has *just written*, not one read back from
 * the store — see `translateGrid` for why that distinction matters. The
 * transformer knows every node's new rectangle at the moment it commits them,
 * so it can hand over their union without anything having to be measured
 * afterwards.
 *
 * Re-laying rather than leaving the cells scaled is the point: gutters and
 * corner radii are absolute measurements chosen against the page, not
 * proportions of the modules, so a drag to 1.6x would otherwise take a 16px
 * gutter to 26px.
 */
export function resizeGridTo(
  groupId: string,
  actual: { x: number; y: number; width: number; height: number }
): void {
  const recipe = gridRecipe(groupId);
  if (!recipe) return;
  if (!(actual.width > 0) || !(actual.height > 0)) return;

  const fitted = refitBox(recipe, gridBounds(layoutGrid(recipe.spec)), actual);
  if (fitted === recipe) return;
  relayoutGrid(groupId, fitted);
}

/** The box a recipe's cells will occupy, for a live preview. *//** The box a recipe's cells will occupy, for a live preview. */
export function previewBounds(recipe: GridRecipe) {
  return gridBounds(layoutGrid(recipe.spec));
}
