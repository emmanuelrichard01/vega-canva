import React from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Note, Row, SegmentedControl, Select, Switch } from '../panel/grammar';
import { rangeLines, resolveTableLink } from '../../engine/chart/chartFromTable';
import {
  CHART_SORTS,
  CHART_SORT_LABELS,
  LINK_FILTER_OPS,
  type ChartSort,
  type ChartSpec,
  type ChartTableLink,
  type LinkAggregate,
  type LinkFilter,
  type LinkFilterOp,
} from '../../engine/chart/chartTypes';
import type { TableSpec } from '../../engine/table/tableTypes';
import { setChartLink } from './dataActions';

/**
 * How a linked range is read: which way the series run, which line holds the
 * categories and which are drawn, readings combined by category, filters,
 * and the order the categories are drawn in.
 */

const VIEW_ONLY = 'Only editors change how a chart reads its table';

const AGGREGATES: Array<{ value: 'none' | LinkAggregate; label: string; detail: string }> = [
  { value: 'none', label: 'Every row', detail: 'One category per reading, as the table has it' },
  { value: 'sum', label: 'Sum', detail: 'Add up readings that share a category' },
  { value: 'avg', label: 'Average', detail: 'The mean of readings that share a category' },
  { value: 'count', label: 'Count', detail: 'How many filled cells each category has' },
  { value: 'min', label: 'Smallest', detail: 'The lowest reading per category' },
  { value: 'max', label: 'Largest', detail: 'The highest reading per category' },
];

export const FILTER_OP_LABELS: Record<LinkFilterOp, string> = {
  eq: 'is',
  ne: 'is not',
  gt: 'is over',
  lt: 'is under',
  contains: 'contains',
  filled: 'is filled',
};

interface Props {
  chartId: string;
  spec: ChartSpec;
  replace: (next: ChartSpec) => void;
  link: ChartTableLink;
  table: TableSpec;
  canEdit: boolean;
}

export const LinkShape: React.FC<Props> = ({ chartId, spec, replace, link, table, canEdit }) => {
  const lines = React.useMemo(() => rangeLines(table, link), [table, link]);
  const data = React.useMemo(() => resolveTableLink(table, link), [table, link]);
  const lock = canEdit ? undefined : VIEW_ONLY;
  const set = (change: Partial<ChartTableLink>, drop: Array<keyof ChartTableLink> = []) => {
    const next: ChartTableLink = { ...link, ...change };
    for (const k of drop) delete next[k];
    for (const k of Object.keys(change) as Array<keyof ChartTableLink>) if (change[k] === undefined) delete next[k];
    setChartLink(chartId, spec, next);
  };

  const single = lines.length <= 1;
  const catId = single ? null : lines.some((l) => l.id === link.categoryLine) ? link.categoryLine! : lines[0].id;
  const others = lines.filter((l) => l.id !== catId);
  const drawn = new Set(link.seriesLines ?? others.map((l) => l.id));
  const toggleSeries = (id: string) => {
    const on = new Set(drawn);
    if (on.has(id)) on.delete(id);
    else on.add(id);
    const list = others.map((l) => l.id).filter((x) => on.has(x));
    set({ seriesLines: list.length === others.length ? undefined : list });
  };

  const filters = link.filters ?? [];
  const setFilters = (next: LinkFilter[]) => set({ filters: next.length ? next : undefined });
  const lineOptions = lines.map((l) => ({ value: l.id, label: l.label }));

  return (
    <div className="data-block" role="group" aria-label="How the range is read">
      <Row label="Series in">
        <SegmentedControl
          ariaLabel="Where the series are in the range"
          fill
          disabledReason={lock}
          value={link.seriesIn ?? 'columns'}
          segments={[
            { value: 'columns', label: 'Columns', hint: 'Each column is a series' },
            { value: 'rows', label: 'Rows', hint: 'Each row is a series' },
          ]}
          onChange={(v) =>
            // Lines are rows one way and columns the other, so a mapping by line does not carry over.
            set(v === 'rows' ? { seriesIn: 'rows' } : { seriesIn: undefined }, ['categoryLine', 'seriesLines', 'filters', 'header'])
          }
        />
      </Row>
      <Row label="Names" hint="Whether the first line of the range names the series">
        <Switch
          checked={data.header}
          disabled={!canEdit}
          tooltip={lock}
          label={link.seriesIn === 'rows' ? 'First column' : 'First row'}
          onChange={(on) => set({ header: on })}
        />
      </Row>
      {!single && (
        <Row label="Categories">
          <Select
            label="Line holding the categories"
            value={catId ?? ''}
            options={lineOptions}
            disabledReason={lock}
            onChange={(id) => set({ categoryLine: id === lines[0].id ? undefined : id, seriesLines: link.seriesLines?.filter((s) => s !== id) })}
          />
        </Row>
      )}
      {!single && others.length > 0 && (
        <Row label="Series" stack={others.length > 3}>
          <div className="data-chips" role="group" aria-label="Lines drawn as series">
            {others.map((l) => {
              const on = drawn.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  className="data-chip"
                  aria-pressed={on}
                  disabled={!canEdit}
                  data-tooltip={lock}
                  onClick={() => toggleSeries(l.id)}
                >
                  {on && <Check size={12} aria-hidden="true" />}
                  <span>{l.label}</span>
                </button>
              );
            })}
          </div>
        </Row>
      )}
      <Row label="Combine" hint="Readings that share a category become one">
        <Select
          label="Combine readings by category"
          value={link.aggregate ?? 'none'}
          options={AGGREGATES}
          disabledReason={lock}
          onChange={(v) => set({ aggregate: v === 'none' ? undefined : v })}
        />
      </Row>
      <Row label="Order">
        <Select<ChartSort>
          label="Category order"
          value={spec.sort ?? 'none'}
          options={CHART_SORTS.map((s) => ({ value: s, label: s === 'none' ? 'As in the table' : CHART_SORT_LABELS[s] }))}
          disabledReason={lock}
          onChange={(v) => {
            const { sort: _sort, ...rest } = spec;
            replace(v === 'none' ? rest : { ...rest, sort: v });
          }}
        />
      </Row>
      <div className="data-filters" role="group" aria-label="Filters">
        <div className="data-filters__head">
          <span className="pg-row__label">Filters</span>
          {canEdit && lines.length > 0 && (
            <button
              type="button"
              className="pg-icon-btn"
              aria-label="Add a filter"
              data-tooltip="Add a filter"
              onClick={() => setFilters([...filters, { line: (catId ?? lines[0].id), op: 'filled', value: '' }])}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {filters.length === 0 ? (
          <Note>Every reading is drawn.</Note>
        ) : (
          filters.map((f, i) => (
            <FilterRow
              key={i}
              filter={f}
              lines={lineOptions}
              canEdit={canEdit}
              onChange={(next) => setFilters(filters.map((g, j) => (j === i ? next : g)))}
              onRemove={() => setFilters(filters.filter((_, j) => j !== i))}
            />
          ))
        )}
      </div>
    </div>
  );
};

function FilterRow({
  filter,
  lines,
  canEdit,
  onChange,
  onRemove,
}: {
  filter: LinkFilter;
  lines: Array<{ value: string; label: string }>;
  canEdit: boolean;
  onChange: (next: LinkFilter) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const lock = canEdit ? undefined : VIEW_ONLY;
  const known = lines.some((l) => l.value === filter.line);
  const commit = () => {
    if (draft !== null && draft !== filter.value) onChange({ ...filter, value: draft });
    setDraft(null);
  };
  return (
    <div className="data-filter">
      <Select
        label="Filter on"
        value={known ? filter.line : 'gone'}
        options={known ? lines : [{ value: 'gone', label: 'A line no longer in the range' }, ...lines]}
        disabledReason={lock}
        onChange={(line) => line !== 'gone' && onChange({ ...filter, line })}
      />
      <Select<LinkFilterOp>
        label="Condition"
        value={filter.op}
        options={LINK_FILTER_OPS.map((op) => ({ value: op, label: FILTER_OP_LABELS[op] }))}
        disabledReason={lock}
        onChange={(op) => onChange({ ...filter, op })}
      />
      {filter.op !== 'filled' ? (
        <input
          className="data-field"
          aria-label="Filter value"
          placeholder="Value"
          value={draft ?? filter.value}
          readOnly={!canEdit}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setDraft(null);
          }}
        />
      ) : (
        <span />
      )}
      {canEdit ? (
        <button type="button" className="pg-icon-btn" aria-label="Remove this filter" data-tooltip="Remove" onClick={onRemove}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
