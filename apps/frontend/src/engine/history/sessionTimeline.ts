import * as Y from 'yjs';
import { normalizeNode } from '../document/normalize';
import { nodeLabel } from '../model/nodeLabel';
import { unionBounds, type FitBounds } from '../cameraFit';

/**
 * Turns the server's raw CRDT update log into a human session timeline.
 *
 * A row in `room_updates` is one Yjs transaction: the unit storage uses, not a
 * unit anyone authored. Dragging a sticky emits dozens; renaming it emits one.
 * The builder applies the rows into a scratch document, watches what each one
 * did, and folds runs of related transactions into described moments ("Ada
 * moved Idea Card"), each attributed to the person who made it.
 *
 * Replaying the update stream stays the substrate because it captures every
 * change regardless of origin, including drags and physics settles that never
 * pass through the editor's command layer.
 *
 * Yjs updates cannot be un-applied, so the builder also records periodic
 * keyframes (encoded document states); `ReplayEngine` (frames.ts) seeks from
 * the nearest one rather than from the first row.
 */

/** One row of the server's `room_updates` log, as returned by `/rooms/:id/history`. */
export interface RawUpdate {
  /** Server row id; present on logs from the paged endpoint. */
  id?: number;
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
  /** Epoch ms of the moment's first update. */
  firstAt: number;
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
  /** Server row id of the moment's last update, when the log carried ids. */
  rowId?: number;
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
   * Set when the build hit its time budget and stopped early.
   *
   * The replay is then real but short of the log it was given, and the bar says
   * so — the same honesty the trimmed-history notice provides, for a different
   * reason.
   */
  truncated?: boolean;
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
  /**
   * The document as it stood before the first retained update.
   *
   * A trimmed log is a set of deltas whose base is missing, so replaying it
   * alone reconstructs nothing. Measured on a real room here: four hundred
   * retained updates produced a document holding **zero** objects, because
   * every object's creation was in the discarded rows. Seeding from the
   * server's baseline is what turns a bounded log into a shorter history
   * rather than an empty one.
   */
  baseline?: Uint8Array | null;
  /**
   * How long a synchronous build may spend before returning what it has,
   * marked `truncated`. A log whose base is missing makes Yjs park every row in
   * its pending store, which slows each later apply; the budget keeps that a
   * pause rather than a frozen tab.
   */
  budgetMs?: number;
}

const DEFAULT_COALESCE_MS = 1200;
const DEFAULT_MAX_KEYFRAMES = 32;

/**
 * The ceiling on a synchronous build.
 *
 * Generous for a healthy log — four hundred updates build in about 186ms — and
 * short enough that the worst case is a pause rather than a frozen tab.
 */
const DEFAULT_BUDGET_MS = 1500;

/** Monotonic where available; `Date.now` is enough for a coarse budget. */
const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

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
 * `mutations.updateNode` sets these on every write, so they are invisible to
 * classification, and a transaction touching nothing else is not an authored
 * moment. This list must follow the write path; a test holds it against what
 * `updateNode` actually stamps.
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

/** Options for the incremental builder. */
export interface TimelineBuilderOptions {
  coalesceWindowMs?: number;
  baseline?: Uint8Array | null;
  /** Rows between keyframes before any thinning. */
  keyframeEvery?: number;
  /**
   * Keyframes kept. Past this the builder drops every other one and doubles
   * the interval, so memory stays bounded however long the log grows while
   * seeks stay O(interval).
   */
  maxKeyframes?: number;
}

/**
 * Builds a timeline from a log that arrives in pages and is processed in
 * slices.
 *
 * Applying an update is synchronous, and a long log applied in one pass blocks
 * the tab for as long as it takes. The builder instead does as much as a
 * caller's budget allows per `step`, so the caller can yield between slices
 * (see `buildTimelineSliced`) and every frame stays inside its budget however
 * many rows there are. Rows can be appended while it works, which is what lets
 * the timeline grow while later pages are still downloading.
 */
export class TimelineBuilder {
  private readonly rows: RawUpdate[] = [];
  private cursor = 0;
  private readonly doc = new Y.Doc();
  private readonly objects: Y.Map<Y.Map<unknown>>;
  private readonly identities: Y.Map<{ name?: string; color?: string }>;
  private pending = emptyPending();
  private readonly names = new Map<string, string>();
  private readonly authors = new Map<string, { id: string; name: string; color: string }>();
  private keyframes: Keyframe[] = [];
  private readonly moments: Moment[] = [];
  private sessionBounds: FitBounds | null = null;
  private open: OpenMoment | null = null;
  private keyframeEvery: number;
  private readonly maxKeyframes: number;
  private readonly coalesceWindow: number;
  private destroyed = false;
  private readonly listener: (events: Y.YEvent<any>[]) => void;

  constructor(options: TimelineBuilderOptions = {}) {
    this.coalesceWindow = options.coalesceWindowMs ?? DEFAULT_COALESCE_MS;
    this.keyframeEvery = Math.max(1, options.keyframeEvery ?? 64);
    this.maxKeyframes = Math.max(2, options.maxKeyframes ?? 64);
    /**
     * Seeded before anything is observed, so the baseline is the starting
     * *state* rather than an authored moment. Applied after the observer, the
     * timeline would open with one fabricated "someone added 400 objects".
     */
    if (options.baseline) {
      try {
        Y.applyUpdate(this.doc, options.baseline);
      } catch {
        // An unreadable baseline degrades to a replay that starts from nothing.
      }
    }
    this.objects = this.doc.getMap<Y.Map<unknown>>('objects');
    // Identities recorded by `publishLocalIdentity`: unlike `createdByName`,
    // which only names a node's creator, this covers anyone who was present.
    this.identities = this.doc.getMap<{ name?: string; color?: string }>('identities');

    // `event.path` runs from the observed root, so path[0] is the node id and
    // path[1] (when present) the field whose interior changed.
    this.listener = (events) => {
      const pending = this.pending;
      events.forEach((event) => {
        const path = event.path as (string | number)[];
        if (path.length === 0) {
          event.keys.forEach((change, id) => {
            if (change.action === 'add') pending.createdIds.add(id);
            else if (change.action === 'delete') pending.deletedIds.add(id);
            else {
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
        if (fields.size > 0) pending.fieldsById.set(id, fields);
      });
    };
    this.objects.observeDeep(this.listener);
  }

  /** Append rows to the end of the log. */
  push(rows: readonly RawUpdate[]): void {
    for (const row of rows) this.rows.push(row);
  }

  /** Every row pushed so far, in order. Seeks index into this. */
  get log(): RawUpdate[] {
    return this.rows;
  }

  /** Rows processed so far. */
  get processed(): number {
    return this.cursor;
  }

  get done(): boolean {
    return this.cursor >= this.rows.length;
  }

  /**
   * Process rows until `budgetMs` has elapsed or the log is exhausted.
   * Returns true when every pushed row has been processed.
   */
  step(budgetMs: number): boolean {
    if (this.destroyed) return true;
    const deadline = now() + budgetMs;
    while (this.cursor < this.rows.length) {
      this.applyRow(this.cursor);
      this.cursor++;
      // Checked every fourth row: cheap, and bounds the overshoot to a few rows.
      if (this.cursor % 4 === 0 && now() > deadline) break;
    }
    return this.done;
  }

  /**
   * The timeline as it stands. The moment still being folded is included, so
   * a partial build is already navigable.
   */
  snapshot(): SessionTimeline {
    const moments = this.open ? [...this.moments, stripOpen(this.open)] : [...this.moments];
    return {
      moments,
      keyframes: [...this.keyframes],
      totalUpdates: this.rows.length,
      authors: [...this.authors.values()],
      bounds: this.sessionBounds,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.objects.unobserveDeep(this.listener);
    this.doc.destroy();
  }

  private addKeyframe(index: number) {
    this.keyframes.push({ index, state: Y.encodeStateAsUpdate(this.doc) });
    if (this.keyframes.length > this.maxKeyframes) {
      this.keyframes = this.keyframes.filter((_k, i) => i % 2 === 1);
      this.keyframeEvery *= 2;
    }
  }

  private refreshName(id: string) {
    const ymap = this.objects.get(id);
    if (!ymap) return;
    try {
      const node = normalizeNode(ymap.toJSON(), id);
      if (node) this.names.set(id, nodeLabel(node));
    } catch {
      // A partially-applied node mid-stream is expected; keep the old name.
    }
  }

  private registerAuthor(id: string) {
    const ymap = this.objects.get(id);
    if (!ymap) return;
    const clientId = ymap.get('createdBy');
    if (typeof clientId !== 'string' || this.authors.has(clientId)) return;
    const name = ymap.get('createdByName');
    const color = ymap.get('createdByColor');
    this.authors.set(clientId, {
      id: clientId,
      name: typeof name === 'string' && name ? name : 'A collaborator',
      color: typeof color === 'string' && color ? color : 'var(--text-tertiary)',
    });
  }

  private applyRow(index: number) {
    const raw = this.rows[index];
    this.pending = emptyPending();
    const pending = this.pending;
    const keyframeDue = (index + 1) % this.keyframeEvery === 0;

    // Decoded once, and handed to both the apply and the attribution.
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64Update(raw.update);
      Y.applyUpdate(this.doc, bytes);
    } catch {
      // A corrupt row must not abort the whole session.
      if (keyframeDue) this.addKeyframe(index);
      return;
    }

    const at = new Date(raw.createdAt).getTime();
    const touched = new Set<string>([
      ...pending.createdIds,
      ...pending.deletedIds,
      ...pending.fieldsById.keys(),
    ]);
    if (touched.size === 0) {
      // Metadata-only or bookkeeping-only: nothing authored.
      if (keyframeDue) this.addKeyframe(index);
      return;
    }

    // Resolved after the no-op check: `dominantClient` decodes every struct.
    const authorId = dominantClient(bytes);
    pending.createdIds.forEach((id) => this.registerAuthor(id));

    // The union over every touched node at every step is exactly the ground
    // the session ever covered, at O(touched) per update.
    for (const id of touched) {
      const ymap = this.objects.get(id);
      if (!ymap) continue;
      const x = ymap.get('x');
      const y = ymap.get('y');
      const w = ymap.get('width');
      const h = ymap.get('height');
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      this.sessionBounds = unionBounds(this.sessionBounds, {
        x,
        y,
        width: typeof w === 'number' && Number.isFinite(w) ? w : 0,
        height: typeof h === 'number' && Number.isFinite(h) ? h : 0,
      });
    }

    // Names are refreshed only when something that is a name changed; a drag
    // changes coordinates and cannot move a label.
    pending.createdIds.forEach((id) => this.refreshName(id));
    pending.fieldsById.forEach((fields, id) => {
      if (fields.has('text') || fields.has('title') || fields.has('mixed')) this.refreshName(id);
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

    if (authorId && !this.authors.has(authorId)) {
      const declared = this.identities.get(authorId);
      if (declared && typeof declared.name === 'string' && declared.name) {
        this.authors.set(authorId, {
          id: authorId,
          name: declared.name,
          color:
            typeof declared.color === 'string' && declared.color ? declared.color : 'var(--text-tertiary)',
        });
      }
    }

    const resolvedAuthor = (authorId && this.authors.get(authorId)) || null;
    const authorName = resolvedAuthor?.name ?? 'A collaborator';
    const authorColor = resolvedAuthor?.color ?? 'var(--text-tertiary)';
    const labelNames = ids.map((id) => this.names.get(id) ?? 'an object');

    // Same person, same action, same targets, close together: one moment.
    const open = this.open;
    if (
      open &&
      open.kind === kind &&
      open.authorId === authorId &&
      open.idKey === idKey &&
      at - open.at <= this.coalesceWindow
    ) {
      open.index = index;
      open.at = at;
      open.updateCount += 1;
      if (typeof raw.id === 'number') open.rowId = raw.id;
    } else {
      if (open) this.moments.push(stripOpen(open));
      this.open = {
        index,
        firstIndex: index,
        at,
        firstAt: at,
        kind,
        ids,
        authorId,
        authorName,
        authorColor,
        label: `${authorName} ${summarise(kind, labelNames)}`,
        updateCount: 1,
        rowId: typeof raw.id === 'number' ? raw.id : undefined,
        idKey,
      };
    }

    pending.deletedIds.forEach((id) => this.names.delete(id));
    if (keyframeDue) this.addKeyframe(index);
  }
}

function stripOpen(open: OpenMoment): Moment {
  const { idKey: _idKey, ...moment } = open;
  return moment;
}

/**
 * Build a timeline in one synchronous pass, bounded by `budgetMs`.
 *
 * For tests and small logs. The replay UI uses `buildTimelineSliced`, which
 * yields between slices instead of stopping at the budget.
 */
export function buildTimeline(updates: RawUpdate[], options: BuildOptions = {}): SessionTimeline {
  const maxKeyframes = Math.max(1, options.maxKeyframes ?? DEFAULT_MAX_KEYFRAMES);
  const builder = new TimelineBuilder({
    coalesceWindowMs: options.coalesceWindowMs,
    baseline: options.baseline,
    keyframeEvery: Math.max(1, Math.ceil(updates.length / maxKeyframes)),
    maxKeyframes: maxKeyframes * 2,
  });
  builder.push(updates);
  const finished = builder.step(options.budgetMs ?? DEFAULT_BUDGET_MS);
  const timeline = builder.snapshot();
  builder.destroy();
  return finished ? timeline : { ...timeline, truncated: true };
}

/** Resolve on the next macrotask, so input and paint can run between slices. */
const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Drive a builder to completion in slices of `sliceMs`, yielding between
 * them. `onProgress` sees the row count after each slice.
 */
export async function buildTimelineSliced(
  builder: TimelineBuilder,
  options: { sliceMs?: number; signal?: AbortSignal; onProgress?: (processed: number) => void } = {}
): Promise<void> {
  const slice = options.sliceMs ?? 8;
  while (!builder.done) {
    if (options.signal?.aborted) return;
    builder.step(slice);
    options.onProgress?.(builder.processed);
    await yieldToBrowser();
  }
}
