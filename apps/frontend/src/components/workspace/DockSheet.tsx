import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

/**
 * The sheet a dock seat opens: every choice for the next gesture, on one
 * scroll.
 *
 * ## What it replaces
 *
 * `KindPicker`, in the dock. It served four seats with four configurations of
 * the same machinery -- tabs on one, a recent row on another, search on two,
 * tiles from 62 to 104px -- so no two of those menus behaved alike, and the
 * one with the most choices (shapes) was also the one with the most chrome
 * between the pointer and the thing it came for. The shape swapper on the
 * rail still uses it; the dock does not.
 *
 * ## The one layout
 *
 * - **Sections, not tabs.** A family is a small label on the scroll, a
 *   landmark rather than a door, so nothing is hidden behind a word.
 * - **Two tile shapes, chosen by what identifies the choice.** `icon` when the
 *   picture *is* the identity (a hexagon has six sides; nobody reads the word)
 *   and `card` when the name is needed beside it (a grid system, a finished
 *   table). Icon tiles buy a family per row; cards buy readability.
 * - **One line of words at the foot**, for whatever the pointer or the keyboard
 *   is on -- the name and what it is for, read once, where it is wanted.
 * - **A fixed height when there is a search**, so filtering never resizes the
 *   panel under the pointer: the failure that once closed a flyout mid-click.
 *
 * ## The keyboard
 *
 * Arrows move by where tiles are *drawn*, so Down reaches the tile below even
 * where a family ends mid-row. Up from the top row returns to the search, Down
 * from the search enters the grid, Enter in the search takes the first match.
 * Typing while a tile has focus goes to the search rather than to the board's
 * one-key tools -- pressing `e` in a chart menu must not hand you the eraser.
 */

export interface SheetItem<T extends string> {
  id: T;
  label: string;
  /** What it is for, in a sentence. Shown at the foot and read by screen readers. */
  hint: string;
  icon: React.ReactNode;
  /** Extra words a search should match. */
  keywords?: readonly string[];
}

export interface SheetSection<T extends string> {
  id: string;
  label?: string;
  items: readonly SheetItem<T>[];
}

interface Props<T extends string> {
  sections: readonly SheetSection<T>[];
  /** The current choice, lit in the sheet. */
  value: T | null;
  onPick: (id: T) => void;
  variant: 'icon' | 'card';
  columns: number;
  width: number;
  /** A fixed body height, which a searchable sheet needs. Omit to show all. */
  height?: number;
  /** Offer a search, with this placeholder. */
  searchPlaceholder?: string;
  /**
   * Put the caret in the search on open -- only when the sheet was opened on
   * purpose (a click, the shelf). A sheet that opened because the pointer
   * rested on a seat must not take the keyboard, or the next `v` is typed into
   * a search box instead of arming Select.
   */
  focusSearch?: boolean;
  /** The foot's line when nothing is under the pointer or the keyboard. */
  idle: string;
}

function matches<T extends string>(item: SheetItem<T>, query: string): boolean {
  const haystack = [item.label, item.hint, ...(item.keywords ?? [])].join(' ').toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

export function DockSheet<T extends string>({
  sections,
  value,
  onPick,
  variant,
  columns,
  width,
  height,
  searchPlaceholder,
  focusSearch = false,
  idle,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<T | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const q = query.trim().toLowerCase();
  const shown = useMemo<readonly SheetSection<T>[]>(
    () =>
      q
        ? [{ id: 'matches', items: sections.flatMap((s) => s.items).filter((item) => matches(item, q)) }]
        : sections,
    [q, sections]
  );
  const flat = shown.flatMap((s) => s.items);
  const described =
    (hover && flat.find((item) => item.id === hover)) ||
    (value && sections.flatMap((s) => s.items).find((item) => item.id === value)) ||
    null;

  const tiles = () =>
    Array.from(bodyRef.current?.querySelectorAll<HTMLButtonElement>('.dock-sheet__tile') ?? []);

  /** The tile in the next row up or down, nearest to this one's column. */
  const tileAcross = (from: HTMLButtonElement, dir: 1 | -1): HTMLButtonElement | null => {
    const here = from.getBoundingClientRect();
    const rows = tiles().filter((t) => {
      const top = t.getBoundingClientRect().top;
      return dir > 0 ? top > here.top + 2 : top < here.top - 2;
    });
    if (rows.length === 0) return null;
    const tops = rows.map((t) => t.getBoundingClientRect().top);
    const rowTop = dir > 0 ? Math.min(...tops) : Math.max(...tops);
    const row = rows.filter((t) => Math.abs(t.getBoundingClientRect().top - rowTop) < 2);
    const gap = (t: HTMLButtonElement) => Math.abs(t.getBoundingClientRect().left - here.left);
    return row.reduce((best, t) => (gap(t) < gap(best) ? t : best));
  };

  const onBodyKey = (e: React.KeyboardEvent) => {
    const list = tiles();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;

    if (searchPlaceholder && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      setQuery((current) => current + e.key);
      searchRef.current?.focus();
      return;
    }

    let next: HTMLElement | null | undefined;
    if (e.key === 'ArrowRight') next = list[at + 1];
    else if (e.key === 'ArrowLeft') next = list[at - 1];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else if (e.key === 'ArrowDown') next = tileAcross(list[at], 1);
    else if (e.key === 'ArrowUp') next = tileAcross(list[at], -1) ?? searchRef.current;
    else return;

    // Stopped here so the room does not also pan the board with the arrows.
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      tiles()[0]?.focus();
    } else if (e.key === 'Enter' && flat[0]) {
      e.preventDefault();
      onPick(flat[0].id);
    } else if (e.key === 'Escape' && query) {
      // The first Escape clears the search; the next one closes the menu.
      e.stopPropagation();
      setQuery('');
    }
  };

  return (
    <div
      className="dock-sheet"
      data-variant={variant}
      style={{ width, ['--sheet-cols' as string]: String(columns) }}
    >
      {searchPlaceholder && (
        <label className="dock-sheet__search">
          <Search size={13} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>
      )}

      <div
        className="dock-sheet__body"
        ref={bodyRef}
        style={height ? { height } : undefined}
        onKeyDown={onBodyKey}
        onMouseLeave={() => setHover(null)}
      >
        {flat.length === 0 ? (
          <p className="dock-sheet__empty">Nothing matches “{query.trim()}”.</p>
        ) : (
          shown.map((section) => (
            <div key={section.id} className="dock-sheet__section" role="group" aria-label={section.label ?? 'Choices'}>
              {section.label && (
                <div className="dock-flyout__group" role="presentation">{section.label}</div>
              )}
              <div className="dock-sheet__grid">
                {section.items.map((item) => {
                  const on = value === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      aria-label={`${item.label}. ${item.hint}`}
                      className={`btn-icon dock-sheet__tile${on ? ' active' : ''}`}
                      onClick={() => onPick(item.id)}
                      onMouseEnter={() => setHover(item.id)}
                      onFocus={() => setHover(item.id)}
                    >
                      <span className="dock-sheet__pic" aria-hidden="true">{item.icon}</span>
                      {variant === 'card' && <span className="dock-sheet__label">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="dock-sheet__foot">
        {described ? (
          <>
            <span className="dock-sheet__name">{described.label}</span>
            <span className="dock-sheet__hint">{described.hint}</span>
          </>
        ) : (
          <span className="dock-sheet__hint">{idle}</span>
        )}
      </div>
    </div>
  );
}
