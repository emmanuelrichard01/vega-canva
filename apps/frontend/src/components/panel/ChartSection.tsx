import React from 'react';
import {
  ClipboardPaste,
  Copy,
  FileDown,
  FileUp,
  Grid3x3,
  Hash,
  Plus,
  Tag,
  Trash2,
  Table as TableIcon,
  Lock,
  Unlock,
  RotateCcw,
  Eye,
  EyeOff,
  ArrowLeftRight,
} from 'lucide-react';
import { NumberStepper } from '../ui/NumberStepper';
import { Slider } from '../ui/Slider';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { Row } from './panelPrimitives';
import {
  ActionRow,
  Group,
  OptionalNumber,
  Reveal,
  ToggleRow,
  TypeHeader,
  PaletteRibbonPicker,
  MathTokenBar,
} from './chartPanelParts';
import { setChartKind, updateChart } from '../../engine/chart/chartApply';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  withChartData,
} from '../../engine/chart/chartCsv';
import { PresetGallery } from './PresetGallery';
import { logDomainOf } from '../../engine/chart/scales';
import { EXPRESSION_FUNCTIONS, parseExpression } from '../../engine/chart/expression';
import type { RampId } from '../../engine/chart/colorRamps';
import { formatValue } from '../../engine/chart/chartLayout';
import { findRoots, findExtrema, integrate, type Sample } from '../../engine/chart/chartAnalysis';
import {
  chartCapabilities,
  CHART_PALETTE,
  CHART_SORTS,
  CHART_SORT_LABELS,
  isPlot,
  isPolar,
  isTwoVariable,
  isRadial,
  seriesColor,
  type ChartSpec,
} from '../../engine/chart/chartTypes';
import { useStore } from '../../hooks/useStore';
import type { ChartNode } from '../../engine/model/schema';

/**
 * Editing a chart after it exists.
 *
 * ## Flat, and why
 *
 * A previous version made every group a disclosure with a summary on its
 * header. That was wrong for two reasons which are worth keeping written down,
 * because the idea is attractive and comes back.
 *
 * It ignored where this component actually renders: **inside** the panel's
 * `Chart` accordion. Nine collapsibles inside a collapsible is a tree where
 * the rest of the inspector is a list, and it costs a click on every visit to
 * reach controls that were two rows away.
 *
 * And progressive disclosure only pays when the hidden thing is secondary
 * *and* long. A title field and two toggles are cheaper to show than to
 * summarise, so hiding them charges a click to reveal almost nothing. Two
 * things here do pass that test and stay behind a `Reveal`: the fourteen-entry
 * preset gallery and the function vocabulary.
 *
 * ## Rows come from the panel, not from here
 *
 * Every label/control pair is `Row`, so the chart's rows share the inspector's
 * 84px label column. The earlier version defined its own at 72px and sat
 * visibly out of step with the Transform and Fill rows directly above it —
 * `.prop-row`'s own comment records that 76px was already tried and truncated
 * the labels.
 *
 * ## The rule that keeps it short
 *
 * Nothing is offered where it does not reach the renderer: no donut hole on a
 * bar chart, no axis range on a pie, no roots on a parametric curve. That is
 * invariant 6 read as a rule about layout, and it is what makes a flat panel
 * shorter than a collapsed one — there is simply less in it.
 */

interface Props {
  node: ChartNode;
}
/**
 * One character per ordering, because four names do not fit four segments.
 *
 * The arrow says the direction and the bar beside it says what is being
 * ordered *by* — height for value, letters for the label. Each carries its
 * full wording as the segment's hint, so the short form is a compression of
 * the label rather than a replacement for it.
 */
const SORT_GLYPH: Record<string, string> = {
  none: '—',
  valueDesc: '↓',
  valueAsc: '↑',
  labelAsc: 'A→Z',
};


export const ChartSection: React.FC<Props> = ({ node }) => {
  const spec = node.chart;
  const radial = isRadial(spec.kind);
  const polar = isPolar(spec.kind);
  const plot = isPlot(spec.kind);
  const twoVar = isTwoVariable(spec.kind);
  /**
   * What this kind can actually honour.
   *
   * Every group below is gated on it rather than on a hand-written condition,
   * so the panel and the layout cannot drift -- which is exactly how a
   * reference line came to be offered on a pie that never drew one.
   */
  const can = chartCapabilities(spec.kind);

  const patch = React.useCallback(
    (next: Partial<ChartSpec>) => updateChart(node.id, { ...spec, ...next }),
    [node.id, spec]
  );

  return (
    <div className="chartp">
      <TypeHeader kind={spec.kind} onPick={(k) => setChartKind(node.id, spec, k)} />

      {plot ? (
        <>
          <Group label="Formulae">
            <FormulaEditor spec={spec} patch={patch} />
          </Group>
          <Group label={twoVar ? 'Plane' : 'Domain'}>
            {twoVar ? (
              <PlaneFields spec={spec} patch={patch} />
            ) : (
              <DomainFields spec={spec} patch={patch} />
            )}
          </Group>
          {spec.kind === 'function' && (
            <Group label="Read off the curve">
              <AnalysisFields spec={spec} patch={patch} />
            </Group>
          )}
        </>
      ) : (
        <Group label="Data" actions={<DataActions node={node} spec={spec} />}>
          <DataGrid spec={spec} patch={patch} />
        </Group>
      )}

      <Group label="Labels">
        <Row label="Title">
          <input
            className="panel-input"
            value={spec.title ?? ''}
            placeholder="None"
            onChange={(e) => patch({ title: e.target.value || undefined })}
          />
        </Row>
        {spec.title && (
          <Row label="Title size">
            <NumberStepper
              value={spec.titleSize ?? 16}
              min={9}
              max={48}
              onChange={(v) => patch({ titleSize: v === 16 ? undefined : v })}
            />
          </Row>
        )}
        <Row label="Subtitle">
          <input
            className="panel-input"
            value={spec.subtitle ?? ''}
            placeholder="None"
            onChange={(e) => patch({ subtitle: e.target.value || undefined })}
          />
        </Row>
        <Row label="Footnote">
          <input
            className="panel-input"
            value={spec.footnote ?? ''}
            placeholder="Source / context note"
            onChange={(e) => patch({ footnote: e.target.value || undefined })}
          />
        </Row>
        {!radial && !polar && !plot && (
          <>
            <Row label="X-axis title">
              <input
                className="panel-input"
                value={spec.xAxisLabel ?? ''}
                placeholder="e.g. Quarter"
                onChange={(e) => patch({ xAxisLabel: e.target.value || undefined })}
              />
            </Row>
            <Row label="Y-axis title">
              <input
                className="panel-input"
                value={spec.yAxisLabel ?? ''}
                placeholder="e.g. Revenue ($)"
                onChange={(e) => patch({ yAxisLabel: e.target.value || undefined })}
              />
            </Row>
          </>
        )}
        <Row label="Show">
          <ToggleRow
            options={[
              {
                id: 'legend',
                icon: <Tag size={12} />,
                label: 'Legend',
                on: spec.showLegend ?? true,
              },
              ...(can.valueLabels
                ? [
                    {
                      id: 'values',
                      icon: <Hash size={12} />,
                      label: 'Value labels',
                      on: spec.showValues ?? false,
                    },
                  ]
                : []),
              ...(radial || polar
                ? []
                : [
                    {
                      id: 'grid',
                      icon: <Grid3x3 size={12} />,
                      label: 'Grid lines',
                      on: spec.showGrid ?? true,
                    },
                  ]),
            ]}
            onToggle={(id) => {
              if (id === 'legend') patch({ showLegend: !(spec.showLegend ?? true) });
              else if (id === 'values') patch({ showValues: !(spec.showValues ?? false) });
              else patch({ showGrid: !(spec.showGrid ?? true) });
            }}
          />
        </Row>
        {(spec.showLegend ?? true) && (
          <Row label="Legend pos">
            <SegmentedControl
              fill
              ariaLabel="Legend position"
              value={spec.legendPosition ?? 'bottom'}
              onChange={(v) => patch({ legendPosition: v as any })}
              segments={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </Row>
        )}
        {spec.showValues && can.valueLabels && (
          <>
            <Row label="Value place">
              <SegmentedControl
                fill
                ariaLabel="Value label placement"
                value={spec.valuePlacement ?? 'auto'}
                onChange={(v) => patch({ valuePlacement: v as any })}
                segments={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'inside', label: 'In' },
                  { value: 'outside', label: 'Out' },
                  { value: 'center', label: 'Center' },
                ]}
              />
            </Row>
            <Row label="Value style">
              <SegmentedControl
                fill
                ariaLabel="Value label format"
                value={spec.valueFormat ?? 'value'}
                onChange={(v) => patch({ valueFormat: v as any })}
                segments={[
                  { value: 'value', label: 'Value' },
                  { value: 'percent', label: '%' },
                  { value: 'both', label: 'Both' },
                ]}
              />
            </Row>
          </>
        )}
        {spec.showValues && (spec.kind === 'line' || spec.kind === 'area') && (
          <Row label="Values on">
            <SegmentedControl
              fill
              ariaLabel="Value labels subset"
              value={spec.extremesOnly ? 'extremes' : 'all'}
              onChange={(v) => patch({ extremesOnly: v === 'extremes' ? true : undefined })}
              segments={[
                { value: 'all', label: 'All points' },
                { value: 'extremes', label: 'Extremes' },
              ]}
            />
          </Row>
        )}
      </Group>

      {/*
        `curved` was implemented in the layout and had no control at all --
        a feature nothing could reach, which is the dead-capability rule in its
        other direction. Offered only for the runs that are drawn through
        points, and never for `step`: a staircase asserts the value did *not*
        slide between readings, and rounding its corners states the opposite.
      */}
      {can.curved && (
        <Group label="Line">
          <Row label="Shape">
            <SegmentedControl
              fill
              ariaLabel="How the run is drawn"
              value={spec.curved ? 'curved' : 'straight'}
              onChange={(v) => patch({ curved: v === 'curved' ? true : undefined })}
              segments={[
                { value: 'straight', label: 'Straight', hint: 'Joins the points directly' },
                { value: 'curved', label: 'Curved', hint: 'Smooths through the points' },
              ]}
            />
          </Row>
        </Group>
      )}

      {spec.kind === 'step' && (
        <Group label="Step">
          <Row label="Alignment">
            <SegmentedControl
              fill
              ariaLabel="Step transition alignment"
              value={spec.stepMode ?? 'after'}
              onChange={(v) => patch({ stepMode: v as any })}
              segments={[
                { value: 'after', label: 'After', hint: 'Step after point' },
                { value: 'mid', label: 'Mid', hint: 'Step halfway' },
                { value: 'before', label: 'Before', hint: 'Step before point' },
              ]}
            />
          </Row>
        </Group>
      )}

      {(spec.kind === 'scatter' || spec.kind === 'bubble') && (
        <Group label="Analytics">
          <Row label="Trendline">
            <SegmentedControl
              fill
              ariaLabel="Linear regression trendline"
              value={spec.showTrendline ? 'on' : 'off'}
              onChange={(v) => patch({ showTrendline: v === 'on' ? true : undefined })}
              segments={[
                { value: 'off', label: 'None', hint: 'No trendline' },
                { value: 'on', label: 'OLS (R²)', hint: 'Ordinary Least Squares regression with R²' },
              ]}
            />
          </Row>
        </Group>
      )}

      {spec.kind === 'histogram' && (
        <Group label="Density">
          <Row label="KDE curve">
            <SegmentedControl
              fill
              ariaLabel="Gaussian Kernel Density Estimation"
              value={spec.showKde ? 'on' : 'off'}
              onChange={(v) => patch({ showKde: v === 'on' ? true : undefined })}
              segments={[
                { value: 'off', label: 'Bars only', hint: 'Histogram bars only' },
                { value: 'on', label: 'Gaussian KDE', hint: 'Overlaid smooth density curve' },
              ]}
            />
          </Row>
        </Group>
      )}

      {(spec.kind === 'slopeField' || spec.kind === 'vectorField') && (
        <Group label="Solution Streamlines">
          <Row label="Seeds">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {(spec.seedPoints?.length ?? 0)} solution {spec.seedPoints?.length === 1 ? 'curve' : 'curves'}
              </span>
              <button
                type="button"
                className="btn-text"
                onClick={() => patch({ seedPoints: undefined })}
                disabled={!spec.seedPoints?.length}
                style={{ fontSize: 11, padding: '2px 8px', opacity: spec.seedPoints?.length ? 1 : 0.5 }}
              >
                Clear seeds
              </button>
            </div>
          </Row>
          <p className="chartp-note" style={{ margin: '4px 0 0' }}>
            Alt+Click anywhere on the field to drop an initial-value solution curve.
          </p>
        </Group>
      )}

      <Group label="Palette & Style">
        <Row label="Palette">
          <PaletteRibbonPicker
            value={spec.paletteId ?? 'default'}
            onChange={(id) => patch({ paletteId: id })}
          />
        </Row>
        {(spec.kind === 'line' || spec.kind === 'area' || spec.kind === 'bar' || spec.kind === 'barHorizontal') && (
          <Row label="Fill style">
            <SegmentedControl
              fill
              ariaLabel="Fill style"
              value={spec.gradient ? 'gradient' : 'solid'}
              onChange={(v) => patch({ gradient: v === 'gradient' ? true : undefined })}
              segments={[
                { value: 'solid', label: 'Solid', hint: 'Flat solid color' },
                { value: 'gradient', label: 'Gradient', hint: 'Smooth linear agency gradient' },
              ]}
            />
          </Row>
        )}
        {(spec.kind === 'bar' || spec.kind === 'barHorizontal') && (
          <Row label="Corner radius">
            <Slider
              label="Corner radius"
              labelHidden
              value={spec.cornerRadius ?? 3}
              min={0}
              max={16}
              onChange={(v) => patch({ cornerRadius: v === 3 ? undefined : v })}
            />
          </Row>
        )}
        {(spec.kind === 'line' || spec.kind === 'area' || spec.kind === 'step') && (
          <>
            <Row label="Line width">
              <NumberStepper
                value={spec.lineWidth ?? 2.5}
                min={1}
                max={6}
                step={0.5}
                onChange={(v) => patch({ lineWidth: v === 2.5 ? undefined : v })}
              />
            </Row>
            <Row label="Markers">
              <SegmentedControl
                fill
                ariaLabel="Line data point markers"
                value={spec.markerShape ?? 'circle'}
                onChange={(v) => patch({ markerShape: v as any })}
                segments={[
                  { value: 'circle', label: '● Filled' },
                  { value: 'ring', label: '○ Ring' },
                  { value: 'none', label: '— None' },
                ]}
              />
            </Row>
          </>
        )}
        {(spec.kind === 'area' || spec.kind === 'stackedArea') && (
          <Row label="Area fill">
            <Slider
              label="Area fill opacity"
              labelHidden
              value={Math.round((spec.areaOpacity ?? 0.22) * 100)}
              min={10}
              max={90}
              onChange={(v) => patch({ areaOpacity: v / 100 })}
            />
          </Row>
        )}
      </Group>

      {can.valueAxis && (
        <Group label="Value axis">
          <AxisFields spec={spec} patch={patch} />
        </Group>
      )}

      {can.numberFormat && (
        <Group label="Numbers">
          <Row label="Presets" stack>
            <div className="chartp-presets-strip">
              <button
                type="button"
                className="chartp-preset-chip"
                onClick={() => patch({ valuePrefix: '$', compactNumbers: true, decimals: 0 })}
              >
                $ USD
              </button>
              <button
                type="button"
                className="chartp-preset-chip"
                onClick={() => patch({ valuePrefix: '€', compactNumbers: true, decimals: 0 })}
              >
                € EUR
              </button>
              <button
                type="button"
                className="chartp-preset-chip"
                onClick={() => patch({ valueSuffix: '%', decimals: 1, compactNumbers: false })}
              >
                % Pct
              </button>
              <button
                type="button"
                className="chartp-preset-chip"
                onClick={() => patch({ valuePrefix: '$', compactNumbers: true, decimals: 1 })}
              >
                $1.2M
              </button>
              <button
                type="button"
                className="chartp-preset-chip"
                onClick={() => patch({ decimals: 0, compactNumbers: false, valuePrefix: undefined, valueSuffix: undefined })}
              >
                Integer
              </button>
            </div>
          </Row>
          <Row label="Preview">
            <div className="chartp-preview-badge">
              <span>1,250,000 → </span>
              <strong>{formatValue(1250000, spec)}</strong>
            </div>
          </Row>
          <Row label="Prefix">
            <input
              className="panel-input"
              value={spec.valuePrefix ?? ''}
              placeholder="$"
              aria-label="Value prefix"
              onChange={(e) => patch({ valuePrefix: e.target.value || undefined })}
            />
          </Row>
          <Row label="Suffix">
            <input
              className="panel-input"
              value={spec.valueSuffix ?? ''}
              placeholder="%"
              aria-label="Value suffix"
              onChange={(e) => patch({ valueSuffix: e.target.value || undefined })}
            />
          </Row>
          <Row label="Decimals">
            <NumberStepper
              value={spec.decimals ?? 0}
              min={0}
              max={6}
              onChange={(v) => patch({ decimals: v })}
            />
          </Row>
          <Row label="Large numbers">
            <SegmentedControl
              fill
              ariaLabel="How large numbers are written"
              value={(spec.compactNumbers ?? true) ? 'compact' : 'full'}
              onChange={(v) => patch({ compactNumbers: v === 'compact' ? undefined : false })}
              segments={[
                { value: 'compact', label: '12k', hint: 'Abbreviate thousands and millions' },
                { value: 'full', label: '12,000', hint: 'Write them out in full' },
              ]}
            />
          </Row>
        </Group>
      )}

      {can.sort && (
        <Group label="Order">
          <Row label="Order" stack>
            <SegmentedControl
              fill
              ariaLabel="Category order"
              value={spec.sort ?? 'none'}
              onChange={(v) =>
                patch({ sort: v === 'none' ? undefined : (v as ChartSpec['sort']) })
              }
              segments={CHART_SORTS.map((s) => ({
                value: s,
                label: SORT_GLYPH[s],
                hint: CHART_SORT_LABELS[s],
              }))}
            />
          </Row>
          {spec.series.length > 1 && (
            <Row label="Sort by">
              <SegmentedControl
                fill
                ariaLabel="Sort key"
                value={spec.sortKey ?? 'series'}
                onChange={(v) => patch({ sortKey: v as any })}
                segments={[
                  { value: 'series', label: 'Series 1' },
                  { value: 'total', label: 'Total Sum' },
                ]}
              />
            </Row>
          )}
          <Row label="Top items" hint="Consolidate tail categories into 'Other'">
            <NumberStepper
              value={spec.topN ?? spec.categories.length}
              min={3}
              max={Math.max(3, spec.categories.length)}
              onChange={(v) => patch({ topN: v >= spec.categories.length ? undefined : v })}
            />
          </Row>
        </Group>
      )}

      {spec.kind === 'donut' && (
        <Group label="Donut">
          <Row label="Hole">
            <Slider
              label="Hole"
              labelHidden
              value={Math.round((spec.innerRadius ?? 0.55) * 100)}
              min={15}
              max={85}
              onChange={(v) => patch({ innerRadius: v / 100 })}
            />
          </Row>
        </Group>
      )}

      {spec.kind === 'histogram' && (
        <Group label="Distribution">
          <Row label="Buckets" hint="The same samples at 5 and at 40 tell different stories">
            <NumberStepper
              value={spec.buckets ?? 10}
              min={2}
              max={60}
              onChange={(v) => patch({ buckets: v })}
            />
          </Row>
        </Group>
      )}

      {can.reference && (
        <Group label="Reference line">
          <ReferenceFields spec={spec} patch={patch} />
        </Group>
      )}

      {can.seriesColors && (
        <Group label="Series">
          <SeriesFields spec={spec} patch={patch} />
        </Group>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * The four table operations, on the group's heading.
 *
 * They act on the whole table rather than on a row, so they belong to the
 * group and not inside it. An `ActionRow` rather than a `ToggleRow`: these do
 * something and hold no state, and drawing them as switches that never light
 * was a control lying about its own kind.
 */
const DataActions: React.FC<{ node: ChartNode; spec: ChartSpec }> = ({ node, spec }) => {
  const [notice, setNotice] = React.useState<string | null>(null);
  const say = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2400);
  };

  const readInto = (text: string, source: string) => {
    const data = parseChartData(text);
    if (data.categories.length === 0) say(`No table in ${source}`);
    else {
      updateChart(node.id, withChartData(spec, data));
      say(`Read ${data.categories.length} rows`);
    }
  };

  const run = async (id: string) => {
    try {
      if (id === 'sheet') {
        useStore.getState().setChartDataModalNodeId(node.id);
        return;
      }
      if (id === 'transpose') {
        const oldCats = spec.categories;
        const oldSeries = spec.series;
        if (oldCats.length === 0 || oldSeries.length === 0) return;
        const newCats = oldSeries.map((s) => s.name);
        const newSeries = oldCats.map((cat, ci) => ({
          name: cat,
          values: oldSeries.map((s) => s.values[ci] ?? null),
        }));
        updateChart(node.id, {
          ...spec,
          categories: newCats,
          series: newSeries,
        });
        say('Transposed table');
        return;
      }
      if (id === 'paste') readInto(await navigator.clipboard.readText(), 'the clipboard');
      else if (id === 'copy') {
        await navigator.clipboard.writeText(chartToCsv(spec));
        say('Copied as CSV');
      } else if (id === 'export') downloadCsv(spec, csvFilename(spec.title));
      else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (file) readInto(await file.text(), file.name);
        };
        input.click();
      }
    } catch {
      // A clipboard action that fails silently is a failure that surfaces
      // somewhere else entirely, as the wrong thing in somebody's document.
      say('Clipboard unavailable');
    }
  };

  return (
    <>
      {/* The message sits under the grid, not on the heading: a heading that
          changes width when a toast appears makes the whole group jump. */}
      {notice && <span className="chartp-notice">{notice}</span>}
      <ActionRow
        actions={[
          { id: 'sheet', icon: <TableIcon size={12} />, label: 'Open spreadsheet editor' },
          { id: 'transpose', icon: <ArrowLeftRight size={12} />, label: 'Transpose rows & columns' },
          { id: 'paste', icon: <ClipboardPaste size={12} />, label: 'Paste a table' },
          { id: 'copy', icon: <Copy size={12} />, label: 'Copy as CSV' },
          { id: 'import', icon: <FileUp size={12} />, label: 'Import a CSV file' },
          { id: 'export', icon: <FileDown size={12} />, label: 'Export a CSV file' },
        ]}
        onRun={(id) => void run(id)}
      />
    </>
  );
};

/**
 * The editable table.
 *
 * A real grid of inputs rather than a spreadsheet component: the data a chart
 * on a whiteboard carries is a dozen rows, and virtualising would be machinery
 * for a case that does not arise.
 *
 * An emptied cell becomes `null`, not `0` — the distinction the whole model
 * rests on, and the panel must not be where it is lost.
 */
const DataGrid: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const setValue = (si: number, ci: number, raw: string) =>
    patch({
      series: spec.series.map((s, i) => {
        if (i !== si) return s;
        const values = [...s.values];
        const t = raw.trim();
        values[ci] = t === '' || !Number.isFinite(Number(t)) ? null : Number(t);
        return { ...s, values };
      }),
    });

  return (
    <div className="chartp-grid-wrap">
      <div
        className="chartp-grid"
        style={{ gridTemplateColumns: `1fr repeat(${spec.series.length}, minmax(42px, 1fr)) 22px` }}
      >
        <span className="chartp-grid__corner" />
        {spec.series.map((s, si) => (
          <input
            key={`h${si}`}
            className="chartp-grid__head"
            value={s.name}
            onChange={(e) =>
              patch({
                series: spec.series.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)),
              })
            }
            aria-label={`Series ${si + 1} name`}
          />
        ))}
        <button
          type="button"
          className="chartp-grid__icon"
          data-tooltip="Add a series"
          aria-label="Add a series"
          onClick={() =>
            patch({
              series: [
                ...spec.series,
                {
                  name: `Series ${spec.series.length + 1}`,
                  values: spec.categories.map(() => null),
                },
              ],
            })
          }
        >
          <Plus size={11} />
        </button>

        {spec.categories.map((category, ci) => (
          <React.Fragment key={`r${ci}`}>
            <input
              className="chartp-grid__cell chartp-grid__cell--label"
              value={category}
              onChange={(e) =>
                patch({
                  categories: spec.categories.map((c, i) => (i === ci ? e.target.value : c)),
                })
              }
              aria-label={`Category ${ci + 1}`}
            />
            {spec.series.map((s, si) => (
              <input
                key={`c${si}-${ci}`}
                className="chartp-grid__cell"
                inputMode="decimal"
                value={s.values[ci] == null ? '' : String(s.values[ci])}
                onChange={(e) => setValue(si, ci, e.target.value)}
                aria-label={`${s.name} at ${category}`}
              />
            ))}
            <button
              type="button"
              className="chartp-grid__icon"
              data-tooltip="Remove this row"
              aria-label={`Remove ${category}`}
              onClick={() =>
                patch({
                  categories: spec.categories.filter((_, i) => i !== ci),
                  series: spec.series.map((s) => ({
                    ...s,
                    values: s.values.filter((_, i) => i !== ci),
                  })),
                })
              }
            >
              <Trash2 size={11} />
            </button>
          </React.Fragment>
        ))}
      </div>

      <button
        type="button"
        className="chartp-add"
        onClick={() =>
          patch({
            categories: [...spec.categories, `Item ${spec.categories.length + 1}`],
            series: spec.series.map((s) => ({ ...s, values: [...s.values, null] })),
          })
        }
      >
        <Plus size={12} /> Add a row
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px 2px', fontSize: 11, color: 'var(--text-secondary)' }}>
        <span>{spec.categories.length} categories × {spec.series.length} series</span>
        <span>{spec.series.reduce((acc, s) => acc + s.values.filter((v) => v !== null).length, 0)} points</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Axis and numbers
// ---------------------------------------------------------------------------

const AxisFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const values = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const canLog = logDomainOf(values).ok;

  return (
    <>
      {/*
        `OptionalNumber`, not a stepper. These were steppers using 0 as the
        sentinel for "automatic", which made a minimum of *zero* unexpressible
        -- and pinning a bar chart's baseline to zero is the single most likely
        thing anybody wants from this field.
      */}
      <Row label="Minimum">
        <OptionalNumber
          label="Axis minimum"
          value={spec.yMin}
          onChange={(v) => patch({ yMin: v })}
        />
      </Row>
      <Row label="Maximum">
        <OptionalNumber
          label="Axis maximum"
          value={spec.yMax}
          onChange={(v) => patch({ yMax: v })}
        />
      </Row>
      <Row label="Baseline" hint="A bar's length means nothing measured from anywhere else">
        <SegmentedControl
          fill
          ariaLabel="Where the axis starts"
          value={(spec.includeZero ?? true) ? 'zero' : 'fit'}
          onChange={(v) => patch({ includeZero: v === 'zero' })}
          segments={[
            { value: 'zero', label: 'Zero' },
            { value: 'fit', label: 'Fit' },
          ]}
        />
      </Row>

      {/*
        A log axis is undefined at and below zero, so the control is withdrawn
        when the data cannot take it rather than offered and quietly clamping —
        which would put a point where the data says nothing.
      */}
      {canLog || spec.yScale === 'log' ? (
        <Row label="Scale" hint="Log suits data spanning orders of magnitude">
          <SegmentedControl
            fill
            ariaLabel="Value axis scale"
            value={spec.yScale ?? 'linear'}
            onChange={(v) => patch({ yScale: v === 'log' ? 'log' : undefined })}
            segments={[
              { value: 'linear', label: 'Linear' },
              { value: 'log', label: 'Log' },
            ]}
          />
        </Row>
      ) : (
        <p className="chartp-note">A log scale needs every value above zero.</p>
      )}

      {(spec.yMin !== undefined || spec.yMax !== undefined) && (
        <button
          type="button"
          className="chartp-add chartp-add--quiet"
          onClick={() => patch({ yMin: undefined, yMax: undefined })}
        >
          Clear both bounds
        </button>
      )}
    </>
  );
};

/**
 * Mean, median and extremes of everything drawn.
 *
 * Pooled across series, because a reference line is one rule across the whole
 * chart and an average of one series would be a number the picture does not
 * show. Holes are skipped rather than counted as zero -- an average that
 * treats a missing reading as nought is lower than the truth by exactly the
 * amount nobody measured.
 *
 * Returns null for a plot, which has no data table to average.
 */
function summarise(spec: ChartSpec): { mean: number; median: number; min: number; max: number } | null {
  const values = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const round = (n: number) => Math.round(n * 1000) / 1000;

  return {
    mean: round(values.reduce((a, b) => a + b, 0) / values.length),
    // The average of the middle two for an even count, which is the
    // definition -- taking the lower one is off by half a step on every
    // even-length series.
    median: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
  };
}

const ReferenceFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const ref = spec.reference;
  const band = spec.toleranceBand;
  const stats = summarise(spec);

  return (
    <>
      {ref ? (
        <>
          <Row label="Target">
            <NumberStepper
              value={ref.value}
              onChange={(v) => patch({ reference: { ...ref, value: v } })}
            />
          </Row>
          <Row label="Label">
            <input
              className="panel-input"
              value={ref.label ?? ''}
              placeholder="Target"
              onChange={(e) => patch({ reference: { ...ref, label: e.target.value || undefined } })}
            />
          </Row>
          <Row label="Colour">
            <ColorPickerPopover
              color={ref.color ?? '#EF4444'}
              onChange={(color) => patch({ reference: { ...ref, color } })}
            />
          </Row>
          <Row label="Style" hint="Dashed reads as a note on the data; solid reads as data">
            <SegmentedControl
              fill
              ariaLabel="Reference line style"
              value={ref.style ?? 'dashed'}
              onChange={(v) =>
                patch({ reference: { ...ref, style: v === 'solid' ? 'solid' : undefined } })
              }
              segments={[
                { value: 'dashed', label: 'Dashed' },
                { value: 'solid', label: 'Solid' },
              ]}
            />
          </Row>
          {stats && (
            <Row label="Set to" stack>
              <div className="chartp-quick">
                <button type="button" onClick={() => patch({ reference: { ...ref, value: stats.mean } })}>
                  Mean
                </button>
                <button type="button" onClick={() => patch({ reference: { ...ref, value: stats.median } })}>
                  Median
                </button>
                <button type="button" onClick={() => patch({ reference: { ...ref, value: stats.max } })}>
                  Max
                </button>
                <button type="button" onClick={() => patch({ reference: { ...ref, value: stats.min } })}>
                  Min
                </button>
              </div>
            </Row>
          )}
          <button
            type="button"
            className="chartp-add chartp-add--quiet"
            onClick={() => patch({ reference: undefined })}
          >
            <Trash2 size={12} /> Remove target line
          </button>
        </>
      ) : (
        <button
          type="button"
          className="chartp-add"
          onClick={() => patch({ reference: { value: stats?.mean ?? 0, label: 'Target' } })}
        >
          <Plus size={12} /> Add a target line
        </button>
      )}

      {band ? (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <Row label="Band min">
            <NumberStepper
              value={band.min}
              onChange={(v) => patch({ toleranceBand: { ...band, min: v } })}
            />
          </Row>
          <Row label="Band max">
            <NumberStepper
              value={band.max}
              onChange={(v) => patch({ toleranceBand: { ...band, max: v } })}
            />
          </Row>
          <Row label="Band label">
            <input
              className="panel-input"
              value={band.label ?? ''}
              placeholder="Tolerance"
              onChange={(e) => patch({ toleranceBand: { ...band, label: e.target.value || undefined } })}
            />
          </Row>
          <Row label="Band color">
            <ColorPickerPopover
              color={band.color ?? '#10B981'}
              onChange={(color) => patch({ toleranceBand: { ...band, color } })}
            />
          </Row>
          <button
            type="button"
            className="chartp-add chartp-add--quiet"
            onClick={() => patch({ toleranceBand: undefined })}
          >
            <Trash2 size={12} /> Remove tolerance corridor
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="chartp-add"
          style={{ marginTop: ref ? 6 : 0 }}
          onClick={() =>
            patch({
              toleranceBand: {
                min: (ref?.value ?? stats?.mean ?? 10) - 5,
                max: (ref?.value ?? stats?.mean ?? 10) + 5,
                label: 'Tolerance',
                color: '#10B981',
              },
            })
          }
        >
          <Plus size={12} /> Add a tolerance corridor
        </button>
      )}
    </>
  );
};

/**
 * Per-series colour.
 *
 * A pie and a funnel colour by *category*, so the swatches follow whichever the
 * chart is keyed on — offering series colours on a pie would be one swatch
 * controlling every slice.
 */
const SeriesFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  if (isRadial(spec.kind) || spec.kind === 'funnel') {
    return (
      <>
        <div className="chartp-swatches">
          {CHART_PALETTE.map((c) => (
            <span key={c} className="chartp-swatches__chip" style={{ background: c }} title={c} />
          ))}
        </div>
        <p className="chartp-note">Slices take the palette in order.</p>
      </>
    );
  }

  return (
    <>
      {spec.series.map((s, i) => (
        <Row key={i} label={s.name || `Series ${i + 1}`}>
          <ColorPickerPopover
            color={seriesColor(s, i)}
            onChange={(color) =>
              patch({ series: spec.series.map((x, j) => (i === j ? { ...x, color } : x)) })
            }
          />
        </Row>
      ))}
      {spec.series.length > 1 && (
        <button
          type="button"
          className="chartp-add chartp-add--quiet"
          onClick={() => patch({ series: spec.series.slice(0, -1) })}
        >
          <Trash2 size={12} /> Remove the last series
        </button>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Plots
// ---------------------------------------------------------------------------

/**
 * The formula editor.
 *
 * Errors are shown, never thrown, and never clear the curve. Somebody typing
 * `sin(` is not wrong, they are halfway through — so the field keeps its text,
 * the message appears underneath, and the last curve that *did* compile stays
 * on the board. Clearing the plot on every keystroke that does not yet parse
 * makes the chart flash empty through the whole of typing.
 */
const FormulaEditor: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const twoVar = isTwoVariable(spec.kind);
  const variable = twoVar
    ? 'x'
    : spec.kind === 'parametric'
      ? 't'
      : spec.kind === 'polarPlot'
        ? 'a'
        : 'x';
  // Two-variable expressions read both; the parser is told the set so an
  // unknown name is still an error rather than a silent NaN.
  const variables = twoVar ? ['x', 'y'] : [variable];
  const curves = spec.functions ?? [];
  const [activeCurveIdx, setActiveCurveIdx] = React.useState<number>(0);

  // Pairs are named rather than numbered: "f2" would not tell anybody it is
  // the y half of a parametric curve or the Q of a vector field.
  const rowLabel = (i: number) => {
    if (spec.kind === 'parametric') return i === 0 ? 'x(t)' : 'y(t)';
    if (spec.kind === 'vectorField') return i === 0 ? 'P(x,y)' : 'Q(x,y)';
    if (twoVar) return spec.kind === 'implicit' ? `F${i + 1}(x,y)` : 'f(x,y)';
    return `f${i + 1}(${variable})`;
  };

  const set = (i: number, next: Partial<(typeof curves)[number]>) =>
    patch({ functions: curves.map((c, j) => (i === j ? { ...c, ...next } : c)) });

  const onInsertToken = (tok: string) => {
    const target = Math.min(activeCurveIdx, Math.max(0, curves.length - 1));
    if (curves.length === 0) {
      patch({ functions: [{ source: tok }] });
      return;
    }
    const cur = curves[target].source.trim();
    const nextSrc = !cur ? tok : `${cur} + ${tok}`;
    set(target, { source: nextSrc });
  };

  return (
    <>
      <MathTokenBar variable={variable} onInsert={onInsertToken} />

      {curves.map((curve, i) => {
        const result = parseExpression(curve.source, variables);
        return (
          <div className="chartp-formula" key={i}>
            <div className="chartp-formula__row">
              <span className="chartp-formula__name">{rowLabel(i)}</span>
              <input
                className="panel-input chartp-formula__input"
                value={curve.source}
                spellCheck={false}
                data-invalid={!result.ok || undefined}
                onFocus={() => setActiveCurveIdx(i)}
                onChange={(e) => set(i, { source: e.target.value })}
                aria-label={rowLabel(i)}
              />
              <button
                type="button"
                className={`chartp-eye-btn ${curve.hidden ? 'muted' : ''}`}
                data-tooltip={curve.hidden ? 'Show curve' : 'Mute curve'}
                aria-label={curve.hidden ? 'Show curve' : 'Mute curve'}
                onClick={() => set(i, { hidden: !curve.hidden })}
              >
                {curve.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <ColorPickerPopover
                color={curve.color ?? seriesColor(undefined, i)}
                onChange={(color) => set(i, { color })}
              />
              <button
                type="button"
                className="chartp-grid__icon"
                data-tooltip="Remove"
                aria-label={`Remove ${rowLabel(i)}`}
                onClick={() => patch({ functions: curves.filter((_, j) => j !== i) })}
              >
                <Trash2 size={11} />
              </button>
            </div>
            {!result.ok && <div className="chartp-formula__error">{result.error.message}</div>}

            {/* Per-curve stroke width & dash style */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 34 }}>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Stroke:</span>
              <NumberStepper
                value={curve.width ?? 2}
                min={1}
                max={5}
                step={0.5}
                onChange={(w) => set(i, { width: w === 2 ? undefined : w })}
              />
              <SegmentedControl
                fill
                ariaLabel="Stroke pattern"
                value={curve.style ?? 'solid'}
                onChange={(st) => set(i, { style: st === 'solid' ? undefined : (st as any) })}
                segments={[
                  { value: 'solid', label: '—' },
                  { value: 'dashed', label: '--' },
                  { value: 'dotted', label: '··' },
                ]}
              />
            </div>
          </div>
        );
      })}

      <button
        type="button"
        className="chartp-add"
        onClick={() => patch({ functions: [...curves, { source: variable }] })}
      >
        <Plus size={12} /> Add a formula
      </button>

      <Reveal label="Start from an example">
        <PresetGallery
          kind={spec.kind}
          onPick={(next) => patch(next)}
          onAddCurve={(newCurves) => patch({ functions: [...curves, ...newCurves] })}
        />
      </Reveal>

      <Reveal label="What you can write">
        <p className="chartp-note">
          <code>{variables.join('</code>, <code>')}</code>, numbers, <code>+ − × / % ^</code>, brackets, <code>|x|</code>,
          and <code>pi e tau phi</code>. Implicit products work: <code>2{variable}</code>,{' '}
          <code>3sin({variable})</code>.
        </p>
        <p className="chartp-help__fns">{EXPRESSION_FUNCTIONS.join('  ')}</p>
      </Reveal>
    </>
  );
};

/**
 * The box a two-variable plot is drawn over, and how finely it is sampled.
 *
 * Four bounds rather than two, because both axes are *inputs* here: a contour
 * has no y to discover and an implicit curve's y is not a result. Every other
 * plot in this panel fits its value axis to what the function reached, which is
 * impossible and would be meaningless for these.
 */
const PlaneFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => (
  <>
    <Row label="x from">
      <NumberStepper value={spec.xMin ?? -5} onChange={(v) => patch({ xMin: v })} />
    </Row>
    <Row label="x to">
      <NumberStepper value={spec.xMax ?? 5} onChange={(v) => patch({ xMax: v })} />
    </Row>
    <Row label="y from">
      <NumberStepper value={spec.yPlotMin ?? -5} onChange={(v) => patch({ yPlotMin: v })} />
    </Row>
    <Row label="y to">
      <NumberStepper value={spec.yPlotMax ?? 5} onChange={(v) => patch({ yPlotMax: v })} />
    </Row>
    <Row
      label={spec.kind === 'implicit' || spec.kind === 'contour' ? 'Detail' : 'Density'}
      hint="Cost is quadratic in this, unlike a curve's sample count"
    >
      <NumberStepper
        value={spec.resolution ?? (spec.kind === 'contour' ? 100 : 80)}
        min={8}
        max={160}
        step={4}
        onChange={(v) => patch({ resolution: v })}
      />
    </Row>
    {spec.kind === 'contour' && (
      <Row label="Levels" hint="Spread across what the function actually reaches">
        <NumberStepper
          value={spec.levels ?? 8}
          min={2}
          max={40}
          onChange={(v) => patch({ levels: v })}
        />
      </Row>
    )}
    {spec.kind === 'heatmap' && (
      <Row label="Colormap" hint="Perceptually uniform color ramps">
        <SegmentedControl
          fill
          ariaLabel="Heatmap colormap"
          value={spec.ramp ?? 'viridis'}
          onChange={(v) => patch({ ramp: v as RampId })}
          segments={[
            { value: 'viridis', label: 'Viridis', hint: 'Perceptually uniform blue-green-yellow' },
            { value: 'magma', label: 'Magma', hint: 'Black through purple/red to near-white' },
            { value: 'diverging', label: 'Diverging', hint: 'Blue-white-red with neutral midpoint' },
            { value: 'mono', label: 'Mono', hint: 'Single blue hue gradient' },
          ]}
        />
      </Row>
    )}
    <Row label="Aspect" hint="Keep square geometric aspect ratio">
      <SegmentedControl
        fill
        ariaLabel="Isotropic aspect ratio"
        value={spec.isotropic ? '1:1' : 'free'}
        onChange={(v) => patch({ isotropic: v === '1:1' ? true : undefined })}
        segments={[
          { value: 'free', label: 'Free' },
          { value: '1:1', label: '1:1' },
        ]}
      />
    </Row>
    <p className="chartp-note">
      Both axes are the same plane, so a unit is kept the same length on each —
      otherwise an implicit circle would draw as an ellipse.
    </p>
    <Row label="Plane Lock" hint="Prevent accidental zoom and pan gestures">
      <button
        type="button"
        className={`chartp-lock-btn ${spec.lockPlane ? 'locked' : ''}`}
        onClick={() => patch({ lockPlane: !spec.lockPlane })}
      >
        {spec.lockPlane ? <Lock size={12} /> : <Unlock size={12} />}
        <span>{spec.lockPlane ? 'Locked' : 'Unlocked'}</span>
      </button>
    </Row>
    <Row label="Reset Plane">
      <button
        type="button"
        className="chartp-btn-secondary"
        onClick={() =>
          patch({
            xMin: -5,
            xMax: 5,
            yPlotMin: -5,
            yPlotMax: 5,
          })
        }
      >
        <RotateCcw size={12} />
        <span>Reset Plane Bounds</span>
      </button>
    </Row>
  </>
);

const DomainFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const isFn = spec.kind === 'function';
  return (
    <>
      <Row label="From">
        <OptionalNumber
          label="Domain start"
          placeholder={String(isFn ? -10 : 0)}
          value={spec.xMin}
          onChange={(v) => patch({ xMin: v })}
        />
      </Row>
      <Row label="To">
        <OptionalNumber
          label="Domain end"
          placeholder={isFn ? '10' : '2π'}
          value={spec.xMax}
          onChange={(v) => patch({ xMax: v })}
        />
      </Row>
      <Row label="Range" stack>
        <div className="chartp-quick">
          <button type="button" onClick={() => patch({ xMin: -Math.PI, xMax: Math.PI })}>
            ±π
          </button>
          <button type="button" onClick={() => patch({ xMin: 0, xMax: Math.PI * 2 })}>
            0…2π
          </button>
          <button type="button" onClick={() => patch({ xMin: -10, xMax: 10 })}>
            ±10
          </button>
          <button type="button" onClick={() => patch({ xMin: -1, xMax: 1 })}>
            ±1
          </button>
        </div>
      </Row>
      <Row label="Y-clip min" hint="Clamp singular spikes (e.g. tan or 1/x)">
        <OptionalNumber
          label="Y-clip minimum"
          value={spec.yClipMin}
          onChange={(v) => patch({ yClipMin: v })}
        />
      </Row>
      <Row label="Y-clip max" hint="Clamp singular spikes (e.g. tan or 1/x)">
        <OptionalNumber
          label="Y-clip maximum"
          value={spec.yClipMax}
          onChange={(v) => patch({ yClipMax: v })}
        />
      </Row>
      <Row label="Samples" hint="Before adaptive subdivision">
        <NumberStepper
          value={spec.samples ?? 160}
          min={16}
          max={2000}
          step={20}
          onChange={(v) => patch({ samples: v })}
        />
      </Row>
      <Row label="Aspect" hint="Equal unit scaling or square 1:1">
        <SegmentedControl
          fill
          ariaLabel="Axis scaling"
          value={spec.isotropic ? '1:1' : (spec.equalAxes ?? !isFn) ? 'equal' : 'free'}
          onChange={(v) =>
            patch({
              isotropic: v === '1:1' ? true : undefined,
              equalAxes: v === 'equal' || v === '1:1' ? true : false,
            })
          }
          segments={[
            { value: 'free', label: 'Free' },
            { value: 'equal', label: 'Equal' },
            { value: '1:1', label: '1:1' },
          ]}
        />
      </Row>
      <Row label="Plane Lock" hint="Prevent accidental zoom and pan gestures">
        <button
          type="button"
          className={`chartp-lock-btn ${spec.lockPlane ? 'locked' : ''}`}
          onClick={() => patch({ lockPlane: !spec.lockPlane })}
        >
          {spec.lockPlane ? <Lock size={12} /> : <Unlock size={12} />}
          <span>{spec.lockPlane ? 'Locked' : 'Unlocked'}</span>
        </button>
      </Row>
      <Row label="Reset Domain">
        <button
          type="button"
          className="chartp-btn-secondary"
          onClick={() =>
            patch({
              xMin: isFn ? -10 : 0,
              xMax: isFn ? 10 : Number((Math.PI * 2).toFixed(3)),
              yPlotMin: undefined,
              yPlotMax: undefined,
              yClipMin: undefined,
              yClipMax: undefined,
            })
          }
        >
          <RotateCcw size={12} />
          <span>Reset Domain Bounds</span>
        </button>
      </Row>
    </>
  );
};

const AnalysisFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const primaryCurve = spec.functions?.[0];
  const parsed = React.useMemo(() => {
    if (!primaryCurve?.source) return null;
    const res = parseExpression(primaryCurve.source, ['x']);
    return res.ok ? (x: number) => res.expression.evaluate(x) : null;
  }, [primaryCurve?.source]);

  const analysis = React.useMemo(() => {
    if (!parsed) return null;
    const xMin = spec.xMin ?? -10;
    const xMax = spec.xMax ?? 10;
    const n = Math.min(300, spec.samples ?? 160);
    const step = (xMax - xMin) / n;
    const samples: Sample[] = [];
    for (let i = 0; i <= n; i++) {
      const x = xMin + i * step;
      try {
        const y = parsed(x);
        samples.push({ x, y: Number.isFinite(y) ? y : null });
      } catch {
        samples.push({ x, y: null });
      }
    }
    const roots = spec.showRoots ? findRoots(samples, parsed) : [];
    const extrema = spec.showExtrema ? findExtrema(samples) : [];
    let integralVal: number | null = null;
    if (spec.integralBounds) {
      const a = Math.min(spec.integralBounds.a, spec.integralBounds.b);
      const b = Math.max(spec.integralBounds.a, spec.integralBounds.b);
      const sign = spec.integralBounds.a <= spec.integralBounds.b ? 1 : -1;
      const intSamples: Sample[] = [];
      const m = 120;
      const intStep = (b - a) / m;
      for (let i = 0; i <= m; i++) {
        const x = a + i * intStep;
        try {
          const y = parsed(x);
          intSamples.push({ x, y: Number.isFinite(y) ? y : null });
        } catch {
          intSamples.push({ x, y: null });
        }
      }
      const intRes = integrate(intSamples);
      integralVal = intRes.complete ? intRes.value * sign : null;
    }
    return { roots, extrema, integralVal };
  }, [parsed, spec.xMin, spec.xMax, spec.samples, spec.showRoots, spec.showExtrema, spec.integralBounds]);

  return (
    <>
      <Row label="Mark">
        <ToggleRow
          options={[
            {
              id: 'roots',
              icon: <span className="chartp-mono">0</span>,
              label: 'Where the curve crosses zero',
              on: !!spec.showRoots,
            },
            {
              id: 'extrema',
              icon: <span className="chartp-mono">∧</span>,
              label: 'Turning points',
              on: !!spec.showExtrema,
            },
            {
              id: 'area',
              icon: <span className="chartp-mono">∫</span>,
              label: 'Area under the curve',
              on: !!spec.fillArea,
            },
            {
              id: 'derivative',
              icon: <span className="chartp-mono">f′</span>,
              label: 'The derivative, alongside',
              on: !!spec.showDerivative,
            },
          ]}
          onToggle={(id) => {
            if (id === 'roots') patch({ showRoots: !spec.showRoots });
            else if (id === 'extrema') patch({ showExtrema: !spec.showExtrema });
            else if (id === 'area') patch({ fillArea: !spec.fillArea });
            else patch({ showDerivative: !spec.showDerivative });
          }}
        />
      </Row>

      <Row label="Definite ∫" hint="Integrate over [a, b]">
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <OptionalNumber
            label="Lower bound a"
            placeholder={String(spec.xMin ?? -10)}
            value={spec.integralBounds?.a}
            onChange={(v) =>
              patch({
                integralBounds: {
                  a: v ?? (spec.xMin ?? -10),
                  b: spec.integralBounds?.b ?? (spec.xMax ?? 10),
                },
              })
            }
          />
          <OptionalNumber
            label="Upper bound b"
            placeholder={String(spec.xMax ?? 10)}
            value={spec.integralBounds?.b}
            onChange={(v) =>
              patch({
                integralBounds: {
                  a: spec.integralBounds?.a ?? (spec.xMin ?? -10),
                  b: v ?? (spec.xMax ?? 10),
                },
              })
            }
          />
        </div>
      </Row>

      {analysis?.integralVal !== null && analysis?.integralVal !== undefined && (
        <div className="chartp-readout-card">
          <span className="chartp-readout-title">∫ Area [a, b]:</span>
          <strong style={{ fontSize: 11, fontFamily: 'monospace' }}>
            {analysis.integralVal.toFixed(4)}
          </strong>
        </div>
      )}
      {spec.integralBounds && (
        <button
          type="button"
          className="chartp-add chartp-add--quiet"
          style={{ marginTop: 4 }}
          onClick={() => patch({ integralBounds: undefined })}
        >
          <Trash2 size={12} /> Clear ∫ bounds
        </button>
      )}

      {analysis?.roots && analysis.roots.length > 0 && (
        <div className="chartp-readout-card">
          <span className="chartp-readout-title">Roots:</span>
          <div className="chartp-readout-list">
            {analysis.roots.slice(0, 6).map((r, i) => (
              <button
                key={i}
                type="button"
                className="chartp-pill-chip"
                data-tooltip="Click to copy root"
                onClick={() => navigator.clipboard.writeText(String(r))}
              >
                x = {Number(r.toFixed(3))}
              </button>
            ))}
          </div>
        </div>
      )}

      {analysis?.extrema && analysis.extrema.length > 0 && (
        <div className="chartp-readout-card">
          <span className="chartp-readout-title">Extrema:</span>
          <div className="chartp-readout-list">
            {analysis.extrema.slice(0, 6).map((e, i) => (
              <button
                key={i}
                type="button"
                className="chartp-pill-chip"
                data-tooltip={`Click to copy ${e.kind}`}
                onClick={() => navigator.clipboard.writeText(`(${e.x}, ${e.y})`)}
              >
                {e.kind === 'max' ? '▲' : '▼'} ({Number(e.x.toFixed(2))}, {Number(e.y.toFixed(2))})
              </button>
            ))}
          </div>
        </div>
      )}

      <Row label="Rectangles" hint="Riemann strips, and their sum">
        <SegmentedControl
          fill
          ariaLabel="Riemann rectangles"
          value={spec.riemann ? spec.riemann.mode : 'off'}
          onChange={(v) =>
            patch({
              riemann:
                v === 'off'
                  ? undefined
                  : { n: spec.riemann?.n ?? 12, mode: v as 'left' | 'right' | 'midpoint' },
            })
          }
          segments={[
            { value: 'off', label: 'Off' },
            { value: 'left', label: 'L', hint: 'Left corner meets the curve' },
            { value: 'midpoint', label: 'M', hint: 'Midpoint meets the curve' },
            { value: 'right', label: 'R', hint: 'Right corner meets the curve' },
          ]}
        />
      </Row>
      {spec.riemann && (
        <Row label="Count">
          <NumberStepper
            value={spec.riemann.n}
            min={1}
            max={200}
            onChange={(n) => patch({ riemann: { ...spec.riemann!, n } })}
          />
        </Row>
      )}
      <p className="chartp-note">
        Left and right sums bracket the true area from either side, and converge on it as the count
        rises.
      </p>
    </>
  );
};
