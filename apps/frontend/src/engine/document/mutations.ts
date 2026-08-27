import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { doc, groupsMap, identitiesMap, objectsMap, provider } from './doc';
import type { GroupPlan, GroupRecord } from '../model/groupTree';
import { applyReactionToggle, seedReactions } from './reactions';
import { frameForNode } from '../model/frames';
import { getColorForUser } from '../presence/ColorPalette';

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

/**
 * The frame a node created at this box should be born inside, if any.
 *
 * Membership is derived from geometry and recomputed whenever an object stops
 * moving — but *creation* is a move that never happens, so a rectangle drawn
 * inside a frame, a sticky dropped into one, a pasted copy, an imported image:
 * all of them landed visibly inside a frame owning nothing, unclipped, and left
 * behind the moment the frame was dragged. Nudging each one a pixel was the
 * only way to make it join.
 *
 * Decided here rather than in the eight tools that create things, for the same
 * reason z-index is: a rule that has to be remembered in eight places is a rule
 * that will hold in seven. Reads `objectsMap` directly so the write path keeps
 * no dependency on the store or on `frameMembership`, which imports this file.
 */
function frameToJoin(box: {
  id: string;
  /**
   * Carried because a frame is placed by a stricter rule than anything else —
   * see `frameForNode`. Omitting it here is what let a frame drawn inside
   * another one become that frame's *parent* at the moment it was created.
   */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): string | null {
  const frames: Array<{ id: string; x: number; y: number; width: number; height: number; zIndex: number }> = [];
  objectsMap.forEach((node, id) => {
    if (node.get('type') !== 'frame') return;
    frames.push({
      id,
      x: (node.get('x') as number) ?? 0,
      y: (node.get('y') as number) ?? 0,
      width: (node.get('width') as number) ?? 0,
      height: (node.get('height') as number) ?? 0,
      zIndex: (node.get('zIndex') as number) ?? 0,
    });
  });
  if (frames.length === 0) return null;
  return frameForNode(box, frames);
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

/**
 * The local **person's** id, used as the authorship stamp.
 *
 * This returned `awareness.clientID`, which is a **per-session** number: Yjs
 * mints a fresh one every time the document is constructed, so it changed on
 * every reload, in every tab, forever. Everything that asks "is this mine?"
 * was therefore asking "did I do this in *this* browser session?" — which
 * quietly broke the two places it matters most:
 *
 * - **Comments.** Edit and delete are author-only and compare against this. A
 *   reload made your own comments read-only to you, permanently.
 * - **Attribution.** `createdBy` is stamped on every node, so one person's
 *   work across two sessions looked like two people's.
 *
 * Worse than useless, it is *reassigned*: Yjs client ids are random 32-bit
 * numbers, so a future visitor can be handed an id that an old comment was
 * written under and inherit the right to edit it.
 *
 * The stable id is the one `AuthContext` mints and persists, published on the
 * awareness `user` field. The client id remains the fallback for the moment
 * before sign-in has been published.
 */
export function localAuthorId(): string {
  const user = provider.awareness?.getLocalState()?.user as { id?: string } | undefined;
  if (typeof user?.id === 'string' && user.id) return user.id;
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
  const id = localAuthorId();
  return {
    id,
    name: user?.name ?? 'Unknown',
    /**
     * The fallback comes from the presence palette, not from a literal.
     *
     * This was a hardcoded blue, which is both a colour outside the design
     * system and — more to the point — a *different* colour from the one every
     * other surface shows for the same person. `getColorForUser` derives a
     * stable colour from the id, so a node stamped before awareness has
     * published gets the same colour the cursor, the radar and the avatar will
     * use a moment later, instead of a blue that never appears again.
     */
    color: user?.color ?? getColorForUser(id),
  };
}

/**
 * Record the local user's display identity in the document, once per session.
 *
 * Awareness carries this for live presence, but awareness is ephemeral and
 * never lands in the update log — so replay could only name people who had
 * created a node. Writing it here means a person who joins and only *edits*
 * still gets attributed by name in Time Travel.
 *
 * Guarded so it costs one tiny transaction per participant rather than one per
 * reload: an unchanged identity writes nothing.
 */
export function publishLocalIdentity(name: string, color: string): void {
  const id = localAuthorId();
  if (id === 'local') return; // awareness not ready; the caller retries on change
  const existing = identitiesMap.get(id);
  if (existing && existing.name === name && existing.color === color) return;
  identitiesMap.set(id, { name, color });
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

  // Derived from where the node actually is, not from `input` — a duplicate or
  // a paste spreads the original's `frameId`, which is the wrong frame the
  // moment the copy lands somewhere else. `?? undefined` because a null here
  // would be written into the Y.Map as a literal null and defeat every
  // `if (node.frameId)` downstream; undefined is dropped by the loop below.
  node.frameId =
    frameToJoin({
      id,
      type: input.type,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
    }) ??
    undefined;

  const ymap = new Y.Map<unknown>();
  doc.transact(() => {
    Object.entries(node).forEach(([key, value]) => {
      if (value !== undefined) ymap.set(key, value);
    });
    // `reactions` is created here, as a real `Y.Map`, and never lazily on the
    // first reaction. Creating the container on demand looks harmless and is
    // the whole bug over again: two people reacting to a *fresh* note each
    // build their own `Y.Map` and `set` it at the same key, so one map — and
    // the reaction inside it — is discarded. The container has to exist before
    // anyone can race for it. See `reactions.ts`.
    if (node.type === 'sticky') seedReactions(ymap, node.reactions);
    objectsMap.set(id, ymap);
  });

  return id;
}

function revokeIfBlobUrl(url: unknown): void {
  if (
    typeof url === 'string' &&
    url.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore already revoked URLs */
    }
  }
}

export function updateNode(id: string, updates: Record<string, unknown>): void {
  const ymap = objectsMap.get(id);
  if (!ymap) return;

  if ('src' in updates) {
    const oldSrc = ymap.get('src');
    if (oldSrc && oldSrc !== updates.src) {
      revokeIfBlobUrl(oldSrc);
    }
  }

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

    /**
     * Who touched it last, alongside when — but **only when the answer
     * changes**.
     *
     * `updatedAt` has been stamped here since this file existed and `updatedBy`
     * was never recorded, so the Metadata panel could say a node changed four
     * minutes ago and not who changed it — on a board with thirty people that
     * is the half of the fact worth having, and "Created by Ada, updated four
     * minutes ago" reads as though Ada did it when often she did not.
     *
     * The guard is not a micro-optimisation. Writing both fields
     * unconditionally put an id *and a display name string* into every single
     * transaction — and a drag emits one every few frames, so a five-second
     * drag wrote the same name fifty times. That inflates the update log, which
     * is the CRDT's append-only history: it costs storage, it costs bandwidth
     * on every sync, and it costs Time Travel most of all, because replay has
     * to decode and apply every one of those transactions. The first version of
     * this made an already-heavy replay materially heavier.
     *
     * Comparing first means a run of edits by one person writes the pair once.
     * A `Y.Map` read is local and cheap; the write is neither.
     */
    const author = localAuthorId();
    if (ymap.get('updatedBy') !== author) {
      ymap.set('updatedBy', author);
      ymap.set('updatedByName', localAuthor().name);
    }
  });
}

/**
 * Apply the same updates to several nodes at once.
 *
 * One transaction, not one per node, and the difference is not merely
 * efficiency. A Yjs transaction is the unit that observers, the undo stack and
 * the Time Travel timeline all see: setting a fill across four objects in four
 * transactions is four document changes, so it re-renders four times, lands in
 * history as four entries, and takes four presses of undo to put back — none
 * of which matches the single action the person took.
 *
 * Missing ids are skipped rather than throwing. The selection is held in React
 * state and the document is edited by other people, so a node can legitimately
 * disappear between the render that offered the control and the click on it.
 */
export function updateNodes(ids: readonly string[], updates: Record<string, unknown>): void {
  if (ids.length === 0) return;
  const now = Date.now();
  doc.transact(() => {
    ids.forEach((id) => {
      const ymap = objectsMap.get(id);
      if (!ymap) return;
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined) ymap.delete(key);
        else ymap.set(key, value);
      });
      ymap.set('updatedAt', now);
    });
  });
}

/**
 * Apply a different set of updates to each of several nodes, in one
 * transaction.
 *
 * What `updateNodes` is for a shared value, this is for a derived one: moving
 * a multi-selection gives every node its own new coordinate, and those writes
 * are still one action. See `engine/model/selection.ts`, which computes the
 * patches.
 */
export function applyNodePatches(
  patches: ReadonlyArray<{ id: string; changes: Record<string, unknown> }>
): void {
  if (patches.length === 0) return;
  const now = Date.now();
  doc.transact(() => {
    patches.forEach(({ id, changes }) => {
      const ymap = objectsMap.get(id);
      if (!ymap) return;
      Object.entries(changes).forEach(([key, value]) => {
        if (value === undefined) ymap.delete(key);
        else ymap.set(key, value);
      });
      ymap.set('updatedAt', now);
    });
  });
}

/**
 * Apply a group plan: create, reparent and delete, as one act.
 *
 * ## Why this is one function and not three calls
 *
 * Grouping writes to both maps — a record into `groups`, a `parentId` onto
 * every member — and those two writes are only meaningful together. Split
 * across transactions, a peer receiving them in between sees nodes pointing at
 * a group that does not exist yet, and undo has a step where the folder is
 * there and empty. One `doc.transact` makes it one update, one history entry,
 * one undo, and one thing a peer can observe.
 *
 * The plan itself is computed by `engine/model/groupTree`, which is pure and
 * tested — including the parts that are tedious to reach by clicking, like
 * grouping a selection that happens to *be* a whole group, or a drag that
 * would put a folder inside itself.
 */
export function applyGroupPlan(plan: GroupPlan): void {
  const touchesNothing =
    plan.nodes.length === 0 && plan.groups.length === 0 && !plan.create && plan.remove.length === 0;
  if (touchesNothing) return;

  const now = Date.now();
  doc.transact(() => {
    if (plan.create) groupsMap.set(plan.create.id, stripUndefined(plan.create));

    for (const { id, parentId } of plan.groups) {
      const existing = groupsMap.get(id);
      if (!existing) continue;
      groupsMap.set(id, stripUndefined({ ...existing, parentId }));
    }

    for (const { id, parentId } of plan.nodes) {
      const ymap = objectsMap.get(id);
      if (!ymap) continue;
      if (parentId === undefined) ymap.delete('parentId');
      else ymap.set('parentId', parentId);
      ymap.set('updatedAt', now);
    }

    // Deleted last, so a group being emptied and a group being removed in the
    // same plan cannot resurrect each other through ordering.
    for (const id of plan.remove) groupsMap.delete(id);
  });
}

/**
 * `undefined` is a value in a Y.Map, and it is not the same as absent.
 *
 * A record stored with `parentId: undefined` round-trips through sync as a key
 * that exists and holds nothing, which every `?? ` and `if (parentId)` in the
 * tree code then has to agree about. Dropping the key is the only form that
 * means "top level" unambiguously.
 */
function stripUndefined(record: GroupRecord): GroupRecord {
  const out: GroupRecord = { id: record.id };
  if (record.parentId !== undefined) out.parentId = record.parentId;
  if (record.name !== undefined) out.name = record.name;
  if (record.grid !== undefined) out.grid = record.grid;
  return out;
}

/** Rename a group. The one field of a group anybody edits directly. */
export function renameGroup(id: string, name: string): void {
  const existing = groupsMap.get(id);
  if (!existing) return;
  groupsMap.set(id, stripUndefined({ ...existing, name: name.trim() || undefined }));
}

/**
 * Add or remove your reaction to a node.
 *
 * The one node field stored as a **nested Y type** rather than a plain value,
 * and the reason is the whole point of the feature. Every other field —
 * position, text, colour — is edited by one person at a time, so
 * last-write-wins is the right and simplest model for them. Reactions are the
 * opposite: they are *designed* to be written by several people at the same
 * moment, and a plain value means the last write erases the others.
 *
 * As a `Y.Map<emoji, Y.Array<authorId>>`:
 * - two people reacting with different emoji never touch the same key;
 * - two people reacting with the *same* emoji both land, because concurrent
 *   inserts into a `Y.Array` merge instead of clobbering.
 *
 * `toJSON()` flattens this back to `Record<emoji, string[]>`, so nothing
 * downstream of the document layer knows or cares that it is a Y type.
 *
 * **Do not write `reactions` through `updateNode`.** That sets a plain object
 * and would replace the shared structure with a snapshot of one client's view
 * of it, reintroducing exactly the lost-update bug this exists to fix.
 */
export function toggleReaction(nodeId: string, emoji: string, authorId: string): void {
  const ymap = objectsMap.get(nodeId);
  if (!ymap) return;
  doc.transact(() => {
    applyReactionToggle(ymap, emoji, authorId);
  });
}

export function deleteNode(id: string): void {
  const ymap = objectsMap.get(id);
  if (ymap) {
    revokeIfBlobUrl(ymap.get('src'));
  }
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
