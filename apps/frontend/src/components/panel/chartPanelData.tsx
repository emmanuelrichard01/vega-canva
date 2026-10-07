import React from 'react';
import { Eye, EyeOff, Link2, Unlink } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../hooks/useStore';
import { IconToggle, Note, Row, SegmentedControl, Select, Switch } from './grammar';
import {
  parseRangeLabel,
  rangeLabel,
  resolveTableLink,
  unlinkedSpec,
  withResolvedData,
} from '../../engine/chart/chartFromTable';
import {
  isComboKind,
  isPlot,
  isSampleKind,
  legendNamesCategories,
  seriesColor,
  resolveChartOptions,
  type ChartSpec,
  type SeriesMark,
} from '../../engine/chart/chartTypes';
import type { TableSpec } from '../../engine/table/tableTypes';

/**
 * The chart panel's data link, series list and category-axis controls.
 *
 * Built from the panel grammar (rows, selects, switches) so a chart's panel
 * reads like every other object's.
 */

type Patch = (next: Partial<ChartSpec>) => void;

interface TableEntry {
  id: string;
  name: string;
}

const SEP = '\u0000';

function useBoardTables(): TableEntry[] {
  const keys = useStore(
    useShallow((s) => {
      const out: string[] = [];
      for (const [id, n] of Object.entries(s.objects)) {
        if ((n as { type?: string }).type !== 'table') continue;
        out.push(`${id}${SEP}${(n as { title?: string }).title ?? ''}`);
      }
      return out;
    })
  );
  return keys.map((k, i) => {
    const [id, title] = k.split(SEP);
    return { id, name: title?.trim() || `Table ${i + 1}` };
  });
}

function useTableSpec(id: string | undefined): TableSpec | null {
  return useStore((s) => {
    const n = id ? s.objects[id] : undefined;
    return n && (n as { type?: string }).type === 'table' ? (n as unknown as { table: TableSpec }).table : null;
  });
}

/**
 * Where the numbers come from: typed in, or a table on the board.
 *
 * Linking reads the chosen table's whole grid; the range can then be narrowed.
 * While linked the chart follows every edit to the table, on every client, and
 * Unlink keeps the values as they are at that moment.
 */
export const TableSource: React.FC<{ spec: ChartSpec; replace: (next: ChartSpec) => void }> = ({ spec, replace }) => {
  const tables = useBoardTables();
  const link = spec.link;
  const table = useTableSpec(link?.tableId);
  const [rangeDraft, setRangeDraft] = React.useState<string | null>(null);

  if (isPlot(spec.kind)) return null;

  if (!link) {
    if (tables.length === 0) return null;
    return (
      <Row label="Source">
        <Select
          label="Data source"
          value="typed"
          options={[
            { value: 'typed', label: 'Typed in', icon: <Unlink size={14} /> },
            ...tables.map((t) => ({ value: t.id, label: t.name, icon: <Link2 size={14} />, group: 'Tables on this board' })),
          ]}
          onChange={(id) => {
            if (id === 'typed') return;
            const t = useStore.getState().objects[id] as unknown as { table?: TableSpec } | undefined;
            if (!t?.table) return;
            const next = {
              tableId: id,
              r0: 0,
              c0: 0,
              r1: Math.max(0, t.table.cells.length - 1),
              c1: Math.max(0, t.table.columns.length - 1),
            };
            replace({ ...withResolvedData(spec, resolveTableLink(t.table, next)), link: next });
          }}
        />
      </Row>
    );
  }

  const name = tables.find((t) => t.id === link.tableId)?.name ?? 'Table';
  const label = rangeLabel(link);
  const shown = rangeDraft ?? label;
  const parsed = rangeDraft === null ? null : parseRangeLabel(rangeDraft);
  const invalid = rangeDraft !== null && !parsed;

  const commitRange = () => {
    if (rangeDraft === null) return;
    if (parsed) {
      const next = { ...link, ...parsed };
      replace({ ...(table ? withResolvedData(spec, resolveTableLink(table, next)) : spec), link: next });
    }
    setRangeDraft(null);
  };

  if (!table) {
    return (
      <>
        <Note>The linked table has been deleted. The chart keeps the values it last read.</Note>
        <button type="button" className="chartp-linkbtn" onClick={() => replace(unlinkedSpec(spec, null))}>
          <Unlink size={14} aria-hidden="true" />
          <span>Keep these values</span>
        </button>
      </>
    );
  }

  return (
    <>
      <Row label="Source">
        <div className="chartp-link">
          <Link2 size={14} aria-hidden="true" />
          <span className="chartp-link__name">{name}</span>
          <button
            type="button"
            className="chartp-link__unlink"
            onClick={() => replace(unlinkedSpec(spec, table))}
            data-tooltip="Stop following the table and keep its current values"
          >
            Unlink
          </button>
        </div>
      </Row>
      <Row label="Range" htmlFor="chartp-range">
        <input
          id="chartp-range"
          className="chartp-range"
          value={shown}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          onChange={(e) => setRangeDraft(e.target.value)}
          onBlur={commitRange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRange();
            else if (e.key === 'Escape') setRangeDraft(null);
          }}
        />
      </Row>
      <Row label="Series">
        <SegmentedControl
          ariaLabel="Where the series are in the range"
          fill
          value={link.seriesIn ?? 'columns'}
          segments={[
            { value: 'columns', label: 'Columns' },
            { value: 'rows', label: 'Rows' },
          ]}
          onChange={(v) => {
            const next = { ...link, ...(v === 'rows' ? { seriesIn: 'rows' as const } : {}) };
            if (v !== 'rows') delete (next as { seriesIn?: string }).seriesIn;
            replace({ ...withResolvedData({ ...spec, series: [] }, resolveTableLink(table, next)), link: next });
          }}
        />
      </Row>
      {invalid && <Note>Write the range as two corners, like A1:D9.</Note>}
      {!invalid && <Note>Follows every edit to {name}, {label}. Values are set in the table.</Note>}
    </>
  );
};

const MARK_OPTIONS: Array<{ value: SeriesMark; label: string }> = [
  { value: 'bar', label: 'Bars' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
];

/**
 * One row per series: whether it is drawn, and on combo-capable kinds, how and
 * against which axis. The legend toggles the same flag on the chart itself.
 */
export const SeriesRows: React.FC<{ spec: ChartSpec; patch: Patch }> = ({ spec, patch }) => {
  if (isPlot(spec.kind) || isSampleKind(spec.kind) || legendNamesCategories(spec.kind) || spec.series.length === 0) return null;
  const combo = isComboKind(spec.kind);
  const palette = resolveChartOptions(spec).palette;
  const set = (i: number, change: Partial<ChartSpec['series'][number]>) =>
    patch({
      series: spec.series.map((s, j) => {
        if (j !== i) return s;
        const next = { ...s, ...change };
        for (const k of Object.keys(change) as Array<keyof typeof change>) {
          if (change[k] === undefined) delete next[k];
        }
        return next;
      }),
    });

  return (
    <div className="chartp-series" role="list" aria-label="Series">
      {spec.series.map((s, i) => {
        const name = s.name || `Series ${i + 1}`;
        return (
          <div key={i} className="chartp-series__row" role="listitem" data-hidden={s.hidden || undefined}>
            <IconToggle
              label={s.hidden ? `Show ${name}` : `Hide ${name}`}
              pressed={!s.hidden}
              onClick={() => set(i, { hidden: s.hidden ? undefined : true })}
            >
              {s.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </IconToggle>
            <span className="chartp-series__swatch" style={{ background: seriesColor(s, i, palette) }} aria-hidden="true" />
            <span className="chartp-series__name">{name}</span>
            {combo && (
              <>
                <Select
                  label={`How ${name} is drawn`}
                  value={s.mark ?? (spec.kind as SeriesMark)}
                  options={MARK_OPTIONS}
                  onChange={(v) => set(i, { mark: v === spec.kind ? undefined : v })}
                />
                <SegmentedControl
                  ariaLabel={`Axis for ${name}`}
                  value={s.axis ?? 'left'}
                  segments={[
                    { value: 'left', label: 'L', hint: 'Left axis' },
                    { value: 'right', label: 'R', hint: 'Right axis' },
                  ]}
                  onChange={(v) => set(i, { axis: v === 'right' ? 'right' : undefined })}
                />
              </>
            )}
          </div>
        );
      })}
      {combo && spec.series.length > 1 && (
        <Note>Mix bars, lines and areas, and give a series of different units its own axis on the right.</Note>
      )}
    </div>
  );
};

const ANGLE_OPTIONS = [
  { value: 'auto', label: 'Auto', detail: 'Turn only when names collide' },
  { value: '0', label: 'Level' },
  { value: '45', label: 'Slanted' },
  { value: '90', label: 'Vertical' },
];

const EVERY_OPTIONS = [
  { value: 'auto', label: 'Auto', detail: 'Thin only when names collide' },
  { value: '1', label: 'Every name' },
  { value: '2', label: 'Every 2nd' },
  { value: '3', label: 'Every 3rd' },
  { value: '5', label: 'Every 5th' },
  { value: '10', label: 'Every 10th' },
];

/** How the category names sit along the axis, and the order they run in. */
export const CategoryAxisFields: React.FC<{ spec: ChartSpec; patch: Patch }> = ({ spec, patch }) => (
  <>
    <Row label="Names">
      <Select
        label="Category name angle"
        value={spec.labelAngle === undefined ? 'auto' : String(spec.labelAngle)}
        options={ANGLE_OPTIONS}
        onChange={(v) => patch({ labelAngle: v === 'auto' ? undefined : (Number(v) as 0 | 45 | 90) })}
      />
    </Row>
    <Row label="Show">
      <Select
        label="Which category names are written"
        value={spec.labelEvery === undefined ? 'auto' : String(spec.labelEvery)}
        options={EVERY_OPTIONS}
        onChange={(v) => patch({ labelEvery: v === 'auto' ? undefined : Number(v) })}
      />
    </Row>
    <Row label="Reverse">
      <Switch
        checked={Boolean(spec.reverseCategories)}
        onChange={(on) => patch({ reverseCategories: on ? true : undefined })}
        label="Last to first"
      />
    </Row>
  </>
);

/** One size for every piece of chart text but the title. */
export const TextSizeRow: React.FC<{ spec: ChartSpec; patch: Patch }> = ({ spec, patch }) => (
  <Row label="Text">
    <SegmentedControl
      ariaLabel="Chart text size"
      fill
      value={spec.textSize ?? 'm'}
      segments={[
        { value: 's', label: 'S', hint: 'Small' },
        { value: 'm', label: 'M', hint: 'Medium' },
        { value: 'l', label: 'L', hint: 'Large' },
      ]}
      onChange={(v) => patch({ textSize: v === 'm' ? undefined : (v as 's' | 'l') })}
    />
  </Row>
);

