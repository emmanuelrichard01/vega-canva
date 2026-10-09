import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { doc, groupsMap, identitiesMap, metadataMap, objectsMap, provider } from './doc';
import type { GroupPlan, GroupRecord } from '../model/groupTree';
import { applyReactionToggle, seedReactions } from './reactions';
import { frameForNode } from '../model/frames';
import { getColorForUser } from '../presence/ColorPalette';
import { canEditObjects, canPostComments, getRoomRole } from '../model/permissions';
import { writeTable } from '../table/tableCrdt';
import type { TableSpec } from '../table/tableTypes';

/**
 * The write path for canvas objects, groups and board metadata.
 *
 * Invariants enforced here rather than by each caller:
 *
 *  - **z-index.** New nodes land on top of the stack.
 *  - **`updatedAt` / `updatedBy`.** Stamped on every write a person makes.
 *  - **provenance and base fields.** `createdBy`/`createdAt`/`locked` and
 *    transform defaults are stamped here; a caller's own `createdBy` is
 *    ignored unless it is restoring a backup.
 *  - **the role gate** (`refuseWrite`).
 *
 * Comments, ruler guides, backup restore and migrations write their own
 * shared state elsewhere, and check the same role there.
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
 * Two clients creating simultaneously can pick the same value. Every reader
 * orders with `compareStacking` (engine/model/stacking.ts), which breaks ties
 * by id, so the tie stacks the same way on every screen.
 */
export function nextZIndex(): number {
  return highestZIndex() + 1;
}

function highestZIndex(): number {
  let max = 0;
  objectsMap.forEach((node) => {
    const z = node.get('zIndex');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

type FrameBox = { id: string; x: number; y: number; width: number; height: number; zIndex: number };

function frameBoxes(): FrameBox[] {
  const frames: FrameBox[] = [];
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
  return frames;
}

/**
 * The stacking top and the frames, for a run of creates inside one transaction.
 *
 * `createNode` needs both, and each is a walk over the whole document. A
 * template, a paste or a restore creates hundreds of nodes in one transaction,
 * so walking per create made the run quadratic: 5,000 objects took 27 s, 2,000
 * took 4 s. Inside one transaction nothing outside this module can add an
 * object or move one (every object write goes through here), so the walk is
 * done once per transaction and `createNode` keeps it current as it adds
 * nodes. Any other gated write in this module drops it (they all pass
 * through `refuseWrite` first), and a new transaction starts from a fresh walk.
 */
let createScan: { transaction: unknown; top: number; frames: FrameBox[] } | null = null;

function scanForCreate(): { top: number; frames: FrameBox[] } {
  const transaction = doc._transaction;
  if (!transaction) {
    createScan = null;
    return { top: highestZIndex(), frames: frameBoxes() };
  }
  if (createScan?.transaction !== transaction) {
    createScan = { transaction, top: highestZIndex(), frames: frameBoxes() };
  }
  return createScan;
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
}, frames: FrameBox[]): string | null {
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
  // A viewer's connection is read-only, so the write would only fork their copy.
  if (!canPostComments()) return;
  const id = localAuthorId();
  if (id === 'local') return; // awareness not ready; the caller retries on change
  const existing = identitiesMap.get(id);
  if (existing && existing.name === name && existing.color === color) return;
  identitiesMap.set(id, { name, color });
}

/**
 * The one gate a role actually needs.
 *
 * ## Why it is here and not on the controls
 *
 * Every edit of a canvas object ends here, which makes this the one place
 * the permission can be enforced and be true everywhere -- the same argument
 * `ToolManager.setActiveTool` makes for tools, and for the same reason: every
 * route ends here, so refusing here refuses the dock, the contextual rail, the
 * properties panel, the keyboard, the command palette, a lesson driving the
 * board for you, and whatever gets added next year by somebody who never read
 * this file.
 *
 * Gating the *controls* was the alternative and it had already failed. Tools
 * and dragging were gated; the contextual rail was not, so a viewer could
 * still set a colour, embolden a label and italicise text. Every one of those
 * was a control that looked like it worked, wrote to the local document, and
 * was then silently dropped by a server that had marked the connection
 * read-only -- so the viewer saw a change nobody else could see, and their copy
 * of the board quietly forked from everyone else's.
 *
 * That is the worst outcome available: not a refusal, but a divergence that
 * looks like success. Hiding controls is presentation. This is the rule.
 *
 * ## Why not "enforce focus mode"
 *
 * Because it enforces nothing. Focus mode is a *viewing preference* the person
 * can switch straight back off, and hiding a button has never stopped the
 * keyboard shortcut behind it. A permission that can be undone from the View
 * menu is decoration -- which is precisely the mistake the share roles started
 * out making, when the client picked its own role and the server believed it.
 */
function refuseWrite(what: string): boolean {
  if (what !== 'createNode') createScan = null;
  if (canEditObjects()) return false;

  // Loud in development, silent in production. A refusal reaching this point
  // means some control offered an edit it should not have -- a bug to fix at
  // the control, not a message to show a person who was never told they could.
  if (import.meta.env.DEV) {
    console.warn(
      `[permissions] ${what} refused: this session is "${getRoomRole()}". ` +
        'The control that called it should not have been offered.'
    );
  }
  return true;
}

export interface CreateNodeOptions {
  /**
   * Keep the `createdBy*` fields the input carries. Only a backup restore
   * should: it is putting back authorship the document already recorded.
   * Everything else, paste and duplicate included, is authored by whoever
   * performs it.
   */
  preserveAuthorship?: boolean;
  /**
   * Keep the `reactions` the input carries without taking its authorship.
   * For a template seed, whose stamps are part of the board it ships.
   */
  keepReactions?: boolean;
}

export function createNode(input: NewNodeInput, options: CreateNodeOptions = {}): string {
  // Returns '' rather than throwing: callers place the node and move on, and a
  // throw here would take out a drop of nine images on the first one.
  if (refuseWrite('createNode')) return '';
  const now = Date.now();
  const id = input.id ?? nanoid();
  const author = localAuthor();
  const scan = scanForCreate();
  const zIndex = scan.top + 1;

  const node: Record<string, unknown> = {
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    locked: false,
    hidden: false,
    ...input,
    id,
    createdBy: (options.preserveAuthorship && input.createdBy) || author.id,
    createdByName: (options.preserveAuthorship && input.createdByName) || author.name,
    createdByColor: (options.preserveAuthorship && input.createdByColor) || author.color,
    createdAt: now,
    updatedAt: now,
    updatedBy: undefined,
    updatedByName: undefined,
    // Always a fresh top slot, even when the caller spread an existing node
    // (duplicate/paste) whose stale z-index would otherwise be inherited.
    zIndex,
  };
  // A copy starts with nobody's reactions: those were responses to the original.
  if (!options.preserveAuthorship && !options.keepReactions) delete node.reactions;

  // Derived from where the node actually is, not from `input` — a duplicate or
  // a paste spreads the original's `frameId`, which is the wrong frame the
  // moment the copy lands somewhere else. `?? undefined` because a null here
  // would be written into the Y.Map as a literal null and defeat every
  // `if (node.frameId)` downstream; undefined is dropped by the loop below.
  // Connectors must NEVER belong to frames: they route across the canvas and
  // must never be clipped to a frame container.
  node.frameId =
    input.type === 'connector'
      ? undefined
      : (frameToJoin({
          id,
          type: input.type,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
        }, scan.frames) ?? (typeof input.frameId === 'string' ? input.frameId : undefined));

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

  // Keep the transaction's scan in step with what was just written.
  scan.top = Math.max(scan.top, zIndex);
  const replaced = scan.frames.findIndex((frame) => frame.id === id);
  if (replaced >= 0) scan.frames.splice(replaced, 1);
  if (node.type === 'frame') {
    scan.frames.push({
      id,
      x: (node.x as number) ?? 0,
      y: (node.y as number) ?? 0,
      width: (node.width as number) ?? 0,
      height: (node.height as number) ?? 0,
      zIndex,
    });
  }

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
  if (refuseWrite('updateNode')) return;
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
    stampUpdatedBy(ymap, localAuthorId());
  });
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Write a table node's spec — as a diff into its merged shape, so other
 * people's edits to other cells survive (`tableCrdt.ts`) — together with any
 * size change, in one transaction: one undo step, which takes back only this
 * person's changes. A table still stored as one whole value is converted on
 * this first write.
 *
 * `prev` is the spec the edit was made from (the node as last read), so
 * unchanged rows are skipped without reading the document.
 */
export function updateTableNode(
  id: string,
  spec: TableSpec,
  prev: TableSpec | undefined,
  patch: Record<string, unknown> = {}
): void {
  if (refuseWrite('updateTableNode')) return;
  const ymap = objectsMap.get(id);
  if (!ymap) return;
  doc.transact(() => {
    writeTable(ymap, spec, prev);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined) ymap.delete(key);
      else ymap.set(key, value);
    });
    // The merged shape counts rows the spreadsheet's way; the mark says so
    // where an older build writing the node back cannot strip it.
    if (ymap.get('tableRefs') !== 2) ymap.set('tableRefs', 2);
    ymap.set('updatedAt', Date.now());
    stampUpdatedBy(ymap, localAuthorId());
  });
}

function stampUpdatedBy(ymap: Y.Map<unknown>, author: string): void {
  if (ymap.get('updatedBy') === author) return;
  ymap.set('updatedBy', author);
  ymap.set('updatedByName', localAuthor().name);
}

/** Options for writes made on the document's behalf rather than a person's. */
export interface WriteOptions {
  /**
   * Transaction origin. Pass `DERIVED_ORIGIN` for reflows and repairs so the
   * write stays out of undo and does not claim a person as its author.
   */
  origin?: unknown;
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
  if (refuseWrite('updateNodes')) return;
  if (ids.length === 0) return;
  const now = Date.now();
  const author = localAuthorId();
  doc.transact(() => {
    ids.forEach((id) => {
      const ymap = objectsMap.get(id);
      if (!ymap) return;
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined) ymap.delete(key);
        else ymap.set(key, value);
      });
      ymap.set('updatedAt', now);
      stampUpdatedBy(ymap, author);
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
  patches: ReadonlyArray<{ id: string; changes: Record<string, unknown> }>,
  options: WriteOptions = {}
): void {
  if (refuseWrite('applyNodePatches')) return;
  if (patches.length === 0) return;
  const now = Date.now();
  const derived = options.origin !== undefined && options.origin !== null;
  const author = localAuthorId();
  doc.transact(() => {
    patches.forEach(({ id, changes }) => {
      const ymap = objectsMap.get(id);
      if (!ymap) return;
      Object.entries(changes).forEach(([key, value]) => {
        if (value === undefined) ymap.delete(key);
        else ymap.set(key, value);
      });
      if (derived) return;
      ymap.set('updatedAt', now);
      stampUpdatedBy(ymap, author);
    });
  }, options.origin ?? null);
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
export function applyGroupPlan(plan: GroupPlan, options: WriteOptions = {}): void {
  if (refuseWrite('applyGroupPlan')) return;
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
  }, options.origin ?? null);
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
  if (refuseWrite('renameGroup')) return;
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
  // Not `refuseWrite`: a reaction is nearer a comment than an edit, so a
  // commenter keeps it and only a viewer is turned away.
  if (!canPostComments()) return;
  const ymap = objectsMap.get(nodeId);
  if (!ymap) return;
  doc.transact(() => {
    applyReactionToggle(ymap, emoji, authorId);
  });
}

export function deleteNode(id: string): void {
  if (refuseWrite('deleteNode')) return;
  const ymap = objectsMap.get(id);
  if (ymap) {
    revokeIfBlobUrl(ymap.get('src'));
  }
  objectsMap.delete(id);
}

/**
 * Write a board-level setting (its name, whether its link unfurls).
 *
 * Gated like every other edit: the server drops a viewer's writes, so letting
 * one through would only fork that viewer's copy of the board.
 */
export function setBoardMetadata(key: string, value: string): void {
  if (refuseWrite('setBoardMetadata')) return;
  metadataMap.set(key, value);
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
