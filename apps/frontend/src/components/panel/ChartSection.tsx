import React from 'react';
import {
  ClipboardPaste,
  Copy,
  Download,
  Grid3x3,
  Hash,
  Plus,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import { NumberStepper } from '../ui/NumberStepper';
import { Slider } from '../ui/Slider';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { Disclosure, Field, FieldPair, ToggleRow, TypeHeader } from './chartPanelParts';
import { setChartKind, updateChart } from '../../engine/chart/chartApply';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  withChartData,
} from '../../engine/chart/chartCsv';
import { PLOT_PRESETS, specFromPreset } from '../../engine/chart/plotPresets';
import { logDomainOf } from '../../engine/chart/scales';
import { EXPRESSION_FUNCTIONS, parseExpression } from '../../engine/chart/expression';
import {
  analysisSummary,
  axisSummary,
  dataSummary,
  domainSummary,
  labelSummary,
  numberSummary,
  referenceSummary,
  seriesSummary,
  sortSummary,
} from '../../engine/chart/chartSummary';
import {
  CHART_PALETTE,
  CHART_SORTS,
  CHART_SORT_LABELS,
  isPlot,
  isPolar,
  isRadial,
  seriesColor,
  type ChartSpec,
} from '../../engine/chart/chartTypes';
import type { ChartNode } from '../../engine/model/schema';

/**
 * Editing a chart after it exists.
 *
 * ## The shape of this panel, and why it changed
 *
 * It was nine always-open blocks, roughly two screens tall, with the type
 * picker as a grid of nineteen 18px glyphs at the top. Every fault in that
 * follows from one assumption — that a properties panel is a list of every
 * control — and the fix is the arrangement every serious tool converged on:
 *
 * 1. **What the object is, first and large.** The current kind with its name
 *    and its one-line purpose, and the catalogue behind a popover with room to
 *    be read. The common case at this control is *confirming* the kind, not
 *    changing it, and a 19-cell grid of tiny glyphs serves neither well.
 * 2. **The thing you came for, open.** For a table chart that is the data
 *    grid; for a plot it is the formulae. Nothing else starts open.
 * 3. **Everything else collapsed, with its state on the header.** A closed
 *    section that hides whether anything inside it is set is worse than a long
 *    panel — so each header carries a live summary: `$ · 2dp`, `0–300`,
 *    `Title, legend, values`. See `chartSummary.ts`, which derives them so
 *    they cannot go stale.
 *
 * ## Two rules the controls follow
 *
 * **Nothing is offered where it does not reach the renderer.** A donut hole on
 * a bar chart, an axis minimum on a pie, roots on a parametric curve — each is
 * absent rather than present and inert. That is invariant 6 read as a rule
 * about layout, and it is what keeps the panel short without hiding anything.
 *
 * **Independent switches are a toggle row; a choice between options is a
 * segmented control.** They look different because they mean different things,
 * and lighting two segments of a segmented control would say something it
 * cannot mean.
 */

interface Props {
  node: ChartNode;
}

export const ChartSection: React.FC<Props> = ({ node }) => {
  const spec = node.chart;
  const radial = isRadial(spec.kind);
  const polar = isPolar(spec.kind);
  const plot = isPlot(spec.kind);

  const patch = React.useCallback(
    (next: Partial<ChartSpec>) => updateChart(node.id, { ...spec, ...next }),
    [node.id, spec]
  );

  return (
    <div className="cp">
      <TypeHeader kind={spec.kind} onPick={(k) => setChartKind(node.id, spec, k)} />

      {plot ? (
        <>
          <Disclosure label="Formulae" summary={dataSummary(spec)} defaultOpen>
            <FormulaEditor spec={spec} patch={patch} />
          </Disclosure>
          <Disclosure label="Start from" summary={`${PLOT_PRESETS.length} curves`}>
            <PlotGallery onPick={(next) => updateChart(node.id, next)} />
          </Disclosure>
          <Disclosure label="Domain" summary={domainSummary(spec)}>
            <DomainFields spec={spec} patch={patch} />
          </Disclosure>
          {spec.kind === 'function' && (
            <Disclosure label="Read off the curve" summary={analysisSummary(spec)}>
              <AnalysisFields spec={spec} patch={patch} />
            </Disclosure>
          )}
        </>
      ) : (
        <Disclosure
          label="Data"
          summary={dataSummary(spec)}
          defaultOpen
          actions={<DataActions node={node} spec={spec} />}
        >
          <DataGrid spec={spec} patch={patch} />
        </Disclosure>
      )}

      <Disclosure label="Labels" summary={labelSummary(spec)}>
        <LabelFields spec={spec} patch={patch} radial={radial} polar={polar} />
      </Disclosure>

      {!radial && !polar && !plot && (
        <Disclosure label="Value axis" summary={axisSummary(spec)}>
          <AxisFields spec={spec} patch={patch} />
        </Disclosure>
      )}

      <Disclosure label="Numbers" summary={numberSummary(spec)}>
        <NumberFields spec={spec} patch={patch} />
      </Disclosure>

      {!plot && (
        <Disclosure label="Order" summary={sortSummary(spec)}>
          <SegmentedControl
            ariaLabel="Category order"
            value={spec.sort ?? 'none'}
            onChange={(v) => patch({ sort: v === 'none' ? undefined : (v as ChartSpec['sort']) })}
            segments={CHART_SORTS.map((s) => ({ value: s, label: CHART_SORT_LABELS[s] }))}
          />
          <p className="cp-note">
            A view, never an edit — the rows keep the order they were entered in.
          </p>
        </Disclosure>
      )}

      {spec.kind === 'donut' && (
        <Disclosure label="Donut" summary={`${Math.round((spec.innerRadius ?? 0.55) * 100)}% hole`}>
          <Field label="Hole">
            <Slider
              label="Hole"
              labelHidden
              value={Math.round((spec.innerRadius ?? 0.55) * 100)}
              min={15}
              max={85}
              onChange={(v) => patch({ innerRadius: v / 100 })}
            />
          </Field>
        </Disclosure>
      )}

      {spec.kind === 'histogram' && (
        <Disclosure label="Distribution" summary={`${spec.buckets ?? 10} buckets`}>
          <Field label="Buckets" hint="The same samples at 5 and at 40 tell different stories">
            <NumberStepper
              value={spec.buckets ?? 10}
              min={2}
              max={60}
              onChange={(v) => patch({ buckets: v })}
            />
          </Field>
        </Disclosure>
      )}

      <Disclosure label="Reference line" summary={referenceSummary(spec)}>
        <ReferenceFields spec={spec} patch={patch} />
      </Disclosure>

      {!plot && (
        <Disclosure label="Series" summary={seriesSummary(spec)}>
          <SeriesFields spec={spec} patch={patch} />
        </Disclosure>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * The data operations, on the section header rather than under the grid.
 *
 * They act on the whole table, so they belong to the section and not to its
 * contents — and putting them on the header keeps them reachable while the
 * grid is collapsed, which is exactly when "give me this as a CSV" is asked.
 */
const DataActions: React.FC<{ node: ChartNode; spec: ChartSpec }> = ({ node, spec }) => {
  const [notice, setNotice] = React.useState<string | null>(null);
  const say = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2400);
  };

  const paste = async () => {
    try {
      const data = parseChartData(await navigator.clipboard.readText());
      if (data.categories.length === 0) say('Nothing table-shaped on the clipboard');
      else {
        updateChart(node.id, withChartData(spec, data));
        say(`Read ${data.categories.length} rows`);
      }
    } catch {
      // A clipboard action that fails silently is a failure that surfaces
      // somewhere else entirely, as the wrong thing in somebody's document.
      say('Clipboard unavailable');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chartToCsv(spec));
      say('Copied as CSV');
    } catch {
      say('Clipboard unavailable');
    }
  };

  const openFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = parseChartData(await file.text());
      if (data.categories.length === 0) say(`${file.name} had no table in it`);
      else {
        updateChart(node.id, withChartData(spec, data));
        say(`Read ${data.categories.length} rows`);
      }
    };
    input.click();
  };

  return (
    <>
      {notice && <span className="cp-notice">{notice}</span>}
      <ToggleRow
        options={[
          { id: 'paste', icon: <ClipboardPaste size={12} />, label: 'Paste a table', on: false },
          { id: 'copy', icon: <Copy size={12} />, label: 'Copy as CSV', on: false },
          { id: 'import', icon: <Upload size={12} />, label: 'Import a CSV file', on: false },
          { id: 'export', icon: <Download size={12} />, label: 'Export a CSV file', on: false },
        ]}
        onToggle={(id) => {
          if (id === 'paste') void paste();
          else if (id === 'copy') void copy();
          else if (id === 'import') openFile();
          else downloadCsv(spec, csvFilename(spec.title));
        }}
      />
    </>
  );
};

/**
 * The editable table.
 *
 * A real grid of inputs rather than a spreadsheet component: the data a chart
 * on a whiteboard carries is a dozen rows, and virtualising would be machinery
 * for a case that does not arise here.
 *
 * An emptied cell becomes `null`, not `0`. That is the distinction the whole
 * model rests on — a missing reading against a measured zero — and the panel
 * must not be the place it is lost.
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
    <div className="cp-grid-wrap">
      <div
        className="cp-grid"
        style={{ gridTemplateColumns: `1fr repeat(${spec.series.length}, minmax(46px, 1fr)) 20px` }}
      >
        <span />
        {spec.series.map((s, si) => (
          <input
            key={`h${si}`}
            className="cp-grid__head"
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
          className="cp-grid__icon"
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
              className="cp-grid__cell cp-grid__cell--label"
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
                className="cp-grid__cell"
                inputMode="decimal"
                value={s.values[ci] == null ? '' : String(s.values[ci])}
                onChange={(e) => setValue(si, ci, e.target.value)}
                aria-label={`${s.name} at ${category}`}
              />
            ))}
            <button
              type="button"
              className="cp-grid__icon"
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
        className="cp-add"
        onClick={() =>
          patch({
            categories: [...spec.categories, `Item ${spec.categories.length + 1}`],
            series: spec.series.map((s) => ({ ...s, values: [...s.values, null] })),
          })
        }
      >
        <Plus size={12} /> Add a row
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

const LabelFields: React.FC<{
  spec: ChartSpec;
  patch: (n: Partial<ChartSpec>) => void;
  radial: boolean;
  polar: boolean;
}> = ({ spec, patch, radial, polar }) => (
  <>
    <Field label="Title">
      <input
        className="panel-input"
        value={spec.title ?? ''}
        placeholder="None"
        onChange={(e) => patch({ title: e.target.value || undefined })}
      />
    </Field>
    <Field label="Show">
      <ToggleRow
        options={[
          { id: 'legend', icon: <Tag size={12} />, label: 'Legend', on: spec.showLegend ?? true },
          {
            id: 'values',
            icon: <Hash size={12} />,
            label: 'Value labels',
            on: spec.showValues ?? false,
          },
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
    </Field>
  </>
);

const AxisFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => (
  <>
    <FieldPair label="Range" hint="Both are optional; an empty one is chosen automatically">
      <NumberStepper value={spec.yMin ?? 0} onChange={(v) => patch({ yMin: v })} />
      <NumberStepper value={spec.yMax ?? 0} onChange={(v) => patch({ yMax: v })} />
    </FieldPair>
    <ScaleField spec={spec} patch={patch} />
    <Field label="Baseline" hint="A bar's length means nothing if it is not measured from zero">
      <SegmentedControl
        ariaLabel="Where the axis starts"
        value={(spec.includeZero ?? true) ? 'zero' : 'fit'}
        onChange={(v) => patch({ includeZero: v === 'zero' })}
        segments={[
          { value: 'zero', label: 'From zero' },
          { value: 'fit', label: 'Fit data' },
        ]}
      />
    </Field>
    {(spec.yMin !== undefined || spec.yMax !== undefined) && (
      <button
        type="button"
        className="cp-add cp-add--quiet"
        onClick={() => patch({ yMin: undefined, yMax: undefined })}
      >
        Back to automatic
      </button>
    )}
  </>
);

/**
 * Linear or logarithmic, and the option is withdrawn when the data cannot take
 * it.
 *
 * A log axis is undefined at and below zero. Offering it anyway and clamping
 * would put a point where the data says nothing, so `logDomainOf` is asked
 * first and the control explains its own absence rather than appearing and
 * misbehaving. That is the same reading as the rest of this panel: a control
 * that cannot reach the renderer is not shown.
 */
const ScaleField: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const values = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const canLog = logDomainOf(values).ok;

  if (!canLog && spec.yScale !== 'log') {
    return (
      <p className="cp-note">
        A log scale needs every value above zero; this data has one that is not.
      </p>
    );
  }

  return (
    <Field label="Scale" hint="Log suits data spanning orders of magnitude">
      <SegmentedControl
        ariaLabel="Value axis scale"
        value={spec.yScale ?? 'linear'}
        onChange={(v) => patch({ yScale: v === 'log' ? 'log' : undefined })}
        segments={[
          { value: 'linear', label: 'Linear' },
          { value: 'log', label: 'Log' },
        ]}
      />
    </Field>
  );
};

const NumberFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => (
  <>
    <FieldPair label="Prefix / suffix">
      <input
        className="panel-input"
        value={spec.valuePrefix ?? ''}
        placeholder="$"
        aria-label="Value prefix"
        onChange={(e) => patch({ valuePrefix: e.target.value || undefined })}
      />
      <input
        className="panel-input"
        value={spec.valueSuffix ?? ''}
        placeholder="%"
        aria-label="Value suffix"
        onChange={(e) => patch({ valueSuffix: e.target.value || undefined })}
      />
    </FieldPair>
    <Field label="Decimals">
      <NumberStepper
        value={spec.decimals ?? 0}
        min={0}
        max={6}
        onChange={(v) => patch({ decimals: v })}
      />
    </Field>
  </>
);

const ReferenceFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const ref = spec.reference;
  if (!ref) {
    return (
      <>
        <button
          type="button"
          className="cp-add"
          onClick={() => patch({ reference: { value: 0, label: 'Target' } })}
        >
          <Plus size={12} /> Add a target line
        </button>
        <p className="cp-note">
          Kept at a <em>value</em>, so it survives a resize and a change of data — which a line
          drawn on top cannot.
        </p>
      </>
    );
  }
  return (
    <>
      <Field label="Value">
        <NumberStepper
          value={ref.value}
          onChange={(v) => patch({ reference: { ...ref, value: v } })}
        />
      </Field>
      <Field label="Label">
        <input
          className="panel-input"
          value={ref.label ?? ''}
          onChange={(e) => patch({ reference: { ...ref, label: e.target.value || undefined } })}
        />
      </Field>
      <Field label="Colour">
        <div className="cp-inline">
          <ColorPickerPopover
            color={ref.color ?? '#EF4444'}
            onChange={(color) => patch({ reference: { ...ref, color } })}
          />
          <button
            type="button"
            className="cp-add cp-add--quiet"
            onClick={() => patch({ reference: undefined })}
          >
            Remove
          </button>
        </div>
      </Field>
    </>
  );
};

/**
 * Per-series colour.
 *
 * A pie and a funnel colour by *category*, so the swatches follow whichever the
 * chart is actually keyed on — offering series colours on a pie would be one
 * swatch controlling every slice.
 */
const SeriesFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  if (isRadial(spec.kind) || spec.kind === 'funnel') {
    return (
      <>
        <div className="cp-swatches">
          {CHART_PALETTE.map((c) => (
            <span key={c} className="cp-swatches__chip" style={{ background: c }} title={c} />
          ))}
        </div>
        <p className="cp-note">Slices take the palette in order.</p>
      </>
    );
  }

  return (
    <>
      {spec.series.map((s, i) => (
        <Field key={i} label={s.name || `Series ${i + 1}`}>
          <ColorPickerPopover
            color={seriesColor(s, i)}
            onChange={(color) =>
              patch({ series: spec.series.map((x, j) => (i === j ? { ...x, color } : x)) })
            }
          />
        </Field>
      ))}
      {spec.series.length > 1 && (
        <button
          type="button"
          className="cp-add cp-add--quiet"
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
 *
 * The message names what is wrong because `parseExpression` knows the grammar,
 * which is most of the argument for having written a parser instead of reaching
 * for `eval`.
 */
const FormulaEditor: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const variable = spec.kind === 'parametric' ? 't' : spec.kind === 'polarPlot' ? 'a' : 'x';
  const curves = spec.functions ?? [];
  // A parametric curve is an ordered pair, so its two rows are named rather
  // than numbered — "f2" would not tell anybody it is the y half.
  const rowLabel = (i: number) =>
    spec.kind === 'parametric'
      ? i === 0
        ? `x(${variable})`
        : `y(${variable})`
      : `f${i + 1}(${variable})`;

  const set = (i: number, next: Partial<(typeof curves)[number]>) =>
    patch({ functions: curves.map((c, j) => (i === j ? { ...c, ...next } : c)) });

  return (
    <>
      {curves.map((curve, i) => {
        const result = parseExpression(curve.source, variable);
        return (
          <div className="cp-formula" key={i}>
            <div className="cp-formula__row">
              <span className="cp-formula__name">{rowLabel(i)}</span>
              <input
                className="panel-input cp-formula__input"
                value={curve.source}
                spellCheck={false}
                data-invalid={!result.ok || undefined}
                onChange={(e) => set(i, { source: e.target.value })}
                aria-label={rowLabel(i)}
              />
              <ColorPickerPopover
                color={curve.color ?? seriesColor(undefined, i)}
                onChange={(color) => set(i, { color })}
              />
              <button
                type="button"
                className="cp-grid__icon"
                data-tooltip="Remove"
                aria-label={`Remove ${rowLabel(i)}`}
                onClick={() => patch({ functions: curves.filter((_, j) => j !== i) })}
              >
                <Trash2 size={11} />
              </button>
            </div>
            {!result.ok && <div className="cp-formula__error">{result.error.message}</div>}
          </div>
        );
      })}

      <button
        type="button"
        className="cp-add"
        onClick={() => patch({ functions: [...curves, { source: variable }] })}
      >
        <Plus size={12} /> Add a formula
      </button>

      {/*
        The vocabulary, listed rather than documented elsewhere. It is a closed
        set, so anything absent from it is a parse error — and a user with no
        way to see the set has to discover that by trial.
      */}
      <details className="cp-help">
        <summary>What you can write</summary>
        <p>
          <code>{variable}</code>, numbers, <code>+ − × / % ^</code>, brackets, <code>|x|</code>,
          and <code>pi e tau phi</code>. Implicit products work: <code>2{variable}</code>,{' '}
          <code>3sin({variable})</code>.
        </p>
        <p className="cp-help__fns">{EXPRESSION_FUNCTIONS.join('  ')}</p>
      </details>
    </>
  );
};

const DomainFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const isFn = spec.kind === 'function';
  return (
    <>
      <FieldPair label="From / to">
        <NumberStepper value={spec.xMin ?? (isFn ? -10 : 0)} onChange={(v) => patch({ xMin: v })} />
        <NumberStepper
          value={spec.xMax ?? (isFn ? 10 : Math.PI * 2)}
          onChange={(v) => patch({ xMax: v })}
        />
      </FieldPair>
      <Field label="Samples" hint="Before adaptive subdivision">
        <NumberStepper
          value={spec.samples ?? 160}
          min={16}
          max={2000}
          step={20}
          onChange={(v) => patch({ samples: v })}
        />
      </Field>
      <Field label="Scale" hint="A circle on unequal axes is an ellipse — a different curve">
        <SegmentedControl
          ariaLabel="Axis scale"
          value={(spec.equalAxes ?? !isFn) ? 'equal' : 'free'}
          onChange={(v) => patch({ equalAxes: v === 'equal' })}
          segments={[
            { value: 'equal', label: 'Equal' },
            { value: 'free', label: 'Fill' },
          ]}
        />
      </Field>
      {/*
        The domains people actually want, rather than typing 6.283185. A plot's
        range is almost always a multiple of pi or a small symmetric window,
        and both are awkward to enter and easy to get subtly wrong.
      */}
      <div className="cp-quick">
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
    </>
  );
};

const AnalysisFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => (
  <>
    <Field label="Mark">
      <ToggleRow
        options={[
          {
            id: 'roots',
            icon: <span className="cp-mono">0</span>,
            label: 'Where the curve crosses zero',
            on: !!spec.showRoots,
          },
          {
            id: 'extrema',
            icon: <span className="cp-mono">∧</span>,
            label: 'Turning points',
            on: !!spec.showExtrema,
          },
          {
            id: 'area',
            icon: <span className="cp-mono">∫</span>,
            label: 'Area under the curve',
            on: !!spec.fillArea,
          },
          {
            id: 'derivative',
            icon: <span className="cp-mono">f′</span>,
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
    </Field>
    <Field label="Rectangles" hint="Riemann strips under the curve, and their sum">
      <div className="cp-inline">
        <SegmentedControl
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
      </div>
    </Field>
    {spec.riemann && (
      <Field label="Count">
        <NumberStepper
          value={spec.riemann.n}
          min={1}
          max={200}
          onChange={(n) => patch({ riemann: { ...spec.riemann!, n } })}
        />
      </Field>
    )}
    <p className="cp-note">
      Roots are refined against the function itself. Turning points sit at the nearest sample —
      raise the sample count for a sharper answer. Left and right sums bracket the true area from
      either side, and converge on it as the count rises.
    </p>
  </>
);

/**
 * The preset gallery.
 *
 * A formula field is the most powerful control here and the least
 * discoverable: it works perfectly and says nothing about what it can do. This
 * is the documentation, in the only form a graph can be documented in — and it
 * replaces the whole spec rather than merging, because a preset is an example
 * to start from and half of one merged into somebody's work is neither.
 */
const PlotGallery: React.FC<{ onPick: (spec: ChartSpec) => void }> = ({ onPick }) => (
  <div className="cp-gallery">
    {PLOT_PRESETS.map((preset) => (
      <button
        key={preset.id}
        type="button"
        className="cp-gallery__item"
        title={preset.note}
        onClick={() => onPick(specFromPreset(preset))}
      >
        <span className="cp-gallery__name">{preset.name}</span>
        <span className="cp-gallery__note">{preset.note}</span>
      </button>
    ))}
  </div>
);
