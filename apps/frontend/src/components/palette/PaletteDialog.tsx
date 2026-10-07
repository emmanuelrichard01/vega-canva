import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { groupRuns, labelMatches, rankItems, type PaletteItem } from './paletteMatch';
import './palette.css';

export type { PaletteItem } from './paletteMatch';

/**
 * The command surface, without opinions about what is in it.
 *
 * The board's palette and the dashboard's both render through this, so the
 * keyboard model, the matching and the look are one thing. It carries no
 * animation library and touches no document state, which is what lets the
 * dashboard load it without pulling in the board.
 */

/** The characters that matched, marked — the same walk the score uses. */
export const Marked: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;

  const out: React.ReactNode[] = [];
  let qi = 0;
  let run = '';
  let hit = '';

  const flush = () => {
    if (run) { out.push(run); run = ''; }
    if (hit) { out.push(<mark key={out.length} className="cmdk__mark">{hit}</mark>); hit = ''; }
  };

  for (const ch of text) {
    if (qi < q.length && ch.toLowerCase() === q[qi]) {
      if (run) { out.push(run); run = ''; }
      hit += ch;
      qi += 1;
    } else {
      if (hit) { out.push(<mark key={out.length} className="cmdk__mark">{hit}</mark>); hit = ''; }
      run += ch;
    }
  }
  flush();
  return <>{out}</>;
};

interface Props {
  items: readonly PaletteItem[];
  /** Results that depend on the query, appended after the ranked items. */
  extraResults?: (query: string) => PaletteItem[];
  placeholder: string;
  label: string;
  onClose: () => void;
}

export const PaletteDialog: React.FC<Props> = ({ items, extraResults, placeholder, label, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** The row under the pointer, which is not the row the keyboard is on. */
  const [hovered, setHovered] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useFocusTrap(true, onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const ranked = rankItems(items, query);
    return query.trim() && extraResults ? groupRuns([...ranked, ...extraResults(query)]) : ranked;
  }, [items, extraResults, query]);

  // Enter never runs a command that is no longer under the highlight.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const commit = (item: PaletteItem | undefined) => {
    if (!item) return;
    item.perform();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(results[selectedIndex]);
    }
  };

  let lastGroup = '';
  const activeId = results[selectedIndex] ? `cmdk-row-${results[selectedIndex].id}` : undefined;

  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="cmdk cmdk--enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk__head">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
          />
          {query.trim() && (
            <span className="cmdk__tally" role="status">
              {results.length === 0 ? 'no matches' : `${results.length}`}
            </span>
          )}
        </div>

        <div id="command-results" ref={listRef} role="listbox" aria-label="Results" className="cmdk__list">
          {results.length === 0 && <p className="cmdk__none">Nothing matches “{query}”.</p>}

          {results.map((item, index) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            const isSelected = index === selectedIndex;

            return (
              <React.Fragment key={item.id}>
                {showGroup && <p className="cmdk__group">{item.group}</p>}
                <div
                  id={`cmdk-row-${item.id}`}
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected || undefined}
                  data-hovered={hovered === index || undefined}
                  className="cmdk__row"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
                  onClick={() => commit(item)}
                >
                  <span className="cmdk__icon">{item.icon}</span>
                  <span className="cmdk__text">
                    <span className="cmdk__label">{labelMatches(item.label, query) ? <Marked text={item.label} query={query} /> : item.label}</span>
                    {item.detail && <span className="cmdk__detail">{item.detail}</span>}
                  </span>
                  {item.shortcut && <kbd className="cmdk__key">{item.shortcut}</kbd>}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="cmdk__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
};
