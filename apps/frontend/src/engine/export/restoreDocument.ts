import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { doc, objectsMap, commentsMap, createNode, deleteNode, metadataMap } from '../document';
import type { ImportedDocument } from './DocumentImport';

export type RestoreMode = 'replace' | 'merge';

export interface RestoreSummary {
  added: number;
  removed: number;
  /** Comment threads written back. */
  comments: number;
  /** The name the board took from the file, when it took one. */
  title: string | null;
}

/**
 * Write an imported document into the live room.
 *
 * ## One transaction
 *
 * A restore of two hundred objects is one change, one undo step and one
 * broadcast — not two hundred of each. It also means collaborators never see a
 * half-restored board: with separate writes there is a window where the old
 * objects are gone and the new ones have not arrived, and anyone watching sees
 * the room empty itself.
 *
 * ## Why ids are regenerated when merging
 *
 * A merge brings a copy of the file *alongside* what is already here. If the
 * file came from this same room — which is the common case, since it is a
 * backup of it — every id already exists, so keeping them would overwrite the
 * live objects one by one instead of adding anything. That is a replace
 * wearing a merge's label, and it is the destructive one of the two.
 *
 * Replace keeps the original ids, because there is nothing left to collide
 * with and preserving them means a restored board is the same board — the same
 * connectors bind to the same boxes, and the same frames own the same children.
 */
export function restoreDocument(
  imported: ImportedDocument,
  mode: RestoreMode = 'replace'
): RestoreSummary {
  const summary: RestoreSummary = { added: 0, removed: 0, comments: 0, title: null };

  doc.transact(() => {
    if (mode === 'replace') {
      const existing = Array.from(objectsMap.keys());
      existing.forEach((id) => deleteNode(id));
      summary.removed = existing.length;
      // Threads belong to the board being replaced, not to the one arriving.
      // Left in place they would hang on the ids of objects that no longer
      // exist, so every pin would collapse onto the origin.
      Array.from(commentsMap.keys()).forEach((id) => commentsMap.delete(id));
    }

    /**
     * Old id → new id, so references between restored objects survive.
     *
     * A connector stores the ids of the two objects it joins, and a child
     * stores its frame's id. Regenerating ids without rewriting those would
     * restore a flowchart whose arrows point at nothing.
     */
    const remap = new Map<string, string>();
    if (mode === 'merge') {
      Object.keys(imported.nodes).forEach((id) => remap.set(id, nanoid()));
    }
    const idFor = (id: string) => remap.get(id) ?? id;

    for (const [id, node] of Object.entries(imported.nodes)) {
      const next: Record<string, unknown> = { ...node, id: idFor(id) };

      if (remap.size > 0) {
        if (typeof next.parentId === 'string') next.parentId = idFor(next.parentId);
        for (const end of ['from', 'to'] as const) {
          const value = next[end];
          if (value && typeof value === 'object' && typeof (value as any).nodeId === 'string') {
            next[end] = { ...(value as object), nodeId: idFor((value as any).nodeId) };
          }
        }
      }

      // Through `createNode` rather than writing the map directly, so every
      // restored object goes through the same normalisation and z-index
      // assignment a freshly drawn one does.
      createNode(next as Parameters<typeof createNode>[0]);
      summary.added += 1;
    }

    summary.comments = restoreComments(imported.comments, idFor, remap.size > 0);

    /**
     * The board's name comes back with it, but only on a replace.
     *
     * A replace is "this board is now that board", and a board that has taken
     * on every object of a backup while keeping a different name is half
     * restored -- the one field somebody uses to recognise it is the one field
     * left behind. A merge is the opposite case: the board is still itself and
     * has gained some contents, so renaming it out from under whoever is
     * looking at it would be wrong.
     *
     * Inside the transaction with everything else, so the name and the objects
     * arrive for collaborators in the same update.
     */
    if (mode === 'replace' && imported.title) {
      metadataMap.set('name', imported.title);
      summary.title = imported.title;
    }
  });

  return summary;
}

/**
 * Comment threads, written back into their own CRDT map.
 *
 * ## Why this was missing, and why it counts
 *
 * The exporter goes out of its way to include comments — it reaches into
 * `commentsMap` because they are not in the objects store, and its comment says
 * omitting them "silently dropped every comment thread from every export". The
 * importer then validates them and carries them on `ImportedDocument.comments`.
 * And nothing read that field. It was written by one side, parsed by the other,
 * and consumed by nobody: **dead**, in this project's own worst sense, and the
 * round trip quietly lost every thread on the board.
 *
 * ## The shape has to be rebuilt, not assigned
 *
 * A thread is a `Y.Map` whose `messages` key is a `Y.Array`. `toJSON()`
 * flattened both into plain objects on the way out, so handing that straight
 * back would store a plain array where every reader expects a `Y.Array` —
 * `addReply` would find no `push` and replying would fail on a restored thread.
 * Rebuilt structurally here, the same way `useComments` builds a new one.
 */
function restoreComments(
  threads: unknown[],
  idFor: (id: string) => string,
  remapping: boolean
): number {
  let count = 0;

  for (const raw of threads) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const thread = raw as Record<string, unknown>;
    const id = typeof thread.id === 'string' ? thread.id : null;
    if (!id) continue;

    const map = new Y.Map<unknown>();
    // A merge gives every thread a new id for the same reason it gives every
    // node one: restoring a backup of this room alongside itself must add
    // threads rather than overwrite the live ones.
    map.set('id', remapping ? nanoid() : id);
    map.set('x', typeof thread.x === 'number' ? thread.x : 0);
    map.set('y', typeof thread.y === 'number' ? thread.y : 0);
    map.set('resolved', thread.resolved === true);
    map.set('createdAt', typeof thread.createdAt === 'number' ? thread.createdAt : Date.now());
    // A pin anchored to an object has to follow that object's new id, or it
    // detaches and floats at the world origin.
    if (typeof thread.objectId === 'string') map.set('objectId', idFor(thread.objectId));

    const messages = new Y.Array<unknown>();
    if (Array.isArray(thread.messages)) {
      messages.push(thread.messages.filter((m) => m && typeof m === 'object'));
    }
    map.set('messages', messages);

    commentsMap.set(map.get('id') as string, map);
    count += 1;
  }

  return count;
}
