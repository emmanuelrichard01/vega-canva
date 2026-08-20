import * as Y from 'yjs';
import { normalizeNode } from '../document/normalize';
import { nodeLabel } from '../model/nodeLabel';
import { unionBounds, type FitBounds } from '../cameraFit';

/**
 * Turns the server's raw CRDT update log into a human session timeline.
 *
 * ## Why this exists
 *
 * Time Travel used to scrub the raw log directly and label the playhead
 * "Change 5 of 8". A row in `room_updates` is one Yjs transaction — the unit
 * the *storage layer* happens to use, not a unit anyone authored. Dragging one
 * sticky across the canvas emits dozens of them; renaming it emits one. So the
 * scrubber's steps were wildly uneven, nothing said who did anything, and
 * there was no way to seek to a moment you actually remembered.
 *
 * Replaying the update stream is still the right substrate, and deliberately
 * so: it captures *every* change regardless of origin, including drag moves
 * and physics settles that never pass through the editor command layer. The
 * fix is not to replace the substrate but to read meaning out of it. We apply
 * the updates once into a scratch document, watch what each one actually did,
 * and fold runs of related transactions into single described moments.
 *
 * The result is that the playhead moves through "Ada moved Idea Card" rather
 * than "Change 5 of 8", while replay fidelity is unchanged.
 *
 * ## Seeking
 *
 * Yjs updates cannot be un-applied, so rewinding means rebuilding. Rebuilding
 * from index 0 on every backwards scrub is O(n) per frame, which made scrubbing
 * a long session progressively slower the further in you were. We therefore
 * also capture periodic keyframes — encoded document states — so a seek only
 * has to replay from the nearest keyframe at or before the target.
 */

/** One row of the server's `room_updates` log, as returned by `/rooms/:id/history`. */
export interface RawUpdate {
  createdAt: string;
  /** Base64-encoded Yjs update. */
  update: string;
}

export type MomentKind =
  | 'create'
  | 'delete'
  | 'move'
  | 'resize'
  | 'text'
  | 'style'
  | 'order'
  | 'visibility'
  | 'mixed';

export interface Moment {
  /**
   * Index of the last raw update folded into this moment — i.e. the seek
   * target that reproduces the document as it stood once the moment finished.
   */
  index: number;
  /** Index of the first raw update in the run, for "rewind to before this". */
  firstIndex: number;
  /** Epoch ms of the moment's last update. */
  at: number;
  kind: MomentKind;
  /** Nodes this moment touched. */
  ids: string[];
  authorId: string | null;
  authorName: string;
  authorColor: string;
  /** A sentence: "Ada moved Idea Card". */
  label: string;
  /** How many raw transactions were folded in — the "weight" of the moment. */
  updateCount: number;
}

export interface Keyframe {
  /** Applying `state` to an empty doc reproduces the document through this index. */
  index: number;
  state: Uint8Array;
}

export interface SessionTimeline {
  moments: Moment[];
  keyframes: Keyframe[];
  /** Raw transaction count — what the old UI called "changes". */
  totalUpdates: number;
  /** Distinct contributors, in first-seen order, for the timeline legend. */
  authors: { id: string; name: string; color: string }[];
  /**
   * Everywhere the session ever reached, so replay can frame it once.
   *
   * The union across *every* moment, not the extent of the final document.
   * Framing the end state is the obvious thing and it is wrong in both
   * directions on an infinite canvas: an object created far out and later
   * deleted is outside the final box, and an object dragged across the board
   * occupies ground the final box does not include — so playback would run
   * partly off screen, which reads as objects failing to appear at all.
   *
   * Accumulated during the pass that is already walking every update, so it
   * costs a box comparison per touched node and nothing else. `null` when the
   * session never contained anything with a position.
   */
  bounds: FitBounds | null;
}

export interface BuildOptions {
  /**
   * Consecutive same-author, same-kind, same-target transactions closer than
   * this are one moment. A drag emits a transaction every few frames, so the
   * window has to comfortably exceed the gap between them without swallowing
   * two deliberate, separate actions.
   */
  coalesceWindowMs?: number;
  /**
   * Upper bound on retained keyframes. Each one costs a full encoded document,
   * so this trades memory for seek latency rather than growing without limit.
   */
  maxKeyframes?: number;
}

const DEFAULT_COALESCE_MS = 1200;
const DEFAULT_MAX_KEYFRAMES = 32;

const FIELD_KIND: Record<string, MomentKind> = {
  x: 'move',
  y: 'move',
  width: 'resize',
  height: 'resize',
  rotation: 'resize',
  scaleX: 'resize',
  scaleY: 'resize',
  text: 'text',
  zIndex: 'order',
  parentId: 'order',
  locked: 'visibility',
  hidden: 'visibility',
  pinned: 'visibility',
  title: 'text',
};

/** Everything else that is a paint/typography concern rather than form. */
const STYLE_FIELDS = new Set([
  'appearance',
  'typography',
  'theme',
  'fontSize',
  'opacity',
  'filters',
  'crop',
  'reactions',
  'tags',
  'src',
  'geometry',
  'resolved',
  'transcript',
]);

/**
 * Bookkeeping stamped by the write path rather than chosen by a person.
 *
 * `mutations.updateNode` sets these on *every* write, so without this every
 * edit arrived carrying an unclassifiable field and collapsed to "mixed" — the
 * timeline said "Dave changed Ship the beta" where it should have said "moved"
 * or "edited". These are invisible to classification, and a transaction
 * touching nothing else is not an authored moment at all.
 *
 * **This list has to move whenever the write path learns to stamp something
 * new.** It is a second record of what `updateNode` writes, with no compiler
 * holding the two together — invariant 7 in its purest form. `updatedBy` and
 * `updatedByName` were added to the write path and missed here, and the tests
 * did not notice because their fixtures build updates by hand rather than going
 * through `updateNode`, so nothing in them ever carried the new fields. The
 * test below now asserts the set against the real stamping instead.
 */
const BOOKKEEPING_FIELDS = new Set([
  'updatedAt',
  'updatedBy',
  'updatedByName',
  'createdAt',
  'id',
]);

/**
 * Exported so a test can hold it against what `mutations.updateNode` actually
 * stamps, rather than against a second hand-written list.
 */
export const BOOKKEEPING_FIELD_NAMES: readonly string[] = Array.from(BOOKKEEPING_FIELDS);

function classifyField(field: string): MomentKind {
  if (FIELD_KIND[field]) return FIELD_KIND[field];
  if (STYLE_FIELDS.has(field)) return 'style';
  return 'mixed';
}

const VERB: Record<MomentKind, string> = {
  create: 'added',
  delete: 'deleted',
  move: 'moved',
  resize: 'resized',
  text: 'edited',
  style: 'restyled',
  order: 'reordered',
  visibility: 'changed visibility of',
  mixed: 'changed',
};

export function decodeBase64Update(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Which client produced an update.
 *
 * Yjs stamps every struct with the originating `clientID`, and
 * `mutations.localAuthorId()` uses that same id as a node's `createdBy` — so
 * once we have seen any node a client created, we can put a name and a presence
 * colour to everything else it did. Wrapped defensively: attribution is a
 * nicety, and a decode failure must degrade to "a collaborator" rather than
 * take the whole timeline down.
 */
function dominantClient(bytes: Uint8Array): string | null {
  try {
    const decoded = Y.decodeUpdate(bytes) as {
      structs: { id?: { client?: number } }[];
      ds?: { clients?: Map<number, unknown> };
    };

    const tally = new Map<string, number>();
    for (const struct of decoded.structs) {
      const client = struct?.id?.client;
      if (client === undefined || client === null) continue;
      const key = String(client);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }

    let best: string | null = null;
    let bestCount = 0;
    tally.forEach((count, client) => {
      if (count > bestCount) {
        best = client;
        bestCount = count;
      }
    });
    if (best) return best;

    // A deletion adds no structs — it is encoded entirely in the delete set —
    // so a pure delete has nobody to attribute by the tally above. Every
    // "deleted X" moment was landing on the unknown-author fallback until this
    // read the delete set as well.
    const clients = decoded.ds?.clients;
    if (clients && typeof clients.forEach === 'function') {
      const first = [...clients.keys()][0];
      if (first !== undefined) return String(first);
    }
    return null;
  } catch {
    return null;
  }
}

interface PendingChange {
  createdIds: Set<string>;
  deletedIds: Set<string>;
  /** node id -> top-level fields touched */
  fieldsById: Map<string, Set<string>>;
}

function emptyPending(): PendingChange {
  return { createdIds: new Set(), deletedIds: new Set(), fieldsById: new Map() };
}

/** A moment under construction, before it is frozen into the timeline. */
interface OpenMoment extends Moment {
  idKey: string;
}

function summarise(kind: MomentKind, names: string[]): string {
  const verb = VERB[kind];
  if (names.length === 0) return `${verb} something`;
  if (names.length === 1) return `${verb} ${names[0]}`;
  if (names.length === 2) return `${verb} ${names[0]} and ${names[1]}`;
  return `${verb} ${names.length} objects`;
}

export function buildTimeline(updates: RawUpdate[], options: BuildOptions = {}): SessionTimeline {
  const coalesceWindow = options.coalesceWindowMs ?? DEFAULT_COALESCE_MS;
  const maxKeyframes = Math.max(1, options.maxKeyframes ?? DEFAULT_MAX_KEYFRAMES);

  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  // Identities recorded in the document by `publishLocalIdentity`. Unlike
  // `createdByName` — which only ever names a node's *creator* — this covers
  // anyone who was present, so an edit by someone who never created anything
  // still gets attributed.
  const identities = doc.getMap<{ name?: string; color?: string }>('identities');

  let pending = emptyPending();

  // `event.path` is the key path from the observed root down to the target, so
  // path[0] is always the node id and path[1] (when present) the field whose
  // interior changed. Using it avoids the parent-walk-and-scan that resolving
  // a nested target would otherwise need.
  const listener = (events: Y.YEvent<any>[]) => {
    events.forEach((event) => {
      const path = event.path as (string | number)[];
      if (path.length === 0) {
        event.keys.forEach((change, id) => {
          if (change.action === 'add') pending.createdIds.add(id);
          else if (change.action === 'delete') pending.deletedIds.add(id);
          else {
            // The node's whole entry was replaced rather than mutated in place.
            const fields = pending.fieldsById.get(id) ?? new Set<string>();
            fields.add('mixed');
            pending.fieldsById.set(id, fields);
          }
        });
        return;
      }

      const id = String(path[0]);
      const fields = pending.fieldsById.get(id) ?? new Set<string>();
      if (path.length > 1) {
        fields.add(String(path[1]));
      } else {
        event.keys.forEach((_change, field) => {
          const name = String(field);
          if (!BOOKKEEPING_FIELDS.has(name)) fields.add(name);
        });
      }
      // A transaction that only bumped `updatedAt` describes no authored change.
      if (fields.size > 0) pending.fieldsById.set(id, fields);
    });
  };

  objects.observeDeep(listener);

  /** Last known display name per node, so a delete can still name its target. */
  const names = new Map<string, string>();
  const authors = new Map<string, { id: string; name: string; color: string }>();
  const keyframes: Keyframe[] = [];
  const moments: Moment[] = [];
  /** The ground the session ever covered; see `SessionTimeline.bounds`. */
  let sessionBounds: FitBounds | null = null;
  let open: OpenMoment | null = null;

  const keyframeEvery = Math.max(1, Math.ceil(updates.length / maxKeyframes));

  const refreshName = (id: string) => {
    const ymap = objects.get(id);
    if (!ymap) return;
    try {
      const node = normalizeNode(ymap.toJSON(), id);
      if (node) names.set(id, nodeLabel(node));
    } catch {
      // A partially-applied node mid-stream is expected; keep the old name.
    }
  };

  const registerAuthor = (id: string) => {
    const ymap = objects.get(id);
    if (!ymap) return;
    const clientId = ymap.get('createdBy');
    if (typeof clientId !== 'string' || authors.has(clientId)) return;
    const name = ymap.get('createdByName');
    const color = ymap.get('createdByColor');
    authors.set(clientId, {
      id: clientId,
      name: typeof name === 'string' && name ? name : 'A collaborator',
      color: typeof color === 'string' && color ? color : 'var(--text-tertiary)',
    });
  };

  const closeMoment = () => {
    if (!open) return;
    const { idKey: _idKey, ...moment } = open;
    moments.push(moment);
    open = null;
  };

  updates.forEach((raw, index) => {
    pending = emptyPending();

    /**
     * Decoded **once**.
     *
     * This used to call `decodeBase64Update(raw.update)` twice — once to apply
     * and once again, immediately, to hand to `dominantClient` — so every
     * transaction in the log paid for two base64 walks and two `Uint8Array`
     * allocations. On a two-thousand-row session that is two thousand copies
     * thrown away for nothing.
     */
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64Update(raw.update);
      Y.applyUpdate(doc, bytes);
    } catch {
      // A corrupt row must not abort the whole session; skip it and continue.
      return;
    }

    const at = new Date(raw.createdAt).getTime();

    // Decide this transaction's single dominant kind and target set.
    const touched = new Set<string>([
      ...pending.createdIds,
      ...pending.deletedIds,
      ...pending.fieldsById.keys(),
    ]);
    if (touched.size === 0) {
      // Metadata-only or awareness-adjacent transaction — nothing authored.
      if ((index + 1) % keyframeEvery === 0) {
        keyframes.push({ index, state: Y.encodeStateAsUpdate(doc) });
      }
      return;
    }

    /**
     * Attribution is resolved *after* the no-op check, not before.
     *
     * `dominantClient` runs a full `Y.decodeUpdate` — it walks every struct in
     * the transaction — and it was being run on every row including the many
     * that turn out to describe no authored change at all. Those now cost
     * nothing beyond the apply.
     */
    const authorId = dominantClient(bytes);

    pending.createdIds.forEach(registerAuthor);

    /**
     * Grow the session's extent by wherever the touched nodes now are.
     *
     * Only the touched ones, because a node can only move through an update
     * that touches it — so the union over every touched node at every step is
     * exactly the ground the session ever covered, at O(touched) rather than
     * O(document) per update.
     */
    for (const id of touched) {
      const ymap = objects.get(id);
      if (!ymap) continue;
      const x = ymap.get('x');
      const y = ymap.get('y');
      const w = ymap.get('width');
      const h = ymap.get('height');
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      sessionBounds = unionBounds(sessionBounds, {
        x,
        y,
        width: typeof w === 'number' && Number.isFinite(w) ? w : 0,
        height: typeof h === 'number' && Number.isFinite(h) ? h : 0,
      });
    }

    /**
     * Names are refreshed only when something that *is* a name changed.
     *
     * `refreshName` runs the node through `normalizeNode` — the full read
     * boundary — and it was called for every touched node on every update. A
     * drag emits a transaction every few frames and changes nothing but
     * coordinates, so the same sticky was fully re-normalized dozens of times
     * to re-derive a label that could not have moved. Creation and deletion
     * still refresh, because those are the cases where the label is new or
     * about to become unreachable.
     */
    pending.createdIds.forEach(refreshName);
    pending.fieldsById.forEach((fields, id) => {
      if (fields.has('text') || fields.has('title') || fields.has('mixed')) refreshName(id);
    });

    let kind: MomentKind;
    if (pending.createdIds.size > 0) kind = 'create';
    else if (pending.deletedIds.size > 0) kind = 'delete';
    else {
      const kinds = new Set<MomentKind>();
      pending.fieldsById.forEach((fields) => fields.forEach((f) => kinds.add(classifyField(f))));
      kind = kinds.size === 1 ? [...kinds][0] : 'mixed';
    }

    const ids = [...touched];
    const idKey = [...ids].sort().join(',');

    // Prefer an identity the document itself recorded; fall back to the
    // creator stamp learned from nodes this client made.
    if (authorId && !authors.has(authorId)) {
      const declared = identities.get(authorId);
      if (declared && typeof declared.name === 'string' && declared.name) {
        authors.set(authorId, {
          id: authorId,
          name: declared.name,
          color:
            typeof declared.color === 'string' && declared.color
              ? declared.color
              : 'var(--text-tertiary)',
        });
      }
    }

    const resolvedAuthor = (authorId && authors.get(authorId)) || null;
    const authorName = resolvedAuthor?.name ?? 'A collaborator';
    const authorColor = resolvedAuthor?.color ?? 'var(--text-tertiary)';
    const labelNames = ids.map((id) => names.get(id) ?? 'an object');

    // Fold into the open moment when it is the same person continuing the same
    // action on the same things — the drag case — otherwise start a new one.
    if (
      open &&
      open.kind === kind &&
      open.authorId === authorId &&
      open.idKey === idKey &&
      at - open.at <= coalesceWindow
    ) {
      open.index = index;
      open.at = at;
      open.updateCount += 1;
    } else {
      closeMoment();
      open = {
        index,
        firstIndex: index,
        at,
        kind,
        ids,
        authorId,
        authorName,
        authorColor,
        label: `${authorName} ${summarise(kind, labelNames)}`,
        updateCount: 1,
        idKey,
      };
    }

    pending.deletedIds.forEach((id) => names.delete(id));

    if ((index + 1) % keyframeEvery === 0) {
      keyframes.push({ index, state: Y.encodeStateAsUpdate(doc) });
    }
  });

  closeMoment();
  objects.unobserveDeep(listener);
  doc.destroy();

  return {
    moments,
    keyframes,
    totalUpdates: updates.length,
    authors: [...authors.values()],
    bounds: sessionBounds,
  };
}

/**
 * Materialise the document as of `targetIndex`, reusing `existing` when it is
 * already at or before the target so forward scrubbing stays incremental.
 *
 * Returns the doc plus the index it now reflects. Callers own destroying it.
 */
export function materialiseAt(
  updates: RawUpdate[],
  targetIndex: number,
  keyframes: Keyframe[],
  existing?: { doc: Y.Doc; appliedThrough: number } | null
): { doc: Y.Doc; appliedThrough: number } {
  const target = Math.min(targetIndex, updates.length - 1);

  // Forward from where we already are: the cheap, common case while playing.
  if (existing && existing.appliedThrough <= target) {
    for (let i = existing.appliedThrough + 1; i <= target; i++) {
      try {
        Y.applyUpdate(existing.doc, decodeBase64Update(updates[i].update));
      } catch {
        /* skip corrupt row */
      }
    }
    return { doc: existing.doc, appliedThrough: target };
  }

  // Rewinding: start from the nearest keyframe at or before the target rather
  // than from index 0.
  let start = -1;
  let seed: Uint8Array | null = null;
  for (const frame of keyframes) {
    if (frame.index <= target && frame.index > start) {
      start = frame.index;
      seed = frame.state;
    }
  }

  const doc = new Y.Doc();
  if (seed) {
    try {
      Y.applyUpdate(doc, seed);
    } catch {
      start = -1;
    }
  }
  for (let i = start + 1; i <= target; i++) {
    try {
      Y.applyUpdate(doc, decodeBase64Update(updates[i].update));
    } catch {
      /* skip corrupt row */
    }
  }
  return { doc, appliedThrough: target };
}

/**
 * One column of the replay bar's activity strip.
 *
 * `weight` is 0..1 against the busiest column, so the strip can be drawn
 * without the caller knowing anything about the rest of the session.
 */
export interface ActivityBucket {
  /** Moments that fell in this slice of wall-clock time. */
  count: number;
  /** Height to draw, relative to the busiest bucket. */
  weight: number;
  /** Colour of whoever authored most of it, or null for an empty slice. */
  color: string | null;
}

/**
 * Divide the session into equal slices of **wall-clock time** and count the
 * moments in each.
 *
 * ## Why this exists
 *
 * The replay bar drew one dot per moment, positioned at `i / (count - 1)` —
 * evenly spaced *by index*. Its own comment claimed the ticks showed "where the
 * session was busy instead of spacing steps evenly", which is exactly what
 * index spacing cannot show: fifty edits in one frantic minute and fifty spread
 * over an afternoon produce an identical row of evenly spaced dots.
 *
 * Time is the axis that answers the question, so the strip uses time and the
 * scrub track keeps index spacing — which is the right axis for *navigating*,
 * since it makes every moment equally reachable no matter when it happened.
 * Two axes, each doing the thing it is good at, rather than one doing neither.
 *
 * A session with no elapsed time — everything in the same millisecond, or a
 * single moment — spreads evenly rather than piling into bucket zero, because
 * a strip with one full bar at the far left reads as a rendering fault.
 */
export function activityBuckets(moments: Moment[], count: number): ActivityBucket[] {
  const empty = (): ActivityBucket[] =>
    new Array(Math.max(0, count)).fill(null).map(() => ({ count: 0, weight: 0, color: null }));

  if (count <= 0 || moments.length === 0) return empty();

  const first = moments[0].at;
  const last = moments[moments.length - 1].at;
  const span = last - first;

  const buckets = empty();
  /** Author tallies per bucket, so each column can name its majority. */
  const tallies: Array<Map<string, number>> = buckets.map(() => new Map());

  moments.forEach((moment, i) => {
    const fraction = span > 0 ? (moment.at - first) / span : i / Math.max(1, moments.length - 1);
    // The final moment lands exactly on 1 and would index one past the end.
    const slot = Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
    buckets[slot].count += 1;
    const tally = tallies[slot];
    tally.set(moment.authorColor, (tally.get(moment.authorColor) ?? 0) + 1);
  });

  const busiest = Math.max(...buckets.map((b) => b.count));
  buckets.forEach((bucket, i) => {
    bucket.weight = busiest > 0 ? bucket.count / busiest : 0;
    let best: string | null = null;
    let bestN = 0;
    tallies[i].forEach((n, color) => {
      if (n > bestN) { bestN = n; best = color; }
    });
    bucket.color = best;
  });

  return buckets;
}
