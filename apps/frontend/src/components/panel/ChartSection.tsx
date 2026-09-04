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
} from './chartPanelParts';
import { setChartKind, updateChart } from '../../engine/chart/chartApply';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  withChartData,
} from '../../engine/chart/chartCsv';
import {
  presetGroups,
  specFromPreset,
  type PlotPreset,
} from '../../engine/chart/plotPresets';
import { logDomainOf } from '../../engine/chart/scales';
import { EXPRESSION_FUNCTIONS, parseExpression } from '../../engine/chart/expression';
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
        {/*
          Offered only once there is a title to size. A stepper controlling the
          type of an empty string is a live control with nothing to act on,
          which is the dead-UI rule applied to a field rather than a feature.
        */}
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

      {can.valueAxis && (
        <Group label="Value axis">
          <AxisFields spec={spec} patch={patch} />
        </Group>
      )}

      {can.numberFormat && (
        <Group label="Numbers">
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
        </Group>
      )}

      {can.sort && (
        <Group label="Order">
          {/*
            Short labels with the full wording on hover. Four segments sharing
            a 170px control cannot hold "As entered / Largest first / Smallest
            first / A to Z" -- they wrapped to two lines each and the control
            grew to three rows of broken words. The glyphs say the ordering and
            the hint says it in full, which is the division `Segment` was
            written for.
          */}
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
          { id: 'paste', icon: <ClipboardPaste size={12} />, label: 'Paste a table' },
          { id: 'copy', icon: <Copy size={12} />, label: 'Copy as CSV' },
          /*
            `FileUp`/`FileDown` rather than `Upload`/`Download`. The mapping was
            never wrong -- this app uses a down arrow for export everywhere, and
            the restore control in the export dialog uses an up arrow -- but at
            12px `Upload` and `Download` are the *same tray* with an arrow that
            differs only in direction, and four monochrome glyphs in a row gave
            the eye nothing else to go on. A page with an arrow is a different
            silhouette, not a mirrored one, which is the property that makes a
            pair of opposites legible at this size.
          */
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
          className="chartp-add"
          onClick={() => patch({ reference: { value: 0, label: 'Target' } })}
        >
          <Plus size={12} /> Add a target line
        </button>
        <p className="chartp-note">
          Kept at a <em>value</em>, so it survives a resize and a change of data — which a line
          drawn on top cannot.
        </p>
      </>
    );
  }
  return (
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
        <ColorPickerPopover
          color={ref.color ?? '#EF4444'}
          onChange={(color) => patch({ reference: { ...ref, color } })}
        />
      </Row>
      <button
        type="button"
        className="chartp-add chartp-add--quiet"
        onClick={() => patch({ reference: undefined })}
      >
        <Trash2 size={12} /> Remove the target
      </button>
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

  return (
    <>
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
                onChange={(e) => set(i, { source: e.target.value })}
                aria-label={rowLabel(i)}
              />
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
        {/*
          Grouped, with this kind's own examples first. A flat list of
          twenty-nine is the wall the type picker was already fixed for, and
          making somebody editing a vector field scroll past fourteen curves to
          reach four is that fault at a smaller scale.
        */}
        {presetGroups(spec.kind).map((group) => (
          <div className="chartp-presetGroup" key={group.kind}>
            <div className="chartp-presetGroup__label">{group.label}</div>
            <div className="chartp-gallery">
              {group.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="chartp-gallery__item"
                  title={preset.note}
                  onClick={() => updateChartFromPreset(preset)}
                >
                  <span className="chartp-gallery__name">{preset.name}</span>
                  <span className="chartp-gallery__note">{preset.note}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
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

  /**
   * A preset replaces the whole spec rather than merging into it: it is an
   * example to start from, and half of one merged into somebody's
   * half-finished work is neither. Undo puts back exactly what was there,
   * which is what makes trying one cheap.
   */
  function updateChartFromPreset(preset: PlotPreset) {
    patch(specFromPreset(preset));
  }
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
    <p className="chartp-note">
      Both axes are the same plane, so a unit is kept the same length on each —
      otherwise an implicit circle would draw as an ellipse.
    </p>
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
        {/*
          The domains people actually want. A plot's range is almost always a
          multiple of pi or a small symmetric window, and both are awkward to
          type and easy to get subtly wrong.
        */}
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
      <Row label="Samples" hint="Before adaptive subdivision">
        <NumberStepper
          value={spec.samples ?? 160}
          min={16}
          max={2000}
          step={20}
          onChange={(v) => patch({ samples: v })}
        />
      </Row>
      <Row label="Scale" hint="A circle on unequal axes is an ellipse — a different curve">
        <SegmentedControl
          fill
          ariaLabel="Axis scale"
          value={(spec.equalAxes ?? !isFn) ? 'equal' : 'free'}
          onChange={(v) => patch({ equalAxes: v === 'equal' })}
          segments={[
            { value: 'equal', label: 'Equal' },
            { value: 'free', label: 'Fill' },
          ]}
        />
      </Row>
    </>
  );
};

const AnalysisFields: React.FC<{ spec: ChartSpec; patch: (n: Partial<ChartSpec>) => void }> = ({
  spec,
  patch,
}) => (
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
