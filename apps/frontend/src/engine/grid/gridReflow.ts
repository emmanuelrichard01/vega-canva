import type { AnyNode, GridNode, ImageNode, TextNode } from '../model/schema';
import { coverCrop, parkedCell, slotBox } from './gridSlot';
import { gridCellsOf } from './gridNode';

/**
 * A node that can sit in a module: a picture, or a caption.
 *
 * Kept as a union rather than as `AnyNode` so the fitting branch below is
 * exhaustive by the compiler rather than by a default case — adding a third
 * kind of content should fail to build until somebody decides how it is fitted,
 * which is the one decision that cannot be defaulted.
 */
export type SlottableNode = ImageNode | TextNode;

export const isSlottable = (n: AnyNode | undefined): n is SlottableNode =>
  n?.type === 'image' || n?.type === 'text';

/**
 * Keeping slotted pictures on their modules.
 *
 * ## Why this is one function and not seven call sites
 *
 * A grid's modules are derived from its box, so a picture sitting in one has to
 * be moved whenever that box changes — and the box changes from a drag, the
 * transformer, a nudge, an align, a distribute, a panel edit, an undo, and a
 * collaborator doing any of those on another machine.
 *
 * The previous generation of the grid code tried to hold two copies of a fact
 * together by remembering to update the second one at each of those sites, and
 * `gridApply.ts` opens with the post-mortem: *"every one of those existed to
 * hold two copies of one fact together, and every one of them was a place they
 * could come apart."* Undo and a remote edit are the two that settle the
 * argument, because **neither has a local call site at all** — the UndoManager
 * writes to the Y.Map directly, and a collaborator's change arrives as an
 * update. Anything that has to be remembered by a sender cannot cover them.
 *
 * So this observes the document instead. It is the shape invariant 12 asks for:
 * a state that anything can falsify from outside rather than one that depends
 * on every writer remembering. A reflow is a pure function of the grid's
 * current box, so running it again is always safe and always converges.
 *
 * ## Why writing back is right, when a connector derives on read
 *
 * `ConnectorNode` recomputes its points on every read and stores nothing, and
 * the obvious question is why a slotted picture does not. Because a connector
 * is a special case in every consumer that needed to know, and a picture is
 * not: the spatial index, culling, the selection outline, the transformer,
 * smart guides and `computeContentBounds` all read `x`/`y`/`width`/`height`
 * straight off the node. Deriving on read would mean teaching every one of them
 * about grid slots. Writing through means teaching none of them anything, and
 * the document says something true about where the picture is.
 *
 * That is also the existing precedent: `syncConnectedConnectors` writes patches
 * on commit for exactly this reason, and this planner deliberately has the same
 * shape — it *returns* patches rather than writing them, so a caller can fold
 * them into one transaction and so the whole thing can be tested with no
 * document at all.
 *
 * ## Idempotence is what makes it safe on every client
 *
 * Every client observes the same change and computes the same answer, but only
 * differences are written — so the client that made the change writes, and the
 * others compute the identical box, find it already correct, and write nothing.
 * Two clients racing produce byte-identical values, which a CRDT merges without
 * a conflict. This is also what stops the observer feeding itself: the write it
 * makes produces a change whose reflow is a no-op.
 */

/** One node, and what has to change about it. Mirrors `applyNodePatches`. */
export interface ReflowPatch {
  id: string;
  changes: Record<string, unknown>;
}

/**
 * How far a number may drift before it is worth a write.
 *
 * Positions here come out of trigonometry — `slotBox` rotates about the grid's
 * centre — so a value that is arithmetically unchanged can come back differing
 * in the last bits. Writing on that would mean a rotated grid re-broadcasting
 * every picture in it on every unrelated document change, forever. A hundredth
 * of a world unit is far below anything a screen can show at any zoom this
 * canvas supports.
 */
const EPSILON = 0.01;

const differs = (a: number | undefined, b: number): boolean =>
  typeof a !== 'number' || Math.abs(a - b) > EPSILON;

function cropDiffers(
  current: ImageNode['crop'],
  next: { x: number; y: number; width: number; height: number } | null
): boolean {
  if (next === null) return false; // Nothing to say; leave whatever is stored.
  if (!current) return true;
  return (
    differs(current.x, next.x) ||
    differs(current.y, next.y) ||
    differs(current.width, next.width) ||
    differs(current.height, next.height)
  );
}

/**
 * What has to change for every picture in one grid.
 *
 * Pure: hand it a grid and the pictures claiming a module in it, and it returns
 * the writes. No document, no store, no Konva — which is what lets the
 * behaviour that actually matters (a resize re-covers, a shrunk grid releases,
 * an unchanged grid writes nothing) be pinned by tests rather than by looking.
 *
 * `images` is the caller's business to filter; anything here whose slot names
 * another grid is ignored rather than trusted, because a caller that filtered
 * wrongly would otherwise drag pictures out of a grid they belong to.
 */
export function planGridReflow(
  grid: GridNode,
  contents: readonly SlottableNode[]
): ReflowPatch[] {
  const cells = gridCellsOf(grid);
  const patches: ReflowPatch[] = [];

  /**
   * Which of this grid's content has no module to be in.
   *
   * Worked out up front, and in a stable order, because where a parked item
   * goes depends on how many others are parked — and every client has to agree
   * about that or they will fight over the positions. Ordered by the module
   * each one *came from*, so the strip preserves the arrangement they had and
   * putting the old grid back puts them back in the same order.
   */
  const mine = contents.filter((n) => n.gridSlot?.gridId === grid.id);
  const parked = mine
    .filter((n) => !cells.some((c) => c.index === n.gridSlot!.cell))
    .sort((a, b) => a.gridSlot!.cell - b.gridSlot!.cell);
  const parkedOrdinal = new Map(parked.map((n, i) => [n.id, i]));

  for (const image of mine) {
    const slot = image.gridSlot!;
    const cell = cells.find((c) => c.index === slot.cell);

    /**
     * The module this content was in does not exist in the current
     * arrangement — the grid was given fewer modules, or a different kind
     * with a different number of them.
     *
     * **It waits, it is not released.** The binding is kept and the content is
     * laid out in a strip below the grid, so bringing back an arrangement with
     * enough modules brings it back into place. See `parkedCell` for why: a
     * grid's module count runs from one to thirty-six across the kinds, and
     * cycling through them to see which you like is precisely the gesture that
     * must not cost you your photographs.
     *
     * Releasing is now only ever something a person asks for.
     */
    if (!cell) {
      const box = slotBox(grid, parkedCell(parkedOrdinal.get(image.id) ?? 0, grid));
      const changes: Record<string, unknown> = {};
      if (differs(image.x, box.x)) changes.x = box.x;
      if (differs(image.y, box.y)) changes.y = box.y;
      if (differs(image.width, box.width)) changes.width = box.width;
      if (differs(image.height, box.height)) changes.height = box.height;
      if (differs(image.rotation, box.rotation)) changes.rotation = box.rotation;

      // Re-covered to the waiting square, so a parked photograph is a
      // photograph rather than a stretched one.
      if (image.type === 'image') {
        const natural = { width: image.naturalWidth ?? 0, height: image.naturalHeight ?? 0 };
        const crop = coverCrop(box, natural, slot);
        if (cropDiffers(image.crop, crop)) changes.crop = crop ?? undefined;
      }

      if (Object.keys(changes).length > 0) patches.push({ id: image.id, changes });
      continue;
    }

    const box = slotBox(grid, cell);
    const changes: Record<string, unknown> = {};

    if (differs(image.x, box.x)) changes.x = box.x;
    if (differs(image.y, box.y)) changes.y = box.y;
    if (differs(image.width, box.width)) changes.width = box.width;
    if (differs(image.height, box.height)) changes.height = box.height;
    if (differs(image.rotation, box.rotation)) changes.rotation = box.rotation;

    /**
     * The picture is re-covered, not merely resized.
     *
     * Moving a grid changes nothing about the crop; changing its proportions
     * changes everything about it. Skipping this would stretch a photograph the
     * moment a 3x3 grid was dragged wider — which is the exact failure "cover"
     * exists to prevent, arriving one gesture after the picture was placed
     * correctly.
     *
     * `coverCrop` returns null when the bitmap's natural size has not been
     * recorded yet, and null means *leave the stored crop alone*: the picture
     * keeps its module and shows its whole self until some client loads it and
     * writes the size down, at which point that write is itself a change this
     * observer sees, and the next reflow covers it properly.
     */
    if (image.type === 'image') {
      const natural = { width: image.naturalWidth ?? 0, height: image.naturalHeight ?? 0 };
      const crop = coverCrop(cell, natural, slot);
      if (cropDiffers(image.crop, crop)) changes.crop = crop ?? undefined;
    } else {
      /**
       * A caption is fitted by being told its box, and that is the whole of it.
       *
       * There is no source to cover and nothing to crop — the module *is* the
       * text box. What it does need is `resize: 'fixed'`, because the other two
       * modes let the box follow the text: an auto-height caption would grow
       * out of its module the moment somebody typed a third line, and the
       * reflow would drag it back on the next document change, so the box would
       * fight the typing. Fixed is the mode that already means "this box is
       * decided elsewhere", and it ellipsizes rather than overflowing.
       */
      if (image.resize !== 'fixed') changes.resize = 'fixed';
    }

    /**
     * A rounded module rounds the picture in it.
     *
     * `ImageRenderer` already hands `cornerRadius` to Konva, which clips to it
     * natively, so a rounded rectangular module needs no clipping code at all —
     * only the number. Non-rectangular modules are a different problem and are
     * clipped by `ObjectRenderer`, which can express a silhouette.
     */
    if (image.type === 'image') {
      const radius = cell.outline ? 0 : cell.radius;
      if (differs(image.appearance?.cornerRadius, radius)) {
        changes.appearance = { ...(image.appearance ?? {}), cornerRadius: radius };
      }
    }

    if (Object.keys(changes).length > 0) patches.push({ id: image.id, changes });
  }

  return patches;
}

/**
 * Pictures whose grid is gone.
 *
 * Separated from the reflow because it answers a question the reflow cannot:
 * *is this grid missing, or has it simply not arrived yet?* On a document that
 * is still syncing, a picture can be loaded before the grid it belongs to, and
 * releasing it then would quietly dismantle every grid on the board during the
 * first second of every session. So this is only ever called with a grid id the
 * caller **watched being deleted**, never with one it merely failed to find.
 */
export function planSlotRelease(
  gridIds: ReadonlySet<string>,
  images: readonly SlottableNode[]
): ReflowPatch[] {
  if (gridIds.size === 0) return [];
  return images
    .filter((image) => image.gridSlot && gridIds.has(image.gridSlot.gridId))
    .map((image) => ({ id: image.id, changes: { gridSlot: undefined } }));
}
