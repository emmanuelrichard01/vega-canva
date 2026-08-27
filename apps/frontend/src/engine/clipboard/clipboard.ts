import { nanoid } from 'nanoid';
import type { AnyNode } from '../model/schema';
import { ancestorsOf, remapGroups, type GroupRecord, type Groups } from '../model/groupTree';

/**
 * Copying objects, and pasting them back.
 *
 * ## Why the system clipboard, and why text
 *
 * A private in-memory buffer is half a feature: it cannot cross a tab, so
 * copying from one board and pasting into another — the thing anyone with two
 * boards open will try first — silently does nothing. Writing the payload to
 * the real clipboard as **text** makes that work, survives a reload, and costs
 * nothing extra, because `navigator.clipboard.writeText` is available wherever
 * this app runs.
 *
 * Text rather than a custom MIME type for the same reason: only `text/plain`,
 * `text/html` and `image/png` are reliably readable back out of the async
 * clipboard API across browsers. A private type would be written happily and
 * then be unreadable on paste, which is the worst of both.
 *
 * The cost is that pasting into a text editor shows JSON. That is the honest
 * trade every canvas tool makes, and the envelope is at least recognisable.
 */

/** Marks a payload as ours, so arbitrary pasted text is never mistaken for one. */
export const CLIPBOARD_MAGIC = 'vega-studio/objects@1';

export interface ClipboardPayload {
  kind: typeof CLIPBOARD_MAGIC;
  /** The nodes as they were, ids included — remapped on the way back in. */
  nodes: Record<string, unknown>[];
  /**
   * The top-left of the copied set, so a paste can preserve relative layout
   * while landing where the person is looking rather than where the originals
   * happen to sit.
   */
  origin: { x: number; y: number };
}

/** Nodes worth putting on a clipboard: everything the user can select. */
const UNCOPYABLE = new Set(['comment']);

/**
 * Serialise a selection.
 *
 * Returns `null` rather than an empty envelope when there is nothing to copy,
 * so a caller cannot overwrite a useful clipboard with a copy of nothing —
 * pressing Cmd+C on empty space is a common accident and losing what you
 * copied a minute ago to it is a real annoyance.
 */
export function writeClipboard(nodes: readonly AnyNode[]): ClipboardPayload | null {
  const copyable = nodes.filter((n) => n && !UNCOPYABLE.has(n.type));
  if (copyable.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  for (const n of copyable) {
    if (Number.isFinite(n.x)) minX = Math.min(minX, n.x);
    if (Number.isFinite(n.y)) minY = Math.min(minY, n.y);
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;

  return {
    kind: CLIPBOARD_MAGIC,
    nodes: copyable.map((n) => ({ ...(n as unknown as Record<string, unknown>) })),
    origin: { x: minX, y: minY },
  };
}

/** `null` for anything that is not one of ours — including valid JSON. */
export function parseClipboard(text: string): ClipboardPayload | null {
  if (!text || !text.includes(CLIPBOARD_MAGIC)) return null;
  try {
    const raw = JSON.parse(text);
    if (!raw || raw.kind !== CLIPBOARD_MAGIC || !Array.isArray(raw.nodes)) return null;
    if (raw.nodes.length === 0) return null;
    return {
      kind: CLIPBOARD_MAGIC,
      nodes: raw.nodes.filter((n: unknown) => n && typeof n === 'object'),
      origin: {
        x: Number.isFinite(raw.origin?.x) ? raw.origin.x : 0,
        y: Number.isFinite(raw.origin?.y) ? raw.origin.y : 0,
      },
    };
  } catch {
    return null;
  }
}

export interface PasteResult {
  /** Ready for `createNode`, with fresh ids and moved into place. */
  nodes: Record<string, unknown>[];
  /** The new ids, in the order they were produced, for selecting the result. */
  ids: string[];
  /** Group records to create, with the copy's own nesting rather than the original's. */
  groups: GroupRecord[];
}

/**
 * Turn a payload into nodes to create, at a given point.
 *
 * ## Ids are always regenerated
 *
 * Pasting into the board the objects came from would otherwise overwrite the
 * originals one for one — a "paste" that is really a no-op, and a destructive
 * one if anything had been edited since. This is the same reasoning
 * `restoreDocument` uses for a merge, and the same trap.
 *
 * ## References are rewritten with them
 *
 * A connector stores the ids of the two objects it joins, and a grouped node
 * stores its group's synthetic `parentId`. Regenerating ids without rewriting
 * those pastes a flowchart whose arrows point at the *originals* — so dragging
 * the copy leaves its arrows behind, attached to the thing it was copied from.
 *
 * A reference to something that was *not* copied is left alone deliberately: an
 * arrow copied without its target still points at that target, which is the
 * only meaning available and is what every diagram tool does.
 */
export function pasteNodes(
  payload: ClipboardPayload,
  at: { x: number; y: number },
  /** The board's group tree, so a copied folder's nesting survives the paste. */
  groupTable: Groups = {}
): PasteResult {
  const remap = new Map<string, string>();
  for (const raw of payload.nodes) {
    const id = typeof raw.id === 'string' ? raw.id : null;
    if (id) remap.set(id, nanoid());
  }

  /**
   * Group ids are remapped separately, because they are not node ids.
   *
   * A group is a *synthetic* id shared by its members and belonging to no node
   * at all, so it never appears in the map above — and looking it up there
   * therefore always missed, leaving the pasted copy carrying the original's
   * group id. The copy then joined the original's group, and the two moved
   * together forever after: a paste that welds itself to what it came from.
   *
   * Only groups actually present in the payload are remapped. A member copied
   * without its group keeps the id it had, which is the same rule connectors
   * follow for an end pointing outside the selection.
   */
  const groups = new Map<string, string>();
  for (const raw of payload.nodes) {
    const parent = typeof raw.parentId === 'string' ? raw.parentId : null;
    if (parent && !groups.has(parent)) groups.set(parent, nanoid());
  }
  // Ancestors too: copying an inner folder brings the outer one that gave it
  // its place, or the copy's nesting is one level of guesswork.
  for (const old of [...groups.keys()]) {
    for (const up of ancestorsOf(groupTable, old)) {
      if (!groups.has(up)) groups.set(up, nanoid());
    }
  }

  const dx = at.x - payload.origin.x;
  const dy = at.y - payload.origin.y;

  const nodes: Record<string, unknown>[] = [];
  const ids: string[] = [];

  for (const raw of payload.nodes) {
    const oldId = typeof raw.id === 'string' ? raw.id : null;
    const id = (oldId && remap.get(oldId)) || nanoid();
    const next: Record<string, unknown> = { ...raw, id };

    next.x = (Number.isFinite(raw.x) ? (raw.x as number) : 0) + dx;
    next.y = (Number.isFinite(raw.y) ? (raw.y as number) : 0) + dy;

    if (typeof next.parentId === 'string') {
      next.parentId = groups.get(next.parentId) ?? next.parentId;
    }
    // Frame membership is re-derived from geometry by the write path, so it is
    // dropped rather than remapped: carrying it would put a pasted object
    // inside a frame it is no longer over.
    delete next.frameId;
    /**
     * And a grid module, for a sharper version of the same reason.
     *
     * A `gridSlot` names a grid *and an index within it*, so a copied picture
     * arrives claiming the exact module the original is still sitting in. Two
     * nodes then hold one module: the reflow computes the same box for both and
     * stacks them perfectly, so the copy is invisible, and which of them the
     * module "contains" depends on iteration order.
     *
     * Dropped rather than reassigned to a free module — a paste is not a
     * placement, and quietly filing the copy into some other part of the grid
     * is a decision the gesture did not make. It lands beside the original as
     * an ordinary picture, and dropping it onto a module puts it in one.
     */
    delete next.gridSlot;

    for (const end of ['from', 'to'] as const) {
      const value = next[end];
      if (value && typeof value === 'object' && typeof (value as any).nodeId === 'string') {
        const target = remap.get((value as any).nodeId);
        if (target) next[end] = { ...(value as object), nodeId: target };
      }
    }

    nodes.push(next);
    ids.push(id);
  }

  /**
   * The group *records*, remapped alongside the ids on the nodes.
   *
   * The ids on the nodes were already being remapped, which was the whole
   * answer while a group was nothing but a shared string. Now that a group is a
   * record with a parent of its own, the record has to come too — otherwise the
   * pasted nodes point at folders that do not exist, and the panel shows a copy
   * with no hierarchy at all.
   *
   * `remapGroups` also pulls in the *ancestors* of every copied group, so
   * copying an inner folder brings the outer one that gave it its place. A
   * folder whose parent was not part of the fragment comes out at the top
   * level, because the alternative is a paste that silently joins something the
   * user did not copy.
   */
  const { records } = remapGroups(
    groupTable,
    [...groups.keys()],
    (old) => groups.get(old) ?? nanoid()
  );

  return { nodes, ids, groups: records };
}

/**
 * Where a paste should land when there is no pointer to use.
 *
 * Offset from the originals rather than dropped exactly on top of them, so a
 * paste into the same board is visibly a second object rather than something
 * that looks like nothing happened. The same twenty units `duplicate` uses, so
 * the two gestures agree.
 */
export const PASTE_OFFSET = 20;

export function offsetOrigin(payload: ClipboardPayload): { x: number; y: number } {
  return { x: payload.origin.x + PASTE_OFFSET, y: payload.origin.y + PASTE_OFFSET };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How much room the copied set takes up.
 *
 * Needed because "will this paste be visible" is a question about the whole
 * fragment, not about its corner: a wide diagram whose top-left is just off the
 * left edge is mostly on screen, and treating its origin as the answer would
 * send it to the middle for no reason.
 *
 * Sizes are read defensively, because a payload can arrive from another tab, an
 * older version of this app, or somebody editing JSON.
 */
export function payloadBounds(payload: ClipboardPayload): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const raw of payload.nodes) {
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
    const x = raw.x as number;
    const y = raw.y as number;
    const w = Number.isFinite(raw.width) ? (raw.width as number) : 0;
    const h = Number.isFinite(raw.height) ? (raw.height as number) : 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  if (!Number.isFinite(minX)) {
    return { x: payload.origin.x, y: payload.origin.y, width: 0, height: 0 };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Where a paste with no pointer behind it should go.
 *
 * ## The bug this replaces
 *
 * A paste landed at the original's position plus twenty units, always. Copy
 * something, pan across the board, paste — and it arrived back where you copied
 * it from, off screen, with the selection now pointing at objects you cannot
 * see. Nothing appeared to happen, and whatever you did next happened to a
 * selection somewhere else entirely.
 *
 * ## Why not simply always paste into the middle
 *
 * Because the offset paste is *right* when you can see the original: it is what
 * makes repeated pastes step a copy down and to the right, and it is what
 * duplicate does. Always centring would move something you were watching.
 *
 * So the rule keeps both: **stay beside the original if any of it would be on
 * screen, otherwise come to the middle of what I am looking at.** The test is
 * against the pasted fragment's own box, not against its corner.
 */
export function pasteOrigin(payload: ClipboardPayload, viewport: Bounds): { x: number; y: number } {
  const offset = offsetOrigin(payload);
  const bounds = payloadBounds(payload);

  // Where the fragment's box would sit if it landed at the offset origin.
  const landed = {
    x: bounds.x + (offset.x - payload.origin.x),
    y: bounds.y + (offset.y - payload.origin.y),
  };

  const visible =
    landed.x < viewport.x + viewport.width &&
    landed.x + bounds.width > viewport.x &&
    landed.y < viewport.y + viewport.height &&
    landed.y + bounds.height > viewport.y;

  if (visible) return offset;

  /**
   * Centred on the viewport — and returned as the *origin* the caller wants,
   * which is the payload's own reference point rather than the fragment's
   * middle. The two differ whenever the copied set's bounding box does not
   * start at its origin, and conflating them puts a wide fragment off to one
   * side of the screen.
   */
  return {
    x: viewport.x + viewport.width / 2 - bounds.width / 2 + (payload.origin.x - bounds.x),
    y: viewport.y + viewport.height / 2 - bounds.height / 2 + (payload.origin.y - bounds.y),
  };
}
