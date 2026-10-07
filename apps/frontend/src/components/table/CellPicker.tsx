import React from 'react';
import './tableTools.css';
import { Check, Plus } from 'lucide-react';
import { selectLabels } from '../../engine/table/tableModel';
import { initialsOf, personPaint } from '../../engine/table/tableLayout';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';

/**
 * Choosing a select or person cell's value from a list.
 *
 * Opens under the cell; typing filters, arrows move, Enter takes the
 * highlighted choice — or, when nothing matches, makes what was typed a new
 * choice, which is how a select column grows without a trip to the panel. A
 * multi-select toggles and stays open; Backspace in an empty search removes
 * the last choice, as tag inputs everywhere do.
 */

export interface PickerChoice {
  label: string;
  /** A select option's tag colour. */
  tag?: number;
  /** Shown after the label, quieter: "here now", "in this column". */
  detail?: string;
}

export const CellPicker: React.FC<{
  kind: 'select' | 'person';
  value: string;
  choices: PickerChoice[];
  multi: boolean;
  initial?: string;
  left: number;
  top: number;
  minWidth: number;
  onChange: (value: string) => void;
  /** A choice nobody has made yet, typed and committed. */
  onCreate?: (label: string) => void;
  onClose: (move?: 'down' | 'right') => void;
}> = ({ kind, value, choices, multi, initial, left, top, minWidth, onChange, onCreate, onClose }) => {
  const [query, setQuery] = React.useState(initial ?? '');
  const [active, setActive] = React.useState(0);
  const selected = selectLabels(value);
  const has = (l: string) => selected.some((s) => s.toLowerCase() === l.toLowerCase());
  const q = query.trim().toLowerCase();
  const matches = choices.filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 60);
  const exact = choices.some((c) => c.label.toLowerCase() === q);
  const canCreate = Boolean(q) && !exact;
  const rows = matches.length + (canCreate ? 1 : 0);
  const at = Math.min(active, Math.max(0, rows - 1));

  const pick = (label: string) => {
    if (multi) {
      const next = has(label) ? selected.filter((s) => s.toLowerCase() !== label.toLowerCase()) : [...selected, label];
      onChange(next.join('; '));
      setQuery('');
    } else {
      onChange(has(label) ? '' : label);
      onClose('down');
    }
  };
  const create = () => {
    const label = query.trim().replace(/;/g, ',');
    if (!label) return;
    onCreate?.(label);
    pick(label);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + rows) % Math.max(1, rows));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (at < matches.length) pick(matches[at].label);
      else if (canCreate) create();
      else onClose('down');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose('right');
    } else if (e.key === 'Backspace' && !query && multi && selected.length) {
      e.preventDefault();
      onChange(selected.slice(0, -1).join('; '));
    }
  };

  return (
    <div
      className="tblpick"
      role="dialog"
      aria-label={kind === 'select' ? 'Choose a value' : 'Choose a person'}
      style={{ left, top, minWidth }}
      {...{ [PORTAL_SURFACE_ATTR]: 'table-picker' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {multi && selected.length > 0 && (
        <div className="tblpick__chosen">
          {selected.map((l) => {
            const tag = choices.find((c) => c.label.toLowerCase() === l.toLowerCase())?.tag;
            return (
              <button key={l} type="button" className="tbl-tag tbl-tag--removable" data-tag={tag ?? 0} onClick={() => pick(l)} aria-label={`Remove ${l}`}>
                {l}
                <span aria-hidden="true">×</span>
              </button>
            );
          })}
        </div>
      )}
      <input
        className="tblpick__input"
        autoFocus
        value={query}
        placeholder={kind === 'select' ? (onCreate ? 'Find or create an option' : 'Find an option') : 'Find someone, or type a name'}
        role="combobox"
        aria-expanded="true"
        aria-controls="tblpick-list"
        aria-activedescendant={rows ? `tblpick-${at}` : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
      />
      <div className="tblpick__list" id="tblpick-list" role="listbox" aria-multiselectable={multi || undefined}>
        {matches.map((c, i) => (
          <div
            key={c.label}
            id={`tblpick-${i}`}
            role="option"
            aria-selected={has(c.label)}
            data-active={i === at || undefined}
            className="tblpick__opt"
            onPointerEnter={() => setActive(i)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => pick(c.label)}
          >
            {kind === 'person' ? (
              <span className="tblpick__person">
                <span className="tblpick__avatar" style={{ background: personPaint(c.label).paper, color: personPaint(c.label).ink }}>
                  {initialsOf(c.label)}
                </span>
                {c.label}
              </span>
            ) : (
              <span className="tbl-tag" data-tag={c.tag ?? 0}>
                {c.label}
              </span>
            )}
            {c.detail && <span className="tblpick__detail">{c.detail}</span>}
            <span className="tblpick__tick" aria-hidden="true">
              {has(c.label) && <Check size={13} strokeWidth={2.5} />}
            </span>
          </div>
        ))}
        {canCreate && (
          <div
            id={`tblpick-${matches.length}`}
            role="option"
            aria-selected={false}
            data-active={at === matches.length || undefined}
            className="tblpick__opt tblpick__opt--create"
            onPointerEnter={() => setActive(matches.length)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={create}
          >
            <Plus size={13} aria-hidden="true" />
            {kind === 'select' ? (onCreate ? 'Create' : 'Use') : 'Use'} <b>{query.trim()}</b>
          </div>
        )}
        {rows === 0 && <p className="tblpick__empty">{kind === 'select' ? 'Type to create the first option.' : 'Type a name.'}</p>}
      </div>
    </div>
  );
};
