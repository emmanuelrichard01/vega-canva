import React from 'react';
import { Link2, SquarePen, Table2, Unlink } from 'lucide-react';
import { Note, Row, Select, Switch, type SelectOption } from '../panel/grammar';
import { tableNode } from '../../engine/table/tableRegistry';
import {
  anchoredLink,
  currentRange,
  linkRangeLabel,
  parseRangeLabel,
  rangeLabel,
  unlinkedSpec,
  type TableRange,
} from '../../engine/chart/chartFromTable';
import { guessChart } from '../../engine/chart/chartFromTableGuess';
import { isPlot, type ChartSpec, type ChartTableLink } from '../../engine/chart/chartTypes';
import type { TableSpec } from '../../engine/table/tableTypes';
import { useLinkedTable } from './useLinkedChartSpec';
import { useBoardTables, useNamedRanges, type BoardTable } from './useDataBoard';
import { renameRange, setChartLink, showSource, useCanEditData } from './dataActions';
import { focusRange, rangeFocus } from './linkSignals';
import { LinkShape } from './LinkShape';
import { LinkedValues } from './LinkedValues';
import './data.css';

/**
 * Where a chart's numbers come from, in the chart's Data group.
 *
 * Typed in, or a table on the board: the table, the range (outlined on the
 * board while the field is pointed at), its name, whether it grows, then how
 * the range is read (series mapping, combining, filters, order) and the
 * values themselves, which an editor can write back to their cells.
 *
 * Every write goes through `dataActions`, which refuses for non-editors; the
 * controls say so before anyone tries.
 */

export const VIEW_ONLY = 'Only editors change where a chart reads from';

interface Props {
  chartId: string;
  /** The chart as drawn: linked values resolved. */
  spec: ChartSpec;
  replace: (next: ChartSpec) => void;
}

export const ChartDataSource: React.FC<Props> = (props) => {
  if (isPlot(props.spec.kind)) return null;
  return props.spec.link ? <LinkedSource {...props} link={props.spec.link} /> : <TypedSource {...props} />;
};

type SourceValue = 'typed' | `t:${string}` | `n:${string}`;

/** The source menu's options: typed in, the board's tables, and its named ranges. */
function useSourceOptions(withTyped: string | null): {
  options: Array<SelectOption<SourceValue>>;
  pick: (value: SourceValue) => { table: TableSpec; link: ChartTableLink } | 'typed' | null;
  tables: BoardTable[];
} {
  const tables = useBoardTables();
  const named = useNamedRanges(tables);
  const options: Array<SelectOption<SourceValue>> = [
    ...(withTyped !== null ? [{ value: 'typed' as const, label: 'Typed in', icon: <Unlink size={14} />, detail: withTyped || undefined }] : []),
    ...tables.map((t) => ({
      value: `t:${t.id}` as const,
      label: t.name,
      icon: <Table2 size={14} />,
      detail: `${t.rows} rows × ${t.cols} columns`,
      group: 'Tables on this board',
    })),
    ...named.map((n, i) => ({
      value: `n:${i}` as const,
      label: n.name,
      icon: <Link2 size={14} />,
      detail: `${n.table.name} · ${linkRangeLabel(tableNode(n.table.id)?.table, n.link)} · ${n.charts.length} ${n.charts.length === 1 ? 'chart' : 'charts'}`,
      group: 'Named ranges',
    })),
  ];
  const pick = (value: SourceValue) => {
    if (value === 'typed') return 'typed' as const;
    if (value.startsWith('t:')) {
      const id = value.slice(2);
      const table = tableNode(id)?.table;
      if (!table) return null;
      const guess = guessChart(table);
      const range = guess?.range ?? { r0: 0, c0: 0, r1: Math.max(0, table.cells.length - 1), c1: Math.max(0, table.columns.length - 1) };
      return { table, link: anchoredLink(table, id, range, guess?.seriesIn === 'rows' ? { seriesIn: 'rows' } : {}) };
    }
    const n = named[Number(value.slice(2))];
    const table = n && tableNode(n.table.id)?.table;
    if (!n || !table) return null;
    const { r0, c0, r1, c1, ids, grow, seriesIn, header } = n.link;
    return {
      table,
      link: {
        tableId: n.link.tableId,
        r0,
        c0,
        r1,
        c1,
        ...(ids ? { ids } : {}),
        ...(grow ? { grow } : {}),
        ...(seriesIn ? { seriesIn } : {}),
        ...(header !== undefined ? { header } : {}),
        name: n.name,
      },
    };
  };
  return { options, pick, tables };
}

const TypedSource: React.FC<Props> = ({ chartId, spec }) => {
  const canEdit = useCanEditData();
  const { options, pick, tables } = useSourceOptions('');
  if (tables.length === 0) return null;
  return (
    <>
      <Row label="Source">
        <Select<SourceValue>
          label="Data source"
          value="typed"
          options={options}
          disabledReason={canEdit ? undefined : VIEW_ONLY}
          onChange={(v) => {
            const picked = pick(v);
            if (picked && picked !== 'typed') setChartLink(chartId, spec, picked.link);
          }}
        />
      </Row>
      <Note>Read from a table and the chart follows its edits, on every screen.</Note>
    </>
  );
};

const LinkedSource: React.FC<Props & { link: ChartTableLink }> = ({ chartId, spec, replace, link }) => {
  const table = useLinkedTable(link.tableId);
  const canEdit = useCanEditData();
  if (!table) return <DeletedSource chartId={chartId} spec={spec} replace={replace} canEdit={canEdit} />;
  return (
    <>
      {!canEdit && <Note>View only. Editors change this chart’s source.</Note>}
      <SourceRows chartId={chartId} spec={spec} replace={replace} link={link} table={table} canEdit={canEdit} />
      <LinkShape chartId={chartId} spec={spec} replace={replace} link={link} table={table} canEdit={canEdit} />
      <LinkedValues chartId={chartId} spec={spec} link={link} table={table} canEdit={canEdit} />
    </>
  );
};

interface LinkedProps extends Props {
  link: ChartTableLink;
  table: TableSpec;
  canEdit: boolean;
}

function SourceRows({ chartId, spec, replace, link, table, canEdit }: LinkedProps) {
  const { options, pick, tables } = useSourceOptions('Keep the values as they are now');
  const named = useNamedRanges(tables);
  const range = currentRange(table, link) ?? link;
  const label = rangeLabel(range);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [nameDraft, setNameDraft] = React.useState<string | null>(null);
  const parsed = draft === null ? null : parseRangeLabel(draft);
  const invalid = draft !== null && !parsed;
  const sharing = link.name ? named.find((n) => n.link.tableId === link.tableId && n.name.toLowerCase() === link.name!.trim().toLowerCase()) : undefined;
  const others = (sharing?.charts.length ?? 1) - 1;
  const lock = canEdit ? undefined : VIEW_ONLY;

  // The board outlines the range while the field is pointed at; typing moves the outline.
  const point = (r: TableRange | null) => focusRange(r ? { tableId: link.tableId, range: r, from: 'panel' } : null);
  const release = () => {
    if (rangeFocus.get()?.from === 'panel') focusRange(null);
  };
  React.useEffect(() => release, []);

  const commitRange = () => {
    if (draft === null) return;
    if (parsed && canEdit && rangeLabel(parsed) !== label) {
      const { r0: _a, c0: _b, r1: _c, c1: _d, ids: _e, grow: _f, tableId: _g, ...reading } = link;
      setChartLink(chartId, spec, anchoredLink(table, link.tableId, parsed, reading));
    }
    setDraft(null);
  };

  const commitName = () => {
    if (nameDraft === null) return;
    const next = nameDraft.trim();
    const before = link.name?.trim() ?? '';
    setNameDraft(null);
    if (!canEdit || next === before) return;
    // A name already on this table is that range: the chart takes it up.
    const existing = named.find((n) => n.link.tableId === link.tableId && n.name.toLowerCase() === next.toLowerCase() && !n.charts.includes(chartId));
    if (existing) {
      const { r0, c0, r1, c1, ids, grow } = existing.link;
      const adopted: ChartTableLink = { ...link, r0, c0, r1, c1, name: existing.name };
      if (ids) adopted.ids = ids;
      else delete adopted.ids;
      if (grow) adopted.grow = true;
      else delete adopted.grow;
      setChartLink(chartId, spec, adopted);
      return;
    }
    renameRange(link.tableId, before, next, { id: chartId, spec });
  };

  return (
    <>
      <Row label="Source">
        <Select<SourceValue>
          label="Data source"
          value={`t:${link.tableId}`}
          options={options}
          disabledReason={lock}
          onChange={(v) => {
            if (v === `t:${link.tableId}`) return;
            const picked = pick(v);
            if (picked === 'typed') replace(unlinkedSpec(spec, table));
            else if (picked) setChartLink(chartId, spec, picked.link);
          }}
        />
      </Row>
      <Row label="Range" htmlFor={`data-range-${chartId}`}>
        <div className="data-range">
          <input
            id={`data-range-${chartId}`}
            className="data-field data-field--mono"
            value={draft ?? label}
            spellCheck={false}
            readOnly={!canEdit}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `data-range-note-${chartId}` : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              const next = parseRangeLabel(e.target.value);
              if (next) point(next);
            }}
            onFocus={() => point(range)}
            onBlur={() => {
              commitRange();
              release();
            }}
            onPointerEnter={() => point(parsed ?? range)}
            onPointerLeave={() => {
              if (document.activeElement?.id !== `data-range-${chartId}`) release();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRange();
              else if (e.key === 'Escape') {
                setDraft(null);
                point(range);
              }
            }}
          />
          <button
            type="button"
            className="pg-icon-btn"
            aria-label="Edit the source cells"
            data-tooltip="Edit the source cells"
            onClick={() => showSource(link)}
          >
            <SquarePen size={14} aria-hidden="true" />
          </button>
        </div>
      </Row>
      {invalid && (
        <p className="pg-note" id={`data-range-note-${chartId}`}>
          Write the range as two corners, like A1:D9.
        </p>
      )}
      <Row label="Name" htmlFor={`data-name-${chartId}`} hint="Name a range to reuse it: other charts pick it from Source, and moving it moves them all">
        <input
          id={`data-name-${chartId}`}
          className="data-field"
          value={nameDraft ?? link.name ?? ''}
          placeholder="Name this range"
          maxLength={80}
          readOnly={!canEdit}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            else if (e.key === 'Escape') setNameDraft(null);
          }}
        />
      </Row>
      {others > 0 && <Note>{`Shared with ${others} other ${others === 1 ? 'chart' : 'charts'}. Changing the range moves ${others === 1 ? 'it' : 'them'} too.`}</Note>}
      <Row label="Grow" hint="Rows filled in directly under the range join it, the way a Sheets table grows">
        <Switch
          checked={Boolean(link.grow)}
          disabled={!canEdit}
          tooltip={lock}
          label="New rows below"
          onChange={(on) => {
            const next: ChartTableLink = { ...link };
            if (on) next.grow = true;
            else delete next.grow;
            setChartLink(chartId, spec, next);
          }}
        />
      </Row>
    </>
  );
}

function DeletedSource({ chartId, spec, replace, canEdit }: Props & { canEdit: boolean }) {
  const tables = useBoardTables();
  const relink = (id: string) => {
    const table = tableNode(id)?.table;
    if (!table) return;
    const guess = guessChart(table);
    const range = guess?.range ?? { r0: 0, c0: 0, r1: Math.max(0, table.cells.length - 1), c1: Math.max(0, table.columns.length - 1) };
    const kept = spec.link;
    setChartLink(
      chartId,
      spec,
      anchoredLink(table, id, range, {
        ...(guess?.seriesIn === 'rows' ? { seriesIn: 'rows' as const } : {}),
        ...(kept?.aggregate ? { aggregate: kept.aggregate } : {}),
      })
    );
  };
  const points = spec.series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0);
  return (
    <>
      <div className="data-badge" role="status">
        <Unlink size={14} aria-hidden="true" />
        <span>Source table deleted</span>
      </div>
      <Note>{`The chart keeps the ${points} ${points === 1 ? 'value' : 'values'} it last read. Relink it to follow a table again.`}</Note>
      {tables.length > 0 ? (
        <Row label="Relink">
          <Select
            label="Relink to a table"
            value="none"
            disabledReason={canEdit ? undefined : VIEW_ONLY}
            options={[
              { value: 'none', label: 'Choose a table' },
              ...tables.map((t) => ({ value: t.id, label: t.name, icon: <Table2 size={14} />, detail: `${t.rows} rows × ${t.cols} columns` })),
            ]}
            onChange={(id) => id !== 'none' && relink(id)}
          />
        </Row>
      ) : (
        <Note>Add a table to the board to relink.</Note>
      )}
      {canEdit && (
        <button type="button" className="data-textbtn" onClick={() => replace(unlinkedSpec(spec, null))}>
          <Unlink size={14} aria-hidden="true" />
          Keep as typed values
        </button>
      )}
    </>
  );
}
