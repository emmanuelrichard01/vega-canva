/**
 * The board list, as a file.
 *
 * ## Why this sits under `room/` and not under `export/`
 *
 * It was written into `engine/export/` on the reasoning that it serialises
 * something to JSON, and `exportChunking.test.ts` refused it immediately —
 * correctly. That directory is a **lazily-loaded chunk** hanging off the export
 * dialog, and `Home.tsx` is the landing page: importing across that line would
 * have pulled the whole export pipeline into the first paint of a screen that
 * never exports anything.
 *
 * The guard was right about more than the bundle. A library index is not an
 * export of a document — it is a list of **room addresses**, which is what
 * everything else in this directory is about (`roomCode`, `invite`, `route`).
 * Same question, same neighbourhood.
 *
 * ## Why this exists at all
 *
 * There are no accounts here, so a board's address lives in exactly one place:
 * `localStorage` on the machine you opened it from. `Home.tsx` opens with the
 * consequence — the objects are all still there and nobody can ever reach them
 * again — and everything around removal is built to protect that one list.
 *
 * All of it protects the list *in place*. An undo notice, a shelf of removed
 * boards, a confirmation before forgetting one: every layer assumes the
 * `localStorage` entry still exists. None of them survives the two things that
 * actually take a library out — clearing site data, and using a different
 * machine — and neither of those is an accident anybody gets to undo.
 *
 * So the real fix for "this list is the only record" is not another layer of
 * care around the record. It is a second record. This module is that: the
 * index, as a file, that a person keeps wherever they keep things.
 *
 * ## Why loading one merges rather than replaces
 *
 * Replacing is the operation this whole area exists to prevent. Loading a file
 * saved before three boards were opened would drop those three addresses on
 * the floor, which is precisely the unrecoverable loss the shelf is built
 * around — and it would do it as a side effect of an action a person took to
 * be *safer*.
 *
 * So a load is a union, keyed on id. Nothing on this device is ever removed by
 * reading a file, and a board present in both keeps whichever record was
 * touched more recently, since `lastAccessed` is the only field that can
 * meaningfully differ between two copies of the same board.
 */

/** A board, as this device knows it. Mirrors `RecentWorkspace` in `Home.tsx`. */
export interface LibraryBoard {
  id: string;
  name: string;
  lastAccessed: number;
}

export interface LibraryRemoval extends LibraryBoard {
  removedAt: number;
}

/**
 * The tag that says what this file is.
 *
 * Checked before anything else, because a library index and a board export are
 * both JSON with an array in them and both arrive through the same file picker
 * and the same drop target. Without a discriminator the two are told apart by
 * guessing at their shape, which is how a file gets opened as the wrong thing.
 */
export const LIBRARY_KIND = 'vega-library';

export interface LibraryFile {
  kind: typeof LIBRARY_KIND;
  version: 1;
  exportedAt: number;
  boards: LibraryBoard[];
  removed: LibraryRemoval[];
}

export type LibraryParse =
  | { ok: true; file: LibraryFile }
  | { ok: false; error: string };

/**
 * True when this text is *claiming* to be a library index.
 *
 * Deliberately cheaper and more permissive than `parseLibrary`: it answers
 * "which reader should look at this" so a malformed library file reports a
 * library problem rather than being handed to the document reader and coming
 * back as "that file does not contain a document" — an error about the wrong
 * thing, which is worse than no error.
 */
export function looksLikeLibrary(text: string): boolean {
  try {
    const raw = JSON.parse(text) as unknown;
    return !!raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === LIBRARY_KIND;
  } catch {
    return false;
  }
}

const board = (v: unknown): LibraryBoard | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : 'Untitled board',
    // A missing or absurd timestamp sorts to the bottom rather than
    // disqualifying the entry: the id is the part that cannot be reconstructed,
    // and refusing a whole board over its date would throw away the address to
    // protect a sort order.
    lastAccessed: Number.isFinite(r.lastAccessed) ? Number(r.lastAccessed) : 0,
  };
};

export function parseLibrary(text: string): LibraryParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'That file does not contain a board list.' };
  }

  const r = raw as Record<string, unknown>;
  if (r.kind !== LIBRARY_KIND) {
    return { ok: false, error: 'That file is not a Vega Studio board list.' };
  }

  const boards: LibraryBoard[] = [];
  const removed: LibraryRemoval[] = [];

  for (const entry of Array.isArray(r.boards) ? r.boards : []) {
    const b = board(entry);
    if (b) boards.push(b);
  }

  for (const entry of Array.isArray(r.removed) ? r.removed : []) {
    const b = board(entry);
    if (!b) continue;
    const at = (entry as Record<string, unknown>).removedAt;
    removed.push({ ...b, removedAt: Number.isFinite(at) ? Number(at) : 0 });
  }

  if (boards.length === 0 && removed.length === 0) {
    // Said as its own case, because "it worked and did nothing" is the report
    // that sends somebody looking for a bug in the wrong place.
    return { ok: false, error: 'That board list is empty — there is nothing in it to add.' };
  }

  return {
    ok: true,
    file: {
      kind: LIBRARY_KIND,
      version: 1,
      exportedAt: Number.isFinite(r.exportedAt) ? Number(r.exportedAt) : Date.now(),
      boards,
      removed,
    },
  };
}

export function serializeLibrary(boards: LibraryBoard[], removed: LibraryRemoval[]): string {
  const file: LibraryFile = {
    kind: LIBRARY_KIND,
    version: 1,
    exportedAt: Date.now(),
    boards,
    removed,
  };
  // Indented, because this is a file whose whole purpose is to be a durable
  // record a person might one day open and read by eye.
  return JSON.stringify(file, null, 2);
}

export interface LibraryMerge {
  boards: LibraryBoard[];
  /** How many addresses this device did not already have. */
  added: number;
}

/**
 * Fold a loaded list into the one this device holds.
 *
 * A union, never a replacement — see the note at the top. Ordered by
 * `lastAccessed`, newest first, which is the order the library shows anyway,
 * so a merge does not leave the grid in an order nothing chose.
 */
export function mergeLibrary(current: LibraryBoard[], incoming: LibraryBoard[]): LibraryMerge {
  const byId = new Map<string, LibraryBoard>();
  for (const b of current) byId.set(b.id, b);

  let added = 0;
  for (const b of incoming) {
    const have = byId.get(b.id);
    if (!have) {
      byId.set(b.id, b);
      added += 1;
      continue;
    }
    // Both copies are the same board; the later visit is the true one. The
    // name comes with it, since renaming happens on the device you were using.
    if (b.lastAccessed > have.lastAccessed) byId.set(b.id, b);
  }

  return {
    boards: [...byId.values()].sort((a, b) => b.lastAccessed - a.lastAccessed),
    added,
  };
}
