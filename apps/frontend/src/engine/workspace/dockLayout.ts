/**
 * The dock's arrangement, as data.
 *
 * ## Why the toolbar had to stop being a list of JSX
 *
 * Every seat was written out by hand in source order, so the dock's order *was*
 * the file's order. That is fine for a toolbar nobody rearranges and impossible
 * for one they do: there was no value anywhere in the program that said what
 * order the tools were in, so nothing could read it, store it, or change it.
 *
 * Here the order is a list of ids and the component renders that list. Whether
 * a seat is visible, where it sits, and which ones have been put away are three
 * questions with one answer each, and all three are one array away from being
 * saved, reset, or handed to a drag gesture.
 *
 * ## Why separators are items
 *
 * The dock groups its tools — navigate, draw, place, and so on — and those
 * groups are worth keeping for the people who never open the editor. But a
 * fixed grouping and a free arrangement cannot both be true: move Text next to
 * Select and the group boundaries are somebody else's idea of where the seams
 * go.
 *
 * So a separator is an ordinary item in the order, draggable and removable like
 * any other. The default arrangement groups the tools by what they are for, and
 * anyone who rearranges gets to say where their own seams are. Illustrator's
 * toolbar editor makes the same call.
 */

/** Every tool that can hold a seat. */
export const DOCK_SEATS = [
  'select',
  'directSelect',
  'hand',
  'draw',
  'eraser',
  'type',
  'shape',
  'line',
  'frame',
  'grid',
  'chart',
  'table',
  'data',
  'connector',
  'sticky',
  'image',
  'audio',
  'media',
  'comment',
  'forces',
] as const;

export type DockSeat = (typeof DOCK_SEATS)[number];

/** A separator. Several can sit in one dock, so the type is the marker. */
export const SEPARATOR = '|';

export type DockItem = DockSeat | typeof SEPARATOR;

export interface DockLayout {
  /** What the dock shows, left to right. */
  order: DockItem[];
  /**
   * Seats put away in the overflow drawer.
   *
   * A separate list rather than an `enabled` flag on each seat, because the
   * drawer has an order of its own and "hidden" needs to survive a seat being
   * dragged out and back.
   */
  hidden: DockSeat[];
}

/**
 * Seats that another seat carries in its flyout.
 *
 * Direct select rides with Select, the eraser with Draw, line and arrow with
 * Shape, the three data tools on one Data seat, image and voice on Media. A
 * carried seat that is put away is still one hover from the dock, so the
 * drawer does not list it a second time. Anyone can still pin it back as a
 * seat of its own in edit mode.
 */
export const SEAT_HOST: Partial<Record<DockSeat, DockSeat>> = {
  directSelect: 'select',
  eraser: 'draw',
  line: 'shape',
  grid: 'data',
  chart: 'data',
  table: 'data',
  image: 'media',
  audio: 'media',
};

/**
 * The arrangement everyone starts with: eleven seats.
 *
 * Navigate, then create, then data and media, then comment. Every tool not
 * shown here is carried by a seat that is (see `SEAT_HOST`), except Forces,
 * which lives in the drawer. Every single-key shortcut still arms its tool,
 * because a key arms a tool, not a seat.
 */
export const DEFAULT_LAYOUT: DockLayout = {
  order: [
    'select', 'hand',
    SEPARATOR,
    'draw', 'type', 'sticky', 'shape', 'connector', 'frame',
    SEPARATOR,
    'data', 'media', 'comment',
  ],
  hidden: ['directSelect', 'eraser', 'line', 'grid', 'chart', 'table', 'image', 'audio', 'forces'],
};

/** Whether a seat is on the dock, as opposed to put away. */
export function isOnDock(layout: DockLayout, seat: DockSeat): boolean {
  return layout.order.includes(seat);
}

/**
 * Whether a put-away seat is still reachable from the flyout of a seat that is
 * on the dock. Such a seat is shown by its host and not listed in the drawer.
 */
export function isCarried(layout: DockLayout, seat: DockSeat): boolean {
  const host = SEAT_HOST[seat];
  return Boolean(host) && !isOnDock(layout, seat) && isOnDock(layout, host!);
}

/** The put-away seats the drawer has to offer: those no seat on the dock carries. */
export function drawerSeats(layout: DockLayout): DockSeat[] {
  return layout.hidden.filter((seat) => !isCarried(layout, seat));
}

/** The storage format version. Layouts stored before the eleven-seat dock carry none. */
export const LAYOUT_VERSION = 2;

/**
 * A layout stored before the data and media seats existed, brought forward.
 *
 * Someone who rearranged the old dock placed Grid, Chart and Table (and Image
 * and Voice) where they wanted them. Those seats fold into Data and Media at
 * the position of the first of each family, and are put away, so the person's
 * arrangement keeps its shape instead of growing three new seats at the end.
 * The folded seats can be pinned back from edit mode.
 *
 * A family none of whose tools was on the dock (all put away) gives a seat
 * that is put away too: someone who removed Grid, Chart and Table did not ask
 * for a Data button. The result carries the current version, so it is only
 * ever migrated once.
 */
export function migrateStoredLayout(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const source = raw as { v?: unknown; order?: unknown; hidden?: unknown };
  if (source.v === LAYOUT_VERSION || !Array.isArray(source.order)) return raw;

  const FOLD: Record<string, DockSeat> = { grid: 'data', chart: 'data', table: 'data', image: 'media', audio: 'media' };
  const order: unknown[] = [];
  const folded: DockSeat[] = [];
  for (const item of source.order) {
    const into = typeof item === 'string' ? FOLD[item] : undefined;
    if (!into) {
      order.push(item);
      continue;
    }
    folded.push(item as DockSeat);
    if (!order.includes(into)) order.push(into);
  }
  const hidden: unknown[] = [...(Array.isArray(source.hidden) ? source.hidden : []), ...folded];
  // A family that was entirely put away keeps its new seat put away as well.
  // Without this, the normalizer's "unmentioned seats arrive visible" rule
  // would add the seat at the end of the dock.
  for (const host of new Set(Object.values(FOLD))) {
    if (!order.includes(host) && !hidden.includes(host)) hidden.push(host);
  }
  return { v: LAYOUT_VERSION, order, hidden };
}

/**
 * Seats that used to exist, and what they became.
 *
 * A stored layout is somebody's arrangement, and the normalizer's ordinary rule
 * for an id it does not recognise is to drop it -- correct for a tool that was
 * deleted, and wrong for one that was *merged*. Without this, everyone who had
 * ever rearranged their dock would find Text gone from where they put it and
 * `type` appended at the far end by rule 3.
 *
 * Mapping the old ids onto the new one keeps the position: whichever of `text`
 * or `block` came first is where `type` lands, and the second is absorbed by
 * the duplicate rule that already runs.
 */
const RENAMED: Record<string, DockSeat> = {
  text: 'type',
  block: 'type',
};

const KNOWN = new Set<string>(DOCK_SEATS);

/** A stored id, mapped through any rename. `null` when it is not a seat at all. */
function readSeat(value: unknown): DockSeat | null {
  if (typeof value !== 'string') return null;
  if (KNOWN.has(value)) return value as DockSeat;
  return RENAMED[value] ?? null;
}

/**
 * A stored layout, made safe to render.
 *
 * ## What this has to survive
 *
 * The layout lives in `localStorage`, which means it is arbitrary text that
 * *used* to be a layout: written by an older build, hand-edited, truncated by a
 * full disk, or simply from a version of the app with different tools.
 *
 * Three rules, and the third is the one that matters:
 *
 *  1. Anything unrecognised is dropped. A tool that no longer exists must not
 *     leave a hole in the dock, and the renderer would have nothing to draw.
 *  2. A seat listed twice is kept once, at its first position. Duplicates would
 *     give two buttons the same React key and the same shortcut.
 *  3. **A seat nobody has mentioned is appended, visible.** This is what makes
 *     the feature safe to keep: add a tool to the app next month and everyone
 *     who has ever rearranged their dock still gets it, at the end, rather than
 *     a toolbar frozen in the shape it had the day they first dragged
 *     something. The alternative -- treating an unmentioned seat as hidden --
 *     silently withholds new tools from exactly the users most engaged with
 *     the app.
 */
export function normalizeLayout(raw: unknown): DockLayout {
  const source = (raw ?? {}) as { order?: unknown; hidden?: unknown };

  /**
   * Nothing recognisable means a first run, and a first run gets the default.
   *
   * Without this the rules below are still perfectly well-defined and give the
   * wrong answer: no stored seats, so rule 3 appends every seat — a correct,
   * complete dock with every separator missing. Which is to say a new user's
   * toolbar would be one undivided row, and `DEFAULT_LAYOUT`'s grouping would
   * only ever be seen by someone who pressed Reset.
   *
   * Checked across `order` *and* `hidden`, because a person who has put every
   * single tool away has a layout — an eccentric one — and rebuilding the
   * default over the top of it would throw away a deliberate choice.
   */
  const mentionsSomething =
    (Array.isArray(source.order) && source.order.some((i) => readSeat(i))) ||
    (Array.isArray(source.hidden) && source.hidden.some((i) => readSeat(i)));
  if (!mentionsSomething) {
    return { order: [...DEFAULT_LAYOUT.order], hidden: [...DEFAULT_LAYOUT.hidden] };
  }

  const seen = new Set<DockSeat>();
  const order: DockItem[] = [];

  for (const item of Array.isArray(source.order) ? source.order : []) {
    if (item === SEPARATOR) {
      // Never two in a row, and never one at the very start: a rule with
      // nothing on one side of it is a stray line, not a division.
      if (order.length > 0 && order[order.length - 1] !== SEPARATOR) order.push(SEPARATOR);
      continue;
    }
    const seat = readSeat(item);
    if (seat && !seen.has(seat)) {
      seen.add(seat);
      order.push(seat);
    }
  }

  const hidden: DockSeat[] = [];
  for (const item of Array.isArray(source.hidden) ? source.hidden : []) {
    const seat = readSeat(item);
    if (seat && !seen.has(seat)) {
      seen.add(seat);
      hidden.push(seat);
    }
  }

  // Rule 3: everything the stored layout never mentioned.
  for (const seat of DOCK_SEATS) {
    if (!seen.has(seat)) order.push(seat);
  }

  // A separator left dangling at the end after the drops above.
  while (order.length > 0 && order[order.length - 1] === SEPARATOR) order.pop();

  return { order, hidden };
}

/**
 * Move the item at `from` so that it lands at `to`.
 *
 * Splice-out-then-splice-in, which is what makes the index mean the same thing
 * whichever direction the drag went: removing first shifts everything after it
 * down by one, so `to` is read against the list the item is not in — exactly
 * the list the drop indicator was drawn against.
 */
export function moveItem(order: readonly DockItem[], from: number, to: number): DockItem[] {
  if (from < 0 || from >= order.length) return [...order];
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/**
 * Put a seat away in the drawer.
 *
 * Separators are removed outright rather than hidden — a rule in a drawer is
 * not a thing anyone would go looking for, and `addSeparator` makes another
 * for free.
 */
export function hideSeat(layout: DockLayout, seat: DockSeat): DockLayout {
  if (layout.hidden.includes(seat)) return layout;
  return {
    order: tidy(layout.order.filter((item) => item !== seat)),
    hidden: [...layout.hidden, seat],
  };
}

/** Take a seat out of the drawer and put it back on the dock. */
export function showSeat(layout: DockLayout, seat: DockSeat, at = Infinity): DockLayout {
  if (!layout.hidden.includes(seat)) return layout;
  const order = [...layout.order];
  order.splice(Math.max(0, Math.min(order.length, at)), 0, seat);
  return { order, hidden: layout.hidden.filter((s) => s !== seat) };
}

/** Drop a separator into the dock at `at`. */
export function addSeparator(layout: DockLayout, at: number): DockLayout {
  const order = [...layout.order];
  order.splice(Math.max(0, Math.min(order.length, at)), 0, SEPARATOR);
  return { ...layout, order: tidy(order) };
}

/** Remove the item at `index`, whatever it is. */
export function removeAt(layout: DockLayout, index: number): DockLayout {
  const item = layout.order[index];
  if (item === undefined) return layout;
  if (item === SEPARATOR) {
    return { ...layout, order: tidy(layout.order.filter((_, i) => i !== index)) };
  }
  return hideSeat(layout, item);
}

/** Collapse doubled separators and trim the ends. */
function tidy(order: readonly DockItem[]): DockItem[] {
  const out: DockItem[] = [];
  for (const item of order) {
    if (item === SEPARATOR && (out.length === 0 || out[out.length - 1] === SEPARATOR)) continue;
    out.push(item);
  }
  while (out.length > 0 && out[out.length - 1] === SEPARATOR) out.pop();
  return out;
}

/** Whether a layout is the one everybody starts with. */
export function isDefaultLayout(layout: DockLayout): boolean {
  return (
    layout.hidden.length === DEFAULT_LAYOUT.hidden.length &&
    layout.hidden.every((seat, i) => seat === DEFAULT_LAYOUT.hidden[i]) &&
    layout.order.length === DEFAULT_LAYOUT.order.length &&
    layout.order.every((item, i) => item === DEFAULT_LAYOUT.order[i])
  );
}
