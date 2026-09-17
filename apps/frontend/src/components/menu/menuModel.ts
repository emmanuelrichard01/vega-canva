import type React from 'react';

/**
 * The shape of a menu, and the arithmetic behind moving through one.
 *
 * Kept apart from the component so the parts that are easy to get subtly wrong
 * — which row the arrow keys land on, what a typed letter jumps to, which side
 * a submenu opens on, whether the pointer is on its way to that submenu — can
 * be asserted in Node rather than clicked through.
 */

export interface MenuItemEntry {
  kind: 'item';
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Platform-neutral, e.g. `Mod+Shift+G`. See `shortcuts.ts`. */
  shortcut?: string;
  /** A second, quieter line: what will and will not happen. */
  detail?: string;
  /** Something drawn at the end of the row in place of a shortcut — a swatch. */
  trailing?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Why it is disabled, said on the row rather than left to be guessed. */
  disabledReason?: string;
  /** A toggle, drawn with a check and announced as a checkbox. */
  checked?: boolean;
  /**
   * Stay open after running. For settings toggles, where the reason for opening
   * a View menu is often to change two or three things.
   */
  keepOpen?: boolean;
  onSelect: () => void;
}

export interface MenuSubmenuEntry {
  kind: 'submenu';
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Rows, for an ordinary cascading menu. */
  entries?: MenuEntry[];
  /**
   * A bespoke panel — a picker — for a choice that is a grid, not a list.
   * Given `close`, for a control that finishes the interaction.
   */
  panel?: (close: () => void) => React.ReactNode;
}

export interface MenuStripEntry {
  kind: 'strip';
  id: string;
  label: string;
  items: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    shortcut?: string;
    disabled?: boolean;
    onSelect: () => void;
  }>;
}

export interface MenuSeparatorEntry {
  kind: 'separator';
  id: string;
}

export interface MenuHeadingEntry {
  kind: 'heading';
  id: string;
  label: string;
}

export type MenuEntry =
  | MenuItemEntry
  | MenuSubmenuEntry
  | MenuStripEntry
  | MenuSeparatorEntry
  | MenuHeadingEntry;

/** Whether the keyboard can stop on this row. */
export function isNavigable(entry: MenuEntry): boolean {
  if (entry.kind === 'separator' || entry.kind === 'heading') return false;
  if (entry.kind === 'strip') return entry.items.some((i) => !i.disabled);
  return !entry.disabled;
}

/**
 * Tidy a list built from conditions: no separator first, last, or doubled.
 *
 * A menu assembled from "if this, add these rows" produces orphaned rules as a
 * matter of course, and hand-guarding every one is how a menu ends up with two
 * lines in a row the one time a section is empty.
 */
export function tidy(entries: readonly (MenuEntry | null | false | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.kind === 'separator') {
      const last = out[out.length - 1];
      if (!last || last.kind === 'separator') continue;
    }
    if (entry.kind === 'submenu' && entry.entries) {
      const inner = tidy(entry.entries);
      if (inner.length === 0 && !entry.panel) continue;
      out.push({ ...entry, entries: inner });
      continue;
    }
    out.push(entry);
  }
  // A heading with nothing under it before the next rule, or at the end.
  const headed = out.filter((entry, i) => {
    if (entry.kind !== 'heading') return true;
    const next = out[i + 1];
    return Boolean(next) && next.kind !== 'separator' && next.kind !== 'heading';
  });
  // Dropping a heading can leave its rule leading, or two rules touching.
  const cleaned = headed.filter(
    (entry, i) => entry.kind !== 'separator' || (i > 0 && headed[i - 1].kind !== 'separator')
  );
  while (cleaned.length && cleaned[cleaned.length - 1].kind === 'separator') cleaned.pop();
  return cleaned;
}

/** The next row the arrow keys stop on, wrapping. `-1` when there is none. */
export function stepIndex(entries: readonly MenuEntry[], from: number, dir: 1 | -1): number {
  const n = entries.length;
  if (n === 0) return -1;
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n;
    if (isNavigable(entries[i])) return i;
  }
  return -1;
}

export function firstIndex(entries: readonly MenuEntry[]): number {
  return stepIndex(entries, -1, 1);
}

export function lastIndex(entries: readonly MenuEntry[]): number {
  return stepIndex(entries, 0, -1);
}

/**
 * Where a typed prefix lands: the next row after `from` whose label starts
 * with it, wrapping. A repeated single letter cycles through the rows sharing
 * it, which is how native menus behave and how "L" gets from Lock to Layers.
 */
export function typeahead(entries: readonly MenuEntry[], from: number, buffer: string): number {
  const q = buffer.toLowerCase();
  if (!q) return -1;
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  const n = entries.length;
  // A fresh prefix starts at the current row, so typing more of the word keeps
  // the row it already found; a single letter moves on from it.
  const start = needle.length > 1 ? 0 : 1;
  for (let step = start; step < n + start; step++) {
    const i = (((from + step) % n) + n) % n;
    const entry = entries[i];
    if (!isNavigable(entry) || entry.kind === 'strip' || entry.kind === 'separator' || entry.kind === 'heading') continue;
    if (entry.label.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  margin: number;
}

export interface Placement {
  x: number;
  y: number;
  /** Which corner the panel grows from, for the entrance. */
  origin: string;
  /** Set when the panel is taller than the window and must scroll. */
  maxHeight?: number;
}

/**
 * Where a menu opened at a point goes.
 *
 * Down and to the right of the pointer, the way every desktop menu opens —
 * flipping to the left of it, not sliding under it, when there is no room.
 * A menu that slides left to fit puts its first row under the pointer, and a
 * right-click released a moment late then chooses that row.
 */
export function placeAtPoint(point: { x: number; y: number }, size: Size, view: Viewport): Placement {
  const { margin } = view;
  const maxHeight = view.height - margin * 2;
  const height = Math.min(size.height, maxHeight);

  let x = point.x;
  let h: 'left' | 'right' = 'left';
  if (x + size.width > view.width - margin) {
    x = point.x - size.width;
    h = 'right';
    if (x < margin) x = Math.max(margin, view.width - margin - size.width);
  }

  let y = point.y;
  let v: 'top' | 'bottom' = 'top';
  if (y + height > view.height - margin) {
    if (point.y - height >= margin) {
      y = point.y - height;
      v = 'bottom';
    } else {
      y = Math.max(margin, view.height - margin - height);
    }
  }

  return {
    x,
    y,
    origin: `${v} ${h}`,
    maxHeight: size.height > maxHeight ? maxHeight : undefined,
  };
}

/**
 * Where a menu hung off a button goes: under it, end-aligned, or above it when
 * the button is low on the screen.
 */
export function placeAtRect(
  rect: { left: number; right: number; top: number; bottom: number },
  size: Size,
  view: Viewport,
  prefer: 'below' | 'above' = 'below',
  align: 'start' | 'end' = 'end'
): Placement {
  const { margin } = view;
  const gap = 6;
  const roomBelow = view.height - margin - (rect.bottom + gap);
  const roomAbove = rect.top - gap - margin;
  const below =
    prefer === 'below'
      ? roomBelow >= size.height || roomBelow >= roomAbove
      : !(roomAbove >= size.height || roomAbove >= roomBelow);
  const room = below ? roomBelow : roomAbove;
  const height = Math.min(size.height, room);
  const y = below ? rect.bottom + gap : rect.top - gap - height;
  // End-aligned under a button at the right of a bar; start-aligned under one
  // at the left, so the menu grows into the screen rather than off it.
  let x = align === 'end' ? rect.right - size.width : rect.left;
  x = Math.max(margin, Math.min(x, view.width - margin - size.width));
  return {
    x,
    y,
    origin: `${below ? 'top' : 'bottom'} ${align === 'end' ? 'right' : 'left'}`,
    maxHeight: size.height > room ? room : undefined,
  };
}

/**
 * Where a submenu goes: beside its row, overlapping the parent's padding so the
 * pointer never crosses a gap, on whichever side has room.
 */
export function placeSubmenu(
  row: { top: number; bottom: number },
  parent: { left: number; right: number },
  size: Size,
  view: Viewport,
  inset = 4
): Placement & { side: 'right' | 'left' } {
  const { margin } = view;
  let side: 'right' | 'left' = 'right';
  let x = parent.right - inset;
  if (x + size.width > view.width - margin) {
    const left = parent.left + inset - size.width;
    if (left >= margin) {
      x = left;
      side = 'left';
    } else {
      x = Math.max(margin, view.width - margin - size.width);
    }
  }
  const maxHeight = view.height - margin * 2;
  const height = Math.min(size.height, maxHeight);
  // Line the submenu's first row up with the row that opened it.
  let y = row.top - inset;
  if (y + height > view.height - margin) y = view.height - margin - height;
  y = Math.max(margin, y);
  return {
    x,
    y,
    side,
    origin: `top ${side === 'right' ? 'left' : 'right'}`,
    maxHeight: size.height > maxHeight ? maxHeight : undefined,
  };
}

type Point = { x: number; y: number };

function sign(p1: Point, p2: Point, p3: Point) {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

/**
 * Whether the pointer is heading for an open submenu.
 *
 * The triangle from where the pointer was a moment ago to the near edge of the
 * submenu: moving diagonally toward it crosses the rows below the one that
 * opened it, and without this each of those rows would snatch the submenu
 * away on the way past. It is the detail that separates a menu you can use
 * with a trackpad from one you have to steer through like a maze.
 */
export function aimingAt(
  from: Point,
  to: Point,
  panel: { left: number; right: number; top: number; bottom: number },
  side: 'right' | 'left'
): boolean {
  const edgeX = side === 'right' ? panel.left : panel.right;
  // Moving away from the submenu is never aiming at it.
  if (side === 'right' ? to.x < from.x : to.x > from.x) return false;
  const a = from;
  const b = { x: edgeX, y: panel.top - 8 };
  const c = { x: edgeX, y: panel.bottom + 8 };
  const d1 = sign(to, a, b);
  const d2 = sign(to, b, c);
  const d3 = sign(to, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
