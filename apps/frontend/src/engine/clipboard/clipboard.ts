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
