import React from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowLeftRight,
  ArrowUpNarrowWide,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FileUp,
  Globe,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Rows3,
  Table as TableIcon,
  X,
} from 'lucide-react';
import './sheet/sheet.css';
import { useStore } from '../hooks/useStore';
import type { ChartNode } from '../engine/model/schema';
import type { ChartSpec, ChartSeries } from '../engine/chart/chartTypes';
import { getPaletteColors, isSampleKind, seriesColor } from '../engine/chart/chartTypes';
import { CHART_LABELS } from '../engine/chart/chartKinds';
import { updateChart } from '../engine/chart/chartApply';
import { chartToSvg } from '../engine/chart/chartSvg';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  parseDelimited,
  parseNumber,
  withChartData,
} from '../engine/chart/chartCsv';
import { POLL_INTERVALS, POLL_LABELS, syncFromUrl } from '../engine/chart/chartSync';
import { liveStatus, setLiveInterval, subscribeLive } from '../engine/chart/chartLiveSync';
import { ChartKindIcon } from './workspace/chartIcons';
import { SeriesSwatch } from './SeriesSwatch';
import { columnLetter, useSheet, type SheetRange } from './sheet/useSheet';

/**
 * The chart's data, as a real spreadsheet — and where the numbers come from.
 *
 * ## What the sheet was, and why it is rebuilt
 *
 * It was a `<table>` of always-live inputs, one per cell, with a keyboard
 * handler bolted onto each. That gave exactly one cell at a time and nothing
 * else a spreadsheet is for: no range to select, so no copying a block out and
 * no pasting one in (a paste replaced the whole table through a separate text
 * box); no deleting a range; no inserting a row between two others; no idea
 * what the numbers you had selected added up to. It also wrote **zero** into
 * every cell of a new row or series, and turned holes into zeros on
 * transpose — silently breaking the rule the chart model rests on, that a
 * missing reading is not a measured nought.
 *
 * And for the box plot, density and histogram — whose data is raw samples,
 * not categories — it showed an empty sheet with nowhere to type.
 *
 * ## What it is now
 *
 * The same spreadsheet behaviour as the board's table editor (`useSheet`):
 * click and drag to select, Shift to extend, type to replace, Enter to edit,
 * Tab across, Ctrl+C / Ctrl+V with real TSV to and from Excel and Sheets, a
 * single value pasted over a range fills it, Delete clears. On top of that:
 *
 * - **A name box and formula bar**, showing the cell and its exact value.
 * - **Selection stats** — sum, average, count, min, max — as a spreadsheet's
 *   status bar has them, because "what do these add up to" is the question
 *   you are usually asking when you select numbers.
 * - **Rows and series in place**: insert above or below, delete a selection,
 *   sort the rows by any column.
 * - **A live preview** of the chart beside the numbers, so an edit is seen
 *   where it lands without closing the dialog.
 * - **The right shape for every kind**: sample kinds get one column per group
 *   and a free row at the bottom to type into; a network's table stays square,
 *   its column names following its row names.
 *
 * Every write is still one document update per commit, never per keystroke.
 */

interface Props {
  nodeId: string;
  onClose: () => void;
}

type Tab = 'grid' | 'source';

export const ChartDataModal: React.FC<Props> = ({ nodeId, onClose }) => {
  const node = useStore((s) => s.objects[nodeId]) as ChartNode | undefined;
  /**
   * The live registry is module state; `useSyncExternalStore` rather than a
   * mirror of it, which would go stale the moment a tick lands.
   */
  const live = React.useSyncExternalStore(subscribeLive, () => liveStatus(nodeId), () => undefined);
  /** Read out of the store when a refresh tick runs, never closed over. */
  const readSpec = React.useCallback((id: string) => {
    const target = useStore.getState().objects[id];
    return target && target.type === 'chart' ? target.chart : null;
  }, []);

  if (!node || node.type !== 'chart') return null;
  return <DataDialog node={node} onClose={onClose} live={live} readSpec={readSpec} />;
};

const DataDialog: React.FC<{
  node: ChartNode;
  onClose: () => void;
  live: ReturnType<typeof liveStatus>;
  readSpec: (id: string) => ChartSpec | null;
}> = ({ node, onClose, live, readSpec }) => {
  const nodeId = node.id;
  const spec = node.chart;
  const kind = spec.kind;
  const samples = isSampleKind(kind);
  const network = kind === 'network';
  const categories = spec.categories ?? [];
  const series = spec.series ?? [];
  const palette = getPaletteColors(spec.paletteId);

  const [tab, setTab] = React.useState<Tab>('grid');
  const [syncing, setSyncing] = React.useState(false);
  const [preview, setPreview] = React.useState(true);
  const [notice, setNotice] = React.useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const noticeTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const say = (tone: 'ok' | 'bad', text: string) => {
    setNotice({ tone, text });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  };

  // Escape closes when the sheet has not already used it (it stops what it
  // handles, so this only hears an Escape nothing else wanted).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** The spec as it is now — writes read this, so a burst never loses one. */
  const now = (): ChartSpec => {
    const n = useStore.getState().objects[nodeId];
    return n && n.type === 'chart' ? n.chart : spec;
  };
  const commit = (next: ChartSpec) => updateChart(nodeId, next);

  // ------------------------------------------------------------- the shape

  /** Column 0 names the rows, except for sample kinds, which have none. */
  const hasLabels = !samples;
  const cols = (hasLabels ? 1 : 0) + series.length;
  const seriesAt = (c: number) => (hasLabels ? c - 1 : c);
  // Sample kinds keep one free row under the longest group to type into.
  const rows = samples ? Math.max(...series.map((s) => s.values.length), 0) + 1 : Math.max(1, categories.length);

  /** Series values made exactly `n` long, holes kept as holes. */
  const fit = (values: Array<number | null>, n: number) => Array.from({ length: n }, (_, i) => values[i] ?? null);
  /** A sample group without the empty tail the free row leaves behind. */
  const trim = (values: Array<number | null>) => {
    let end = values.length;
    while (end > 0 && values[end - 1] === null) end -= 1;
    return values.slice(0, end);
  };

  const read = (r: number, c: number): string => {
    const si = seriesAt(c);
    if (si < 0) return categories[r] ?? '';
    const v = series[si]?.values[r];
    return v === null || v === undefined ? '' : String(v);
  };

  /** Write a block of text in from (r0, c0), growing the table as needed. */
  const writeBlock = (r0: number, c0: number, block: string[][]) => {
    const cur = now();
    const cats = [...cur.categories];
    let ser: ChartSeries[] = cur.series.map((s) => ({ ...s, values: [...s.values] }));
    const rejected: string[] = [];

    if (!samples) while (cats.length < r0 + block.length) cats.push(`Item ${cats.length + 1}`);

    block.forEach((line, dr) =>
      line.forEach((text, dc) => {
        const r = r0 + dr;
        const si = seriesAt(c0 + dc);
        if (si < 0) {
          cats[r] = text;
          // A network's columns are its nodes: renaming a row renames its column.
          if (network && ser[r]) ser[r] = { ...ser[r], name: text };
          return;
        }
        if (network && si >= cats.length) return;
        while (si >= ser.length) ser.push({ name: `Series ${ser.length + 1}`, values: [] });
        const t = text.trim();
        const v = t === '' ? null : parseNumber(t);
        // Not a number is refused and said, never written as a hole: a typo
        // must not quietly erase the reading it was typed over.
        if (t !== '' && v === null) {
          rejected.push(t);
          return;
        }
        const values = ser[si].values;
        while (values.length <= r) values.push(null);
        values[r] = v;
      })
    );

    if (samples) ser = ser.map((s) => ({ ...s, values: trim(s.values) }));
    else {
      if (network) {
        while (ser.length < cats.length) ser.push({ name: cats[ser.length], values: [] });
        ser = ser.slice(0, cats.length).map((s, i) => ({ ...s, name: cats[i] }));
      }
      ser = ser.map((s) => ({ ...s, values: fit(s.values, cats.length) }));
    }
    commit({ ...cur, categories: samples ? cur.categories : cats, series: ser });
    if (rejected.length) say('bad', `“${rejected[0]}” is not a number, so that cell was left as it was.`);
  };

  const clear = (range: SheetRange) =>
    writeBlock(
      range.r0,
      range.c0,
      Array.from({ length: range.r1 - range.r0 + 1 }, () => Array.from({ length: range.c1 - range.c0 + 1 }, () => ''))
    );

  // ---------------------------------------------------------- rows & series

  const insertRows = (at: number, count = 1) => {
    const cur = now();
    if (samples) {
      commit({ ...cur, series: cur.series.map((s) => ({ ...s, values: trim(s.values.toSpliced(at, 0, ...Array(count).fill(null))) })) });
      return;
    }
    const names = Array.from({ length: count }, (_, i) => `Item ${cur.categories.length + i + 1}`);
    const cats = cur.categories.toSpliced(at, 0, ...names);
    let ser = cur.series.map((s) => ({ ...s, values: fit(s.values, cur.categories.length).toSpliced(at, 0, ...Array(count).fill(null)) }));
    if (network) {
      ser = ser.map((s) => ({ ...s, values: fit(s.values, cats.length) }));
      const added = names.map((name) => ({ name, values: cats.map(() => null) as Array<number | null> }));
      ser.splice(at, 0, ...added);
      ser = ser.map((s, i) => ({ ...s, name: cats[i], values: i < at || i >= at + count ? s.values.toSpliced(at, 0, ...Array(count).fill(null)).slice(0, cats.length) : s.values }));
    }
    commit({ ...cur, categories: cats, series: ser });
  };

  const deleteRows = (r0: number, r1: number) => {
    const cur = now();
    const keep = (i: number) => i < r0 || i > r1;
    if (samples) {
      commit({ ...cur, series: cur.series.map((s) => ({ ...s, values: trim(s.values.filter((_, i) => keep(i))) })) });
      return;
    }
    if (cur.categories.length - (r1 - r0 + 1) < 1) {
      say('bad', 'A chart keeps at least one row.');
      return;
    }
    let ser = cur.series.map((s) => ({ ...s, values: s.values.filter((_, i) => keep(i)) }));
    if (network) ser = ser.filter((_, i) => keep(i));
    commit({ ...cur, categories: cur.categories.filter((_, i) => keep(i)), series: ser });
  };

  const addSeries = () => {
    const cur = now();
    commit({
      ...cur,
      series: [
        ...cur.series,
        { name: samples ? `Group ${cur.series.length + 1}` : `Series ${cur.series.length + 1}`, values: samples ? [] : cur.categories.map(() => null) },
      ],
    });
  };

  const deleteSeries = (si: number) => {
    const cur = now();
    if (cur.series.length <= 1) return;
    commit({ ...cur, series: cur.series.filter((_, i) => i !== si) });
  };

  /**
   * Put the rows in order by one column, carrying every series with them.
   *
   * An edit to the data, not a view: this is the data sheet, where the order
   * rows are stored in is the thing being edited. (The chart's own Sort is the
   * view, and leaves this order alone.)
   */
  const sortRows = (c: number, dir: 1 | -1) => {
    const cur = now();
    const si = seriesAt(c);
    if (samples) {
      if (si < 0) return;
      commit({
        ...cur,
        series: cur.series.map((s, i) =>
          i === si ? { ...s, values: [...s.values].sort((a, b) => (a === null ? 1 : b === null ? -1 : (a - b) * dir)) } : s
        ),
      });
      return;
    }
    const order = cur.categories.map((_, i) => i);
    order.sort((a, b) => {
      if (si < 0) return cur.categories[a].localeCompare(cur.categories[b], undefined, { numeric: true }) * dir;
      const va = cur.series[si]?.values[a] ?? null;
      const vb = cur.series[si]?.values[b] ?? null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * dir;
    });
    let ser = cur.series.map((s) => ({ ...s, values: order.map((i) => s.values[i] ?? null) }));
    if (network) ser = order.map((i) => ser[i]);
    commit({ ...cur, categories: order.map((i) => cur.categories[i]), series: ser });
    say('ok', `Sorted by ${si < 0 ? 'label' : cur.series[si]?.name || columnLetter(c)}.`);
  };

  /** Swap rows for columns — keeping holes as holes, which it used to zero. */
  const transpose = () => {
    const cur = now();
    if (cur.categories.length === 0 || cur.series.length === 0) return;
    commit({
      ...cur,
      categories: cur.series.map((s) => s.name),
      series: cur.categories.map((name, row) => ({ name, values: cur.series.map((s) => s.values[row] ?? null) })),
    });
  };

  // --------------------------------------------------------------- the sheet

  const sheet = useSheet({
    rows,
    cols: Math.max(1, cols),
    read,
    write: (r, c, text) => writeBlock(r, c, [[text]]),
    writeBlock,
    clear,
    appendRow: samples ? undefined : () => insertRows(now().categories.length),
    onExit: onClose,
  });

  const focusRef = React.useRef<HTMLDivElement>(null);
  // Keep the focused cell in view as the keyboard walks off the edge.
  React.useEffect(() => {
    focusRef.current?.querySelector<HTMLElement>(`[data-cell="${sheet.focus.r}:${sheet.focus.c}"]`)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [sheet.focus.r, sheet.focus.c]);

  /** What the name box says: `B3`, and the column's own name beside it. */
  const cellName = `${columnLetter(sheet.focus.c)}${sheet.focus.r + 1}`;
  const focusSeries = seriesAt(sheet.focus.c);
  const columnTitle = focusSeries < 0 ? 'Label' : series[focusSeries]?.name || columnLetter(sheet.focus.c);

  /** The formula bar edits the focused cell, and follows the selection. */
  const [bar, setBar] = React.useState<string | null>(null);
  const barValue = bar ?? read(sheet.focus.r, sheet.focus.c);

  const stats = React.useMemo(() => {
    const nums: number[] = [];
    for (let r = sheet.range.r0; r <= sheet.range.r1; r++) {
      for (let c = sheet.range.c0; c <= sheet.range.c1; c++) {
        const si = seriesAt(c);
        if (si < 0) continue;
        const v = series[si]?.values[r];
        if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
      }
    }
    if (nums.length === 0) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return { count: nums.length, sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) };
    // `seriesAt` is a pure function of `hasLabels`, listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.range, series, hasLabels]);

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

  // The preview is the one expensive thing on this sheet — a whole chart laid
  // out and serialised — and it can trail the grid by a frame without anyone
  // noticing. Deferred, a burst of typing or a paste never waits on it: React
  // renders the grid first and redraws the preview when it has time.
  const previewSpec = React.useDeferredValue(spec);
  const previewMarkup = React.useMemo(
    () =>
      preview
        ? chartToSvg(previewSpec, 340, 230, {
            id: `${nodeId}-sheet`,
            sketch: node.appearance?.sketch,
            sketchSeed: node.appearance?.sketchSeed,
          })
        : '',
    [preview, previewSpec, nodeId, node.appearance?.sketch, node.appearance?.sketchSeed]
  );

  // ------------------------------------------------------------------- CSV

  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      replaceFrom(await file.text(), file.name);
    };
    input.click();
  };

  /** Replace the table with a delimited text: a file, or the clipboard. */
  const replaceFrom = (text: string, source: string) => {
    const cur = now();
    if (samples) {
      // Groups are columns: the first row names them, the rest are readings.
      const grid = parseDelimited(text).filter((r) => r.some((v) => v.trim() !== ''));
      if (grid.length < 2) return say('bad', `No samples in ${source}.`);
      const width = Math.max(...grid.map((r) => r.length));
      const groups = Array.from({ length: width }, (_, c) => ({
        name: grid[0][c]?.trim() || `Group ${c + 1}`,
        values: grid.slice(1).map((r) => parseNumber(r[c] ?? '')).filter((v): v is number => v !== null),
      })).filter((g) => g.values.length > 0);
      if (groups.length === 0) return say('bad', `No numbers in ${source}.`);
      commit({ ...cur, series: groups });
      say('ok', `Read ${groups.length} ${groups.length === 1 ? 'group' : 'groups'} from ${source}.`);
      return;
    }
    const data = parseChartData(text);
    if (data.categories.length === 0) return say('bad', `No table could be read from ${source}.`);
    commit(withChartData(cur, data));
    say('ok', `Read ${data.categories.length} rows from ${source}.`);
  };

  const replaceFromClipboard = async () => {
    try {
      replaceFrom(await navigator.clipboard.readText(), 'the clipboard');
    } catch {
      say('bad', 'The clipboard is not available here — select a cell and press Ctrl+V instead.');
    }
  };

  const copyCsv = () =>
    navigator.clipboard
      .writeText(chartToCsv(spec))
      .then(() => say('ok', 'Copied as CSV.'))
      .catch(() => say('bad', 'The clipboard is not available here — use Download instead.'));

  // ------------------------------------------------------------------ live

  const source = spec.dataSource ?? {};
  const patchSource = (patch: Partial<NonNullable<ChartSpec['dataSource']>>) =>
    commit({ ...now(), dataSource: { ...source, ...patch } });

  const syncNow = async () => {
    if (!source.url) return;
    setSyncing(true);
    setNotice(null);
    const result = await syncFromUrl(source.url, source.dataPath);
    setSyncing(false);
    if (result.ok) {
      updateChart(nodeId, {
        ...withChartData(now(), result.data),
        dataSource: { ...source, lastSyncedAt: Date.now(), syncError: undefined },
      });
      say('ok', `Synced ${result.rows} rows.`);
    } else {
      patchSource({ syncError: result.error });
      say('bad', result.error);
    }
  };

  // ------------------------------------------------------------------ render

  const template = `44px ${hasLabels ? 'minmax(160px, 200px) ' : ''}repeat(${series.length}, minmax(112px, 136px)) 1fr`;
  const selectedRows = `${sheet.range.r0 + 1}${sheet.range.r1 > sheet.range.r0 ? `–${sheet.range.r1 + 1}` : ''}`;

  return (
    <div className="export-scrim" onPointerDown={onClose} role="presentation">
      <div
        className="cdm cdm--sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Chart data"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="cdm__head">
          <div className="cdm__title">
            <TableIcon size={15} aria-hidden />
            <span>{spec.title?.trim() || 'Chart data'}</span>
            <span className="dsheet-kind">
              <ChartKindIcon kind={kind} size={13} />
              {CHART_LABELS[kind]}
            </span>
          </div>

          <div className="cdm__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'grid'} className="cdm__tab" data-active={tab === 'grid' || undefined} onClick={() => setTab('grid')}>
              Sheet
            </button>
            <button type="button" role="tab" aria-selected={tab === 'source'} className="cdm__tab" data-active={tab === 'source' || undefined} onClick={() => setTab('source')}>
              Source
              {live?.interval ? <span className="cdm__pip" aria-label="refreshing" /> : null}
            </button>
          </div>

          <button type="button" className="cdm__close" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        {tab === 'grid' ? (
          <>
            <div className="cdm__bar">
              <div className="cdm__barGroup">
                <button type="button" className="cdm__btn" onClick={() => insertRows(sheet.range.r0)} data-tooltip="Insert a row above the selection">
                  <BetweenHorizontalStart size={13} /> Above
                </button>
                <button type="button" className="cdm__btn" onClick={() => insertRows(sheet.range.r1 + 1)} data-tooltip="Insert a row below the selection">
                  <BetweenHorizontalEnd size={13} /> Below
                </button>
                {!network && (
                  <button type="button" className="cdm__btn" onClick={addSeries}>
                    <Plus size={13} /> {samples ? 'Group' : 'Series'}
                  </button>
                )}
                <button
                  type="button"
                  className="cdm__btn"
                  onClick={() => deleteRows(sheet.range.r0, sheet.range.r1)}
                  data-tooltip={`Delete row${sheet.range.r1 > sheet.range.r0 ? 's' : ''} ${selectedRows}`}
                >
                  <Rows3 size={13} /> Delete
                </button>
              </div>

              <div className="cdm__barGroup">
                <button type="button" className="cdm__btn" onClick={() => sortRows(sheet.focus.c, 1)} data-tooltip={`Sort rows by ${columnTitle}, smallest first`}>
                  <ArrowUpNarrowWide size={13} />
                </button>
                <button type="button" className="cdm__btn" onClick={() => sortRows(sheet.focus.c, -1)} data-tooltip={`Sort rows by ${columnTitle}, largest first`}>
                  <ArrowDownWideNarrow size={13} />
                </button>
                {!samples && !network && (
                  <button type="button" className="cdm__btn" onClick={transpose} data-tooltip="Swap what names the rows for what names the columns">
                    <ArrowLeftRight size={13} /> Transpose
                  </button>
                )}
              </div>

              <div className="cdm__barGroup">
                <button type="button" className="cdm__btn" onClick={importFile}>
                  <FileUp size={13} /> Import
                </button>
                <button type="button" className="cdm__btn" onClick={() => void replaceFromClipboard()} data-tooltip="Replace the whole table with what is on the clipboard">
                  <ClipboardPaste size={13} /> Replace
                </button>
                <button type="button" className="cdm__btn" onClick={() => void copyCsv()}>
                  <Copy size={13} /> Copy
                </button>
                <button type="button" className="cdm__btn" onClick={() => downloadCsv(spec, csvFilename(spec.title))}>
                  <Download size={13} /> CSV
                </button>
                <button
                  type="button"
                  className="cdm__btn"
                  aria-pressed={preview}
                  data-active={preview || undefined}
                  onClick={() => setPreview((v) => !v)}
                  data-tooltip={preview ? 'Hide the preview' : 'Show the chart beside the numbers'}
                >
                  {preview ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
                </button>
              </div>
            </div>

            {/* The name box and the formula bar: which cell, and exactly what
                is in it — the full value, not the one cut to the cell. */}
            <div className="dsheet-fx">
              <span className="dsheet-fx__name" title={columnTitle}>
                {cellName}
              </span>
              <span className="dsheet-fx__col">{columnTitle}</span>
              <input
                className="dsheet-fx__input"
                value={barValue}
                spellCheck={false}
                aria-label={`Value of ${cellName}`}
                placeholder={focusSeries < 0 ? 'A label' : 'A number, or empty for no reading'}
                onChange={(e) => setBar(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    if (bar !== null) writeBlock(sheet.focus.r, sheet.focus.c, [[bar]]);
                    setBar(null);
                    sheet.select({ r: sheet.focus.r + 1, c: sheet.focus.c });
                    sheet.focusSink();
                  } else if (e.key === 'Escape') {
                    setBar(null);
                    sheet.focusSink();
                  }
                }}
                onBlur={() => {
                  if (bar !== null) writeBlock(sheet.focus.r, sheet.focus.c, [[bar]]);
                  setBar(null);
                }}
              />
            </div>

            <div className="dsheet-body">
              <div className="dsheet" ref={focusRef}>
                <div className="dsheet__grid" style={{ gridTemplateColumns: template }}>
                  <div className="dsheet__corner" onPointerDown={(e) => { e.preventDefault(); sheet.select({ r: 0, c: 0 }); sheet.selectRow(0); }} />
                  {Array.from({ length: cols }, (_, c) => {
                    const si = seriesAt(c);
                    const s = si >= 0 ? series[si] : null;
                    const inCol = c >= sheet.range.c0 && c <= sheet.range.c1;
                    return (
                      <div
                        key={`h${c}`}
                        className="dsheet__colhead"
                        data-selected={inCol || undefined}
                        data-label={si < 0 || undefined}
                        onPointerDown={(e) => {
                          if ((e.target as HTMLElement).closest('input,button')) return;
                          e.preventDefault();
                          sheet.selectCol(c, e.shiftKey);
                        }}
                      >
                        <span className="dsheet__letter">{columnLetter(c)}</span>
                        {si < 0 ? (
                          <span className="dsheet__colname dsheet__colname--static">{network ? 'Node' : kind === 'timeline' ? 'Item' : 'Label'}</span>
                        ) : (
                          <>
                            <SeriesSwatch
                              label={s!.name || `Series ${si + 1}`}
                              value={seriesColor(s!, si, palette)}
                              palette={palette}
                              defaultIndex={si % Math.max(1, palette.length)}
                              onChange={(color) => commit({ ...now(), series: now().series.map((x, i) => (i === si ? { ...x, color } : x)) })}
                            />
                            {network ? (
                              <span className="dsheet__colname dsheet__colname--static">{s!.name}</span>
                            ) : (
                              <input
                                className="dsheet__colname"
                                value={s!.name}
                                aria-label={`Name of column ${columnLetter(c)}`}
                                onKeyDown={(e) => e.stopPropagation()}
                                onChange={(e) => commit({ ...now(), series: now().series.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)) })}
                              />
                            )}
                            {!network && series.length > 1 && (
                              <button
                                type="button"
                                className="dsheet__drop"
                                aria-label={`Delete ${s!.name || 'this column'}`}
                                data-tooltip="Delete this column"
                                onClick={() => deleteSeries(si)}
                              >
                                <X size={11} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  <div className="dsheet__colhead dsheet__colhead--end">
                    {!network && (
                      <button type="button" className="dsheet__add" onClick={addSeries} data-tooltip={samples ? 'Add a group' : 'Add a series'}>
                        <Plus size={13} />
                      </button>
                    )}
                  </div>

                  {Array.from({ length: rows }, (_, r) => (
                    <React.Fragment key={`r${r}`}>
                      <div
                        className="dsheet__rowhead"
                        data-selected={(r >= sheet.range.r0 && r <= sheet.range.r1) || undefined}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          sheet.selectRow(r, e.shiftKey);
                        }}
                      >
                        {r + 1}
                      </div>
                      {Array.from({ length: cols }, (_, c) => {
                        const si = seriesAt(c);
                        const editing = sheet.edit && sheet.edit.r === r && sheet.edit.c === c;
                        const text = read(r, c);
                        return (
                          <div
                            key={`c${r}:${c}`}
                            className="dsheet__cell"
                            data-cell={`${r}:${c}`}
                            data-label={si < 0 || undefined}
                            data-sel={sheet.inRange(r, c) || undefined}
                            data-focus={(sheet.focus.r === r && sheet.focus.c === c) || undefined}
                            data-empty={text === '' || undefined}
                            onPointerDown={(e) => sheet.cellPointerDown({ r, c }, e)}
                            onPointerEnter={() => sheet.cellPointerEnter({ r, c })}
                            onDoubleClick={() => sheet.begin({ r, c })}
                          >
                            {editing ? (
                              <input
                                className="dsheet__input"
                                autoFocus
                                spellCheck={false}
                                inputMode={si < 0 ? 'text' : 'decimal'}
                                value={sheet.edit!.draft}
                                onChange={(e) => sheet.setDraft(e.target.value)}
                                onKeyDown={sheet.onEditorKeyDown}
                                onBlur={() => sheet.commit()}
                              />
                            ) : (
                              text || (si < 0 ? '' : '—')
                            )}
                          </div>
                        );
                      })}
                      <div className="dsheet__cell dsheet__cell--end" />
                    </React.Fragment>
                  ))}
                </div>
                <textarea {...sheet.sinkProps} />
              </div>

              {preview && (
                <aside className="dsheet-preview" aria-label="Preview">
                  <svg viewBox="0 0 340 230" className="dsheet-preview__svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: previewMarkup }} />
                  <p className="dsheet-preview__note">
                    Updates as you type. {samples ? 'Each column is one group of readings.' : network ? 'Each row lists one node’s links.' : kind === 'timeline' ? 'Start and end per row; an empty end is a milestone.' : 'Rows are categories; columns are series.'}
                  </p>
                </aside>
              )}
            </div>
          </>
        ) : (
          <div className="cdm__source">
            {/* The security note is shown, not buried: the URL reaches
                everyone in the room, and whose browser fetches it is the
                whole design of this feature. */}
            <p className="cdm__note">
              <Globe size={13} aria-hidden />
              <span>
                The address is saved with the chart, so everyone in the room can see it. Only
                <strong> your </strong>
                browser fetches it — refreshing is local to you, and what everyone else receives is the data that came back.
              </span>
            </p>
            <label className="cdm__field">
              <span>Address</span>
              <input className="cdm__input" type="url" value={source.url ?? ''} placeholder="https://api.example.com/quarterly.csv" onChange={(e) => patchSource({ url: e.target.value || undefined })} />
            </label>
            <label className="cdm__field">
              <span>Path to the records</span>
              <input className="cdm__input" value={source.dataPath ?? ''} placeholder="data.rows — leave empty for CSV, or JSON that is already a list" onChange={(e) => patchSource({ dataPath: e.target.value || undefined })} />
            </label>
            <label className="cdm__field">
              <span>Refresh</span>
              <select className="cdm__input" value={live?.interval ?? 0} onChange={(e) => setLiveInterval(nodeId, Number(e.target.value), readSpec)}>
                {POLL_INTERVALS.map((n) => (
                  <option key={n} value={n}>
                    {POLL_LABELS[n]}
                  </option>
                ))}
              </select>
            </label>
            <p className="cdm__hint">
              Refreshing runs in this browser, for this session. It stops when you close the board, and nobody else starts fetching because you turned it on.
            </p>
            <div className="cdm__sourceActions">
              <button type="button" className="cdm__btn cdm__btn--primary" disabled={syncing || !source.url} onClick={syncNow}>
                <RefreshCw size={13} className={syncing ? 'spin' : undefined} />
                {syncing ? 'Fetching' : 'Fetch now'}
              </button>
              {(live?.lastSyncedAt ?? source.lastSyncedAt) && (
                <span className="cdm__mutedLabel">Last update {new Date(live?.lastSyncedAt ?? source.lastSyncedAt!).toLocaleTimeString()}</span>
              )}
            </div>
            {(live?.lastError ?? source.syncError) && !notice && (
              <p className="cdm__notice" data-tone="bad">
                <AlertTriangle size={13} aria-hidden /> {live?.lastError ?? source.syncError}
              </p>
            )}
          </div>
        )}

        <footer className="cdm__foot">
          <span className="cdm__mutedLabel">
            {samples
              ? `${series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0)} readings · ${series.length} ${series.length === 1 ? 'group' : 'groups'}`
              : `${categories.length} ${categories.length === 1 ? 'row' : 'rows'} · ${series.length} ${network ? 'nodes' : 'series'}`}
          </span>
          {notice ? (
            <span className="cdm__notice" data-tone={notice.tone} role="status">
              {notice.tone === 'ok' ? <Check size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />} {notice.text}
            </span>
          ) : (
            tab === 'grid' &&
            stats && (
              <span className="dsheet-stats" aria-live="polite">
                {stats.count > 1 && (
                  <>
                    <span>Sum <strong>{fmt(stats.sum)}</strong></span>
                    <span>Average <strong>{fmt(stats.avg)}</strong></span>
                    <span>Min <strong>{fmt(stats.min)}</strong></span>
                    <span>Max <strong>{fmt(stats.max)}</strong></span>
                  </>
                )}
                <span>Count <strong>{stats.count}</strong></span>
              </span>
            )
          )}
        </footer>
      </div>
    </div>
  );
};
