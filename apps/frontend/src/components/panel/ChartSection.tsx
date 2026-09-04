import React from 'react';
import { ClipboardPaste, Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { NumberStepper } from '../ui/NumberStepper';
import { Slider } from '../ui/Slider';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { ChartKindIcon } from '../workspace/chartIcons';
import { Row, ToggleButton } from './panelPrimitives';
import { setChartKind, updateChart } from '../../engine/chart/chartApply';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  withChartData,
} from '../../engine/chart/chartCsv';
import { CHART_HINTS, CHART_LABELS, chartPickerGroups } from '../../engine/chart/chartKinds';
import { parseExpression, EXPRESSION_FUNCTIONS } from '../../engine/chart/expression';
import {
  CHART_PALETTE,
  CHART_SORTS,
  CHART_SORT_LABELS,
  isPlot,
  isPolar,
  isRadial,
  seriesColor,
  type ChartKind,
  type ChartSpec,
} from '../../engine/chart/chartTypes';
import type { ChartNode } from '../../engine/model/schema';

/**
 * Editing a chart after it exists.
 *
 * ## The data grid is the feature
 *
 * A chart tool without a way to type the numbers is a picture of a chart. This
 * section is built around the grid for that reason: it is first, it is always
 * open, and every styling control sits below it rather than competing with it.
 *
 * ## Why edits are committed on blur, not on keystroke
 *
 * Every cell writes through `mutations.ts` into the CRDT, which is synced and
 * undoable. Committing per keystroke would put one undo entry per character
 * and one network frame per character, and typing `1200` would broadcast four
 * states — three of which (`1`, `12`, `120`) are numbers somebody else briefly
 * sees on their board. The local value is held in component state while the
 * field has focus and committed when it loses it, which is the same division
 * `liveTransformStore` makes for a drag: during the gesture the document is
 * deliberately stale.
 *
 * ## Paste is the primary path
 *
 * See `chartCsv.ts`. Nobody types thirty numbers; they copy a range. The paste
 * button reads the clipboard, detects tabs versus commas, and replaces the
 * data while keeping the kind, title, palette and axis bounds — because those
 * are decisions the author made and the clipboard knows nothing about.
 */

interface Props {
  node: ChartNode;
}
/**
 * A titled block of controls.
 *
 * Not `SubGroup`, which pairs its title with a switch — that is the right
 * shape for a feature you turn on (a shadow, a stroke) and the wrong one for
 * a heading. Every group here is always on; the things that can be absent
 * (a reference line, a donut hole) are absent by *kind* or by their own
 * control, not by a switch beside the word "Data".
 */
const Group: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="chart-group">
    <div className="chart-group__label">{label}</div>
    <div className="chart-group__body">{children}</div>
  </div>
);


export const ChartSection: React.FC<Props> = ({ node }) => {
  const spec = node.chart;
  const radial = isRadial(spec.kind);
  const polar = isPolar(spec.kind);

  const patch = React.useCallback(
    (next: Partial<ChartSpec>) => updateChart(node.id, { ...spec, ...next }),
    [node.id, spec]
  );

  return (
    <div className="chart-section">
      <ChartTypeRow kind={spec.kind} onPick={(k) => setChartKind(node.id, spec, k)} />
      {/*
        A plot has no table: its x axis is a domain and its points are sampled,
        so a categories-and-series grid would be a control editing data the kind
        does not read. Offering it would be the dead capability rule inverted --
        a live control wired to nothing.
      */}
      {isPlot(spec.kind) ? (
        <FormulaEditor spec={spec} patch={patch} />
      ) : (
        <DataGrid node={node} spec={spec} patch={patch} />
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
        <div className="chart-toggles">
          <ToggleButton
            label="Legend"
            active={spec.showLegend ?? true}
            onClick={() => patch({ showLegend: !(spec.showLegend ?? true) })}
          >
            Legend
          </ToggleButton>
          <ToggleButton
            label="Values"
            active={spec.showValues ?? false}
            onClick={() => patch({ showValues: !(spec.showValues ?? false) })}
          >
            Values
          </ToggleButton>
          {!radial && !polar && (
            <ToggleButton
            label="Grid"
              active={spec.showGrid ?? true}
              onClick={() => patch({ showGrid: !(spec.showGrid ?? true) })}
            >
              Grid
            </ToggleButton>
          )}
        </div>
      </Group>

      {/*
        Every control below is offered only where it reaches the renderer.
        A donut hole on a bar chart, or an axis minimum on a pie, would be the
        dead capability this project keeps deleting -- see invariant 6.
      */}
      {isPlot(spec.kind) && <DomainGroup spec={spec} patch={patch} />}
      {!radial && !polar && !isPlot(spec.kind) && <AxisGroup spec={spec} patch={patch} />}

      <Group label="Order">
        {/*
          A view on the data, never an edit to it -- the rows keep the order
          they were typed in, so turning this off gives back exactly what was
          there and the next paste is not fighting a sort.
        */}
        <div className="chart-toggles">
          {CHART_SORTS.map((mode) => (
            <ToggleButton
              key={mode}
              label={CHART_SORT_LABELS[mode]}
              active={(spec.sort ?? 'none') === mode}
              onClick={() => patch({ sort: mode === 'none' ? undefined : mode })}
            >
              {CHART_SORT_LABELS[mode]}
            </ToggleButton>
          ))}
        </div>
      </Group>

      <Group label="Numbers">
        <Row label="Prefix">
          <input
            className="panel-input"
            value={spec.valuePrefix ?? ''}
            placeholder="e.g. $"
            onChange={(e) => patch({ valuePrefix: e.target.value || undefined })}
          />
        </Row>
        <Row label="Suffix">
          <input
            className="panel-input"
            value={spec.valueSuffix ?? ''}
            placeholder="e.g. %"
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
      </Group>

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
          <Row label="Buckets">
            {/*
              Visible and editable rather than derived by a rule, because the
              bucket count is the one setting that changes what a histogram
              *says*: the same samples at 5 and at 40 tell different stories,
              and both are legitimate.
            */}
            <NumberStepper
              value={spec.buckets ?? 10}
              min={2}
              max={60}
              onChange={(v) => patch({ buckets: v })}
            />
          </Row>
        </Group>
      )}

      <ReferenceGroup spec={spec} patch={patch} />
      {!isPlot(spec.kind) && <SeriesColors spec={spec} patch={patch} />}
    </div>
  );
};

/**
 * The formula editor.
 *
 * ## Errors are shown, never thrown, and never clear the curve
 *
 * Somebody typing `sin(` is not wrong, they are halfway through. So the field
 * keeps its text, the message appears underneath, and the last curve that
 * *did* compile stays on the board. Clearing the plot on every keystroke that
 * does not yet parse makes the chart flash empty through the whole of typing.
 *
 * The message names the thing that is wrong -- an unknown function, a missing
 * bracket -- because `parseExpression` knows the grammar. That is most of the
 * argument for having written a parser instead of reaching for `eval`, which
 * could only ever have reported a `SyntaxError` about JavaScript.
 */
const FormulaEditor: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const variable = spec.kind === 'parametric' ? 't' : spec.kind === 'polarPlot' ? 'a' : 'x';
  const curves = spec.functions ?? [];
  // A parametric curve is an ordered pair, so the two rows are named rather
  // than numbered -- "Series 2" would not tell anybody it is the y half.
  const rowLabel = (i: number) =>
    spec.kind === 'parametric' ? (i === 0 ? `x(${variable})` : `y(${variable})`) : `f${i + 1}(${variable})`;

  const set = (i: number, next: Partial<(typeof curves)[number]>) =>
    patch({ functions: curves.map((c, j) => (i === j ? { ...c, ...next } : c)) });

  return (
    <Group label={spec.kind === 'polarPlot' ? 'Polar formulae' : 'Formulae'}>
      {curves.map((curve, i) => {
        const result = parseExpression(curve.source, variable);
        return (
          <div className="chart-formula" key={i}>
            <div className="chart-formula__row">
              <span className="chart-formula__name">{rowLabel(i)}</span>
              <input
                className="panel-input chart-formula__input"
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
                className="chart-data__icon"
                title="Remove"
                aria-label={`Remove ${rowLabel(i)}`}
                onClick={() => patch({ functions: curves.filter((_, j) => j !== i) })}
              >
                <Trash2 size={11} />
              </button>
            </div>
            {!result.ok && <div className="chart-formula__error">{result.error.message}</div>}
          </div>
        );
      })}

      <div className="chart-data__actions">
        <button
          type="button"
          className="chart-data__action"
          onClick={() => patch({ functions: [...curves, { source: variable }] })}
        >
          <Plus size={12} /> Formula
        </button>
      </div>

      {/*
        The vocabulary, listed rather than documented elsewhere. It is a closed
        set, so anything absent from it is a parse error -- and a user with no
        way to see the set has to discover that by trial.
      */}
      <details className="chart-formula__help">
        <summary>What you can write</summary>
        <p>
          <code>{variable}</code>, numbers, <code>+ - * / % ^</code>, brackets,{' '}
          <code>|x|</code>, and <code>pi e tau phi</code>. Implicit products work:{' '}
          <code>2{variable}</code>, <code>3sin({variable})</code>.
        </p>
        <p className="chart-formula__fns">{EXPRESSION_FUNCTIONS.join('  ')}</p>
      </details>
    </Group>
  );
};

/** A plot's domain: the range of the variable it is sampled across. */
const DomainGroup: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const variable = spec.kind === 'parametric' ? 't' : spec.kind === 'polarPlot' ? 'a' : 'x';
  return (
    <Group label={`Domain (${variable})`}>
      <Row label="From">
        <NumberStepper value={spec.xMin ?? -10} onChange={(v) => patch({ xMin: v })} />
      </Row>
      <Row label="To">
        <NumberStepper value={spec.xMax ?? 10} onChange={(v) => patch({ xMax: v })} />
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
      <div className="chart-toggles">
        {/*
          Not a preference for parametric and polar: a circle on unequal axes is
          an ellipse, which is a different curve rather than a styled one.
        */}
        <ToggleButton
          label="Keep both axes at the same scale"
          active={spec.equalAxes ?? (spec.kind !== 'function')}
          onClick={() => patch({ equalAxes: !(spec.equalAxes ?? (spec.kind !== 'function')) })}
        >
          Equal axes
        </ToggleButton>
      </div>
    </Group>
  );
};

/** The kind picker, as a compact grid of the same glyphs the dock uses. */
const ChartTypeRow: React.FC<{ kind: ChartKind; onPick: (k: ChartKind) => void }> = ({
  kind,
  onPick,
}) => (
  <Group label="Type">
    <div className="chart-type-grid">
      {chartPickerGroups().flatMap((g) =>
        g.kinds.map((k) => (
          <button
            key={k}
            type="button"
            className="chart-type-cell"
            data-active={k === kind || undefined}
            title={`${CHART_LABELS[k]} — ${CHART_HINTS[k]}`}
            aria-label={CHART_LABELS[k]}
            onClick={() => onPick(k)}
          >
            <ChartKindIcon kind={k} size={18} />
          </button>
        ))
      )}
    </div>
  </Group>
);

/**
 * The editable table.
 *
 * Rendered as a real grid of inputs rather than a spreadsheet component: the
 * data a chart on a whiteboard carries is a dozen rows, and a virtualised grid
 * would be machinery for a case that does not arise here.
 */
const DataGrid: React.FC<{
  node: ChartNode;
  spec: ChartSpec;
  patch: (next: Partial<ChartSpec>) => void;
}> = ({ node, spec, patch }) => {
  const [notice, setNotice] = React.useState<string | null>(null);

  const setCategory = (i: number, name: string) => {
    const categories = [...spec.categories];
    categories[i] = name;
    patch({ categories });
  };

  const setValue = (si: number, ci: number, raw: string) => {
    const series = spec.series.map((s, i) => {
      if (i !== si) return s;
      const values = [...s.values];
      // An emptied cell is a hole, not a zero. That is the distinction the
      // whole model rests on, and the panel must not be the place it is lost.
      const trimmed = raw.trim();
      values[ci] = trimmed === '' ? null : Number.isFinite(Number(trimmed)) ? Number(trimmed) : null;
      return { ...s, values };
    });
    patch({ series });
  };

  const setSeriesName = (si: number, name: string) => {
    patch({ series: spec.series.map((s, i) => (i === si ? { ...s, name } : s)) });
  };

  const addRow = () =>
    patch({
      categories: [...spec.categories, `Item ${spec.categories.length + 1}`],
      series: spec.series.map((s) => ({ ...s, values: [...s.values, null] })),
    });

  const removeRow = (i: number) =>
    patch({
      categories: spec.categories.filter((_, x) => x !== i),
      series: spec.series.map((s) => ({ ...s, values: s.values.filter((_, x) => x !== i) })),
    });

  const addSeries = () =>
    patch({
      series: [
        ...spec.series,
        {
          name: `Series ${spec.series.length + 1}`,
          values: spec.categories.map(() => null),
        },
      ],
    });

  const removeSeries = (si: number) => patch({ series: spec.series.filter((_, i) => i !== si) });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chartToCsv(spec));
      setNotice('Copied as CSV');
    } catch {
      // A copy that fails silently is a failure that surfaces somewhere else
      // entirely, as the wrong thing in somebody's document.
      setNotice('Clipboard unavailable');
    }
    window.setTimeout(() => setNotice(null), 2000);
  };

  /**
   * The file paths, beside the clipboard ones.
   *
   * Both exist because they answer different questions. The clipboard is for
   * "I have this range in a sheet right now"; a file is for "somebody sent me
   * a CSV" and for "I need this data in a sheet later". Offering only the
   * clipboard makes the second case go through a text editor.
   *
   * A `.csv` download rather than the export dialog's formats: those all
   * produce a *picture* of the chart, and this is the numbers. Putting it in
   * the same menu would make "Export CSV" look like a sixth image format.
   */
  const download = () => downloadCsv(spec, csvFilename(spec.title));

  const openFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const data = parseChartData(text);
      if (data.categories.length === 0) {
        setNotice(`${file.name} had no table in it`);
      } else {
        updateChart(node.id, withChartData(spec, data));
        setNotice(`Read ${data.categories.length} rows from ${file.name}`);
      }
      window.setTimeout(() => setNotice(null), 3000);
    };
    input.click();
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const data = parseChartData(text);
      if (data.categories.length === 0) {
        setNotice('Nothing table-shaped on the clipboard');
      } else {
        updateChart(node.id, withChartData(spec, data));
        setNotice(`Read ${data.categories.length} rows`);
      }
    } catch {
      setNotice('Clipboard unavailable');
    }
    window.setTimeout(() => setNotice(null), 2500);
  };

  return (
    <Group label="Data">
      <div className="chart-data">
        <div
          className="chart-data__grid"
          style={{ gridTemplateColumns: `1fr repeat(${spec.series.length}, minmax(48px, 1fr)) 22px` }}
        >
          <div className="chart-data__corner" />
          {spec.series.map((s, si) => (
            <input
              key={`h${si}`}
              className="chart-data__head"
              value={s.name}
              onChange={(e) => setSeriesName(si, e.target.value)}
              aria-label={`Series ${si + 1} name`}
            />
          ))}
          <button
            type="button"
            className="chart-data__icon"
            onClick={addSeries}
            title="Add series"
            aria-label="Add series"
          >
            <Plus size={11} />
          </button>

          {spec.categories.map((category, ci) => (
            <React.Fragment key={`r${ci}`}>
              <input
                className="chart-data__cell chart-data__cell--label"
                value={category}
                onChange={(e) => setCategory(ci, e.target.value)}
                aria-label={`Category ${ci + 1}`}
              />
              {spec.series.map((s, si) => (
                <input
                  key={`c${si}-${ci}`}
                  className="chart-data__cell"
                  inputMode="decimal"
                  value={s.values[ci] === null || s.values[ci] === undefined ? '' : String(s.values[ci])}
                  onChange={(e) => setValue(si, ci, e.target.value)}
                  aria-label={`${s.name} at ${category}`}
                />
              ))}
              <button
                type="button"
                className="chart-data__icon"
                onClick={() => removeRow(ci)}
                title="Remove row"
                aria-label={`Remove ${category}`}
              >
                <Trash2 size={11} />
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="chart-data__actions">
          <button type="button" className="chart-data__action" onClick={addRow}>
            <Plus size={12} /> Row
          </button>
          <button type="button" className="chart-data__action" onClick={paste}>
            <ClipboardPaste size={12} /> Paste
          </button>
          <button type="button" className="chart-data__action" onClick={copy}>
            <Copy size={12} /> Copy
          </button>
          <button type="button" className="chart-data__action" onClick={openFile}>
            <Upload size={12} /> Import CSV
          </button>
          <button type="button" className="chart-data__action" onClick={download}>
            <Download size={12} /> Export CSV
          </button>
          {spec.series.length > 1 && (
            <button
              type="button"
              className="chart-data__action"
              onClick={() => removeSeries(spec.series.length - 1)}
            >
              <Trash2 size={12} /> Series
            </button>
          )}
        </div>

        {/* Said in the panel rather than as a toast: the action happened here,
            and a message four inches away is a message about something else. */}
        {notice && <div className="chart-data__notice">{notice}</div>}
      </div>
    </Group>
  );
};

const AxisGroup: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => (
  <Group label="Value axis">
    <Row label="Min">
      <NumberStepper value={spec.yMin ?? 0} onChange={(v) => patch({ yMin: v })} />
    </Row>
    <Row label="Max">
      <NumberStepper value={spec.yMax ?? 0} onChange={(v) => patch({ yMax: v })} />
    </Row>
    <div className="chart-toggles">
      <ToggleButton
            label="Start at zero"
        active={spec.includeZero ?? true}
        onClick={() => patch({ includeZero: !(spec.includeZero ?? true) })}
      >
        Start at zero
      </ToggleButton>
      {(spec.yMin !== undefined || spec.yMax !== undefined) && (
        <ToggleButton
          label="Reset the axis to automatic bounds"
          active={false}
          onClick={() => patch({ yMin: undefined, yMax: undefined })}
        >
          Auto
        </ToggleButton>
      )}
    </div>
  </Group>
);

/**
 * The reference rule.
 *
 * On the chart rather than drawn as a line object on top of it, because only
 * the chart can keep it at a *value*: a hand-drawn rule at y=250 is at 250
 * pixels and stops meaning anything the moment the box is resized or the data
 * changes.
 */
const ReferenceGroup: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const ref = spec.reference;
  return (
    <Group label="Reference line">
      {!ref ? (
        <button
          type="button"
          className="chart-data__action"
          onClick={() => patch({ reference: { value: 0, label: 'Target' } })}
        >
          <Plus size={12} /> Add a target
        </button>
      ) : (
        <>
          <Row label="Value">
            <NumberStepper
              value={ref.value}
              onChange={(v) => patch({ reference: { ...ref, value: v } })}
            />
          </Row>
          <Row label="Label">
            <input
              className="panel-input"
              value={ref.label ?? ''}
              onChange={(e) => patch({ reference: { ...ref, label: e.target.value || undefined } })}
            />
          </Row>
          <Row label="Colour">
            <div className="chart-swatch-row">
              <ColorPickerPopover
                color={ref.color ?? '#EF4444'}
                onChange={(color) => patch({ reference: { ...ref, color } })}
              />
              <button
                type="button"
                className="chart-data__action"
                onClick={() => patch({ reference: undefined })}
              >
                <Trash2 size={12} /> Remove
              </button>
            </div>
          </Row>
        </>
      )}
    </Group>
  );
};

/**
 * Per-series colour.
 *
 * A pie and a funnel colour by *category*, so the swatches follow whichever
 * the chart is actually keyed on — offering series colours on a pie would be
 * one swatch controlling every slice.
 */
const SeriesColors: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => {
  const byCategory = isRadial(spec.kind) || spec.kind === 'funnel';
  if (byCategory) {
    return (
      <Group label="Palette">
        <div className="chart-swatches">
          {CHART_PALETTE.map((c) => (
            <span key={c} className="chart-swatches__chip" style={{ background: c }} title={c} />
          ))}
        </div>
        <div className="chart-hint">
          Slices take the palette in order. Recolour one from the canvas rail.
        </div>
      </Group>
    );
  }

  return (
    <Group label="Series">
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
    </Group>
  );
};
