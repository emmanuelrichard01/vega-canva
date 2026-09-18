/**
 * How the library orders and dates the boards on this device.
 *
 * Pure, and separate from the page, because these are the two things a library
 * screen gets quietly wrong: a grid of twenty boards with no order anyone can
 * name, and dates in three formats on one row — "today at 18:32", "3 days
 * ago", "27/08/2026" — which is what happens when the rule is written inline
 * and grows a branch at a time.
 */

export interface ShelfBoard {
  id: string;
  name: string;
  lastAccessed: number;
}

export type BoardSort = 'recent' | 'name';

export const BOARD_SORTS: ReadonlyArray<{ id: BoardSort; label: string; hint: string }> = [
  { id: 'recent', label: 'Last opened', hint: 'Newest first' },
  { id: 'name', label: 'Name', hint: 'A to Z' },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When a board was last opened, in one voice.
 *
 * Coarse on purpose. "Opened 4 minutes ago" is worth the words; "opened on
 * 27/08/2026 at 14:03" is a timestamp pretending to be a fact somebody needs.
 * Past a week it becomes a date, because "43 days ago" is arithmetic the
 * reader has to do.
 */
export function whenOpened(timestamp: number, now = Date.now()): string {
  const age = now - timestamp;
  if (age < 0) return 'just now';
  if (age < MINUTE) return 'just now';
  if (age < HOUR) {
    const minutes = Math.floor(age / MINUTE);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (age < DAY) {
    const hours = Math.floor(age / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (age < 2 * DAY) return 'yesterday';
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} days ago`;

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface BoardGroup {
  id: 'today' | 'week' | 'month' | 'older';
  label: string;
  boards: ShelfBoard[];
}

const GROUPS: Array<{ id: BoardGroup['id']; label: string; within: number }> = [
  { id: 'today', label: 'Today', within: DAY },
  { id: 'week', label: 'Earlier this week', within: 7 * DAY },
  { id: 'month', label: 'Earlier this month', within: 30 * DAY },
  { id: 'older', label: 'Older', within: Infinity },
];

export function sortBoards(boards: readonly ShelfBoard[], sort: BoardSort): ShelfBoard[] {
  const list = [...boards];
  return sort === 'name'
    ? list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || b.lastAccessed - a.lastAccessed)
    : list.sort((a, b) => b.lastAccessed - a.lastAccessed);
}

/**
 * Boards under headings of when they were last open.
 *
 * Which is what a library is actually sorted by, and what a flat grid hides:
 * the four you touched this morning and the one from March look identical in a
 * row of pictures. Empty stretches are dropped, so the headings are never a
 * scaffold with nothing under them, and a library small enough to take in at
 * once (up to `MIN_FOR_GROUPS`) is left alone — headings over six boards are
 * furniture.
 */
export const MIN_FOR_GROUPS = 7;

export function groupBoards(boards: readonly ShelfBoard[], now = Date.now()): BoardGroup[] {
  const ordered = sortBoards(boards, 'recent');
  if (ordered.length < MIN_FOR_GROUPS) {
    return ordered.length ? [{ id: 'today', label: '', boards: ordered }] : [];
  }
  return GROUPS.map(({ id, label, within }, index) => {
    const from = index === 0 ? 0 : GROUPS[index - 1].within;
    return {
      id,
      label,
      boards: ordered.filter((board) => {
        const age = now - board.lastAccessed;
        return age >= from && age < within;
      }),
    };
  }).filter((group) => group.boards.length > 0);
}
