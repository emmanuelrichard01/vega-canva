import type { AnyNode } from '../model/schema';

/**
 * Folding one replay frame into the objects the canvas is already showing.
 *
 * ## Why this is not inlined in the store
 *
 * It decides, per frame, which nodes get re-normalized, which get re-indexed,
 * and — the part that actually matters — which keep their **previous object
 * identity**. Every memoized renderer on the canvas compares identity, so a
 * frame that rebuilds all of them re-renders the entire board.
 *
 * That was the old behaviour: each playback step re-normalized every node,
 * re-upserted every node into the spatial index, reported every id as changed
 * (so physics resynced every Matter body), and handed React a completely fresh
 * set of objects. On a five-hundred-object board, up to eight times a second.
 * The result was a tab that stopped responding, playback that hitched, and a
 * canvas that looked like it was tearing.
 *
 * Getting it wrong in the other direction is worse than slow: carry a node
 * forward that *did* change and it renders at a stale position, which looks
 * exactly like the bug this replaced. So the arithmetic lives here, where it
 * runs in Node and can be asserted.
 */

export interface ReplayMerge {
  /** Every node at this moment — carried forward or freshly normalized. */
  objects: Record<string, AnyNode>;
  /** Ids that were actually re-normalized, and so need re-indexing. */
  touched: string[];
  /** Ids present before and gone now. */
  removed: string[];
}

/**
 * @param previous  What the canvas is currently showing.
 * @param snapshot  Raw node data for the moment being shown.
 * @param changedIds Ids known to differ, or `null` for "cannot tell, redo all".
 * @param normalize The read boundary, injected so this stays free of the
 *   document layer and therefore of `window`.
 */
export function mergeReplayObjects(
  previous: Record<string, AnyNode>,
  snapshot: Record<string, unknown>,
  changedIds: readonly string[] | null,
  normalize: (raw: Record<string, unknown>, id: string) => AnyNode | null
): ReplayMerge {
  const objects: Record<string, AnyNode> = {};
  const touched: string[] = [];

  /**
   * A `null` change set means the frame was rebuilt from a keyframe — a
   * rewind — and nothing observed what moved. Redoing everything is correct
   * and affordable there, because a rewind is one deliberate action rather
   * than the thing that happens eight times a second during playback.
   */
  const changed = changedIds ? new Set(changedIds) : null;

  for (const id of Object.keys(snapshot)) {
    /**
     * A node is carried forward only when it is both unchanged *and* already
     * on screen. The second half is what stops a node that arrived during a
     * frame it was not listed in from being skipped: if it is not in
     * `previous`, there is nothing to carry, so it is normalized regardless of
     * what the change set says.
     */
    const carried = changed && !changed.has(id) ? previous[id] : undefined;
    if (carried) {
      objects[id] = carried;
      continue;
    }

    const node = normalize(snapshot[id] as Record<string, unknown>, id);
    if (node) {
      objects[id] = node;
      touched.push(id);
    }
  }

  const removed: string[] = [];
  for (const id of Object.keys(previous)) {
    if (!objects[id]) removed.push(id);
  }

  return { objects, touched, removed };
}
