import React from 'react';
import './tableTools.css';
import { Check, FunnelX, Search } from 'lucide-react';
import * as M from '../../engine/table/tableModel';
import { filterOn, isNumericType, type TableSpec } from '../../engine/table/tableTypes';
import { SegmentedControl } from '../ui/SegmentedControl';
import { columnName } from './columnMenu';

/**
 * Filtering one column: by picking values, or by a condition.
 *
 * Picking is how people filter a status or an owner — tick what to see, the
 * way Sheets and Airtable present it — and every tick shows at once, so the
 * table answers while the list is still open. A condition (`>100`,
 * `2026-01-01..2026-03-31`, "contains") is for numbers, dates and free text,
 * and is applied with Enter, so a half-typed `>1` never hides the table
 * mid-thought.
 */

type Mode = 'values' | 'condition';

const CONDITION_HINT: Record<'text' | 'number' | 'date', string> = {
  text: 'Contains…',
  number: '>10, <=5, 5..20, <>0',
  date: '>2026-01-01, 2026-01-01..2026-03-31',
};

export const FilterPanel: React.FC<{
  spec: TableSpec;
  col: number;
  apply: (next: TableSpec) => void;
  close: () => void;
}> = ({ spec, col, apply, close }) => {
  const type = spec.columns[col]?.type ?? 'text';
  const current = filterOn(spec, col);
  const numeric = isNumericType(type) || type === 'date';
  const [mode, setMode] = React.useState<Mode>(current ? (current.values ? 'values' : 'condition') : numeric ? 'condition' : 'values');
  const [query, setQuery] = React.useState(current && !current.values ? current.query : '');
  const [search, setSearch] = React.useState('');
  const values = React.useMemo(() => M.distinctValues(spec, col), [spec, col]);
  const options = type === 'select' ? M.optionsOf(spec, col) : [];
  const picked = current?.values ? new Set(current.values) : null;
  const isPicked = (v: string) => !picked || picked.has(v);
  const shown = values.filter((v) => !search || v.value.toLowerCase().includes(search.toLowerCase()));

  const setPicked = (next: Set<string>) => {
    const all = values.every((v) => next.has(v.value));
    apply(M.setFilter(spec, col, all ? null : { query: '', values: [...next] }));
  };
  const toggle = (v: string) => {
    const next = new Set(picked ?? values.map((x) => x.value));
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setPicked(next);
  };
  const commitQuery = () => apply(M.setFilter(spec, col, query.trim() ? { query } : null));
  const kind = type === 'date' ? 'date' : numeric ? 'number' : 'text';

  return (
    <div className="tblfilter" role="group" aria-label={`Filter ${columnName(spec, col)}`}>
      <div className="tblfilter__head">
        <span className="tblfilter__title">{columnName(spec, col)}</span>
        {current && (
          <button
            type="button"
            className="tblfilter__clear"
            onClick={() => {
              apply(M.setFilter(spec, col, null));
              setQuery('');
              close();
            }}
          >
            <FunnelX size={13} aria-hidden="true" />
            Clear
          </button>
        )}
      </div>
      <SegmentedControl
        fill
        ariaLabel="How to filter"
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        segments={[
          { value: 'values', label: 'Pick values' },
          { value: 'condition', label: 'Condition' },
        ]}
      />
      {mode === 'values' ? (
        <>
          {values.length > 8 && (
            <label className="tblfilter__search">
              <Search size={13} aria-hidden="true" />
              <input value={search} placeholder="Find a value" onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          )}
          <div className="tblfilter__bulk">
            <button type="button" onClick={() => setPicked(new Set(values.map((v) => v.value)))}>
              All
            </button>
            <button type="button" onClick={() => setPicked(new Set())}>
              None
            </button>
          </div>
          <div className="tblfilter__list" role="listbox" aria-multiselectable="true">
            {shown.slice(0, 200).map((v) => {
              const tag = options.find((o) => o.label === v.value)?.tag;
              return (
                <button
                  key={v.value || '(blank)'}
                  type="button"
                  role="option"
                  aria-selected={isPicked(v.value)}
                  className="tblfilter__opt"
                  onClick={() => toggle(v.value)}
                >
                  <span className="tblfilter__check" aria-hidden="true">
                    {isPicked(v.value) && <Check size={12} strokeWidth={3} />}
                  </span>
                  {v.value === M.BLANK ? (
                    <span className="tblfilter__blank">Empty</span>
                  ) : tag !== undefined ? (
                    <span className="tbl-tag" data-tag={tag}>
                      {v.value}
                    </span>
                  ) : (
                    <span className="tblfilter__value">{type === 'checkbox' ? (v.value === 'TRUE' ? 'Ticked' : 'Not ticked') : v.value}</span>
                  )}
                  <span className="tblfilter__count">{v.count}</span>
                </button>
              );
            })}
            {shown.length === 0 && <p className="tblfilter__none">No value matches “{search}”.</p>}
          </div>
        </>
      ) : (
        <>
          <input
            className="tblfilter__query"
            autoFocus
            value={query}
            placeholder={CONDITION_HINT[kind]}
            aria-label="Condition"
            onChange={(e) => setQuery(e.target.value)}
            onBlur={commitQuery}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                commitQuery();
                close();
              }
            }}
          />
          <p className="tblfilter__note">
            {kind === 'text'
              ? 'Rows whose value contains this, in any case.'
              : 'Compare with > < >= <= = <>, or give a range as from..to. Enter applies it.'}
          </p>
        </>
      )}
    </div>
  );
};
