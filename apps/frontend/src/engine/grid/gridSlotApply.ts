import { nanoid } from 'nanoid';
import { applyNodePatches, doc, nextZIndex } from '../document';
import { editor } from '../api/EditorAPI';
import { requestEditOnMount } from '../interaction/pendingEdit';
import { useStore } from '../../hooks/useStore';
import { DEFAULT_TYPOGRAPHY, type AnyNode, type GridNode, type ImageNode, type Point } from '../model/schema';
import { gridCellsOf } from './gridNode';
import {
  isSlottable,
  planGridReflow,
  planSlotRelease,
  type ReflowPatch,
  type SlottableNode,
} from './gridReflow';
import {
  assignSlots,
  canHoldContent,
  cellIndexAt,
  clampZoom,
  coverCrop,
  freeCellsFrom as freeCellsIn,
  gridLocalPoint,
  nudgeFocus,
  slotBox,
} from './gridSlot';

/**
 * Putting pictures into a grid, and keeping them there.
 *
 * The document-facing half of the slot feature: `gridSlot.ts` holds the
 * arithmetic and `gridReflow.ts` holds the planning, both pure and both tested;
 * this is the thin layer that reads the store, writes through `mutations.ts`,
 * and owns the subscription that makes a reflow happen without anybody
 * remembering to ask for one.
 */

const isGrid = (n: AnyNode | undefined): n is GridNode => n?.type === 'grid';
const isImage = (n: AnyNode | undefined): n is ImageNode => n?.type === 'image';

/** Everything currently claiming a module in this grid — pictures and captions. */
function imagesInGrid(objects: Record<string, AnyNode>, gridId: string): SlottableNode[] {
  const out: SlottableNode[] = [];
  for (const node of Object.values(objects)) {
    if (isSlottable(node) && node.gridSlot?.gridId === gridId) out.push(node);
  }
  return out;
}

/**
 * The modules of this grid that cannot take something new.
 *
 * Two reasons, one set: it already holds something, or it is too small to hold
 * anything. They are folded together because every caller does the same thing
 * with the answer — skip it and try the next — and keeping them apart would
 * mean every caller remembering to ask both questions.
 *
 * The size rule is `canHoldContent`, which is a fact about the module rather
 * than about the kind of grid it came from. See `MIN_SLOT_SIZE` for why that
 * distinction is the whole answer to "which grids does this work for".
 */
function unavailableCells(
  grid: GridNode,
  images: readonly SlottableNode[],
  exclude: ReadonlySet<string>
): Set<number> {
  const taken = new Set<number>();
  for (const image of images) {
    if (exclude.has(image.id)) continue;
    if (image.gridSlot) taken.add(image.gridSlot.cell);
  }
  for (const cell of gridCellsOf(grid)) {
    if (!canHoldContent(cell)) taken.add(cell.index);
  }
  return taken;
}

/**
 * Bring one grid's pictures back onto their modules.
 *
 * Safe to call at any time and from anywhere: the plan is a pure function of
 * the grid's current box, so a grid that is already correct produces no patches
 * and therefore no write, no history entry and no broadcast.
 */
export function reflowGrid(gridId: string): void {
  const objects = useStore.getState().objects;
  const grid = objects[gridId];
  if (!isGrid(grid)) return;
  applyNodePatches(planGridReflow(grid, imagesInGrid(objects, gridId)));
}

/**
 * The grid under a world point, or none.
 *
 * Topmost first, because grids are scaffolds and stacking two is a reasonable
 * thing to do — dropping a picture onto the one you can see is the only
 * defensible reading. The test is against the grid's **box**, which is also
 * what `GridRenderer` hit-tests, so the region that accepts a drop is exactly
 * the region that looks like the grid.
 */
export function gridAtPoint(world: Point): GridNode | null {
  const objects = useStore.getState().objects;
  let best: GridNode | null = null;
  for (const node of Object.values(objects)) {
    if (!isGrid(node) || node.locked || node.hidden) continue;
    const local = gridLocalPoint(node, world);
    if (local.x < 0 || local.y < 0 || local.x > node.width || local.y > node.height) continue;
    if (!best || node.zIndex > best.zIndex) best = node;
  }
  return best;
}

/**
 * The free modules of a grid, in fill order from a starting module.
 *
 * The store-reading wrapper around the pure ordering rule; occupancy is the
 * only thing this adds, and it is the only part that needs the document.
 */
export function freeCellsFrom(gridId: string, start: number): number[] {
  const objects = useStore.getState().objects;
  const grid = objects[gridId];
  if (!isGrid(grid)) return [];
  const unavailable = unavailableCells(grid, imagesInGrid(objects, gridId), new Set());
  return freeCellsIn(gridCellsOf(grid).length, unavailable, start);
}

/** Whether a module is empty and big enough, and so has room for something. */
export function isCellFree(gridId: string, cell: number): boolean {
  const objects = useStore.getState().objects;
  const grid = objects[gridId];
  if (!isGrid(grid)) return false;
  return !unavailableCells(grid, imagesInGrid(objects, gridId), new Set()).has(cell);
}

/**
 * What is in this grid, for a panel to state plainly.
 *
 * The properties panel owns grids and said nothing about their contents, so a
 * grid holding six photographs and three captions looked, from the panel, like
 * an empty scaffold. `modules` comes from the layout rather than from rows
 * times columns, because most kinds do not multiply — bento merges
 * compartments, masonry derives a count per column.
 */
export function gridContent(
  objects: Record<string, AnyNode>,
  gridId: string
): GridContent {
  const grid = objects[gridId];
  if (!isGrid(grid)) return { modules: 0, filled: 0, parked: 0 };

  const cells = gridCellsOf(grid);
  const content = imagesInGrid(objects, gridId);
  const filled = content.filter((n) => cells.some((c) => c.index === n.gridSlot!.cell)).length;
  return { modules: cells.length, filled, parked: content.length - filled };
}

export interface GridContent {
  modules: number;
  filled: number;
  /**
   * How much has no module in the current arrangement.
   *
   * Parked content is real, visible and on the board, but *why* it is sitting in
   * a strip below the grid is not something the strip itself can explain — and a
   * state nobody can name is the "invisible state" objection that parking has to
   * answer for. Both the rail and the properties panel say it, from this one
   * count rather than from two that could disagree.
   */
  parked: number;
}

/** The module of this grid a world point lands on. */
export function cellAtPoint(grid: GridNode, world: Point): number | null {
  return cellIndexAt(gridCellsOf(grid), gridLocalPoint(grid, world));
}

/**
 * The patches that put one picture into one module.
 *
 * Split out from the two callers below because "where does this picture go"
 * must have exactly one answer whether it arrived by bulk insert or by being
 * dropped. It reads the module straight out of the layout rather than being
 * handed a rectangle, so a caller cannot pass a stale one.
 */
function placementPatch(
  grid: GridNode,
  content: SlottableNode,
  cell: number,
  zIndex?: number
): ReflowPatch | null {
  const target = gridCellsOf(grid).find((c) => c.index === cell);
  if (!target) return null;

  const box = slotBox(grid, target);

  /**
   * A fresh placement is centred and unzoomed, on purpose.
   *
   * Carrying the previous framing across would mean a picture dragged from one
   * module to another arrived showing a corner of itself, for reasons only its
   * history could explain. Moving a picture is a new framing question, and the
   * answer that needs no explanation is the middle.
   */
  const framing =
    content.type === 'image'
      ? {
          // Absent rather than a full-frame window, so an uncropped picture
          // takes `ImageRenderer`'s plain `drawImage` path.
          crop:
            coverCrop(target, {
              width: content.naturalWidth ?? 0,
              height: content.naturalHeight ?? 0,
            }) ?? undefined,
          appearance: {
            ...(content.appearance ?? {}),
            cornerRadius: target.outline ? 0 : target.radius,
          },
        }
      : { resize: 'fixed' as const };

  return {
    id: content.id,
    changes: {
      gridSlot: { gridId: grid.id, cell },
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: box.rotation,
      ...framing,
      ...(zIndex === undefined ? null : { zIndex }),
    },
  };
}

/** What a bulk insert did, for the caller to report. */
export interface FillResult {
  placed: number;
  /** Pictures there was no free module for. They are left untouched. */
  overflow: string[];
}

/**
 * Fill a grid's free modules with these pictures, in order.
 *
 * One transaction: a nine-picture insert is one undo step and one broadcast,
 * not nine of each. The pictures are also lifted to the top of the stack in
 * their insert order — a picture placed *under* the grid it was inserted into
 * would be invisible, and the grid's own backdrop takes every click, so it
 * would also be unreachable.
 */
export function fillGridWithImages(gridId: string, imageIds: readonly string[]): FillResult {
  const objects = useStore.getState().objects;
  const grid = objects[gridId];
  if (!isGrid(grid)) return { placed: 0, overflow: [...imageIds] };

  const images = imageIds
    .map((id) => objects[id])
    .filter(isSlottable)
    // A picture already in this grid is being rearranged, not added, so its
    // current module must not count as occupied against itself.
    .filter((image) => !image.locked);

  const inserting = new Set(images.map((i) => i.id));
  const unavailable = unavailableCells(grid, imagesInGrid(objects, gridId), inserting);
  const cellCount = gridCellsOf(grid).length;

  const { placed, overflow } = assignSlots(
    cellCount,
    images.map((i) => i.id),
    unavailable
  );

  const byId = new Map(images.map((i) => [i.id, i]));
  const base = nextZIndex();
  const patches = placed
    .map(({ imageId, cell }, i) => {
      const image = byId.get(imageId);
      return image ? placementPatch(grid, image, cell, base + i) : null;
    })
    .filter((p): p is ReflowPatch => p !== null);

  applyNodePatches(patches);
  return { placed: patches.length, overflow };
}

/**
 * Put one picture into one named module, replacing whatever was there.
 *
 * The deliberate counterpart to bulk insert's "fill the gaps": aiming at a
 * module that already holds a picture means replacing it, because that is the
 * only thing the gesture could mean. The picture that was there is **released,
 * not deleted** — it keeps its box, so it stays on the board where it can be
 * seen and undone, rather than silently disappearing into a stack behind the
 * new one.
 */
export function placeImageInCell(gridId: string, cell: number, imageId: string): boolean {
  const objects = useStore.getState().objects;
  const grid = objects[gridId];
  const image = objects[imageId];
  if (!isGrid(grid) || !isSlottable(image) || image.locked) return false;

  const patch = placementPatch(grid, image, cell, nextZIndex());
  if (!patch) return false;

  const displaced = imagesInGrid(objects, gridId)
    .filter((other) => other.id !== imageId && other.gridSlot?.cell === cell)
    .map((other) => ({ id: other.id, changes: { gridSlot: undefined } }));

  applyNodePatches([...displaced, patch]);
  return true;
}

/**
 * Work out where a dragged picture has landed, and act on it.
 *
 * The direct counterpart to `reassignFrame`, called from the same place for the
 * same reason: membership on this canvas is decided **geometrically**, by where
 * a thing came to rest, rather than by a mode you enter first. That is what
 * makes "drag a photograph onto a module" work without a drop mode, a modifier
 * key, or a target you have to arm.
 *
 * Four outcomes, and the third is the one worth having:
 *
 * - Dropped outside every grid, and it was in one — **released**, and left
 *   exactly where it was dropped. Dragging a picture out of a grid is how you
 *   get it out, and it would be a poor tool that snapped it back.
 * - Dropped on a free module — **placed**, covered and clipped.
 * - Dropped on a module of the *same* grid that is already taken — **swapped**.
 *   Rearranging a photo wall is the commonest thing anyone does to one, and
 *   displacing the picture already there would mean every rearrangement was
 *   two gestures: move A out, move B in. A swap is what the gesture means.
 * - Dropped on a taken module of a *different* grid — the occupant is
 *   **displaced** rather than swapped, because sending someone else's picture
 *   across the board into a grid it was never in is not a thing the drag said.
 */
export function reassignGridSlot(imageId: string): void {
  const objects = useStore.getState().objects;
  const image = objects[imageId];
  if (!isSlottable(image) || image.locked) return;

  const centre = { x: image.x + image.width / 2, y: image.y + image.height / 2 };
  const grid = gridAtPoint(centre);

  if (!grid) {
    if (image.gridSlot) releaseSlots([imageId]);
    return;
  }

  const cell = cellAtPoint(grid, centre);
  if (cell === null) return;

  const wasHere = image.gridSlot?.gridId === grid.id;
  const occupant = imagesInGrid(objects, grid.id).find(
    (other) => other.id !== imageId && other.gridSlot?.cell === cell
  );

  // Dropped back on its own module: nothing has changed, but the picture is
  // wherever the pointer left it, so it still has to be put back on the module.
  if (wasHere && image.gridSlot?.cell === cell && !occupant) {
    reflowGrid(grid.id);
    return;
  }

  const patch = placementPatch(grid, image, cell, nextZIndex());
  if (!patch) return;

  const displaced: ReflowPatch[] = [];
  if (occupant) {
    if (wasHere && image.gridSlot) {
      // A swap: the occupant takes the module the dragged picture came from,
      // and `placementPatch` gives it that module's box and cover in the same
      // transaction, so neither picture is ever seen out of place.
      const back = placementPatch(grid, occupant, image.gridSlot.cell);
      if (back) displaced.push(back);
    } else {
      displaced.push({ id: occupant.id, changes: { gridSlot: undefined } });
    }
  }

  applyNodePatches([...displaced, patch]);
}

/**
 * Move the content of a module, rather than the module.
 *
 * Returns patches rather than writing, so the arrow-key handler can fold a
 * mixed selection — some pictures in modules, some loose objects — into the one
 * transaction and therefore the one undo step that a single press should be.
 *
 * A picture whose source already fits its module exactly has nowhere to travel
 * and produces no patch. That is not a failure to report: it is the same
 * "nothing moved" a nudge against the edge of a photograph gives, and saying
 * anything about it would mean a toast on a keypress.
 */
export function nudgeSlotFocus(ids: readonly string[], dx: number, dy: number): ReflowPatch[] {
  const objects = useStore.getState().objects;
  const patches: ReflowPatch[] = [];

  for (const id of ids) {
    const node = objects[id];
    if (!isImage(node) || !node.gridSlot) continue;

    const grid = objects[node.gridSlot.gridId];
    if (!isGrid(grid)) continue;
    const cell = gridCellsOf(grid).find((c) => c.index === node.gridSlot!.cell);
    if (!cell) continue;

    const natural = { width: node.naturalWidth ?? 0, height: node.naturalHeight ?? 0 };
    const focus = nudgeFocus(cell, natural, node.gridSlot, dx, dy);
    if (!focus) continue;

    const next = { ...node.gridSlot, focus };
    const crop = coverCrop(cell, natural, next);
    if (!crop) continue;

    // Nothing moved: the picture is already against that edge. Writing anyway
    // would put an undo step in the history for a press that did nothing.
    if (
      node.crop &&
      Math.abs(node.crop.x - crop.x) < 1e-6 &&
      Math.abs(node.crop.y - crop.y) < 1e-6
    ) {
      continue;
    }

    patches.push({ id, changes: { gridSlot: next, crop } });
  }

  return patches;
}

/**
 * Set how far into a picture its module looks.
 *
 * Separate from the nudge because zooming re-derives the window around the
 * focal point that is already stored, while nudging moves that point — two
 * different edits to the same framing, and collapsing them into one setter
 * would mean every caller had to pass both.
 */
export function setSlotZoom(id: string, zoom: number): void {
  const objects = useStore.getState().objects;
  const node = objects[id];
  if (!isImage(node) || !node.gridSlot) return;

  const grid = objects[node.gridSlot.gridId];
  if (!isGrid(grid)) return;
  const cell = gridCellsOf(grid).find((c) => c.index === node.gridSlot!.cell);
  if (!cell) return;

  const next = { ...node.gridSlot, zoom: clampZoom(zoom) };
  const crop = coverCrop(
    cell,
    { width: node.naturalWidth ?? 0, height: node.naturalHeight ?? 0 },
    next
  );
  applyNodePatches([{ id, changes: { gridSlot: next, crop: crop ?? undefined } }]);
}

/**
 * Put a picture back to the middle of its module at a plain cover.
 *
 * The escape hatch every direct-manipulation control needs: panning and zooming
 * by hand can reach a state that is hard to walk back by hand, and "start
 * again" should not mean taking the picture out of the grid and putting it back.
 */
export function recentreSlot(ids: readonly string[]): void {
  const objects = useStore.getState().objects;
  const patches: ReflowPatch[] = [];

  for (const id of ids) {
    const node = objects[id];
    if (!isImage(node) || !node.gridSlot) continue;
    const grid = objects[node.gridSlot.gridId];
    if (!isGrid(grid)) continue;
    const cell = gridCellsOf(grid).find((c) => c.index === node.gridSlot!.cell);
    if (!cell) continue;

    const next = { gridId: node.gridSlot.gridId, cell: node.gridSlot.cell };
    const crop = coverCrop(cell, {
      width: node.naturalWidth ?? 0,
      height: node.naturalHeight ?? 0,
    });
    patches.push({ id, changes: { gridSlot: next, crop: crop ?? undefined } });
  }

  applyNodePatches(patches);
}

/**
 * Take content out of a module, leaving it where it sits.
 *
 * ## Why released and not deleted
 *
 * "I do not want this in there" and "I do not want this" are different
 * sentences, and only the person saying one of them knows which they mean. A
 * release keeps the object — same picture, same adjustments, same id, so
 * anything pointing at it still does — and simply stops the grid owning its
 * box. Delete is one keystroke away for anyone who meant the other thing,
 * whereas a release that deleted would need an undo and a moment of alarm.
 *
 * ## Why the crop is put back
 *
 * The cover crop was the *module's* framing, not the picture's — it exists to
 * make a 4:3 photograph fill a square, and the moment the square is gone it is
 * an arbitrary trim nobody chose. Leaving it would hand back a picture
 * mysteriously missing its edges, and the only clue would be a crop the person
 * never made. The box is restored to the source's own proportions around the
 * same centre, so the picture stays exactly where it was on the board and
 * simply becomes whole again.
 *
 * A crop the person made *themselves* before the picture went into the grid is
 * gone either way — the slot overwrote it — which is a real if minor loss, and
 * the honest place for it is right here in the open rather than in a surprise.
 */
export function releaseSlots(ids: readonly string[]): void {
  const objects = useStore.getState().objects;
  const patches: ReflowPatch[] = [];

  for (const id of ids) {
    const node = objects[id];
    if (!isSlottable(node) || !node.gridSlot) continue;

    const changes: Record<string, unknown> = { gridSlot: undefined };

    if (node.type === 'image') {
      const natural = { width: node.naturalWidth ?? 0, height: node.naturalHeight ?? 0 };
      if (natural.width > 0 && natural.height > 0 && node.crop) {
        // The largest box with the bitmap's own aspect that fits the module,
        // concentric with it — so nothing jumps and nothing is left trimmed.
        const scale = Math.min(node.width / natural.width, node.height / natural.height);
        const width = natural.width * scale;
        const height = natural.height * scale;
        changes.x = node.x + (node.width - width) / 2;
        changes.y = node.y + (node.height - height) / 2;
        changes.width = width;
        changes.height = height;
        changes.crop = undefined;
      }
    }

    patches.push({ id, changes });
  }

  applyNodePatches(patches);
}

/**
 * Put a caption in a module and open it for typing.
 *
 * ## Why the node is created before anything is typed
 *
 * The alternative — a floating editor that only becomes a node once it has
 * text — means the thing on screen is not in the document, so it is not in the
 * Layers panel, not undoable, not visible to anyone else in the room, and gone
 * if the tab reloads. Creating first and discarding an empty one on blur is the
 * rule the sticky and text tools already follow, and `ObjectRenderer`'s commit
 * and cancel handlers already delete a text node nobody typed into.
 *
 * ## Why the caret is latched rather than announced
 *
 * `requestEditOnMount` sets the id *before* the node exists and the renderer
 * asks once on its first render. Creating the node and then dispatching "now
 * edit it" is a race the caller always loses, because the renderer has not
 * mounted and nothing is listening — see `pendingEdit.ts`, which was written
 * for exactly this and explains why waiting a frame is worse than not trying.
 */
export function addTextToCell(gridId: string, cell: number): string | null {
  const objects = useStore.getState().objects;
  const grid = objects[gridId];
  if (!isGrid(grid)) return null;

  const target = gridCellsOf(grid).find((c) => c.index === cell);
  if (!target) return null;

  const box = slotBox(grid, target);
  const id = nanoid();

  requestEditOnMount(id);

  doc.transact(() => {
    editor.createNode({
      id,
      type: 'text',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: box.rotation,
      zIndex: nextZIndex(),
      text: '',
      resize: 'fixed',
      typography: {
        ...DEFAULT_TYPOGRAPHY,
        /**
         * Centred both ways, because a caption in a box is not a paragraph.
         * Left-aligned at the top is right for a text object you placed on open
         * canvas and wrong for one filling a module, where the module's own
         * geometry is the composition and ragged text fights it.
         */
        align: 'center',
        verticalAlign: 'middle',
      },
      gridSlot: { gridId, cell },
      parentId: grid.parentId,
      frameId: grid.frameId,
    } as never);
  });

  return id;
}

/**
 * Keep every slotted picture on its module, for the life of the session.
 *
 * ## Why this listens rather than being called
 *
 * A grid's box changes from a drag, the transformer, a nudge, an align, a
 * distribute and a panel edit — and, decisively, from an **undo** and from a
 * **collaborator on another machine**. The last two have no local call site to
 * add a line to: the UndoManager writes to the Y.Map directly and a remote edit
 * arrives as an update. Anything that depends on a writer remembering cannot
 * cover them, which is invariant 12's rule and the reason the previous grid
 * implementation's seven update sites were deleted rather than added to.
 *
 * ## Why it cannot loop
 *
 * The write it makes is itself a change, which this sees. But a reflow is a
 * pure function of the grid's box and only differences are written, so the
 * second pass produces nothing and it settles in one extra round. That is the
 * same property that makes it safe for every client in the room to run it: they
 * all compute the same answer, whoever gets there first writes it, and the rest
 * find it already true.
 *
 * ## Why it subscribes to the store rather than to the document
 *
 * The store publishes **normalized** nodes, and a reflow reads a recipe and a
 * slot — both of which are normalized at that boundary. Reading raw Yjs JSON
 * here would be a second, weaker read path for the same data. It also settles
 * the ordering question: by the time the store has published, it has finished
 * applying the change.
 */
export function startGridSlotSync(): () => void {
  let previousVersion = useStore.getState().version;

  return useStore.subscribe((state) => {
    if (state.version === previousVersion) return;
    previousVersion = state.version;
    // Time Travel drives the store from replayed snapshots. Writing the
    // document in response would turn looking at history into editing it.
    if (state.isReplaying) return;

    const { objects, lastChangedIds, lastRemovedIds } = state;

    /**
     * A grid that was deleted releases its pictures.
     *
     * Only ever for a grid this actually watched leave — never for one that
     * merely cannot be found. On a document that is still syncing, a picture
     * can load before its grid, and releasing on "not found" would quietly
     * dismantle every grid on the board in the first second of every session.
     */
    const removedGrids = new Set(lastRemovedIds);
    if (removedGrids.size > 0) {
      const orphans = planSlotRelease(
        removedGrids,
        Object.values(objects).filter(isSlottable)
      );
      if (orphans.length > 0) applyNodePatches(orphans);
    }

    /**
     * Which grids need looking at.
     *
     * A grid that changed, obviously — but also the grid of any *picture* that
     * changed, which is what lets a bitmap whose natural size has only just
     * been recorded get the cover crop it could not be given when it was
     * placed. Most changes touch neither, and this loop is a handful of map
     * lookups before it exits.
     */
    const grids = new Set<string>();
    for (const id of lastChangedIds) {
      const node = objects[id];
      if (isGrid(node)) grids.add(id);
      else if (isSlottable(node) && node.gridSlot) grids.add(node.gridSlot.gridId);
    }
    if (grids.size === 0) return;

    const patches: ReflowPatch[] = [];
    for (const gridId of grids) {
      const grid = objects[gridId];
      if (!isGrid(grid)) continue;
      patches.push(...planGridReflow(grid, imagesInGrid(objects, gridId)));
    }
    if (patches.length > 0) applyNodePatches(patches);
  });
}
