import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { doc, objectsMap, provider } from './doc';

/**
 * The write path for canvas objects.
 *
 * Every mutation goes through here so that invariants which used to be each
 * caller's responsibility — and which several callers therefore got wrong —
 * are enforced in exactly one place:
 *
 *  - **z-index.** Every tool stamped a literal `zIndex: 0`, so stacking order
 *    was decided by whatever order `Object.values()` happened to return and
 *    the Layers panel's ordering was meaningless. New nodes now always land
 *    on top.
 *  - **`updatedAt`.** Nothing ever wrote it after creation, so the Properties
 *    panel's "Updated At" permanently displayed the creation date.
 *  - **provenance and base fields.** `createdBy`/`createdAt`/`locked`/
 *    transform defaults were copy-pasted across seven tools, and drifted
 *    (TextTool and ShapeTool hardcoded `createdBy: 'local'`, which made every
 *    collaborator's panel claim they had authored every node in the room).
 */

/** Fields callers supply; everything else is stamped here. */
export interface NewNodeInput {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  id?: string;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  parentId?: string;
  [key: string]: unknown;
}

/**
 * Next free stacking slot, one above everything currently in the document.
 *
 * Two clients creating simultaneously can pick the same value; that is
 * acceptable (the CRDT converges and ties break deterministically by id) and
 * far better than the previous behaviour where *every* node shared z-index 0.
 */
export function nextZIndex(): number {
  let max = 0;
  objectsMap.forEach((node) => {
    const z = node.get('zIndex');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max + 1;
}

/** Lowest occupied stacking slot, for "send to back". */
export function lowestZIndex(): number {
  let min = 0;
  objectsMap.forEach((node) => {
    const z = node.get('zIndex');
    if (typeof z === 'number' && Number.isFinite(z) && z < min) min = z;
  });
  return min;
}

/** The local client's id, used as the authorship stamp. */
export function localAuthorId(): string {
  return provider.awareness?.clientID?.toString() ?? 'local';
}

/**
 * The local user's display identity.
 *
 * Denormalised onto every node at creation. A bare client id is useless once
 * that client disconnects — the Properties panel could only resolve names for
 * peers still in the room and fell back to "Unknown" for everyone else, and
 * stickies/audio notes each kept their own private copy under `metadata`.
 */
export function localAuthor(): { id: string; name: string; color: string } {
  const user = provider.awareness?.getLocalState()?.user as
    | { name?: string; color?: string }
    | undefined;
  return {
    id: localAuthorId(),
    name: user?.name ?? 'Unknown',
    color: user?.color ?? '#3B82F6',
  };
}

export function createNode(input: NewNodeInput): string {
  const now = Date.now();
  const id = input.id ?? nanoid();
  const author = localAuthor();

  const node: Record<string, unknown> = {
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    locked: false,
    hidden: false,
    ...input,
    id,
    createdBy: input.createdBy ?? author.id,
    createdByName: input.createdByName ?? author.name,
    createdByColor: input.createdByColor ?? author.color,
    createdAt: now,
    updatedAt: now,
    // Always a fresh top slot, even when the caller spread an existing node
    // (duplicate/paste) whose stale z-index would otherwise be inherited.
    zIndex: nextZIndex(),
  };

  const ymap = new Y.Map<unknown>();
  doc.transact(() => {
    Object.entries(node).forEach(([key, value]) => {
      if (value !== undefined) ymap.set(key, value);
    });
    objectsMap.set(id, ymap);
  });

  return id;
}

export function updateNode(id: string, updates: Record<string, unknown>): void {
  const ymap = objectsMap.get(id);
  if (!ymap) return;

  doc.transact(() => {
    Object.entries(updates).forEach(([key, value]) => {
      // `undefined` is not representable in a Y.Map — setting it stores a
      // literal undefined that survives toJSON() and defeats `?? fallback`
      // reads downstream. Callers use it to mean "remove this field"
      // (EditorAPI.ungroupNodes clears parentId that way).
      if (value === undefined) ymap.delete(key);
      else ymap.set(key, value);
    });
    ymap.set('updatedAt', Date.now());
  });
}

export function deleteNode(id: string): void {
  objectsMap.delete(id);
}

/** Snapshot of a single node, or null if it no longer exists. */
export function readNode(id: string): Record<string, unknown> | null {
  const ymap = objectsMap.get(id);
  return ymap ? (ymap.toJSON() as Record<string, unknown>) : null;
}

/** Snapshot of the whole document, keyed by id. */
export function readAllNodes(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  objectsMap.forEach((ymap, id) => {
    out[id] = ymap.toJSON() as Record<string, unknown>;
  });
  return out;
}
