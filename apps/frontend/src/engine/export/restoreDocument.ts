import { nanoid } from 'nanoid';
import { doc, objectsMap, createNode, deleteNode } from '../document';
import type { ImportedDocument } from './DocumentImport';

export type RestoreMode = 'replace' | 'merge';

export interface RestoreSummary {
  added: number;
  removed: number;
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
  const summary: RestoreSummary = { added: 0, removed: 0 };

  doc.transact(() => {
    if (mode === 'replace') {
      const existing = Array.from(objectsMap.keys());
      existing.forEach((id) => deleteNode(id));
      summary.removed = existing.length;
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
  });

  return summary;
}
