import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconToggle, Note, Row, SegmentedControl, Select, Switch } from './grammar';
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
import { ChartDataSource } from '../data/ChartDataSource';

/**
 * The chart panel's data link, series list and category-axis controls.
 *
 * Built from the panel grammar (rows, selects, switches) so a chart's panel
 * reads like every other object's.
 */

type Patch = (next: Partial<ChartSpec>) => void;

/**
 * Where the numbers come from: typed in, or a table on the board. The link
 * itself (source, range, name, mapping, filters, write-back) is the data
 * panel's, in `components/data`.
 */
export const TableSource: React.FC<{ chartId: string; spec: ChartSpec; replace: (next: ChartSpec) => void }> = (props) => (
  <ChartDataSource {...props} />
);

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

