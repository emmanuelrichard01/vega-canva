import React from 'react';
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpNarrowWide,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  FunctionSquare,
  Grid3x3,
  Hash,
  List,
  Lock,
  Palette,
  PanelBottom,
  PanelRight,
  PanelTop,
  Plus,
  RotateCcw,
  Ruler,
  Shapes,
  Sheet,
  Sparkles,
  StickyNote,
  Tag,
  TrendingUp,
  Type,
  Unlock,
  Waves,
  X,
} from 'lucide-react';
import './chartPanel.css';
import { NumberStepper } from '../ui/NumberStepper';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { Row, StrokeStyleIcon } from './panelPrimitives';
import {
  AddButton,
  Dependent,
  Group,
  IconAction,
  ItemHead,
  Note,
  OptionalNumber,
  Pair,
  PaletteGrid,
  QuickChips,
  Readout,
  SubHead,
  TextField,
  ToggleChips,
  TypeHeader,
} from './chartPanelParts';
import {
  AreaGlyph,
  AspectEqual,
  AspectFree,
  BandGlyph,
  CurveSmooth,
  CurveStraight,
  DerivativeGlyph,
  ExtremaGlyph,
  MarkerSpecimen,
  PlacementSpecimen,
  RiemannSpecimen,
  RootsGlyph,
  SeedGlyph,
  SeriesKey,
  StepSpecimen,
  TargetLineGlyph,
} from './chartSpecimens';
import { setChartKind, updateChart } from '../../engine/chart/chartApply';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  withChartData,
} from '../../engine/chart/chartCsv';
import { ExampleButton } from './ExampleBrowser';
import { ExpressionReference } from './ExpressionReference';
import { logDomainOf } from '../../engine/chart/scales';
import { parseExpression } from '../../engine/chart/expression';
import { RAMP_IDS, RAMP_LABELS, rampSwatches } from '../../engine/chart/colorRamps';
import { formatValue } from '../../engine/chart/chartLayout';
import { mathText } from '../../engine/chart/mathText';
import { findRoots, findExtrema, integrate, type Sample } from '../../engine/chart/chartAnalysis';
import {
  chartCapabilities,
  CHART_SORTS,
  CHART_SORT_LABELS,
  defaultPlotDomain,
  isIsotropic,
  isPlot,
  isPolar,
  isRadial,
  isSampleKind,
  isTwoVariable,
  legendNamesCategories,
  resolveChartOptions,
  seriesColor,
  type ChartKind,
  type ChartSpec,
} from '../../engine/chart/chartTypes';

import { useStore } from '../../hooks/useStore';
import { editor } from '../../engine/api/EditorAPI';
import type { SketchLevel } from '../../engine/model/rough';
import type { ChartNode } from '../../engine/model/schema';

/**
 * Editing a chart after it exists.
 *
 * ## The spine
 *
 * **Source, Marks, Scales, Labels, Colour, Notes** — always those, always in
 * that order, for every kind. A section with nothing to offer this kind is
 * absent, which is the only variation left, so the panel's *shape* tells you
 * what the kind can do rather than where its author happened to put things.
 * Kind-specific rows fold into whichever section they belong to instead of
 * earning a heading of their own; `chartPanelCoverage.test.ts` holds that.
 *
 * ## Flat, and why
 *
 * This renders inside the panel's `Chart` accordion. Collapsibles inside a
 * collapsible is a tree where the rest of the inspector is a list, and a
 * control you have to open something to discover is a control nobody finds.
 * Rows that only mean something while another is on sit *under* it, indented
 * on a hairline (`Dependent`), which says the relationship without hiding it.
 *
 * ## The rule that keeps it short
 *
 * Nothing is offered where it does not reach the renderer: no donut hole on a
 * bar chart, no axis range on a pie, no roots on a parametric curve. Every
 * group is gated on `chartCapabilities` or on the kind, never on a guess —
 * which is how an aspect control once wrote `isotropic`, a field no layout
 * function has ever read.
 */

interface Props {
  node: ChartNode;
}

type Patch = (next: Partial<ChartSpec>) => void;
interface FieldProps {
  spec: ChartSpec;
  patch: Patch;
}
type Curve = NonNullable<ChartSpec['functions']>[number];

/** The letter this kind's formulae are written in. */
const plotVariableFor = (kind: ChartKind): string => {
  if (kind === 'parametric') return 't';
  if (kind === 'polarPlot') return 'a';
  return 'x';
};

const isField = (kind: ChartKind) => kind === 'slopeField' || kind === 'vectorField';
const isLineRun = (kind: ChartKind) => kind === 'line' || kind === 'area' || kind === 'step';
const hasBars = (kind: ChartKind) =>
  kind === 'bar' ||
  kind === 'barHorizontal' ||
  kind === 'stackedBar' ||
  kind === 'stackedBar100' ||
  kind === 'waterfall' ||
  kind === 'histogram' ||
  kind === 'treemap' ||
  kind === 'timeline' ||
  kind === 'boxPlot';

/**
 * Kinds whose formulae are a fixed set of slots rather than a list.
 *
 * A parametric curve *is* an ordered pair and a vector field is P and Q, so
 * adding a third row or deleting the first silently promotes y(t) to x(t).
 * The contour, heatmap and slope field each read exactly one expression.
 * Only the function, polar and implicit plots take a list.
 */
const FIXED_SLOTS: Partial<Record<ChartKind, number>> = {
  parametric: 2,
  vectorField: 2,
  contour: 1,
  heatmap: 1,
  slopeField: 1,
};

/** Kinds where each row is a drawn line with a colour of its own. */
const colouredRows = (kind: ChartKind, i: number) =>
  kind === 'function' || kind === 'polarPlot' || kind === 'implicit' || (kind === 'parametric' && i === 0);

/** Kinds where a row's stroke weight and pattern reach the renderer. */
const strokedRows = (kind: ChartKind, i: number) =>
  kind === 'function' || kind === 'polarPlot' || (kind === 'parametric' && i === 0);

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n: number) => String(n).replace(/\d/g, (d) => SUBSCRIPTS[Number(d)]);

/** The name a formula row is written against, as it would be on paper. */
function formulaName(kind: ChartKind, i: number, count: number): { prefix: string; name: string } {
  const n = count > 1 ? sub(i + 1) : '';
  switch (kind) {
    case 'parametric':
      return i === 0 ? { prefix: 'x(t) =', name: 'x(t)' } : { prefix: 'y(t) =', name: 'y(t)' };
    case 'vectorField':
      return i === 0 ? { prefix: 'P =', name: 'P(x, y)' } : { prefix: 'Q =', name: 'Q(x, y)' };
    case 'slopeField':
      return { prefix: 'dy/dx =', name: 'dy/dx' };
    // The curve is where F vanishes, so the row reads as the equation it is.
    case 'implicit':
      return { prefix: '0 =', name: `F${n}(x, y)` };
    case 'contour':
    case 'heatmap':
      return { prefix: 'f(x,y) =', name: 'f(x, y)' };
    case 'polarPlot':
      return { prefix: `r${n} =`, name: `r${n}(a)` };
    default:
      return { prefix: `f${n}(x) =`, name: `f${n}(x)` };
  }
}

/** Tidy bounds for a placeholder: `2π` rather than `6.283185307179586`. */
function niceBound(n: number | undefined): string {
  if (n === undefined) return 'Auto';
  const halfTurns = n / (Math.PI / 2);
  if (n !== 0 && Math.abs(halfTurns - Math.round(halfTurns)) < 1e-6) {
    const k = Math.round(halfTurns);
    const whole = k / 2;
    if (Number.isInteger(whole)) return `${whole === 1 ? '' : whole === -1 ? '−' : whole}π`;
    return `${k}π/2`;
  }
  return String(Math.round(n * 1000) / 1000);
}

const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-6;

/** Read a table cell: thousands separators and currency marks are not the number. */
function parseCell(raw: string): number | null {
  const t = raw.trim().replace(/[,\s$€£¥%]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A series' values made exactly `length` long, holes kept as holes. */
const fit = (values: Array<number | null>, length: number) =>
  Array.from({ length }, (_, i) => values[i] ?? null);

/**
 * Mean, median and extremes of everything drawn.
 *
 * Pooled across series, because a reference line is one rule across the whole
 * chart. Holes are skipped rather than counted as zero — an average that
 * treats a missing reading as nought is lower than the truth by exactly the
 * amount nobody measured.
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
    // definition — taking the lower one is off by half a step.
    median: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
  };
}

/** A short-lived status line. One timer, cleared on unmount. */
function useNotice(): [string | null, (msg: string) => void] {
  const [notice, setNotice] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const say = React.useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 2200);
  }, []);
  return [notice, say];
}

// ===========================================================================
// The section
// ===========================================================================

export const ChartSection: React.FC<Props> = ({ node }) => {
  const spec = node.chart;
  const radial = isRadial(spec.kind);
  const polar = isPolar(spec.kind);
  const plot = isPlot(spec.kind);
  const twoVar = isTwoVariable(spec.kind);
  /**
   * What this kind can actually honour. Every group below is gated on it
   * rather than on a hand-written condition, so the panel and the layout
   * cannot drift.
   */
  const can = chartCapabilities(spec.kind);
  const plotVariable = plotVariableFor(spec.kind);
  const kind = spec.kind;

  /**
   * Where a token from the function reference lands.
   *
   * The reference used to append ` + token` to the end of whichever row last
   * had focus, so there was no way to put `sin(` *around* something already
   * written — which is most of what anybody reaches for a function list to
   * do. The caret of the row last edited is kept here, at the parent both
   * the rows and the reference share: a selection is wrapped (`x^2` becomes
   * `sqrt(x^2)`), a caret mid-formula inserts in place, and a caret at the
   * end still extends the formula with `+`.
   */
  const caret = React.useRef<{ index: number; start: number; end: number } | null>(null);

  const patch = React.useCallback<Patch>(
    (next) => updateChart(node.id, { ...spec, ...next }),
    [node.id, spec]
  );

  const insertToken = React.useCallback(
    (token: string) => {
      const curves = spec.functions ?? [];
      if (curves.length === 0) {
        patch({ functions: [{ source: token }] });
        return;
      }
      const at = caret.current && caret.current.index < curves.length ? caret.current : null;
      const target = at?.index ?? 0;
      const source = curves[target].source;
      const start = at?.start ?? source.length;
      const end = at?.end ?? source.length;
      const selected = source.slice(start, end);
      const call = /^([a-z][a-z0-9]*)\((.*)\)$/i.exec(token);

      let piece = token;
      if (selected && call) {
        // Keep a second argument's skeleton: `atan2(x, 1)` wraps as
        // `atan2(<selection>, 1)`, not as a one-argument call.
        const comma = call[2].indexOf(',');
        piece = `${call[1]}(${selected}${comma >= 0 ? call[2].slice(comma) : ''})`;
      } else if (!selected && start === source.length && source.trim() !== '' && !/[+\-*/^(,\s]$/.test(source)) {
        piece = ` + ${token}`;
      }

      const next = source.slice(0, start) + piece + source.slice(end);
      caret.current = { index: target, start: start + piece.length, end: start + piece.length };
      patch({ functions: curves.map((c, i) => (i === target ? { ...c, source: next } : c)) });
    },
    [spec.functions, patch]
  );

  const marksApply =
    can.curved ||
    isLineRun(kind) ||
    hasBars(kind) ||
    kind === 'stackedArea' ||
    kind === 'donut' ||
    kind === 'scatter' ||
    kind === 'bubble' ||
    twoVar;

  return (
    <div className="chartp">
      <TypeHeader kind={kind} onPick={(k) => setChartKind(node.id, spec, k)} />
      <DrawingStyle node={node} />

      {/* ─── 1. Source ─────────────────────────────────────────────────────
          Examples ride on the heading for every kind: somebody plotting
          sin(x) knows what they want, and somebody making their first
          waterfall mostly does not know what a waterfall is *for*. */}
      {plot ? (
        <Group label="Formula" icon={<FunctionSquare size={14} />}>
          {/* A bar of its own: the two triggers side by side on the heading
              were wider than the heading. */}
          <div className="chartp-fxbar">
            <ExpressionReference variable={plotVariable} onInsert={insertToken} />
            <ExampleButton
              kind={kind}
              onPick={(next) => updateChart(node.id, next)}
              onAddCurves={
                FIXED_SLOTS[kind]
                  ? undefined
                  : (extra) => patch({ functions: [...(spec.functions ?? []), ...extra] })
              }
            />
          </div>
          <FormulaEditor spec={spec} patch={patch} caret={caret} />
        </Group>
      ) : (
        <Group
          label="Data"
          icon={<Sheet size={14} />}
          actions={<ExampleButton kind={kind} onPick={(next) => updateChart(node.id, next)} />}
        >
          <DataPanel node={node} spec={spec} patch={patch} />
        </Group>
      )}

      {/* ─── 2. Marks ──────────────────────────────────────────────────── */}
      {marksApply && (
        <Group label="Marks" icon={<Shapes size={14} />}>
          <MarkFields spec={spec} patch={patch} />
        </Group>
      )}

      {/* ─── 3. Scales ─────────────────────────────────────────────────── */}
      {(plot || can.valueAxis || can.numberFormat || can.sort) && (
        <Group label="Scales" icon={<Ruler size={14} />}>
          {plot && (twoVar ? <PlaneFields spec={spec} patch={patch} /> : <DomainFields spec={spec} patch={patch} />)}

          {can.valueAxis && (
            <>
              {plot && <SubHead label="Value axis" />}
              <AxisFields spec={spec} patch={patch} />
            </>
          )}

          {can.numberFormat && (
            <>
              <SubHead label="Numbers" />
              <NumberFields spec={spec} patch={patch} />
            </>
          )}

          {/* A histogram's categories are its buckets, which the layout
              computes — there is nothing entered to put in order. */}
          {can.sort && kind !== 'histogram' && (
            <>
              <SubHead label="Order" />
              <OrderFields spec={spec} patch={patch} />
            </>
          )}
        </Group>
      )}

      {/* ─── 4. Labels ─────────────────────────────────────────────────── */}
      <Group label="Labels" icon={<Type size={14} />}>
        <LabelFields
          spec={spec}
          patch={patch}
          can={can}
          // Axis titles need an axis: a treemap, a network and a heat table
          // have none to put one against.
          axes={!radial && !polar && !plot && kind !== 'treemap' && kind !== 'network' && kind !== 'matrix'}
        />
      </Group>

      {/* ─── 5. Colour ─────────────────────────────────────────────────── */}
      <Group label="Colour" icon={<Palette size={14} />}>
        <ColourFields spec={spec} patch={patch} can={can} />
      </Group>

      {/* ─── 6. Notes ──────────────────────────────────────────────────── */}
      {(can.reference || kind === 'function' || isField(kind)) && (
        <Group label="Notes" icon={<StickyNote size={14} />}>
          {/* A timeline's line runs down the chart — a "today" — and a band
              across a time axis would be a range of dates, not a tolerance. */}
          {can.reference && <ReferenceFields spec={spec} patch={patch} allowBand={kind !== 'timeline'} />}
          {kind === 'function' && (
            <>
              <SubHead label="Read off the curve" />
              <AnalysisFields spec={spec} patch={patch} />
            </>
          )}
          {isField(kind) && (
            <>
              {can.reference && <SubHead label="Solution curves" />}
              <SeedFields spec={spec} patch={patch} />
            </>
          )}
        </Group>
      )}
    </div>
  );
};

/**
 * Clean or sketch — one press, the whole chart.
 *
 * The sketch treatment lived only in the generic Sketch section further down
 * the panel, as a roughness slider shared with shapes and connectors, so the
 * thing people ask of a chart — *make this look whiteboarded* — had no answer
 * where a chart is edited. The treatment keeps every value, label, axis and
 * relationship where the clean chart put them; it changes the hand, not the
 * data, which is why it is safe to offer as a single switch.
 */
const DrawingStyle: React.FC<{ node: ChartNode }> = ({ node }) => {
  const level = node.appearance?.sketch;
  const set = (sketch: SketchLevel | undefined) =>
    editor.updateNode(node.id, { appearance: { ...(node.appearance ?? {}), sketch } });

  return (
    <div className="chartp-mode">
      <SegmentedControl
        fill
        ariaLabel="Drawing style"
        value={level ? 'sketch' : 'clean'}
        onChange={(v) => set(v === 'sketch' ? level ?? 'medium' : undefined)}
        segments={[
          { value: 'clean', label: 'Clean', hint: 'Precise and presentation-ready' },
          { value: 'sketch', label: 'Sketch', hint: 'Hand-drawn for whiteboarding — every value and label kept' },
        ]}
      />
      {level && (
        <SegmentedControl
          fill
          ariaLabel="How rough the hand is"
          value={level}
          onChange={(v) => set(v as SketchLevel)}
          segments={[
            { value: 'light', label: 'Fine', hint: 'A steady hand' },
            { value: 'medium', label: 'Marker', hint: 'A whiteboard marker' },
            { value: 'heavy', label: 'Loose', hint: 'Quick and expressive' },
          ]}
        />
      )}
    </div>
  );
};

// ===========================================================================
// Source: data
// ===========================================================================

/**
 * The table, the operations on it, and one line saying what it holds.
 *
 * The operations were six 22px icons on the heading beside the example
 * button — wider than the heading, so they ran under the section's name.
 * They are a toolbar of their own now, with the spreadsheet as its one
 * labelled, primary entry: it is the one people are looking for, and the
 * other five are one-shot conveniences an icon can carry.
 */
const DataPanel: React.FC<{ node: ChartNode } & FieldProps> = ({ node, spec, patch }) => {
  const [notice, say] = useNotice();
  const samples = isSampleKind(spec.kind);

  const readInto = (text: string, source: string) => {
    const data = parseChartData(text);
    if (data.categories.length === 0) say(`No table in ${source}`);
    else {
      updateChart(node.id, withChartData(spec, data));
      say(`Read ${data.categories.length} rows`);
    }
  };

  const run = async (id: 'sheet' | 'transpose' | 'paste' | 'copy' | 'export' | 'import') => {
    try {
      if (id === 'sheet') {
        useStore.getState().setChartDataModalNodeId(node.id);
      } else if (id === 'transpose') {
        if (spec.categories.length === 0 || spec.series.length === 0) return;
        patch({
          categories: spec.series.map((s) => s.name),
          series: spec.categories.map((cat, ci) => ({
            name: cat,
            values: spec.series.map((s) => s.values[ci] ?? null),
          })),
        });
        say('Rows and columns swapped');
      } else if (id === 'paste') {
        readInto(await navigator.clipboard.readText(), 'the clipboard');
      } else if (id === 'copy') {
        await navigator.clipboard.writeText(chartToCsv(spec));
        say('Copied as CSV');
      } else if (id === 'export') {
        downloadCsv(spec, csvFilename(spec.title));
      } else {
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

  const points = spec.series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0);

  return (
    <>
      <div className="chartp-databar" role="toolbar" aria-label="Table">
        <button type="button" className="chartp-databar__open" onClick={() => void run('sheet')}>
          <Sheet size={14} aria-hidden="true" />
          <span>Open sheet</span>
        </button>
        <span className="chartp-databar__sep" aria-hidden="true" />
        <IconAction label="Paste a table" onClick={() => void run('paste')}>
          <ClipboardPaste size={14} />
        </IconAction>
        <IconAction label="Copy as CSV" onClick={() => void run('copy')}>
          <Copy size={14} />
        </IconAction>
        <IconAction label="Import a CSV file" onClick={() => void run('import')}>
          <FileUp size={14} />
        </IconAction>
        <IconAction label="Export a CSV file" onClick={() => void run('export')}>
          <FileDown size={14} />
        </IconAction>
        {!samples && (
          <IconAction label="Swap rows and columns" onClick={() => void run('transpose')}>
            <ArrowLeftRight size={14} />
          </IconAction>
        )}
      </div>

      {samples ? <SampleEditor spec={spec} patch={patch} /> : <DataGrid spec={spec} patch={patch} />}

      {/* How the table is read, for the kinds whose table is not a plain
          category-by-series grid. Said once, where the numbers are typed. */}
      {spec.kind === 'network' && (
        <Note>Each row lists one node's links: a number under another node joins the two, and its size is the link's weight.</Note>
      )}
      {spec.kind === 'timeline' && (
        <Note>The first column is where each row starts and the second where it ends. Leave the end empty for a milestone.</Note>
      )}
      {spec.kind === 'matrix' && (
        <Note>Rows down the side, columns across the top; every number is painted on the ramp chosen in Colour.</Note>
      )}

      <div className="chartp-datafoot">
        <span>
          {samples
            ? `${points} ${points === 1 ? 'sample' : 'samples'}${spec.kind !== 'histogram' ? ` · ${spec.series.length} ${spec.series.length === 1 ? 'group' : 'groups'}` : ''}`
            : `${spec.categories.length} rows · ${spec.series.length} ${spec.series.length === 1 ? 'series' : 'series'} · ${points} values`}
        </span>
        {/* Here rather than on the heading: a heading that changes width when
            a message appears makes the whole group jump. */}
        <span className="chartp-datafoot__notice" role="status" aria-live="polite">
          {notice}
        </span>
      </div>
    </>
  );
};

/**
 * A number cell that can be typed into.
 *
 * ## The bug this exists for
 *
 * The cells were controlled straight off the spec and wrote on every
 * keystroke through `Number()`. So `-` on its way to `-4` parsed as nothing,
 * wrote a hole, and redrew as an empty cell — the minus vanished under your
 * finger. `1.` on its way to `1.5` wrote `1` and redrew as `1`, and the `.5`
 * arrived as `15`. Negative numbers and decimals could not be entered at all.
 *
 * The cell keeps a draft while focused and commits on blur, Enter or a move,
 * which is also one CRDT write per edit instead of one per character.
 */
const GridCell: React.FC<{
  value: number | null;
  address: string;
  label: string;
  onCommit: (value: number | null) => void;
  onMove: (rows: 1 | -1) => void;
  onPasteBlock: (text: string) => boolean;
}> = ({ value, address, label, onCommit, onMove, onPasteBlock }) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : String(value));
  const invalid = draft !== null && draft.trim() !== '' && parseCell(draft) === null;

  const commit = () => {
    if (draft === null) return;
    const next = parseCell(draft);
    // An unreadable entry is not written as a hole: it stays marked until it
    // is fixed or abandoned, so a typo never silently erases a reading.
    if (invalid) return;
    if (next !== value) onCommit(next);
    setDraft(null);
  };

  return (
    <input
      className="chartp-grid__cell"
      data-cell={address}
      data-invalid={invalid || undefined}
      inputMode="decimal"
      value={shown}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (invalid) setDraft(null);
        else commit();
      }}
      onPaste={(e) => {
        if (onPasteBlock(e.clipboardData.getData('text'))) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          commit();
          onMove(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
        } else if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

/**
 * The editable table, behaving like the small spreadsheet it is.
 *
 * - **Enter** commits and moves down, **Shift+Enter** up, and the arrows do
 *   the same. Enter on the last row adds one — typing a column of readings
 *   is Enter, number, Enter, number, as it is everywhere else.
 * - **Pasting** a block from a spreadsheet fills from the cell you are in,
 *   adding rows and series as it needs them. One number pastes as one number.
 * - The label column stays put while a wide table scrolls sideways.
 * - Each series heading carries its colour, so the table and the chart can be
 *   read against each other.
 *
 * An emptied cell is `null`, not `0` — the distinction the whole model rests
 * on, and the panel must not be where it is lost.
 */
const DataGrid: React.FC<FieldProps> = ({ spec, patch }) => {
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [pendingFocus, setPendingFocus] = React.useState<string | null>(null);
  const palette = resolveChartOptions(spec).palette;
  const rows = spec.categories.length;
  const cols = spec.series.length;

  React.useEffect(() => {
    if (!pendingFocus) return;
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${pendingFocus}"]`);
    if (el) {
      el.focus();
      el.select();
    }
    setPendingFocus(null);
  }, [pendingFocus, rows, cols]);

  const fitted = () => spec.series.map((s) => ({ ...s, values: fit(s.values, rows) }));

  const addRow = (focusCol?: number) => {
    patch({
      categories: [...spec.categories, `Item ${rows + 1}`],
      series: fitted().map((s) => ({ ...s, values: [...s.values, null] })),
    });
    if (focusCol !== undefined) setPendingFocus(`${rows}:${focusCol}`);
  };

  const removeRow = (ri: number) =>
    patch({
      categories: spec.categories.filter((_, i) => i !== ri),
      series: fitted().map((s) => ({ ...s, values: s.values.filter((_, i) => i !== ri) })),
    });

  const addSeries = () => {
    patch({ series: [...fitted(), { name: `Series ${cols + 1}`, values: spec.categories.map(() => null) }] });
    setPendingFocus(`h:${cols}`);
  };

  const removeSeries = (si: number) => patch({ series: spec.series.filter((_, i) => i !== si) });

  const setValue = (ri: number, si: number, v: number | null) =>
    patch({
      series: fitted().map((s, i) =>
        i === si ? { ...s, values: s.values.map((x, j) => (j === ri ? v : x)) } : s
      ),
    });

  const move = (ri: number, col: number, delta: 1 | -1) => {
    const target = ri + delta;
    if (target >= rows && delta === 1) addRow(col);
    else if (target >= 0) setPendingFocus(`${target}:${col}`);
  };

  /** A tab-separated block, written in from (row, column). `-1` is the label column. */
  const pasteBlock = (r0: number, c0: number, text: string): boolean => {
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const matrix = lines.map((l) => l.split('\t'));
    if (matrix.length <= 1 && (matrix[0]?.length ?? 0) <= 1) return false;

    const categories = [...spec.categories];
    let series = fitted();
    matrix.forEach((cells, dr) => {
      const r = r0 + dr;
      while (r >= categories.length) {
        categories.push(`Item ${categories.length + 1}`);
        series = series.map((s) => ({ ...s, values: [...s.values, null] }));
      }
      cells.forEach((raw, dc) => {
        const c = c0 + dc;
        if (c === -1) {
          categories[r] = raw.trim() || categories[r];
          return;
        }
        while (c >= series.length) {
          series.push({ name: `Series ${series.length + 1}`, values: categories.map(() => null) });
        }
        const v = parseCell(raw);
        series[c] = { ...series[c], values: series[c].values.map((x, j) => (j === r ? v : x)) };
      });
    });
    patch({ categories, series });
    return true;
  };

  const template = `minmax(76px, 1.35fr) repeat(${cols}, minmax(58px, 1fr)) 24px`;

  return (
    <div className="chartp-grid" ref={gridRef}>
      <div className="chartp-grid__scroll">
        <div className="chartp-grid__table" style={{ '--grid-cols': template } as React.CSSProperties}>
          <div className="chartp-grid__row chartp-grid__row--head">
            <span className="chartp-grid__corner">Label</span>
            {spec.series.map((s, si) => (
              <span className="chartp-grid__headcell" key={`h${si}`}>
                <SeriesKey color={seriesColor(s, si, palette)} />
                <input
                  className="chartp-grid__head"
                  data-cell={`h:${si}`}
                  value={s.name}
                  onChange={(e) =>
                    patch({ series: spec.series.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)) })
                  }
                  aria-label={`Series ${si + 1} name`}
                />
                {cols > 1 && (
                  <button
                    type="button"
                    className="chartp-grid__drop"
                    aria-label={`Remove ${s.name || `series ${si + 1}`}`}
                    data-tooltip="Remove this series"
                    onClick={() => removeSeries(si)}
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
            <IconAction label="Add a series" onClick={addSeries}>
              <Plus size={13} />
            </IconAction>
          </div>

          {spec.categories.map((category, ci) => (
            <div className="chartp-grid__row" key={`r${ci}`}>
              <input
                className="chartp-grid__cell chartp-grid__cell--label"
                data-cell={`${ci}:-1`}
                value={category}
                onChange={(e) =>
                  patch({ categories: spec.categories.map((c, i) => (i === ci ? e.target.value : c)) })
                }
                onPaste={(e) => {
                  if (pasteBlock(ci, -1, e.clipboardData.getData('text'))) e.preventDefault();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    move(ci, -1, e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
                  }
                }}
                aria-label={`Row ${ci + 1} label`}
              />
              {spec.series.map((s, si) => (
                <GridCell
                  key={`c${si}-${ci}`}
                  address={`${ci}:${si}`}
                  value={s.values[ci] ?? null}
                  label={`${s.name} at ${category}`}
                  onCommit={(v) => setValue(ci, si, v)}
                  onMove={(d) => move(ci, si, d)}
                  onPasteBlock={(text) => pasteBlock(ci, si, text)}
                />
              ))}
              <button
                type="button"
                className="chartp-grid__drop chartp-grid__drop--row"
                aria-label={`Remove ${category || `row ${ci + 1}`}`}
                data-tooltip="Remove this row"
                onClick={() => removeRow(ci)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <AddButton icon={<Plus size={13} aria-hidden="true" />} onClick={() => addRow(0)}>
        Add row
      </AddButton>
    </div>
  );
};

/**
 * A histogram's raw samples.
 *
 * A histogram has no categories — it buckets the values itself — so the grid
 * showed it as an empty table, and "Add a row" appended a label that no value
 * lined up with. The samples are a list of numbers, and a list of numbers is
 * edited as one: paste a column from anywhere, commit on blur.
 */
const SampleEditor: React.FC<FieldProps> = ({ spec, patch }) => {
  // A box plot and a density compare *groups*, so each series is a named,
  // coloured group that can be added and removed; a histogram pools them.
  const grouped = spec.kind !== 'histogram';
  const palette = resolveChartOptions(spec).palette;
  return (
    <div className="chartp-samples">
      {spec.series.map((s, si) => (
        <SampleField
          key={si}
          name={grouped || spec.series.length > 1 ? s.name : undefined}
          color={grouped ? seriesColor(s, si, palette) : undefined}
          onRename={
            grouped
              ? (name) => patch({ series: spec.series.map((x, i) => (i === si ? { ...x, name } : x)) })
              : undefined
          }
          onRemove={
            grouped && spec.series.length > 1
              ? () => patch({ series: spec.series.filter((_, i) => i !== si) })
              : undefined
          }
          values={s.values}
          onCommit={(values) =>
            patch({ series: spec.series.map((x, i) => (i === si ? { ...x, values } : x)) })
          }
        />
      ))}
      {grouped && (
        <AddButton
          icon={<Plus size={13} aria-hidden="true" />}
          onClick={() => patch({ series: [...spec.series, { name: `Group ${spec.series.length + 1}`, values: [] }] })}
        >
          Add a group
        </AddButton>
      )}
    </div>
  );
};

const SampleField: React.FC<{
  name?: string;
  color?: string;
  onRename?: (name: string) => void;
  onRemove?: () => void;
  values: Array<number | null>;
  onCommit: (values: number[]) => void;
}> = ({ name, color, onRename, onRemove, values, onCommit }) => {
  const committed = values.filter((v): v is number => v !== null).join(', ');
  const [draft, setDraft] = React.useState<string | null>(null);
  const nums = values.filter((v): v is number => v !== null);
  const min = nums.length ? Math.min(...nums) : null;
  const max = nums.length ? Math.max(...nums) : null;
  const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  const round = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="chartp-samples__field">
      {name !== undefined &&
        (onRename ? (
          <div className="chartp-samples__head">
            {color && <SeriesKey color={color} />}
            <input
              className="chartp-samples__rename"
              value={name}
              aria-label="Group name"
              onChange={(e) => onRename(e.target.value)}
            />
            {onRemove && (
              <IconAction label={`Remove ${name || 'this group'}`} onClick={onRemove}>
                <X size={13} />
              </IconAction>
            )}
          </div>
        ) : (
          <span className="chartp-samples__name">{name}</span>
        ))}
      <textarea
        className="chartp-samples__input"
        rows={4}
        spellCheck={false}
        value={draft ?? committed}
        aria-label={name ? `${name} samples` : 'Samples'}
        placeholder="Numbers, separated by commas, spaces or new lines"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const parsed = draft
            .split(/[\s,;]+/)
            .map((t) => Number(t))
            .filter((n) => Number.isFinite(n) && String(n) !== '');
          onCommit(parsed);
          setDraft(null);
        }}
      />
      {min !== null && max !== null && mean !== null && (
        <span className="chartp-samples__stats">
          {nums.length} · {round(min)} – {round(max)} · mean {round(mean)}
        </span>
      )}
    </div>
  );
};

// ===========================================================================
// Source: formulae
// ===========================================================================

/**
 * The formula list.
 *
 * Each row is written against its own name — `f₁(x) =`, `x(t) =`, `0 =` for
 * an implicit curve — inside the field, the way it would be on paper. Under
 * it, the formula as the chart will set it (`x^2` → `x²`), or the parse error
 * in its place; and for a drawn line, its pattern and weight.
 *
 * Errors are shown, never thrown, and never clear the curve: somebody typing
 * `sin(` is halfway through, not wrong, and the last curve that compiled stays
 * on the board.
 *
 * Enter on the last row starts another, as in every graphing tool.
 */
const FormulaEditor: React.FC<
  FieldProps & { caret: React.MutableRefObject<{ index: number; start: number; end: number } | null> }
> = ({ spec, patch, caret }) => {
  const twoVar = isTwoVariable(spec.kind);
  const variable = plotVariableFor(spec.kind);
  const variables = twoVar ? ['x', 'y'] : [variable];
  const fixed = FIXED_SLOTS[spec.kind];
  const curves = spec.functions ?? [];
  const count = fixed ?? Math.max(1, curves.length);
  const rows: Curve[] = Array.from({ length: count }, (_, i) => curves[i] ?? { source: '' });
  const palette = resolveChartOptions(spec).palette;
  const listRef = React.useRef<HTMLDivElement>(null);
  const [focusRow, setFocusRow] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (focusRow === null) return;
    listRef.current?.querySelector<HTMLInputElement>(`[data-row="${focusRow}"]`)?.focus();
    setFocusRow(null);
  }, [focusRow, rows.length]);

  const set = (i: number, next: Partial<Curve>) =>
    patch({ functions: rows.map((c, j) => (i === j ? { ...c, ...next } : c)) });

  const track = (i: number, el: HTMLInputElement) => {
    caret.current = {
      index: i,
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  };

  const add = () => {
    patch({ functions: [...rows, { source: '' }] });
    setFocusRow(rows.length);
  };

  return (
    <div className="chartp-fxlist" ref={listRef}>
      {rows.map((curve, i) => {
        const result = curve.source.trim() ? parseExpression(curve.source, variables) : null;
        const error = result && !result.ok ? result.error.message : null;
        const typeset = mathText(curve.source);
        const { prefix, name } = formulaName(spec.kind, i, count);
        const colour = curve.color ?? seriesColor(undefined, i, palette);
        const coloured = colouredRows(spec.kind, i);
        const stroked = strokedRows(spec.kind, i);
        const removable = !fixed && rows.length > 1;

        return (
          <div className="chartp-fx" key={i} data-hidden={curve.hidden || undefined} data-invalid={Boolean(error) || undefined}>
            <div className="chartp-fx__line">
              {coloured ? (
                <ColorPickerPopover color={colour} onChange={(color) => set(i, { color })} />
              ) : (
                <span className="chartp-fx__nokey" aria-hidden="true" />
              )}
              <label className="chartp-fx__field">
                <span className="chartp-fx__prefix" aria-hidden="true">
                  {prefix}
                </span>
                <input
                  className="chartp-fx__input"
                  data-row={i}
                  value={curve.source}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={twoVar ? 'x^2 + y^2 - 4' : `sin(${variable})`}
                  aria-label={name}
                  aria-invalid={Boolean(error) || undefined}
                  onFocus={(e) => track(i, e.currentTarget)}
                  onSelect={(e) => track(i, e.currentTarget)}
                  onChange={(e) => {
                    set(i, { source: e.target.value });
                    track(i, e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !fixed && i === rows.length - 1 && curve.source.trim()) {
                      e.preventDefault();
                      add();
                    }
                  }}
                />
              </label>
              {!fixed && (
                <IconAction label={curve.hidden ? 'Show this curve' : 'Hide this curve'} onClick={() => set(i, { hidden: !curve.hidden || undefined })}>
                  {curve.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </IconAction>
              )}
              {removable && (
                <IconAction label={`Remove ${name}`} onClick={() => patch({ functions: rows.filter((_, j) => j !== i) })}>
                  <X size={14} />
                </IconAction>
              )}
            </div>

            <div className="chartp-fx__meta">
              {error ? (
                <span className="chartp-fx__error" role="status">
                  {error}
                </span>
              ) : (
                /**
                 * The formula as the chart will set it. You edit ASCII — `x^2`,
                 * `sqrt`, `pi` — and the chart shows `x²`, `√`, `π`; this is the
                 * one place the two are seen together. Hidden when identical.
                 */
                <span className="chartp-fx__echo" aria-hidden="true">
                  {typeset !== curve.source.trim() ? typeset : ''}
                </span>
              )}
              {stroked && (
                <span className="chartp-fx__stroke">
                  <span className="chartp-fx__dashes" role="radiogroup" aria-label={`${name} line pattern`}>
                    {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        role="radio"
                        aria-checked={(curve.style ?? 'solid') === st}
                        aria-label={st}
                        data-tooltip={st[0].toUpperCase() + st.slice(1)}
                        className="chartp-fx__dash"
                        onClick={() => set(i, { style: st === 'solid' ? undefined : (st as Curve['style']) })}
                      >
                        <StrokeStyleIcon style={st} />
                      </button>
                    ))}
                  </span>
                  <span className="chartp-fx__weight">
                    <NumberStepper
                      value={curve.width ?? spec.lineWidth ?? 2}
                      min={1}
                      max={6}
                      step={0.5}
                      suffix="px"
                      aria-label={`${name} line weight`}
                      onChange={(w) => set(i, { width: w === 2 ? undefined : w })}
                    />
                  </span>
                </span>
              )}
            </div>
          </div>
        );
      })}

      {!fixed && (
        <AddButton icon={<Plus size={13} aria-hidden="true" />} onClick={add}>
          {spec.kind === 'implicit' ? 'Add an equation' : 'Add a curve'}
        </AddButton>
      )}
    </div>
  );
};

// ===========================================================================
// Marks
// ===========================================================================

/**
 * How the mark itself is drawn — the one question *what does the mark look
 * like*, asked once, with every kind's own rows folded in. Where the choice
 * is a shape, the option is the shape.
 */
const MarkFields: React.FC<FieldProps> = ({ spec, patch }) => {
  const kind = spec.kind;
  const can = chartCapabilities(kind);
  const area = kind === 'area' || kind === 'stackedArea';
  const dots = isLineRun(kind) || kind === 'scatter' || kind === 'bubble';

  return (
    <>
      {/* Never for `step`: a staircase asserts the value did *not* slide
          between readings, and rounding it states the opposite. */}
      {can.curved && (
        <Row label="Shape">
          <SegmentedControl
            fill
            ariaLabel="How the run is joined"
            value={spec.curved ? 'curved' : 'straight'}
            onChange={(v) => patch({ curved: v === 'curved' ? true : undefined })}
            segments={[
              { value: 'straight', label: 'Straight', icon: <CurveStraight />, hint: 'Straight — joins the readings directly' },
              { value: 'curved', label: 'Curved', icon: <CurveSmooth />, hint: 'Curved — smooths through the readings' },
            ]}
          />
        </Row>
      )}

      {kind === 'step' && (
        <Row label="Step" hint="Where the value changes, relative to each reading">
          <SegmentedControl
            fill
            ariaLabel="Where the step happens"
            value={spec.stepMode ?? 'after'}
            onChange={(v) => patch({ stepMode: v === 'after' ? undefined : (v as ChartSpec['stepMode']) })}
            segments={[
              { value: 'before', label: 'Before', icon: <StepSpecimen mode="before" />, hint: 'Before — changes at the reading' },
              { value: 'mid', label: 'Middle', icon: <StepSpecimen mode="mid" />, hint: 'Middle — changes halfway between' },
              { value: 'after', label: 'After', icon: <StepSpecimen mode="after" />, hint: 'After — holds until the next reading' },
            ]}
          />
        </Row>
      )}

      {/* The layout's default is 2, which the panel used to show as 2.5 — so
          setting 2.5 wrote "default" and drew 2. */}
      {isLineRun(kind) && (
        <Row label="Weight">
          <NumberStepper
            value={spec.lineWidth ?? 2}
            min={1}
            max={6}
            step={0.5}
            suffix="px"
            aria-label="Line weight"
            onChange={(v) => patch({ lineWidth: v === 2 ? undefined : v })}
          />
        </Row>
      )}

      {/* Scatter and bubble honour the marker too; they were never offered it.
          "None" is withheld from them — a scatter with no marks is empty. */}
      {dots && (
        <Row label="Points">
          <SegmentedControl
            fill
            ariaLabel="Mark at each reading"
            value={spec.markerShape === 'hollow' ? 'ring' : spec.markerShape ?? 'circle'}
            onChange={(v) => patch({ markerShape: v === 'circle' ? undefined : (v as ChartSpec['markerShape']) })}
            segments={[
              { value: 'circle', label: 'Dot', icon: <MarkerSpecimen shape="circle" />, hint: 'Dot' },
              { value: 'ring', label: 'Ring', icon: <MarkerSpecimen shape="ring" />, hint: 'Ring' },
              { value: 'square', label: 'Square', icon: <MarkerSpecimen shape="square" />, hint: 'Square' },
              ...(isLineRun(kind)
                ? [{ value: 'none', label: 'None', icon: <MarkerSpecimen shape="none" />, hint: 'No marks — the line alone' }]
                : []),
            ]}
          />
        </Row>
      )}

      {hasBars(kind) && (
        <Row label="Corners">
          <Slider
            label="Corner radius"
            labelHidden
            value={spec.cornerRadius ?? 3}
            min={0}
            max={16}
            unit="px"
            origin={3}
            onChange={(v) => patch({ cornerRadius: v === 3 ? undefined : v })}
          />
        </Row>
      )}

      {area && (
        <Row label="Fill">
          <Slider
            label="Area opacity"
            labelHidden
            value={Math.round((spec.areaOpacity ?? 0.22) * 100)}
            min={5}
            max={90}
            unit="%"
            origin={22}
            onChange={(v) => patch({ areaOpacity: v === 22 ? undefined : v / 100 })}
          />
        </Row>
      )}

      {kind === 'donut' && (
        <Row label="Hole" hint="The inner radius, as a share of the outer">
          <Slider
            label="Hole"
            labelHidden
            value={Math.round((spec.innerRadius ?? 0.55) * 100)}
            min={15}
            max={85}
            unit="%"
            origin={55}
            onChange={(v) => patch({ innerRadius: v === 55 ? undefined : v / 100 })}
          />
        </Row>
      )}

      {kind === 'histogram' && (
        <>
          <Row label="Buckets" hint="The same samples at 5 and at 40 tell different stories">
            <NumberStepper
              value={spec.buckets ?? 10}
              min={2}
              max={60}
              aria-label="Buckets"
              onChange={(v) => patch({ buckets: v })}
            />
          </Row>
          <Row label="Density" hint="A smoothed estimate of the distribution, over the bars">
            <span className="chartp-switch">
              <Waves size={13} aria-hidden="true" />
              <Switch checked={Boolean(spec.showKde)} onChange={(on) => patch({ showKde: on || undefined })} label="Density curve" />
            </span>
          </Row>
        </>
      )}

      {(kind === 'scatter' || kind === 'bubble') && (
        <Row label="Trend" hint="Least-squares line, with its R²">
          <span className="chartp-switch">
            <TrendingUp size={13} aria-hidden="true" />
            <Switch checked={Boolean(spec.showTrendline)} onChange={(on) => patch({ showTrendline: on || undefined })} label="Trendline" />
          </span>
        </Row>
      )}

      {isTwoVariable(kind) && (
        <Row label={kind === 'implicit' || kind === 'contour' ? 'Detail' : 'Density'} hint="Cost is quadratic in this, unlike a curve's sample count">
          <NumberStepper
            value={spec.resolution ?? (kind === 'contour' ? 100 : 80)}
            min={8}
            max={160}
            step={4}
            aria-label="Grid resolution"
            onChange={(v) => patch({ resolution: v })}
          />
        </Row>
      )}

      {kind === 'contour' && (
        <Row label="Levels" hint="Spread across what the function actually reaches">
          <NumberStepper value={spec.levels ?? 8} min={2} max={40} aria-label="Contour levels" onChange={(v) => patch({ levels: v })} />
        </Row>
      )}
    </>
  );
};

// ===========================================================================
// Scales
// ===========================================================================

/** Lock the plane against gestures, and put it back where it started. */
const PlaneTools: React.FC<FieldProps> = ({ spec, patch }) => (
  <div className="chartp-tools">
    <button
      type="button"
      className="chartp-tool"
      aria-pressed={Boolean(spec.lockPlane)}
      data-tooltip="Stop wheel and drag gestures moving the plane"
      onClick={() => patch({ lockPlane: spec.lockPlane ? undefined : true })}
    >
      {spec.lockPlane ? <Lock size={13} aria-hidden="true" /> : <Unlock size={13} aria-hidden="true" />}
      <span>{spec.lockPlane ? 'Locked' : 'Lock plane'}</span>
    </button>
    {/* From `defaultPlotDomain`, which *is* the default: the button used to
        carry its own -10..10 and -5..5, and moved the plane somewhere a new
        plot had never been. */}
    <button
      type="button"
      className="chartp-tool"
      data-tooltip="Back to the plane this kind opens with"
      onClick={() => patch({ ...defaultPlotDomain(spec.kind), yClipMin: undefined, yClipMax: undefined })}
    >
      <RotateCcw size={13} aria-hidden="true" />
      <span>Reset view</span>
    </button>
  </div>
);

/** Free or equal units. `equalAxes` is what the layout reads; `isotropic` never was. */
const AspectRow: React.FC<FieldProps & { fallback: boolean }> = ({ spec, patch, fallback }) => (
  <Row label="Aspect" hint="Equal keeps one unit the same length on both axes, so a circle stays a circle">
    <SegmentedControl
      fill
      ariaLabel="Axis scaling"
      value={(spec.equalAxes ?? fallback) ? 'equal' : 'free'}
      onChange={(v) => {
        const equal = v === 'equal';
        patch({ equalAxes: equal === fallback ? undefined : equal, isotropic: undefined });
      }}
      segments={[
        { value: 'free', label: 'Free', icon: <AspectFree />, hint: 'Free — each axis fits its own range' },
        { value: 'equal', label: 'Equal', icon: <AspectEqual />, hint: 'Equal — one unit, one length' },
      ]}
    />
  </Row>
);

const DomainFields: React.FC<FieldProps> = ({ spec, patch }) => {
  const isFn = spec.kind === 'function';
  const d = defaultPlotDomain(spec.kind);
  const v = plotVariableFor(spec.kind);
  const ranges: Array<{ id: string; label: string; from: number; to: number }> = [
    { id: 'pi', label: '±π', from: -Math.PI, to: Math.PI },
    { id: 'tau', label: '0–2π', from: 0, to: Math.PI * 2 },
    { id: 'ten', label: '±10', from: -10, to: 10 },
    { id: 'one', label: '±1', from: -1, to: 1 },
  ];

  return (
    <>
      <Row label={`${v} range`}>
        <Pair>
          <OptionalNumber label="Domain start" glyph="from" placeholder={niceBound(d.xMin)} value={spec.xMin} onChange={(x) => patch({ xMin: x })} />
          <OptionalNumber label="Domain end" glyph="to" placeholder={niceBound(d.xMax)} value={spec.xMax} onChange={(x) => patch({ xMax: x })} />
        </Pair>
      </Row>
      <Row label="" stack>
        <QuickChips
          label="Common ranges"
          options={ranges.map((r) => ({
            id: r.id,
            label: r.label,
            active: near(spec.xMin, r.from) && near(spec.xMax, r.to),
            onClick: () => patch({ xMin: r.from, xMax: r.to }),
          }))}
        />
      </Row>
      {isFn && (
        <Row label="Clip y" hint="Clamp poles and spikes — tan(x), 1/x — so the rest stays readable">
          <Pair>
            <OptionalNumber label="Clip below" glyph="min" placeholder="None" value={spec.yClipMin} onChange={(y) => patch({ yClipMin: y })} />
            <OptionalNumber label="Clip above" glyph="max" placeholder="None" value={spec.yClipMax} onChange={(y) => patch({ yClipMax: y })} />
          </Pair>
        </Row>
      )}
      <Row label="Samples" hint="Before adaptive subdivision; more is smoother and slower">
        <NumberStepper value={spec.samples ?? 160} min={16} max={2000} step={20} aria-label="Samples" onChange={(n) => patch({ samples: n })} />
      </Row>
      <AspectRow spec={spec} patch={patch} fallback={isIsotropic(spec.kind)} />
      <PlaneTools spec={spec} patch={patch} />
    </>
  );
};

/**
 * The box a two-variable plot is drawn over.
 *
 * Four bounds, because both axes are *inputs* here: a contour has no y to
 * discover. Two per line, because each pair is one range read as one thing.
 */
const PlaneFields: React.FC<FieldProps> = ({ spec, patch }) => {
  const d = defaultPlotDomain(spec.kind);
  return (
    <>
      <Row label="x range">
        <Pair>
          <NumberStepper glyph={<span className="chartp-glyphtext">from</span>} aria-label="x from" value={spec.xMin ?? d.xMin ?? -5} onChange={(x) => patch({ xMin: x })} />
          <NumberStepper glyph={<span className="chartp-glyphtext">to</span>} aria-label="x to" value={spec.xMax ?? d.xMax ?? 5} onChange={(x) => patch({ xMax: x })} />
        </Pair>
      </Row>
      <Row label="y range">
        <Pair>
          <NumberStepper glyph={<span className="chartp-glyphtext">from</span>} aria-label="y from" value={spec.yPlotMin ?? d.yPlotMin ?? -5} onChange={(y) => patch({ yPlotMin: y })} />
          <NumberStepper glyph={<span className="chartp-glyphtext">to</span>} aria-label="y to" value={spec.yPlotMax ?? d.yPlotMax ?? 5} onChange={(y) => patch({ yPlotMax: y })} />
        </Pair>
      </Row>
      {/* A two-variable plane defaults to equal units — `layoutField` reads
          `equalAxes ?? true` — so an implicit circle is drawn round. */}
      <AspectRow spec={spec} patch={patch} fallback />
      <PlaneTools spec={spec} patch={patch} />
    </>
  );
};

const AxisFields: React.FC<FieldProps> = ({ spec, patch }) => {
  const values = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const canLog = logDomainOf(values).ok;
  const resolved = resolveChartOptions(spec);
  const lo = values.length ? Math.min(...values) : null;
  const hi = values.length ? Math.max(...values) : null;
  const bounded = spec.yMin !== undefined || spec.yMax !== undefined;

  return (
    <>
      {/* `OptionalNumber`, not a stepper: a stepper needs a sentinel for
          "automatic", and the sentinel was 0 — which made pinning a bar
          chart's baseline to zero the one thing this field could not do. */}
      <Row label="Range">
        <Pair>
          <OptionalNumber label="Axis minimum" glyph="min" value={spec.yMin} onChange={(v) => patch({ yMin: v })} />
          <OptionalNumber label="Axis maximum" glyph="max" value={spec.yMax} onChange={(v) => patch({ yMax: v })} />
        </Pair>
      </Row>
      {lo !== null && hi !== null && (
        <div className="chartp-caption">
          <span>
            Data runs {formatValue(lo, spec)} – {formatValue(hi, spec)}
          </span>
          {bounded && (
            <button type="button" className="chartp-link" onClick={() => patch({ yMin: undefined, yMax: undefined })}>
              Back to auto
            </button>
          )}
        </div>
      )}
      <Row label="Baseline" hint="A bar's length means nothing measured from anywhere else">
        <SegmentedControl
          fill
          ariaLabel="Where the axis starts"
          value={resolved.includeZero ? 'zero' : 'fit'}
          onChange={(v) => patch({ includeZero: v === 'zero' })}
          segments={[
            { value: 'zero', label: 'From zero', hint: 'Always include zero' },
            { value: 'fit', label: 'Fit data', hint: 'Fit the axis to the readings' },
          ]}
        />
      </Row>
      {/* Withdrawn rather than clamped when the data cannot take it: a log
          axis has no position for zero or below. */}
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
        <Note>A log scale needs every value above zero.</Note>
      )}
    </>
  );
};

/**
 * The number formats worth one press. A table rather than hand-written
 * buttons, so each chip can show whether it is the current format.
 */
const NUMBER_PRESETS: Array<{ id: string; label: string; patch: Partial<ChartSpec> }> = [
  { id: 'usd', label: '$', patch: { valuePrefix: '$', valueSuffix: undefined, compactNumbers: undefined, decimals: undefined } },
  { id: 'eur', label: '€', patch: { valuePrefix: '€', valueSuffix: undefined, compactNumbers: undefined, decimals: undefined } },
  { id: 'pct', label: '%', patch: { valuePrefix: undefined, valueSuffix: '%', compactNumbers: false, decimals: 1 } },
  { id: 'compact', label: '1.2M', patch: { valuePrefix: undefined, valueSuffix: undefined, compactNumbers: undefined, decimals: 1 } },
  { id: 'full', label: '1,250', patch: { valuePrefix: undefined, valueSuffix: undefined, compactNumbers: false, decimals: 0 } },
];

function matchesPreset(spec: ChartSpec, preset: { patch: Partial<ChartSpec> }): boolean {
  return (Object.keys(preset.patch) as Array<keyof ChartSpec>).every(
    (key) => (spec[key] ?? undefined) === (preset.patch[key] ?? undefined)
  );
}

/**
 * How a number is written, wherever the chart writes one.
 *
 * The preview is the point: a format you cannot see the result of is a
 * format you set by trial, on the board, in front of everybody.
 */
const NumberFields: React.FC<FieldProps> = ({ spec, patch }) => (
  <>
    <Row label="Format" stack>
      <QuickChips
        label="Number formats"
        options={NUMBER_PRESETS.map((p) => ({
          id: p.id,
          label: p.label,
          active: matchesPreset(spec, p),
          onClick: () => patch(p.patch),
        }))}
      />
    </Row>
    <div className="chartp-preview" aria-label="Preview">
      <span className="chartp-preview__raw">1250000</span>
      <ArrowRight size={12} aria-hidden="true" />
      <strong className="chartp-preview__out">{formatValue(1250000, spec)}</strong>
      <span className="chartp-preview__sep" aria-hidden="true" />
      <span className="chartp-preview__raw">0.4</span>
      <ArrowRight size={12} aria-hidden="true" />
      <strong className="chartp-preview__out">{formatValue(0.4, spec)}</strong>
    </div>
    <Row label="Affixes" hint="Written before and after every number">
      <Pair>
        <TextField label="Text before the number" placeholder="Before" value={spec.valuePrefix} onChange={(v) => patch({ valuePrefix: v })} />
        <TextField label="Text after the number" placeholder="After" value={spec.valueSuffix} onChange={(v) => patch({ valueSuffix: v })} />
      </Pair>
    </Row>
    {/* Empty is automatic — as many places as the tick step needs. A stepper
        showed that as 0 and wrote 0 on first touch. */}
    <Row label="Decimals">
      <OptionalNumber label="Decimal places" value={spec.decimals} min={0} max={6} integer onChange={(v) => patch({ decimals: v })} />
    </Row>
    <Row label="Large">
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
  </>
);

const SORT_ICON: Record<string, React.ReactNode> = {
  none: <List size={15} />,
  valueDesc: <ArrowDownWideNarrow size={15} />,
  valueAsc: <ArrowUpNarrowWide size={15} />,
  labelAsc: <ArrowDownAZ size={15} />,
};

/** What order the categories come in, and how many of them are shown. */
const OrderFields: React.FC<FieldProps> = ({ spec, patch }) => {
  const n = spec.categories.length;
  const byValue = spec.sort === 'valueDesc' || spec.sort === 'valueAsc';
  return (
    <>
      <Row label="Sort">
        <SegmentedControl
          fill
          ariaLabel="Category order"
          value={spec.sort ?? 'none'}
          onChange={(v) => patch({ sort: v === 'none' ? undefined : (v as ChartSpec['sort']) })}
          segments={CHART_SORTS.map((s) => ({ value: s, label: CHART_SORT_LABELS[s], icon: SORT_ICON[s], hint: CHART_SORT_LABELS[s] }))}
        />
      </Row>
      {byValue && spec.series.length > 1 && (
        <Dependent>
          <Row label="By" hint="Which number decides the order when there are several">
            <SegmentedControl
              fill
              ariaLabel="Sort key"
              value={spec.sortKey === 'total' || spec.sortKey === 'sum' ? 'total' : 'series'}
              onChange={(v) => patch({ sortKey: v === 'total' ? 'total' : undefined })}
              segments={[
                { value: 'series', label: spec.series[0]?.name || 'First', hint: 'The first series' },
                { value: 'total', label: 'Total', hint: 'The sum across every series' },
              ]}
            />
          </Row>
        </Dependent>
      )}
      {n > 3 && (
        <Row label="Show top" hint="The rest are gathered into a single ‘Other’">
          <OptionalNumber
            label="Categories shown"
            placeholder={`All ${n}`}
            value={spec.topN}
            min={2}
            max={n}
            integer
            onChange={(v) => patch({ topN: v === undefined || v >= n ? undefined : v })}
          />
        </Row>
      )}
    </>
  );
};

// ===========================================================================
// Labels
// ===========================================================================

/** The words on the chart, and which of its furniture shows. */
const LabelFields: React.FC<FieldProps & { can: ReturnType<typeof chartCapabilities>; axes: boolean }> = ({
  spec,
  patch,
  can,
  axes,
}) => {
  /**
   * What the chart will actually do, not what the spec happens to store.
   * Each switch reports — and writes the negation of — what is *drawn*, so
   * the first click always changes the picture.
   */
  const shown = resolveChartOptions(spec);
  const line = spec.kind === 'line' || spec.kind === 'area';

  return (
    <>
      <Row label="Title">
        <div className="chartp-inline">
          <TextField label="Title" placeholder="Untitled" value={spec.title} onChange={(v) => patch({ title: v })} />
          {/* The size arrives with a title rather than sitting there greyed out. */}
          {spec.title && (
            <span className="chartp-inline__fixed">
              <NumberStepper
                value={spec.titleSize ?? 16}
                min={9}
                max={48}
                suffix="px"
                aria-label="Title size"
                onChange={(v) => patch({ titleSize: v === 16 ? undefined : v })}
              />
            </span>
          )}
        </div>
      </Row>
      <Row label="Subtitle">
        <TextField label="Subtitle" placeholder="None" value={spec.subtitle} onChange={(v) => patch({ subtitle: v })} />
      </Row>
      <Row label="Footnote">
        <TextField label="Footnote" placeholder="Source or context" value={spec.footnote} onChange={(v) => patch({ footnote: v })} />
      </Row>
      {axes && (
        <>
          <Row label="X axis">
            <TextField label="Horizontal axis title" placeholder="e.g. Quarter" value={spec.xAxisLabel} onChange={(v) => patch({ xAxisLabel: v })} />
          </Row>
          <Row label="Y axis">
            <TextField label="Vertical axis title" placeholder="e.g. Revenue" value={spec.yAxisLabel} onChange={(v) => patch({ yAxisLabel: v })} />
          </Row>
        </>
      )}

      <Row label="Show" stack>
        <ToggleChips
          label="Chart furniture"
          options={[
            { id: 'legend', icon: <Tag size={13} />, label: 'Legend', on: shown.showLegend },
            ...(can.valueLabels ? [{ id: 'values', icon: <Hash size={13} />, label: 'Values', on: shown.showValues }] : []),
            ...(can.gridLines ? [{ id: 'grid', icon: <Grid3x3 size={13} />, label: 'Grid', on: shown.showGrid }] : []),
          ]}
          onToggle={(id) => {
            if (id === 'legend') patch({ showLegend: !shown.showLegend });
            else if (id === 'values') patch({ showValues: !shown.showValues });
            else patch({ showGrid: !shown.showGrid });
          }}
        />
      </Row>

      {shown.showLegend && (
        <Dependent>
          <Row label="Legend">
            <SegmentedControl
              fill
              ariaLabel="Legend position"
              value={spec.legendPosition === 'none' ? 'bottom' : spec.legendPosition ?? 'bottom'}
              onChange={(v) => patch({ legendPosition: v === 'bottom' ? undefined : (v as ChartSpec['legendPosition']) })}
              segments={[
                { value: 'top', label: 'Top', icon: <PanelTop size={15} />, hint: 'Above the plot' },
                { value: 'bottom', label: 'Bottom', icon: <PanelBottom size={15} />, hint: 'Below the plot' },
                { value: 'right', label: 'Right', icon: <PanelRight size={15} />, hint: 'Beside the plot' },
              ]}
            />
          </Row>
        </Dependent>
      )}

      {shown.showValues && can.valueLabels && (
        <Dependent>
          <Row label="Position" hint="Where each number sits against its mark">
            <SegmentedControl
              fill
              ariaLabel="Where value labels sit"
              value={spec.valuePlacement ?? 'auto'}
              onChange={(v) => patch({ valuePlacement: v === 'auto' ? undefined : (v as ChartSpec['valuePlacement']) })}
              segments={[
                { value: 'auto', label: 'Auto', icon: <Sparkles size={14} />, hint: 'Auto — inside where it fits, outside where it does not' },
                { value: 'inside', label: 'Inside', icon: <PlacementSpecimen at="inside" />, hint: 'Inside the end' },
                { value: 'outside', label: 'Outside', icon: <PlacementSpecimen at="outside" />, hint: 'Past the end' },
                { value: 'center', label: 'Centre', icon: <PlacementSpecimen at="center" />, hint: 'In the middle' },
              ]}
            />
          </Row>
          <Row label="Show as" hint="The number, its share of the total, or both">
            <SegmentedControl
              fill
              ariaLabel="What a value label says"
              value={spec.valueFormat ?? 'value'}
              onChange={(v) => patch({ valueFormat: v === 'value' ? undefined : (v as ChartSpec['valueFormat']) })}
              segments={[
                { value: 'value', label: '12' , hint: 'The value' },
                { value: 'percent', label: '%', hint: 'Its share of the total' },
                { value: 'both', label: '12 · %', hint: 'Both' },
              ]}
            />
          </Row>
          {/* Forty labels on a line is a wall of numbers; the high and the low
              are usually the story. */}
          {line && (
            <Row label="On" hint="Every reading, or only the highest and lowest">
              <SegmentedControl
                fill
                ariaLabel="Which points carry a value label"
                value={spec.extremesOnly ? 'extremes' : 'all'}
                onChange={(v) => patch({ extremesOnly: v === 'extremes' ? true : undefined })}
                segments={[
                  { value: 'all', label: 'All', hint: 'Every reading' },
                  { value: 'extremes', label: 'Extremes', hint: 'The high and the low' },
                ]}
              />
            </Row>
          )}
        </Dependent>
      )}
    </>
  );
};

// ===========================================================================
// Colour
// ===========================================================================

const ColourFields: React.FC<FieldProps & { can: ReturnType<typeof chartCapabilities> }> = ({ spec, patch, can }) => {
  const palette = resolveChartOptions(spec).palette;
  const byCategory = legendNamesCategories(spec.kind);
  const itemNoun =
    spec.kind === 'treemap' ? 'Tiles' : spec.kind === 'network' ? 'Nodes' : spec.kind === 'timeline' ? 'Rows' : 'Slices';
  const plot = isPlot(spec.kind);
  const curveOverrides = (spec.functions ?? []).some((c) => c.color);

  return (
    <>
      <Row label="Palette" stack>
        <PaletteGrid value={spec.paletteId ?? 'default'} onChange={(id) => patch({ paletteId: id === 'default' ? undefined : id })} />
      </Row>

      {(spec.kind === 'heatmap' || spec.kind === 'matrix') && <RampPicker spec={spec} patch={patch} />}

      {can.gradient && (
        <Row label="Fill" hint="Fade the area toward the baseline">
          <SegmentedControl
            fill
            ariaLabel="Area fill style"
            value={spec.gradient ? 'gradient' : 'solid'}
            onChange={(v) => patch({ gradient: v === 'gradient' ? true : undefined })}
            segments={[
              { value: 'solid', label: 'Solid' },
              { value: 'gradient', label: 'Fade' },
            ]}
          />
        </Row>
      )}

      {can.seriesColors && <SeriesColours spec={spec} patch={patch} />}

      {/* A pie and a funnel colour by *category*, so the swatches follow the
          categories — offering series colours there would be one swatch
          controlling every slice. They used the default palette whichever
          was chosen, so the key under the picker disagreed with the chart. */}
      {byCategory && (
        <>
          <SubHead label={itemNoun} />
          <div className="chartp-slices">
            {spec.categories.map((c, i) => (
              <span className="chartp-slice" key={i}>
                <SeriesKey color={palette[i % palette.length]} />
                <span className="chartp-slice__name">{c || `${itemNoun.slice(0, -1)} ${i + 1}`}</span>
              </span>
            ))}
          </div>
          <Note>{itemNoun} take the palette in order.</Note>
        </>
      )}

      {plot && curveOverrides && (
        <div className="chartp-caption">
          <span>Some curves have their own colour.</span>
          <button
            type="button"
            className="chartp-link"
            onClick={() => patch({ functions: (spec.functions ?? []).map(({ color: _c, ...rest }) => rest) })}
          >
            Use palette
          </button>
        </div>
      )}
    </>
  );
};

/**
 * Per-series colour, with the way back to the palette.
 *
 * A series given its own colour stops following the palette — so choosing a
 * palette after picking one colour by hand changed every series but that one,
 * with nothing saying why. Each overridden series now says so and can be
 * returned to the palette; all of them can be at once.
 */
const SeriesColours: React.FC<FieldProps> = ({ spec, patch }) => {
  const palette = resolveChartOptions(spec).palette;
  const overridden = spec.series.filter((s) => s.color).length;
  return (
    <>
      <SubHead
        label={spec.series.length > 1 ? 'Series' : 'Series colour'}
        action={
          overridden > 0 ? (
            <button
              type="button"
              className="chartp-link"
              onClick={() => patch({ series: spec.series.map(({ color: _c, ...rest }) => rest) })}
            >
              Use palette
            </button>
          ) : undefined
        }
      />
      <div className="chartp-serieslist">
        {spec.series.map((s, i) => (
          <div className="chartp-seriesrow" key={i}>
            <ColorPickerPopover
              color={seriesColor(s, i, palette)}
              onChange={(color) => patch({ series: spec.series.map((x, j) => (i === j ? { ...x, color } : x)) })}
            />
            <span className="chartp-seriesrow__name">{s.name || `Series ${i + 1}`}</span>
            {s.color ? (
              <IconAction
                label="Back to the palette colour"
                onClick={() => patch({ series: spec.series.map((x, j) => (i === j ? { ...x, color: undefined } : x)) })}
              >
                <RotateCcw size={12} />
              </IconAction>
            ) : (
              <span className="chartp-seriesrow__tag">Palette</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

/**
 * The colormap, shown rather than named. The swatches come from the same
 * `rampColor` the cells are painted with, so a strip cannot show a ramp the
 * surface does not use. Reversal applies to whichever is chosen rather than
 * doubling four entries into eight.
 */
const RampPicker: React.FC<FieldProps> = ({ spec, patch }) => {
  const current = spec.ramp ?? 'viridis';
  const reversed = spec.rampReversed ?? false;
  return (
    <>
      <Row label="Colours" stack>
        <div className="chartp-ramps" role="radiogroup" aria-label="Colour scale">
          {RAMP_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={current === id}
              className="chartp-ramp"
              onClick={() => patch({ ramp: id })}
            >
              <span className="chartp-ramp__strip" aria-hidden="true">
                {rampSwatches(id, 12, reversed).map((color, i) => (
                  <span key={i} style={{ background: color }} />
                ))}
              </span>
              <span className="chartp-ramp__name">{RAMP_LABELS[id]}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row label="Direction" stack hint="Put the heavy end of the colour where the heavy end of the meaning is">
        <SegmentedControl
          fill
          ariaLabel="Colour scale direction"
          value={reversed ? 'high-dark' : 'high-light'}
          onChange={(v) => patch({ rampReversed: v === 'high-dark' ? true : undefined })}
          segments={[
            { value: 'high-light', label: 'More is light', hint: 'The default: growth, density, count' },
            { value: 'high-dark', label: 'More is dark', hint: 'For a cost, an error or a depth' },
          ]}
        />
      </Row>
    </>
  );
};

// ===========================================================================
// Notes
// ===========================================================================

/**
 * Annotations the chart owns: a target line and a tolerance band.
 *
 * Each is an item — name, value at a glance, a way to remove it — with its
 * settings indented beneath, and what is not on the chart yet is offered once
 * at the foot. "Snap to" puts the line on the mean, median or an extreme of
 * everything drawn, and says which it is on.
 */
const ReferenceFields: React.FC<FieldProps & { allowBand?: boolean }> = ({ spec, patch, allowBand = true }) => {
  const ref = spec.reference;
  const band = spec.toleranceBand;
  const stats = summarise(spec);

  return (
    <>
      {ref && (
        <div className="chartp-annot">
          <ItemHead
            glyph={<TargetLineGlyph />}
            title={ref.label || 'Target line'}
            meta={formatValue(ref.value, spec)}
            onRemove={() => patch({ reference: undefined })}
            removeLabel="Remove the target line"
          />
          <Dependent>
            <Row label="Value">
              <NumberStepper value={ref.value} aria-label="Target value" onChange={(v) => patch({ reference: { ...ref, value: v } })} />
            </Row>
            {stats && (
              <Row label="Snap to" stack>
                <QuickChips
                  label="Snap the line to"
                  options={(['mean', 'median', 'min', 'max'] as const).map((k) => ({
                    id: k,
                    label: k === 'mean' ? 'Mean' : k === 'median' ? 'Median' : k === 'min' ? 'Min' : 'Max',
                    hint: formatValue(stats[k], spec),
                    active: near(ref.value, stats[k]),
                    onClick: () => patch({ reference: { ...ref, value: stats[k] } }),
                  }))}
                />
              </Row>
            )}
            <Row label="Label">
              <TextField label="Target label" placeholder="Target" value={ref.label} onChange={(v) => patch({ reference: { ...ref, label: v } })} />
            </Row>
            <Row label="Line">
              <div className="chartp-inline">
                <ColorPickerPopover color={ref.color ?? '#EF4444'} onChange={(color) => patch({ reference: { ...ref, color } })} />
                <SegmentedControl
                  fill
                  ariaLabel="Target line style"
                  value={ref.style ?? 'dashed'}
                  onChange={(v) => patch({ reference: { ...ref, style: v === 'solid' ? 'solid' : undefined } })}
                  segments={[
                    { value: 'dashed', label: 'Dashed', icon: <StrokeStyleIcon style="dashed" />, hint: 'Dashed reads as a note on the data' },
                    { value: 'solid', label: 'Solid', icon: <StrokeStyleIcon style="solid" />, hint: 'Solid reads as data' },
                  ]}
                />
              </div>
            </Row>
          </Dependent>
        </div>
      )}

      {band && (
        <div className="chartp-annot">
          <ItemHead
            glyph={<BandGlyph />}
            title={band.label || 'Band'}
            meta={`${formatValue(band.min, spec)} – ${formatValue(band.max, spec)}`}
            onRemove={() => patch({ toleranceBand: undefined })}
            removeLabel="Remove the band"
          />
          <Dependent>
            <Row label="Range">
              <Pair>
                <NumberStepper glyph={<span className="chartp-glyphtext">min</span>} aria-label="Band minimum" value={band.min} onChange={(v) => patch({ toleranceBand: { ...band, min: v } })} />
                <NumberStepper glyph={<span className="chartp-glyphtext">max</span>} aria-label="Band maximum" value={band.max} onChange={(v) => patch({ toleranceBand: { ...band, max: v } })} />
              </Pair>
            </Row>
            <Row label="Label">
              <TextField label="Band label" placeholder="Tolerance" value={band.label} onChange={(v) => patch({ toleranceBand: { ...band, label: v } })} />
            </Row>
            <Row label="Colour">
              <ColorPickerPopover color={band.color ?? '#10B981'} onChange={(color) => patch({ toleranceBand: { ...band, color } })} />
            </Row>
          </Dependent>
        </div>
      )}

      {(!ref || (!band && allowBand)) && (
        <div className="chartp-addrow">
          {!ref && (
            <AddButton
              icon={<TargetLineGlyph />}
              onClick={() => patch({ reference: { value: stats?.mean ?? 0, label: 'Target' } })}
            >
              Target line
            </AddButton>
          )}
          {!band && allowBand && (
            <AddButton
              icon={<BandGlyph />}
              onClick={() => {
                const centre = ref?.value ?? stats?.mean ?? 10;
                const half = stats ? Math.max(1, Math.round(((stats.max - stats.min) / 10) * 100) / 100) : 5;
                patch({ toleranceBand: { min: centre - half, max: centre + half, label: 'Tolerance', color: '#10B981' } });
              }}
            >
              Band
            </AddButton>
          )}
        </div>
      )}
    </>
  );
};

/**
 * Reading the first curve: roots, turning points, area and derivative, the
 * definite integral over a chosen interval, and Riemann strips.
 *
 * Found values are listed and copy on a press — with the press confirmed,
 * which it never was — so a root read off the chart can go straight into a
 * note or another formula.
 */
const AnalysisFields: React.FC<FieldProps> = ({ spec, patch }) => {
  const [notice, say] = useNotice();
  const d = defaultPlotDomain(spec.kind);
  const xMin = spec.xMin ?? d.xMin ?? -10;
  const xMax = spec.xMax ?? d.xMax ?? 10;
  const primary = spec.functions?.[0];

  const parsed = React.useMemo(() => {
    if (!primary?.source) return null;
    const res = parseExpression(primary.source, ['x']);
    return res.ok ? (x: number) => res.expression.evaluate(x) : null;
  }, [primary?.source]);

  const analysis = React.useMemo(() => {
    if (!parsed) return null;
    const sampleOver = (a: number, b: number, n: number): Sample[] => {
      const out: Sample[] = [];
      const step = (b - a) / n;
      for (let i = 0; i <= n; i++) {
        const x = a + i * step;
        try {
          const y = parsed(x);
          out.push({ x, y: Number.isFinite(y) ? y : null });
        } catch {
          out.push({ x, y: null });
        }
      }
      return out;
    };
    const samples = sampleOver(xMin, xMax, Math.min(300, spec.samples ?? 160));
    const roots = spec.showRoots ? findRoots(samples, parsed) : [];
    const extrema = spec.showExtrema ? findExtrema(samples) : [];
    let integral: number | null = null;
    if (spec.integralBounds) {
      const { a, b } = spec.integralBounds;
      const res = integrate(sampleOver(Math.min(a, b), Math.max(a, b), 240));
      integral = res.complete ? res.value * (a <= b ? 1 : -1) : null;
    }
    return { roots, extrema, integral };
  }, [parsed, xMin, xMax, spec.samples, spec.showRoots, spec.showExtrema, spec.integralBounds]);

  const copy = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => say(`Copied ${text}`))
      .catch(() => say('Clipboard unavailable'));
  };

  const r3 = (n: number) => Number(n.toFixed(3));

  return (
    <>
      <Row label="Mark" stack>
        <ToggleChips
          label="Features of the curve"
          columns={2}
          options={[
            { id: 'roots', icon: <RootsGlyph />, label: 'Roots', on: !!spec.showRoots, hint: 'Where the curve crosses zero' },
            { id: 'extrema', icon: <ExtremaGlyph />, label: 'Turning points', on: !!spec.showExtrema, hint: 'Local highs and lows' },
            { id: 'area', icon: <AreaGlyph />, label: 'Area', on: !!spec.fillArea, hint: 'Shade to the axis, and report the signed area' },
            { id: 'derivative', icon: <DerivativeGlyph />, label: 'Derivative', on: !!spec.showDerivative, hint: 'The slope, drawn alongside' },
          ]}
          onToggle={(id) => {
            if (id === 'roots') patch({ showRoots: !spec.showRoots || undefined });
            else if (id === 'extrema') patch({ showExtrema: !spec.showExtrema || undefined });
            else if (id === 'area') patch({ fillArea: !spec.fillArea || undefined });
            else patch({ showDerivative: !spec.showDerivative || undefined });
          }}
        />
      </Row>

      {analysis && spec.showRoots && (
        <Readout label="Roots">
          {analysis.roots.length === 0 ? (
            <span className="chartp-readout__none">None in view</span>
          ) : (
            analysis.roots.slice(0, 8).map((r, i) => (
              <button key={i} type="button" className="chartp-value" data-tooltip="Copy" onClick={() => copy(String(r3(r)))}>
                {r3(r)}
              </button>
            ))
          )}
        </Readout>
      )}
      {analysis && spec.showExtrema && (
        <Readout label="Turning">
          {analysis.extrema.length === 0 ? (
            <span className="chartp-readout__none">None in view</span>
          ) : (
            analysis.extrema.slice(0, 6).map((e, i) => (
              <button
                key={i}
                type="button"
                className="chartp-value"
                data-kind={e.kind}
                data-tooltip={`${e.kind === 'max' ? 'High' : 'Low'} — copy`}
                onClick={() => copy(`(${r3(e.x)}, ${r3(e.y)})`)}
              >
                ({Number(e.x.toFixed(2))}, {Number(e.y.toFixed(2))})
              </button>
            ))
          )}
        </Readout>
      )}

      <Row label="Integral" hint="The signed area under the curve between a and b">
        <Pair>
          <OptionalNumber
            label="Lower bound a"
            glyph="a"
            placeholder={niceBound(xMin)}
            value={spec.integralBounds?.a}
            onChange={(v) =>
              patch({
                integralBounds:
                  v === undefined && spec.integralBounds?.b === undefined
                    ? undefined
                    : { a: v ?? xMin, b: spec.integralBounds?.b ?? xMax },
              })
            }
          />
          <OptionalNumber
            label="Upper bound b"
            glyph="b"
            placeholder={niceBound(xMax)}
            value={spec.integralBounds?.b}
            onChange={(v) =>
              patch({
                integralBounds:
                  v === undefined && spec.integralBounds?.a === undefined
                    ? undefined
                    : { a: spec.integralBounds?.a ?? xMin, b: v ?? xMax },
              })
            }
          />
        </Pair>
      </Row>
      {spec.integralBounds && (
        <div className="chartp-caption">
          <span className="chartp-integral">
            ∫ = <strong>{analysis?.integral != null ? analysis.integral.toFixed(4) : '—'}</strong>
          </span>
          <button type="button" className="chartp-link" onClick={() => patch({ integralBounds: undefined })}>
            Clear
          </button>
        </div>
      )}

      <Row label="Strips" hint="Riemann rectangles: which corner of each strip meets the curve">
        <SegmentedControl
          fill
          ariaLabel="Riemann rectangles"
          value={spec.riemann ? spec.riemann.mode : 'off'}
          onChange={(v) =>
            patch({
              riemann: v === 'off' ? undefined : { n: spec.riemann?.n ?? 12, mode: v as 'left' | 'right' | 'midpoint' },
            })
          }
          segments={[
            { value: 'off', label: 'Off', hint: 'No strips' },
            { value: 'left', label: 'Left', icon: <RiemannSpecimen mode="left" />, hint: 'Left corner meets the curve' },
            { value: 'midpoint', label: 'Midpoint', icon: <RiemannSpecimen mode="midpoint" />, hint: 'Midpoint meets the curve' },
            { value: 'right', label: 'Right', icon: <RiemannSpecimen mode="right" />, hint: 'Right corner meets the curve' },
          ]}
        />
      </Row>
      {spec.riemann && (
        <Dependent>
          <Row label="Count">
            <NumberStepper
              value={spec.riemann.n}
              min={1}
              max={200}
              aria-label="Strip count"
              onChange={(n) => patch({ riemann: { ...spec.riemann!, n } })}
            />
          </Row>
          <Note>Left and right sums bracket the true area, and close on it as the count rises.</Note>
        </Dependent>
      )}

      <span className="chartp-sr" role="status" aria-live="polite">
        {notice}
      </span>
      {notice && <div className="chartp-toast" aria-hidden="true">{notice}</div>}
    </>
  );
};

/** The seeds a field draws its solution curves from. */
const SeedFields: React.FC<FieldProps> = ({ spec, patch }) => {
  const count = spec.seedPoints?.length ?? 0;
  return (
    <>
      <div className="chartp-item">
        <span className="chartp-item__glyph" aria-hidden="true">
          <SeedGlyph />
        </span>
        <span className="chartp-item__title">
          {count === 0 ? 'No solution curves' : `${count} solution ${count === 1 ? 'curve' : 'curves'}`}
        </span>
        {count > 0 && (
          <button type="button" className="chartp-link" onClick={() => patch({ seedPoints: undefined })}>
            Clear
          </button>
        )}
      </div>
      <Note>
        <kbd>Alt</kbd>-click the field to drop a curve through that point.
      </Note>
    </>
  );
};
