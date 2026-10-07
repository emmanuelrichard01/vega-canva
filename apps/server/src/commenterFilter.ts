import * as Y from 'yjs';

/**
 * What a commenter's connection may change in a board, enforced on the server.
 *
 * Hocuspocus can only make a connection fully read-only, and a commenter has
 * to write: comment threads, and reactions on a node. So each update from a
 * commenter is applied first to a scratch copy of the document, every type it
 * changed is traced back to the root it hangs from, and the update is refused
 * unless all of them are in the commenter's part of the document.
 *
 * The rules mirror the client's own gate (`canPostComments` in the frontend's
 * `permissions.ts`, used by `useComments` and `toggleReaction`):
 *
 * - `comments`: anything. Threads, messages, edits, deletions.
 * - `identities`: a display name and colour per client.
 * - `objects`: only inside a node's `reactions`, plus the node's `reactions`
 *   and `updatedAt` keys, which a reaction toggle sets. Creating, deleting or
 *   otherwise editing a node is refused.
 * - Anything else (`groups`, `metadata`, `guides`, `history`, ...): refused.
 *
 * An update that cannot be fully integrated (it depends on structs the server
 * has not seen) is refused too. Otherwise its parts would sit pending and be
 * integrated later by somebody else's update, past this check.
 */

export type CommenterVerdict = { ok: true } | { ok: false; reason: string };

const OPEN_ROOTS = new Set(['comments', 'identities']);
const NODE_KEYS_A_REACTION_SETS = new Set(['reactions', 'updatedAt']);

function rootName(doc: Y.Doc, root: Y.AbstractType<any>): string | null {
  for (const [name, type] of doc.share) if (type === root) return name;
  return null;
}

/** The keys from the root down to `type`; `'#'` marks a position in a sequence. */
function pathOf(type: Y.AbstractType<any>): { root: Y.AbstractType<any>; path: string[] } {
  const path: string[] = [];
  let current = type;
  while (current._item) {
    path.unshift(current._item.parentSub ?? '#');
    current = current._item.parent as Y.AbstractType<any>;
  }
  return { root: current, path };
}

function judge(name: string | null, path: string[], keys: Set<string | null>): string | null {
  if (name !== null && OPEN_ROOTS.has(name)) return null;
  if (name !== 'objects') return `writes to "${name ?? 'unknown'}"`;
  if (path.length === 0) return 'adds or removes a node';
  if (path.length === 1) {
    for (const key of keys) {
      if (key === null || !NODE_KEYS_A_REACTION_SETS.has(key)) return `edits node field "${key}"`;
    }
    return null;
  }
  return path[1] === 'reactions' ? null : `edits node field "${path[1]}"`;
}

export function commenterMayApply(doc: Y.Doc, update: Uint8Array): CommenterVerdict {
  const scratch = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));

    let refusal: string | null = null;
    scratch.on('afterTransaction', (tr: Y.Transaction) => {
      for (const [type, keys] of tr.changed) {
        const { root, path } = pathOf(type);
        const why = judge(rootName(scratch, root), path, keys);
        if (why) {
          refusal ??= why;
          return;
        }
      }
    });

    try {
      Y.applyUpdate(scratch, update);
    } catch {
      return { ok: false, reason: 'unreadable update' };
    }

    if (refusal) return { ok: false, reason: refusal };
    if (scratch.store.pendingStructs || scratch.store.pendingDs) {
      return { ok: false, reason: 'depends on changes the server has not seen' };
    }
    return { ok: true };
  } finally {
    scratch.destroy();
  }
}
