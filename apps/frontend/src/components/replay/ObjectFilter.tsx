import React, { useMemo, useRef, useState } from 'react';
import { Crosshair, Search } from 'lucide-react';
import { Popover } from '../ui/Popover';

export interface FilterOption {
  id: string;
  label: string;
  changes: number;
}

interface Props {
  options: () => FilterOption[];
  onPick: (id: string) => void;
}

/**
 * Per-object history, picked from the timeline itself: every object the log
 * touched, busiest first, searchable.
 */
export const ObjectFilter: React.FC<Props> = ({ options, onPick }) => {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const list = useMemo(() => (open ? options() : []), [open, options]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? list.filter((o) => o.label.toLowerCase().includes(q)) : list).slice(0, 200);
  }, [list, query]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="btn-icon btn-icon--sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Show one object's history"
        data-tooltip="Show one object's history"
        onClick={() => setOpen((o) => !o)}
      >
        <Crosshair size={16} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Object history" prefer="above" align="end" className="replay-filter">
        <label className="replay-filter__search">
          <Search size={14} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            placeholder="Find an object"
            aria-label="Find an object"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="replay-filter__list" role="listbox" aria-label="Objects with history">
          {shown.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={false}
              className="replay-filter__option"
              onClick={() => {
                onPick(o.id);
                setOpen(false);
              }}
            >
              <span className="replay-filter__name">{o.label}</span>
              <span className="replay-filter__count">{o.changes.toLocaleString()}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="replay-filter__empty">No object by that name in this history.</p>}
        </div>
      </Popover>
    </>
  );
};
