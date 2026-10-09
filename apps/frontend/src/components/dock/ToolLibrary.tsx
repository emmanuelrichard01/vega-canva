import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

/**
 * A searchable, grouped list of tools: the Insert seat's library and the All
 * tools panel are both this.
 *
 * Each row is the tool's icon, its name, one line on what it does, and its
 * key. Rows that can sit on the dock carry a pin; rows that live inside
 * another seat say which one instead, so nothing is only findable by knowing
 * where it was put.
 *
 * The search takes the keyboard on open. Down and Up walk the rows (from the
 * search too), Enter arms the focused one, and typing anywhere in the list
 * goes back to the search.
 */

export interface ToolEntry {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  group: string;
  shortcut?: string;
  /** Extra words the search matches. */
  keywords?: readonly string[];
  /** Whether this is the tool in hand. */
  active?: boolean;
  run: () => void;
  /** For a tool with a seat of its own: whether it is on the dock, and the switch. */
  pin?: { pinned: boolean; toggle: () => void };
  /** For a tool inside another seat: that seat's name. */
  home?: string;
}

interface Props {
  label: string;
  entries: readonly ToolEntry[];
  searchPlaceholder: string;
  /** Under the list: the panel's own actions. */
  footer?: React.ReactNode;
  /** Put the caret in the search on open. */
  focusSearch?: boolean;
}

function matches(entry: ToolEntry, q: string): boolean {
  const hay = [entry.label, entry.description, entry.group, entry.home ?? '', ...(entry.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

const PinIcon: React.FC<{ on: boolean }> = ({ on }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      d="M6 2.5h4l-.6 4 2.1 2.2v1H4.5v-1l2.1-2.2Z M8 9.7V13.5"
      fill={on ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

export const ToolLibrary: React.FC<Props> = ({ label, entries, searchPlaceholder, footer, focusSearch = true }) => {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus({ preventScroll: true });
  }, [focusSearch]);

  const q = query.trim();
  const groups = useMemo(() => {
    const shown = q ? entries.filter((e) => matches(e, q)) : entries;
    const out: Array<{ name: string; rows: ToolEntry[] }> = [];
    for (const entry of shown) {
      const last = out[out.length - 1];
      if (last && last.name === entry.group) last.rows.push(entry);
      else out.push({ name: entry.group, rows: [entry] });
    }
    return out;
  }, [entries, q]);
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  /** The pin column is only drawn for a list that has pins or homes to show. */
  const hasAside = entries.some((e) => e.pin || e.home);

  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.tool-lib__row') ?? []);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows()[0]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows()[0]?.click();
    } else if (e.key === 'Escape' && query) {
      // The first Escape clears the search; the next one closes the library,
      // as in every sheet the dock opens.
      e.stopPropagation();
      setQuery('');
    }
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const all = rows();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (at < 0) return;
      if (e.key === 'ArrowUp' && at === 0) {
        searchRef.current?.focus();
        return;
      }
      all[Math.min(all.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      if (at < 0) return;
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && at >= 0) {
      // Typing on a row is searching.
      searchRef.current?.focus();
    }
  };

  return (
    <div className="tool-lib" aria-label={label}>
      <label className="tool-lib__search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          aria-controls={`${label}-list`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
      </label>

      <div className="tool-lib__list" ref={listRef} id={`${label}-list`} onKeyDown={onListKey}>
        {count === 0 && (
          <p className="tool-lib__empty" role="status">
            Nothing called “{q}”. Try a shorter word.
          </p>
        )}
        {groups.map((group) => (
          <div className="tool-lib__group" key={group.name} role="group" aria-label={group.name}>
            <div className="tool-lib__heading" aria-hidden="true">{group.name}</div>
            {group.rows.map((entry) => (
              <div className="tool-lib__item" key={entry.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="tool-lib__row"
                  data-active={entry.active || undefined}
                  aria-current={entry.active || undefined}
                  aria-label={`${entry.label}. ${entry.description}${entry.shortcut ? `. Key ${entry.shortcut}` : ''}`}
                  onClick={entry.run}
                >
                  <span className="tool-lib__icon" aria-hidden="true">{entry.icon}</span>
                  <span className="tool-lib__text">
                    <span className="tool-lib__name">{entry.label}</span>
                    <span className="tool-lib__desc">{entry.description}</span>
                  </span>
                  {entry.shortcut && <kbd className="tool-lib__key">{entry.shortcut}</kbd>}
                </button>
                {entry.pin ? (
                  <button
                    type="button"
                    className="tool-lib__pin"
                    aria-pressed={entry.pin.pinned}
                    aria-label={entry.pin.pinned ? `Take ${entry.label} off the dock` : `Put ${entry.label} on the dock`}
                    data-tooltip={entry.pin.pinned ? 'On the dock' : 'Put on the dock'}
                    onClick={entry.pin.toggle}
                  >
                    <PinIcon on={entry.pin.pinned} />
                  </button>
                ) : entry.home ? (
                  <span className="tool-lib__home">{entry.home}</span>
                ) : hasAside ? (
                  <span className="tool-lib__home" aria-hidden="true" />
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {footer && <div className="tool-lib__foot">{footer}</div>}
    </div>
  );
};
