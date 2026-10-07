import { groupBoards, sortBoards, type BoardGroup, type BoardSort, type ShelfBoard } from '../../engine/room/boardShelf';
import { storageGetJson, storageSet } from '../../utils/safeStorage';

/**
 * The dashboard's own bookkeeping: the board list and its shelf, pins, local
 * names, grouping and the keyboard model of the board grid. Pure where it can
 * be, so it is tested in Node rather than clicked through.
 *
 * Every write is read-merge-write against storage, never a whole list from
 * memory: two tabs of the dashboard, or a dashboard and a board, write these
 * keys independently, and the last whole-list write would erase the other's.
 */

export type BoardRole = 'editor' | 'commenter' | 'viewer';

/** A board this device knows, with how it was reached. */
export interface LibraryBoard extends ShelfBoard {
  /** The signed invite it was opened through, when it was. */
  invite?: string;
  /** The role that invite grants. Absent means the bare address: an editor. */
  role?: BoardRole;
  /** When the invite stops working, epoch ms. */
  inviteExpires?: number | null;
}

export interface RemovedBoard extends LibraryBoard {
  removedAt: number;
}

/** Board id → when it was pinned. Newest pin first. */
export type PinMap = Record<string, number>;

/**
 * Board id → a name typed on the dashboard.
 *
 * Kept until the server reports the board under that name, because the name
 * the dashboard reads back lags a rename by however long it takes somebody to
 * open the board. `was` is the name the board had when this one was typed, so
 * a later rename from somewhere else can be told apart from the stale one.
 */
export interface PendingName {
  name: string;
  sent: boolean;
  was?: string;
}
export type NameMap = Record<string, PendingName>;

export const RECENTS_KEY = 'recentWorkspaces';
export const REMOVED_KEY = 'vega_removed_workspaces';
export const PINS_KEY = 'vega_pinned_boards';
export const NAMES_KEY = 'vega_board_names';
/** A ceiling, said out loud if it is ever reached; "Forget" is the real exit. */
export const REMOVED_LIMIT = 500;

const ROLES = new Set<string>(['editor', 'commenter', 'viewer']);

function isBoard(value: unknown): value is LibraryBoard {
  const b = value as Partial<LibraryBoard> | null;
  return !!b && typeof b.id === 'string' && !!b.id && typeof b.name === 'string' && typeof b.lastAccessed === 'number';
}

function cleanBoard<T extends LibraryBoard>(b: T): T {
  const out = { ...b };
  if (typeof out.invite !== 'string' || !out.invite) delete out.invite;
  if (!out.role || !ROLES.has(out.role)) delete out.role;
  return out;
}

export function readRecents(): LibraryBoard[] {
  const raw = storageGetJson<unknown>(RECENTS_KEY, []);
  return Array.isArray(raw) ? raw.filter(isBoard).map(cleanBoard) : [];
}

export function readRemoved(): RemovedBoard[] {
  const raw = storageGetJson<unknown>(REMOVED_KEY, []);
  return Array.isArray(raw)
    ? raw.filter((r): r is RemovedBoard => isBoard(r) && typeof (r as RemovedBoard).removedAt === 'number').map(cleanBoard)
    : [];
}

function readRecord<T>(key: string, valid: (value: unknown) => value is T): Record<string, T> {
  const raw = storageGetJson<unknown>(key, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (valid(value)) out[id] = value;
  }
  return out;
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNameEntry = (v: unknown): v is PendingName =>
  !!v && typeof (v as { name?: unknown }).name === 'string' && !!(v as { name: string }).name.trim();

export const readPins = (): PinMap => readRecord(PINS_KEY, isTime);
export const readNames = (): NameMap => {
  const raw = readRecord<unknown>(NAMES_KEY, (_v): _v is unknown => true);
  const out: NameMap = {};
  for (const [id, v] of Object.entries(raw)) {
    // Older entries were the bare string.
    if (typeof v === 'string' && v.trim()) out[id] = { name: v, sent: false };
    else if (isNameEntry(v)) {
      out[id] = { name: v.name, sent: Boolean((v as { sent?: unknown }).sent) };
      if (typeof v.was === 'string') out[id].was = v.was;
    }
  }
  return out;
};

/**
 * What the server's title for a board means for a name typed here.
 *
 * `settled`: the server now reports the typed name, so it can be forgotten.
 * `superseded`: the server reports a third name — somebody renamed the board
 * after this name was sent — so theirs wins. `pending`: the server still
 * reports the old name, which it does until somebody opens the board.
 */
export function reconcileName(pending: PendingName, serverTitle: string): 'settled' | 'superseded' | 'pending' {
  if (pending.name === serverTitle) return 'settled';
  if (pending.sent && pending.was !== undefined && serverTitle !== pending.was) return 'superseded';
  return 'pending';
}

/** Read the current stored value, change it, write it back, return it. */
function mutate<T>(read: () => T, key: string, change: (current: T) => T): T {
  const next = change(read());
  storageSet(key, JSON.stringify(next));
  return next;
}

export const mutateRecents = (change: (list: LibraryBoard[]) => LibraryBoard[]) => mutate(readRecents, RECENTS_KEY, change);
export const mutateRemoved = (change: (list: RemovedBoard[]) => RemovedBoard[]) =>
  mutate(readRemoved, REMOVED_KEY, (list) => change(list).slice(0, REMOVED_LIMIT));
export const mutatePins = (change: (pins: PinMap) => PinMap) => mutate(readPins, PINS_KEY, change);
export const mutateNames = (change: (names: NameMap) => NameMap) => mutate(readNames, NAMES_KEY, change);

/** The keys this module owns, for listening to other tabs. */
export const LIBRARY_KEYS = new Set([RECENTS_KEY, REMOVED_KEY, PINS_KEY, NAMES_KEY]);

/**
 * Put a board at the front of the list.
 *
 * No cap: this list is, for most boards, the only record of the address, so
 * nothing is ever dropped from it to make room. What the board was reached
 * through is kept unless the new visit says otherwise.
 */
export function upsertRecent(list: readonly LibraryBoard[], entry: LibraryBoard): LibraryBoard[] {
  const previous = list.find((b) => b.id === entry.id);
  const merged = cleanBoard({ ...previous, ...entry });
  return [merged, ...list.filter((b) => b.id !== entry.id)];
}

/** Record a visit to a board, from the board itself. */
export function rememberBoard(entry: LibraryBoard): void {
  mutateRecents((list) => upsertRecent(list, entry));
}

/** Insert at `index` (clamped), or leave the list alone if it is already there. */
export function insertAt<T extends { id: string }>(list: readonly T[], item: T, index: number): T[] {
  if (list.some((b) => b.id === item.id)) return [...list];
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

export function togglePin(pins: PinMap, id: string, now = Date.now()): PinMap {
  const next = { ...pins };
  if (next[id]) delete next[id];
  else next[id] = now;
  return next;
}

/** The longest name a board can be given from here. Matches the header field. */
export const MAX_BOARD_NAME = 120;

/** A typed name, cleaned; `null` when nothing usable is left. */
export function cleanBoardName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_BOARD_NAME);
  return name ? name : null;
}

/** What a board is called on the dashboard: a pending local rename wins. */
export function displayName(board: ShelfBoard, names: NameMap): string {
  return names[board.id]?.name ?? board.name;
}

/** Whether this device's link to a board lets it change the board. */
export const canEditBoard = (board: LibraryBoard) => !board.role || board.role === 'editor';

/** Whether the invite this device holds for a board has run out. */
export const inviteExpired = (board: LibraryBoard, now = Date.now()) =>
  typeof board.inviteExpires === 'number' && board.inviteExpires > 0 && board.inviteExpires <= now;

export interface LibraryGroup {
  id: BoardGroup['id'] | 'pinned' | 'all' | 'recent';
  label: string;
  boards: ShelfBoard[];
}

/**
 * Below this many unpinned boards the library is one run, newest first. Time
 * headings split a small library into rows of one and two, which is a grid
 * of gaps; past this size they help you find your way.
 */
export const MIN_FOR_TIME_GROUPS = 16;

/**
 * The boards, in the groups the page shows.
 *
 * Pinned boards lead, newest pin first, under their own heading — but only
 * when the library is being browsed. A search or a name sort is a question
 * with one answer, so it gets one flat list and pins do not reorder it.
 */
export function libraryGroups(
  boards: readonly ShelfBoard[],
  opts: { pins: PinMap; names: NameMap; sort: BoardSort; query: string; now?: number }
): LibraryGroup[] {
  const named = boards.map((b) => (opts.names[b.id] ? { ...b, name: opts.names[b.id].name } : b));
  const q = opts.query.trim().toLowerCase();

  if (q) {
    const hits = sortBoards(named, opts.sort).filter((b) => b.name.toLowerCase().includes(q));
    return hits.length ? [{ id: 'all', label: '', boards: hits }] : [];
  }

  const pinned = named
    .filter((b) => opts.pins[b.id])
    .sort((a, b) => opts.pins[b.id] - opts.pins[a.id]);
  const rest = named.filter((b) => !opts.pins[b.id]);

  const groups: LibraryGroup[] = [];
  if (pinned.length) groups.push({ id: 'pinned', label: 'Pinned', boards: pinned });
  if (rest.length === 0) return groups;

  if (opts.sort === 'name') {
    groups.push({ id: 'all', label: pinned.length ? 'All boards' : '', boards: sortBoards(rest, 'name') });
    return groups;
  }

  if (rest.length < MIN_FOR_TIME_GROUPS) {
    groups.push({ id: 'recent', label: pinned.length ? 'Recent' : '', boards: sortBoards(rest, 'recent') });
    return groups;
  }

  for (const group of groupBoards(rest, opts.now)) groups.push(group);
  return groups;
}

/* ------------------------------------------------------------- keyboard grid */

export interface CellRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

const center = (r: CellRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Where an arrow key goes from `from`, judged by where the cards actually are.
 *
 * Left and Right step through reading order. Up and Down go to the nearest
 * card in the next row above or below — measured, not computed from a column
 * count, so they work across group headings, in the list layout, and across a
 * last row that is shorter than the one above it. Home and End go to the
 * first and last card. Returns `from` when there is nowhere to go.
 */
export function nextCell(rects: readonly CellRect[], from: number, key: GridKey): number {
  const count = rects.length;
  if (count === 0) return -1;
  if (from < 0 || from >= count) return 0;

  switch (key) {
    case 'ArrowLeft': return Math.max(0, from - 1);
    case 'ArrowRight': return Math.min(count - 1, from + 1);
    case 'Home': return 0;
    case 'End': return count - 1;
    default: break;
  }

  const here = center(rects[from]);
  const down = key === 'ArrowDown' || key === 'PageDown';
  const rowTolerance = Math.max(4, rects[from].height / 3);

  let rowY: number | null = null;
  for (const r of rects) {
    const y = center(r).y;
    const beyond = down ? y > here.y + rowTolerance : y < here.y - rowTolerance;
    if (!beyond) continue;
    if (rowY === null || (down ? y < rowY : y > rowY)) rowY = y;
  }
  if (rowY === null) return from;

  let best = from;
  let bestDx = Infinity;
  rects.forEach((r, i) => {
    const c = center(r);
    if (Math.abs(c.y - rowY!) > rowTolerance) return;
    const dx = Math.abs(c.x - here.x);
    if (dx < bestDx) { bestDx = dx; best = i; }
  });
  return best;
}

/** Where focus goes when the card at `index` of `count` disappears. */
export function focusAfterRemoval(index: number, count: number): number {
  if (count <= 1) return -1;
  return index < count - 1 ? index : index - 1;
}

/* -------------------------------------------------------------------- status */

export interface BoardStatus {
  id: string;
  exists: boolean;
  updatedAt: string | null;
  title: string | null;
  /** How many people have the board open. Never who. */
  onlineCount: number;
}

/** "1 person here", "3 people here". */
export function presenceLine(status: Pick<BoardStatus, 'onlineCount'>): string | null {
  const count = status.onlineCount;
  if (!count || count < 1) return null;
  return `${count} ${count === 1 ? 'person' : 'people'} here`;
}

/**
 * Whether the board changed since this device last had it open.
 *
 * A minute of slack, because opening a board stores it, and that store lands
 * after the moment the dashboard recorded as "opened".
 */
export function changedSinceOpened(board: ShelfBoard, status: BoardStatus | undefined): boolean {
  if (!status?.updatedAt) return false;
  const at = Date.parse(status.updatedAt);
  return Number.isFinite(at) && at > board.lastAccessed + 60_000;
}

/** Split ids into requests the status route accepts. */
export function batchIds(ids: readonly string[], size = 50): string[][] {
  const unique = [...new Set(ids)].sort();
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}
