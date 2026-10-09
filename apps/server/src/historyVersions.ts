import * as Y from 'yjs';

/**
 * Version history: the pure parts, kept free of the database pool so they can
 * be tested without one.
 *
 * ## The model
 *
 * History has three tiers, the same three Figma and Google Docs settle on:
 *
 *  - **The update log** (`room_updates`): every transaction, newest
 *    `MAX_UPDATES_PER_ROOM`, steppable one change at a time.
 *  - **Autosaves** (`room_versions`, kind `auto`): one document state per
 *    working session, written by retention as it folds rows out of the log.
 *    Coarse, but they reach back past the log's window.
 *  - **Named versions** (`room_versions`, kind `named`): a state someone chose
 *    to keep, with a name and a description. Retention never touches them.
 *
 * Versions live on the server rather than in the Yjs document. A version is a
 * full encoded state, and the document is what every client downloads on every
 * open: forty named versions inside it would make every board forty times
 * heavier to load, forever. A state vector would be small, but the document is
 * garbage-collected, so content deleted since cannot be rebuilt from one.
 */

/** A pause longer than this between two updates starts a new session. */
export const SESSION_GAP_MS = 20 * 60 * 1000;

/** Autosaves kept per room. The oldest go first; named versions never do. */
export const MAX_AUTO_VERSIONS = 120;

/** Named versions kept per room, so one room cannot grow without bound. */
export const MAX_NAMED_VERSIONS = 500;

export const MAX_VERSION_NAME = 80;
export const MAX_VERSION_DESCRIPTION = 500;

/** Largest page of the update log one request may ask for. */
export const MAX_HISTORY_PAGE = 2000;

export interface VersionAuthor {
  id: string;
  name: string;
  color: string;
}

/**
 * Which Yjs clients wrote an update: structs by their stamped client id, plus
 * the delete set, since a pure deletion adds no structs at all.
 */
export function updateClients(update: Uint8Array): string[] {
  try {
    const decoded = Y.decodeUpdate(update) as {
      structs: { id?: { client?: number } }[];
      ds?: { clients?: Map<number, unknown> };
    };
    const out = new Set<string>();
    for (const struct of decoded.structs) {
      const client = struct?.id?.client;
      if (typeof client === 'number') out.add(String(client));
    }
    decoded.ds?.clients?.forEach((_v, client) => out.add(String(client)));
    return [...out];
  } catch {
    return [];
  }
}

/**
 * Names for client ids, from the identities the document itself recorded
 * (`publishLocalIdentity` on the client). A client that never published one is
 * left out rather than shown as an anonymous blank.
 */
export function resolveAuthors(doc: Y.Doc, clients: Iterable<string>): VersionAuthor[] {
  const identities = doc.getMap<{ name?: unknown; color?: unknown }>('identities');
  const out: VersionAuthor[] = [];
  const seen = new Set<string>();
  for (const id of clients) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = identities.get(id);
    if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
    out.push({
      id,
      name: entry.name.slice(0, 60),
      color: typeof entry.color === 'string' ? entry.color.slice(0, 32) : '',
    });
  }
  return out;
}

/** Merge two author lists, first-seen order, deduplicated by id. */
export function mergeAuthors(a: readonly VersionAuthor[], b: readonly VersionAuthor[]): VersionAuthor[] {
  const out: VersionAuthor[] = [];
  const seen = new Set<string>();
  for (const author of [...a, ...b]) {
    if (!author || typeof author.id !== 'string' || seen.has(author.id)) continue;
    seen.add(author.id);
    out.push(author);
  }
  return out;
}

export interface FoldRow {
  at: number;
  update: Uint8Array;
}

export interface CheckpointSegment {
  /** Inclusive row range within the fold. */
  from: number;
  to: number;
  startedAt: number;
  endedAt: number;
  /** Continue the previous autosave rather than starting a new one. */
  extends: boolean;
}

/**
 * Split rows leaving the log into working sessions, one autosave each.
 *
 * Retention folds rows on a timer, not at session boundaries, so one session
 * is routinely cut across two or more folds. The first segment therefore
 * *extends* the previous autosave when it follows it closely enough, which is
 * what keeps "one autosave per session" true across folds.
 */
export function planCheckpoints(
  rows: readonly { at: number }[],
  previousEndedAt: number | null,
  gapMs = SESSION_GAP_MS
): CheckpointSegment[] {
  if (rows.length === 0) return [];
  const segments: CheckpointSegment[] = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    const boundary = i === rows.length || rows[i].at - rows[i - 1].at > gapMs;
    if (!boundary) continue;
    segments.push({
      from: start,
      to: i - 1,
      startedAt: rows[start].at,
      endedAt: rows[i - 1].at,
      extends: false,
    });
    start = i;
  }
  if (previousEndedAt !== null && rows[0].at - previousEndedAt <= gapMs) {
    segments[0].extends = true;
  }
  return segments;
}

export interface FoldedCheckpoint extends CheckpointSegment {
  state: Uint8Array;
  updateCount: number;
  authors: VersionAuthor[];
}

/**
 * Apply rows onto a base state, capturing the document at the end of each
 * session. Returns the final state (the new replay baseline) and one
 * checkpoint per segment.
 */
export function foldWithCheckpoints(
  base: Uint8Array | null,
  rows: readonly FoldRow[],
  previousEndedAt: number | null,
  gapMs = SESSION_GAP_MS
): { baseline: Uint8Array; checkpoints: FoldedCheckpoint[] } {
  const doc = new Y.Doc();
  if (base) {
    try {
      Y.applyUpdate(doc, base);
    } catch {
      /* an unreadable base degrades to folding from empty */
    }
  }
  const checkpoints: FoldedCheckpoint[] = [];
  for (const segment of planCheckpoints(rows, previousEndedAt, gapMs)) {
    const clients = new Set<string>();
    for (let i = segment.from; i <= segment.to; i++) {
      const update = rows[i].update;
      try {
        Y.applyUpdate(doc, update);
      } catch {
        continue;
      }
      for (const client of updateClients(update)) clients.add(client);
    }
    checkpoints.push({
      ...segment,
      state: Y.encodeStateAsUpdate(doc),
      updateCount: segment.to - segment.from + 1,
      authors: resolveAuthors(doc, clients),
    });
  }
  const baseline = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return { baseline, checkpoints };
}

/** The document after applying `parts` in order; unreadable parts are skipped. */
export function composeState(parts: readonly (Uint8Array | null | undefined)[]): Uint8Array {
  const doc = new Y.Doc();
  for (const part of parts) {
    if (!part) continue;
    try {
      Y.applyUpdate(doc, part);
    } catch {
      /* skip */
    }
  }
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

export type VersionInput =
  | { ok: true; name: string; description: string }
  | { ok: false; error: string };

/** Validate a name and description from a request body. */
export function readVersionInput(body: unknown): VersionInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
  const description =
    typeof raw.description === 'string' ? raw.description.replace(/\r\n/g, '\n').trim() : '';
  if (!name) return { ok: false, error: 'A version needs a name.' };
  if (name.length > MAX_VERSION_NAME) {
    return { ok: false, error: `Keep the name under ${MAX_VERSION_NAME} characters.` };
  }
  if (description.length > MAX_VERSION_DESCRIPTION) {
    return { ok: false, error: `Keep the description under ${MAX_VERSION_DESCRIPTION} characters.` };
  }
  return { ok: true, name, description };
}

/** A positive integer from a query or body value, or null. */
export function readPositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

export interface SessionRow {
  start_id: string | number;
  end_id: string | number;
  started_at: string | Date;
  ended_at: string | Date;
  count: string | number;
}

export interface SessionSummary {
  startId: number;
  endId: number;
  startedAt: string;
  endedAt: string;
  count: number;
}

export function toSessionSummary(row: SessionRow): SessionSummary {
  const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  return {
    startId: Number(row.start_id),
    endId: Number(row.end_id),
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    count: Number(row.count),
  };
}
