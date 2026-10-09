import type * as Y from 'yjs';

/**
 * A replay track: the board as plain data at every row of the log, without
 * touching Yjs at seek time.
 *
 * The timeline builder already walks the whole log once, in order, with one
 * document. While it does, it records for each row the objects that row
 * touched and their JSON afterwards (a **patch**), and every `every` rows a
 * full frame (a **checkpoint**). Seeking to any row is then: take the nearest
 * checkpoint at or before it (or the frame already on screen, when that is
 * closer) and apply at most `every - 1` patches, which are plain object
 * assignments. No update is decoded, no document is rebuilt, and the cost no
 * longer depends on how far back the target is.
 *
 * Frames share entries: an object untouched between two rows is the same
 * reference in both, which is what the store and the memoised renderers rely
 * on (see `frames.ts`).
 */

type Json = Readonly<Record<string, unknown>>;
type ObjectsFrame = Readonly<Record<string, Json>>;
type GroupsFrame = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface TrackFrame {
  objects: ObjectsFrame;
  groups: GroupsFrame;
}

/** What one row changed: objects set (JSON) or removed (null), and the groups map when it moved. */
export interface RowPatch {
  objects: ReadonlyArray<readonly [string, Json | null]>;
  groups: GroupsFrame | null;
}

interface Checkpoint extends TrackFrame {
  index: number;
}

export const DEFAULT_CHECKPOINT_EVERY = 16;

export class FrameTrack {
  private readonly patches: Array<RowPatch | null> = [];
  private readonly checkpoints: Checkpoint[] = [];
  private readonly every: number;
  private running: Record<string, Json>;
  private runningGroups: GroupsFrame;

  /** `base` is the board before row 0: the replay baseline, or empty. */
  constructor(base: TrackFrame, every = DEFAULT_CHECKPOINT_EVERY) {
    this.every = Math.max(1, Math.floor(every));
    this.running = { ...base.objects };
    this.runningGroups = base.groups;
    this.checkpoints.push({ index: -1, objects: base.objects, groups: base.groups });
  }

  /** Rows recorded; seeks are valid for `-1 .. length - 1`. */
  get length(): number {
    return this.patches.length;
  }

  get checkpointCount(): number {
    return this.checkpoints.length;
  }

  /** Record the next row. Rows must arrive in log order, one call each. */
  record(patch: RowPatch | null): void {
    const index = this.patches.length;
    const useful = patch && (patch.objects.length > 0 || patch.groups) ? patch : null;
    this.patches.push(useful);
    if (useful) applyPatch(this.running, useful);
    if (useful?.groups) this.runningGroups = useful.groups;
    if ((index + 1) % this.every === 0) {
      this.checkpoints.push({ index, objects: { ...this.running }, groups: this.runningGroups });
    }
  }

  /**
   * The board at `target`. `from`, when given, is a frame the caller already
   * holds at `from.index`; it is used as the starting point when it is at or
   * before the target and nearer than the nearest checkpoint, so stepping
   * forward one row costs one patch.
   */
  frameAt(target: number, from?: { index: number; frame: TrackFrame } | null): TrackFrame {
    const t = Math.max(-1, Math.min(Math.floor(target), this.patches.length - 1));
    let start: { index: number; frame: TrackFrame } = this.checkpointAtOrBefore(t);
    if (from && from.index <= t && from.index > start.index) start = from;
    if (start.index === t) return start.frame;

    let objects: Record<string, Json> | null = null;
    let groups = start.frame.groups;
    for (let i = start.index + 1; i <= t; i++) {
      const patch = this.patches[i];
      if (!patch) continue;
      if (patch.objects.length > 0) {
        objects ??= { ...start.frame.objects };
        applyPatch(objects, patch);
      }
      if (patch.groups) groups = patch.groups;
    }
    if (!objects && groups === start.frame.groups) return start.frame;
    return { objects: objects ?? start.frame.objects, groups };
  }

  private checkpointAtOrBefore(t: number): { index: number; frame: TrackFrame } {
    // Checkpoints are evenly spaced after the base, so the slot is arithmetic.
    const slot = Math.min(this.checkpoints.length - 1, Math.max(0, Math.floor((t + 1) / this.every)));
    const c = this.checkpoints[slot];
    return { index: c.index, frame: c };
  }
}

function applyPatch(target: Record<string, Json>, patch: RowPatch): void {
  for (const [id, json] of patch.objects) {
    if (json) target[id] = json;
    else delete target[id];
  }
}

/** The objects and groups of a document as plain data, for a track's base frame. */
export function readTrackFrame(doc: Y.Doc): TrackFrame {
  const objects: Record<string, Json> = {};
  doc.getMap<Y.Map<unknown>>('objects').forEach((ymap, id) => {
    objects[id] = ymap.toJSON() as Json;
  });
  return { objects, groups: doc.getMap('groups').toJSON() as GroupsFrame };
}

/**
 * Collects what each row touches, for `FrameTrack.record`. Attach before the
 * first row is applied; call `take` after each row.
 */
export class PatchRecorder {
  private readonly touched = new Set<string>();
  private groupsTouched = false;
  private readonly objects: Y.Map<Y.Map<unknown>>;
  private readonly groups: Y.Map<unknown>;
  private readonly onObjects: (events: Y.YEvent<any>[]) => void;
  private readonly onGroups: () => void;

  constructor(doc: Y.Doc) {
    this.objects = doc.getMap<Y.Map<unknown>>('objects');
    this.groups = doc.getMap('groups');
    this.onObjects = (events) => {
      for (const event of events) {
        const path = event.path as (string | number)[];
        if (path.length === 0) event.keys.forEach((_c, id) => this.touched.add(String(id)));
        else this.touched.add(String(path[0]));
      }
    };
    this.onGroups = () => {
      this.groupsTouched = true;
    };
    this.objects.observeDeep(this.onObjects);
    this.groups.observeDeep(this.onGroups);
  }

  /** The patch for everything since the last call, and reset. */
  take(): RowPatch | null {
    if (this.touched.size === 0 && !this.groupsTouched) return null;
    const objects: Array<readonly [string, Json | null]> = [];
    this.touched.forEach((id) => {
      const ymap = this.objects.get(id);
      objects.push([id, ymap ? (ymap.toJSON() as Json) : null]);
    });
    const groups = this.groupsTouched ? (this.groups.toJSON() as GroupsFrame) : null;
    this.touched.clear();
    this.groupsTouched = false;
    return { objects, groups };
  }

  /** Forget anything collected, as after a row that failed to apply. */
  reset(): void {
    this.touched.clear();
    this.groupsTouched = false;
  }

  detach(): void {
    this.objects.unobserveDeep(this.onObjects);
    this.groups.unobserveDeep(this.onGroups);
  }
}
