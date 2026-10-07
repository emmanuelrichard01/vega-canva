import * as Y from 'yjs';
import { decodeBase64Update, type Keyframe, type RawUpdate } from './sessionTimeline';

/**
 * Replay frames: the board's objects as plain data at one point in the log.
 *
 * ## Identity is the contract
 *
 * A frame maps object id to that object's JSON, and frames **share entries**:
 * an object untouched between two frames is the same reference in both. Every
 * consumer leans on that. The store carries an unchanged node forward without
 * re-normalizing it, memoized renderers skip it, and two frames can be
 * compared by reference in O(objects) without walking any object.
 *
 * Frames are never mutated after they are handed out.
 */
export type ObjectJson = Readonly<Record<string, unknown>>;
export type Frame = Readonly<Record<string, ObjectJson>>;

export interface FrameState {
  objects: Frame;
  groups: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** Deep equality for the plain data a Y.Map holds: no functions, no cycles. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  for (const k of ak) {
    if (!(k in bo) || !jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Ids whose entry differs between two frames, by reference, plus ids present
 * in only one. Never misses a change, because entries are immutable; may
 * over-report one that was rebuilt to an equal value, which costs a
 * re-normalize and nothing else.
 */
export function changedBetween(prev: Frame, next: Frame): string[] {
  const out: string[] = [];
  for (const id in next) if (prev[id] !== next[id]) out.push(id);
  for (const id in prev) if (!(id in next)) out.push(id);
  return out;
}

/**
 * Read a whole document into a frame, reusing `previous` entries that are
 * deep-equal so identity survives a rebuild.
 */
export function readFrame(doc: Y.Doc, previous?: Frame | null): Frame {
  const out: Record<string, ObjectJson> = {};
  doc.getMap<Y.Map<unknown>>('objects').forEach((ymap, id) => {
    const json = ymap.toJSON() as ObjectJson;
    const prior = previous?.[id];
    out[id] = prior && jsonEqual(prior, json) ? prior : json;
  });
  return out;
}

function readGroups(doc: Y.Doc): FrameState['groups'] {
  return doc.getMap('groups').toJSON() as FrameState['groups'];
}

/** A frame from a full encoded state, such as a saved version. */
export function frameFromState(state: Uint8Array, previous?: Frame | null): FrameState {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
  } catch {
    /* an unreadable state shows as an empty board */
  }
  const result = { objects: readFrame(doc, previous), groups: readGroups(doc) };
  doc.destroy();
  return result;
}

/** A small LRU map keyed by number. */
export class LruCache<V> {
  private readonly map = new Map<number, V>();
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: number): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: number, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as number;
      this.map.delete(oldest);
    }
  }

  has(key: number): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export interface ReplaySource {
  log: () => readonly RawUpdate[];
  keyframes: () => readonly Keyframe[];
  baseline: Uint8Array | null;
}

export interface SeekResult {
  state: FrameState;
  /** Ids that differ from the previously returned frame. */
  changedIds: string[];
  /** True when the frame came from the cache without touching Yjs. */
  cached: boolean;
}

/**
 * Seeks a replay document through the log and hands out frames.
 *
 * Three paths, cheapest first:
 *  1. **Cache.** Every frame produced is kept in an LRU keyed by log index,
 *     so scrubbing back over ground already seen costs a map lookup.
 *  2. **Forward.** From where the document already is, applying only the
 *     rows in between and re-reading only the objects they touched.
 *  3. **Rewind.** From the nearest keyframe at or before the target (or the
 *     baseline), never from row zero.
 *
 * Index `-1` is the board before the first row: the baseline.
 */
export class ReplayEngine {
  private doc: Y.Doc | null = null;
  private docIndex = -2;
  private docState: FrameState | null = null;
  private shown: Frame = {};
  private readonly touched = new Set<string>();
  private groupsTouched = false;
  private readonly cache: LruCache<FrameState>;
  private destroyed = false;
  private readonly source: ReplaySource;

  constructor(source: ReplaySource, cacheSize = 48) {
    this.source = source;
    this.cache = new LruCache(cacheSize);
  }

  /** The frame most recently returned by `seek`. */
  get current(): Frame {
    return this.shown;
  }

  /** Move the playhead to `index` and return the frame there. */
  seek(index: number): SeekResult {
    const target = this.clamp(index);
    const cached = this.cache.get(target);
    const state = cached ?? this.materialise(target);
    const changedIds = changedBetween(this.shown, state.objects);
    this.shown = state.objects;
    return { state, changedIds, cached: !!cached };
  }

  /**
   * The frame at `index` without moving the playhead's document, for a diff
   * base. Built in a scratch document from the nearest keyframe.
   */
  peek(index: number): FrameState {
    const target = this.clamp(index);
    const cached = this.cache.get(target);
    if (cached) return cached;
    const { doc } = this.rebuild(target);
    const state = { objects: readFrame(doc, this.docState?.objects ?? this.shown), groups: readGroups(doc) };
    doc.destroy();
    this.cache.set(target, state);
    return state;
  }

  /** Forget cached frames, as when the log grows under a partial build. */
  invalidate(): void {
    this.cache.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.doc?.destroy();
    this.doc = null;
    this.cache.clear();
  }

  private clamp(index: number): number {
    const last = this.source.log().length - 1;
    return Math.max(-1, Math.min(index, last));
  }

  private materialise(target: number): FrameState {
    if (this.destroyed) return { objects: {}, groups: {} };
    if (this.doc && this.docState && this.docIndex <= target) {
      // Forward: apply the gap, re-read only what it touched.
      this.touched.clear();
      this.groupsTouched = false;
      const log = this.source.log();
      for (let i = this.docIndex + 1; i <= target; i++) applyRow(this.doc, log[i]);
      this.docIndex = target;
      const objects = this.doc.getMap<Y.Map<unknown>>('objects');
      const next: Record<string, ObjectJson> = { ...this.docState.objects };
      this.touched.forEach((id) => {
        const ymap = objects.get(id);
        if (ymap) next[id] = ymap.toJSON() as ObjectJson;
        else delete next[id];
      });
      this.docState = {
        objects: next,
        groups: this.groupsTouched ? readGroups(this.doc) : this.docState.groups,
      };
    } else {
      const { doc } = this.rebuild(target);
      this.doc?.destroy();
      this.doc = doc;
      this.docIndex = target;
      this.observe(doc);
      this.docState = { objects: readFrame(doc, this.docState?.objects ?? this.shown), groups: readGroups(doc) };
    }
    this.cache.set(target, this.docState);
    return this.docState;
  }

  /** A fresh document at `target`, from the nearest keyframe at or before it. */
  private rebuild(target: number): { doc: Y.Doc } {
    let start = -1;
    let seed: Uint8Array | null = null;
    for (const frame of this.source.keyframes()) {
      if (frame.index <= target && frame.index > start) {
        start = frame.index;
        seed = frame.state;
      }
    }
    const doc = new Y.Doc();
    const base = seed ?? this.source.baseline;
    if (base) {
      try {
        Y.applyUpdate(doc, base);
      } catch {
        start = -1;
      }
    }
    const log = this.source.log();
    for (let i = start + 1; i <= target; i++) applyRow(doc, log[i]);
    return { doc };
  }

  private observe(doc: Y.Doc) {
    doc.getMap<Y.Map<unknown>>('objects').observeDeep((events) => {
      events.forEach((event) => {
        const path = event.path as (string | number)[];
        if (path.length === 0) event.keys.forEach((_c, id) => this.touched.add(String(id)));
        else this.touched.add(String(path[0]));
      });
    });
    doc.getMap('groups').observe(() => {
      this.groupsTouched = true;
    });
  }
}

function applyRow(doc: Y.Doc, row: RawUpdate | undefined) {
  if (!row) return;
  try {
    Y.applyUpdate(doc, decodeBase64Update(row.update));
  } catch {
    /* a corrupt row is skipped */
  }
}
