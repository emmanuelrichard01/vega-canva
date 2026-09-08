import React from 'react';
import { Search, X } from 'lucide-react';

/**
 * The picker three dock seats share.
 *
 * ## Why one component
 *
 * Shapes, grids and charts all ask the same question -- *which kind, before
 * you draw* -- and all three had answered it separately. Three search boxes
 * with three placeholders and three clear buttons; three tab strips; three
 * "what am I pointing at" footers; three CSS namespaces. They looked like
 * three products in one dock, and every improvement to one of them was a
 * decision about whether to go and make the same edit twice more. Nobody ever
 * did, which is why one had keyboard support and the others did not, and why
 * one showed its hints inline until the flyout was too wide to fit on screen.
 *
 * ## The one line of explanation lives in one place
 *
 * The single decision that shapes this layout: **a tile carries an icon and a
 * name, and the sentence explaining it appears once, at the bottom, for
 * whatever you are pointing at.**
 *
 * Putting the hint on every tile is what made the chart flyout enormous --
 * twenty-four hints, each wrapping to two lines, is a wall of prose you scan
 * past to find a picture. Putting it *nowhere* is worse: "Manuscript" and
 * "Baseline" mean nothing until somebody tells you, once. A preview bar reads
 * like a status line, costs one row no matter how many kinds there are, and
 * is the pattern Illustrator's tool tips and Figma's component browser both
 * settle on.
 *
 * It also gives hover and keyboard focus the same job, which is what makes
 * arrow-key navigation feel like something rather than a compliance exercise:
 * moving the selection *narrates* itself.
 *
 * ## Keyboard
 *
 * Roving tabindex over the flattened list of what is currently visible.
 * Left/right step one; up/down step a row. Home/End jump to the ends. Enter
 * or Space picks. Typing goes to the search field, and Down from there enters
 * the grid -- so the whole control is reachable without ever moving a hand to
 * the mouse, which is the actual difference between a menu and a tool.
 */

export interface KindOption<T extends string> {
  id: T;
  label: string;
  /** One line. Shown in the preview bar, never on the tile. */
  hint: string;
  icon: React.ReactNode;
  /** Extra words a search should match -- synonyms, the name nobody uses. */
  keywords?: readonly string[];
}

export interface KindGroup<T extends string> {
  id: string;
  /** Omitted for a single unnamed run of options. */
  label?: string;
  options: readonly KindOption<T>[];
}

export interface KindFacet {
  id: string;
  label: string;
}

interface Props<T extends string> {
  /** Already filtered by facet; this component filters only by search text. */
  groups: readonly KindGroup<T>[];
  /** Omit for no tab strip. */
  facets?: readonly KindFacet[];
  activeFacet?: string;
  onFacet?: (id: string) => void;
  /** What the seat is currently armed with, so the picker can show it. */
  value: T | null;
  onPick: (id: T) => void;
  /** Recently used, shown first and unfiltered by facet. */
  recent?: readonly KindOption<T>[];
  searchPlaceholder: string;
  /** Tiles per row. Drives the grid *and* what an arrow key means. */
  columns: number;
  /**
   * How wide one tile is, in px. With `columns`, this *is* the panel width.
   *
   * A property of the picker rather than a constant, because the right answer
   * depends on how long the names are. Chart kinds are the wordiest thing in
   * the dock -- "Percent stacked bar", "Slope field" -- and at the shapes'
   * tile width they came out as two cramped lines each, which reads as a
   * dense list rather than as a set of choices. Room is most of what makes a
   * picker feel considered.
   */
  tile?: number;
  /** Wider tiles that put the name beside the icon rather than under it. */
  dense?: boolean;
  /**
   * Whether to offer a search field.
   *
   * Off by default, because most of these lists do not need one: searching a
   * dozen pictures you can already see is slower than looking at them, and a
   * field that is never used is a row of chrome above every list. It earns
   * its place at forty shapes across seven categories, and nowhere else here.
   */
  search?: boolean;
}

const norm = (s: string) => s.toLowerCase();

export function KindPicker<T extends string>({
  groups,
  facets,
  activeFacet,
  onFacet,
  value,
  onPick,
  recent,
  searchPlaceholder,
  columns,
  dense,
  tile,
  search = false,
}: Props<T>) {
  const [query, setQuery] = React.useState('');
  /**
   * What the preview bar is describing.
   *
   * One piece of state for hover *and* keyboard, because they are the same
   * question asked two ways -- and keeping them apart is how a picker ends up
   * describing the hovered tile while the arrow keys move somewhere else.
   */
  const [cursor, setCursor] = React.useState<T | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const trimmed = query.trim();

  /** The groups actually on screen: searched, with empty groups dropped. */
  const shown = React.useMemo(() => {
    const withRecent: KindGroup<T>[] =
      recent && recent.length > 0 && !trimmed
        ? [{ id: '__recent', label: 'Recent', options: recent }, ...groups]
        : [...groups];

    if (!trimmed) return withRecent;

    const q = norm(trimmed);
    return withRecent
      .map((g) => ({
        ...g,
        options: g.options.filter(
          (o) =>
            norm(o.label).includes(q) ||
            norm(o.hint).includes(q) ||
            (o.keywords ?? []).some((k) => norm(k).includes(q))
        ),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, recent, trimmed]);

  /**
   * Everything visible, in reading order.
   *
   * Arrow keys move through this rather than through the groups, so crossing
   * a heading costs nothing -- the alternative is a cursor that stops dead at
   * every group boundary and has to be coaxed over it.
   */
  const flat = React.useMemo(() => shown.flatMap((g) => g.options), [shown]);

  const total = flat.length;

  // A search that now matches nothing must not leave the cursor describing a
  // tile that is no longer on screen.
  React.useEffect(() => {
    setCursor((c) => (c && flat.some((o) => o.id === c) ? c : null));
  }, [flat]);

  const described = React.useMemo(
    () => flat.find((o) => o.id === cursor) ?? flat.find((o) => o.id === value) ?? null,
    [flat, cursor, value]
  );

  const focusAt = (index: number) => {
    const clamped = Math.max(0, Math.min(total - 1, index));
    const next = flat[clamped];
    if (!next) return;
    setCursor(next.id);
    bodyRef.current?.querySelector<HTMLElement>(`[data-kind="${next.id}"]`)?.focus();
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const at = flat.findIndex((o) => o.id === cursor);
    const from = at < 0 ? 0 : at;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusAt(from + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusAt(from - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusAt(from + columns);
        break;
      case 'ArrowUp':
        e.preventDefault();
        // Off the top of the grid is the search field, which is where
        // somebody pressing Up from the first row is trying to get to.
        if (from - columns < 0) {
          (
            bodyRef.current?.parentElement?.querySelector('.kp__input') as HTMLElement | null
          )?.focus();
        } else focusAt(from - columns);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(total - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="kp"
      data-dense={dense || undefined}
      /**
       * The width is a function of the grid and of nothing else.
       *
       * It used to be whatever the widest thing inside happened to be, which
       * was the preview bar -- so the whole flyout changed width as the
       * pointer moved between kinds with longer and shorter descriptions.
       * A panel that resizes while you read it is the same defect as one that
       * resizes while you click in it.
       */
      style={{
        ['--kp-cols' as string]: String(columns),
        ...(tile ? { ['--kp-tile' as string]: `${tile}px` } : null),
      }}
    >
      {(search || (facets && facets.length > 0)) && (
      <div className="kp__filters">
        {search && (
        <div className="kp__search">
          <Search size={12} aria-hidden />
          <input
            className="kp__input"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            // The flyout closes on Escape and on outside clicks; neither should
            // happen because somebody clicked into this field or cleared it.
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusAt(0);
              } else if (e.key === 'Enter' && total > 0) {
                // The obvious thing after typing three letters that leave one
                // match: take it.
                e.preventDefault();
                onPick(flat[0].id);
              } else if (e.key === 'Escape' && query) {
                // Clears the search rather than closing the picker -- the
                // first Escape undoes the typing, a second one closes.
                e.stopPropagation();
                setQuery('');
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="kp__clear"
              aria-label="Clear the search"
              onClick={(e) => {
                e.stopPropagation();
                setQuery('');
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        )}

        {/* Facets are hidden while searching: a search already spans every
            facet, and leaving the tabs up implies the results are confined to
            the selected one. */}
        {facets && facets.length > 0 && !trimmed && (
          <div className="kp__facets" role="tablist">
            {facets.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={activeFacet === f.id}
                className="kp__facet"
                data-active={activeFacet === f.id || undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onFacet?.(f.id);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {total === 0 ? (
        // Quotes what was typed, so the reader can see the typo rather than
        // only that something failed.
        <p className="kp__empty">Nothing matches “{trimmed}”.</p>
      ) : (
        <div
          className="kp__body"
          ref={bodyRef}
          role="listbox"
          aria-label={searchPlaceholder}
          onKeyDown={onGridKey}
        >
          {shown.map((group) => (
            <section className="kp__group" key={group.id}>
              {group.label && (
                <h5 className="kp__groupLabel">
                  {group.label}
                  <span className="kp__count">{group.options.length}</span>
                </h5>
              )}
              <div className="kp__grid">
                {group.options.map((option) => {
                  const selected = option.id === value;
                  return (
                    <button
                      key={`${group.id}:${option.id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className="kp__tile"
                      data-kind={option.id}
                      data-active={selected || undefined}
                      // Roving tabindex: one stop for the whole grid, so Tab
                      // leaves the picker rather than walking forty tiles.
                      tabIndex={option.id === (cursor ?? value ?? flat[0]?.id) ? 0 : -1}
                      onMouseEnter={() => setCursor(option.id)}
                      onFocus={() => setCursor(option.id)}
                      onClick={() => onPick(option.id)}
                    >
                      <span className="kp__glyph" aria-hidden="true">
                        {option.icon}
                      </span>
                      <span className="kp__label">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/**
       * The one line of explanation, for whatever is being pointed at.
       *
       * Always rendered, even with nothing to describe, so the picker does not
       * change height as the pointer crosses it -- a footer that appears on
       * hover moves every tile above it, which turns a steady scan into a
       * flinch.
       */}
      <div className="kp__preview" aria-live="polite">
        {described ? (
          <>
            <span className="kp__previewGlyph" aria-hidden="true">
              {described.icon}
            </span>
            <span className="kp__previewText">
              <span className="kp__previewName">{described.label}</span>
              <span className="kp__previewHint">{described.hint}</span>
            </span>
          </>
        ) : (
          <span className="kp__previewHint">
            {total} {total === 1 ? 'kind' : 'kinds'} — point at one to see what it does
          </span>
        )}
      </div>
    </div>
  );
}
