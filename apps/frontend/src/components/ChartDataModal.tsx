import React from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Globe,
  Plus,
  RefreshCw,
  Table as TableIcon,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../hooks/useStore';
import type { ChartNode } from '../engine/model/schema';
import type { ChartSpec, ChartSeries } from '../engine/chart/chartTypes';
import { seriesColor } from '../engine/chart/chartTypes';
import { updateChart } from '../engine/chart/chartApply';
import {
  chartToCsv,
  csvFilename,
  downloadCsv,
  parseChartData,
  parseNumber,
  withChartData,
} from '../engine/chart/chartCsv';
import { POLL_INTERVALS, POLL_LABELS, syncFromUrl } from '../engine/chart/chartSync';
import { liveStatus, setLiveInterval, subscribeLive } from '../engine/chart/chartLiveSync';
import { ColorPickerPopover } from './ui/ColorPickerPopover';

/**
 * The chart's data, as a sheet — and where the numbers come from.
 *
 * ## What was wrong, and what decides the rewrite
 *
 * **Every keystroke was a document write.** Each character typed into a cell
 * called `updateChart`, which is a CRDT transaction: replicated to everyone in
 * the room, and one step on the undo stack. Typing `1250` into one cell was
 * four edits everybody received and four presses of undo to take back. It also
 * meant the value was parsed on every keystroke, so `-` and `1.` — the states
 * every number passes through on the way to being typed — were parsed as
 * nothing and thrown away, and the cell fought whoever was typing in it.
 *
 * So a cell holds its own text while it is being edited and commits on blur,
 * on Enter, or on navigating away. That is what every spreadsheet does, and
 * for these reasons rather than for taste.
 *
 * **It was eighty inline style objects.** The same button was declared six
 * times with the same nine properties, colours were hard-coded beside
 * `var(--x, #fallback)` pairs that no longer matched the theme, and nothing
 * could be restyled without finding every copy. It is a stylesheet now.
 */

interface Props {
  nodeId: string;
  onClose: () => void;
}

type Tab = 'grid' | 'source';

/** Which cell is being edited, and what is currently typed in it. */
interface Draft {
  row: number;
  /** `-1` is the category column; `0..n` is a series. */
  col: number;
  text: string;
}

export const ChartDataModal: React.FC<Props> = ({ nodeId, onClose }) => {
  const node = useStore((s) => s.objects[nodeId]) as ChartNode | undefined;
  const [tab, setTab] = React.useState<Tab>('grid');
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pasting, setPasting] = React.useState(false);
  const [pasteText, setPasteText] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const gridRef = React.useRef<HTMLDivElement>(null);

  /**
   * The live registry is module state, not React state.
   *
   * `useSyncExternalStore` rather than an effect and a copy: the registry is
   * the truth about what is refreshing, and a mirror of it in this component
   * would be a second answer that goes stale the moment a tick lands while the
   * dialog is closed.
   */
  const live = React.useSyncExternalStore(
    subscribeLive,
    () => liveStatus(nodeId),
    () => undefined
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape backs out one layer at a time: the paste box, then the dialog.
      if (pasting) {
        e.stopPropagation();
        setPasting(false);
      } else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pasting]);

  /**
   * Reads the chart out of the store when a tick runs, rather than closing
   * over the spec that was current when refresh was switched on -- otherwise
   * editing the URL leaves the timer fetching the old one forever.
   *
   * Above the guard below, because it is a hook: declaring it after an early
   * return makes the hook order depend on whether the node exists, which
   * React cannot survive.
   */
  const readSpec = React.useCallback((id: string) => {
    const target = useStore.getState().objects[id];
    return target && target.type === 'chart' ? target.chart : null;
  }, []);

  if (!node || node.type !== 'chart') return null;

  const spec = node.chart;
  const categories = spec.categories ?? [];
  const series = spec.series ?? [];

  const commit = (next: Partial<ChartSpec>) => updateChart(nodeId, { ...spec, ...next });

  const say = (tone: 'ok' | 'bad', text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(null), 4000);
  };

  // ---------------------------------------------------------------- the sheet

  const cellText = (row: number, col: number): string => {
    if (draft && draft.row === row && draft.col === col) return draft.text;
    if (col === -1) return categories[row] ?? '';
    const value = series[col]?.values[row];
    return value === null || value === undefined ? '' : String(value);
  };

  /**
   * Write the draft into the document, if it changed anything.
   *
   * Comparing against what is stored rather than committing unconditionally
   * means tabbing across a row you did not edit produces no document writes at
   * all — which is the difference between an undo stack you can use and one
   * full of no-ops.
   */
  const flush = (next: Draft | null) => {
    if (draft) {
      const { row, col, text } = draft;
      if (col === -1) {
        if ((categories[row] ?? '') !== text) {
          const nextCategories = [...categories];
          nextCategories[row] = text;
          commit({ categories: nextCategories });
        }
      } else {
        const parsed = text.trim() === '' ? null : parseNumber(text);
        const current = series[col]?.values[row] ?? null;
        if (current !== parsed) {
          commit({
            series: series.map((s, i) =>
              i === col
                ? { ...s, values: s.values.with(row, parsed) }
                : s
            ),
          });
        }
      }
    }
    setDraft(next);
  };

  const focusCell = (row: number, col: number) => {
    gridRef.current
      ?.querySelector<HTMLInputElement>(`[data-cell="${row}:${col}"]`)
      ?.focus();
  };

  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const lastCol = series.length - 1;
    const move = (r: number, c: number) => {
      e.preventDefault();
      // Flushed before the move, so the next cell renders from the document
      // rather than from a draft belonging to the cell just left.
      flush(null);
      focusCell(Math.max(0, Math.min(categories.length - 1, r)), Math.max(-1, Math.min(lastCol, c)));
    };

    switch (e.key) {
      case 'Enter':
        move(e.shiftKey ? row - 1 : row + 1, col);
        break;
      case 'ArrowDown':
        move(row + 1, col);
        break;
      case 'ArrowUp':
        move(row - 1, col);
        break;
      case 'Tab':
        // Wraps to the next row's first cell, so a whole table can be typed
        // without ever reaching for the mouse.
        if (e.shiftKey) move(col === -1 ? row - 1 : row, col === -1 ? lastCol : col - 1);
        else move(col === lastCol ? row + 1 : row, col === lastCol ? -1 : col + 1);
        break;
      case 'Escape':
        // Abandons the edit rather than closing the dialog.
        e.stopPropagation();
        setDraft(null);
        (e.target as HTMLInputElement).blur();
        break;
      default:
        break;
    }
  };

  // ------------------------------------------------------------ table shape

  const addRow = (at = categories.length) => {
    const nextCategories = [...categories];
    nextCategories.splice(at, 0, `Item ${categories.length + 1}`);
    commit({
      categories: nextCategories,
      series: series.map((s) => ({
        ...s,
        values: s.values.toSpliced(at, 0, 0),
      })),
    });
  };

  const deleteRow = (row: number) => {
    if (categories.length <= 1) return;
    commit({
      categories: categories.filter((_, i) => i !== row),
      series: series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== row) })),
    });
  };

  const addSeries = () => {
    commit({
      series: [
        ...series,
        { name: `Series ${series.length + 1}`, values: categories.map(() => 0) },
      ],
    });
  };

  const deleteSeries = (index: number) => {
    if (series.length <= 1) return;
    commit({ series: series.filter((_, i) => i !== index) });
  };

  /**
   * Swap what names the rows for what names the columns.
   *
   * Genuinely useful rather than a novelty: which way round a table is
   * decides what the chart *compares*, and getting it the wrong way round is
   * the single most common thing wrong with a pasted spreadsheet.
   */
  const transpose = () => {
    if (categories.length === 0 || series.length === 0) return;
    const nextSeries: ChartSeries[] = categories.map((name, row) => ({
      name,
      values: series.map((s) => s.values[row] ?? 0),
    }));
    commit({ categories: series.map((s) => s.name), series: nextSeries });
  };

  // ------------------------------------------------------------------- CSV

  const copyCsv = () => {
    navigator.clipboard
      .writeText(chartToCsv(spec))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      // Refused on an insecure origin, and a copy button that silently does
      // nothing is worse than one that tells you to use the download instead.
      .catch(() => say('bad', 'The clipboard is not available here — use Download instead.'));
  };

  const applyPaste = () => {
    const parsed = parseChartData(pasteText);
    if (parsed.categories.length === 0) {
      say('bad', 'No table could be read from that.');
      return;
    }
    commit(withChartData(spec, parsed));
    setPasting(false);
    setPasteText('');
    say('ok', `Read ${parsed.categories.length} rows.`);
  };

  // ------------------------------------------------------------------ live

  const source = spec.dataSource ?? {};
  const patchSource = (patch: Partial<NonNullable<ChartSpec['dataSource']>>) =>
    commit({ dataSource: { ...source, ...patch } });

  const syncNow = async () => {
    if (!source.url) return;
    setSyncing(true);
    setNotice(null);
    const result = await syncFromUrl(source.url, source.dataPath);
    setSyncing(false);

    if (result.ok) {
      updateChart(nodeId, {
        ...withChartData(spec, result.data),
        dataSource: { ...source, lastSyncedAt: Date.now(), syncError: undefined },
      });
      say('ok', `Synced ${result.rows} rows.`);
    } else {
      patchSource({ syncError: result.error });
      say('bad', result.error);
    }
  };

  const rows = categories.length;

  return (
    <div className="export-scrim" onPointerDown={onClose} role="presentation">
      <div
        className="cdm"
        role="dialog"
        aria-modal="true"
        aria-label="Chart data"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="cdm__head">
          <div className="cdm__title">
            <TableIcon size={15} aria-hidden />
            <span>{spec.title?.trim() || 'Chart data'}</span>
          </div>

          <div className="cdm__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'grid'}
              className="cdm__tab"
              data-active={tab === 'grid' || undefined}
              onClick={() => setTab('grid')}
            >
              Sheet
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'source'}
              className="cdm__tab"
              data-active={tab === 'source' || undefined}
              onClick={() => setTab('source')}
            >
              Source
              {/* A dot rather than a word: the tab says whether this chart is
                  wired to something without costing a second line of chrome. */}
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
                <button type="button" className="cdm__btn" onClick={() => addRow()}>
                  <Plus size={13} /> Row
                </button>
                <button type="button" className="cdm__btn" onClick={addSeries}>
                  <Plus size={13} /> Series
                </button>
                <button
                  type="button"
                  className="cdm__btn"
                  onClick={transpose}
                  title="Swap what names the rows for what names the columns"
                >
                  <ArrowLeftRight size={13} /> Transpose
                </button>
              </div>

              <div className="cdm__barGroup">
                <button
                  type="button"
                  className="cdm__btn"
                  data-active={pasting || undefined}
                  onClick={() => setPasting((v) => !v)}
                >
                  <ClipboardPaste size={13} /> Paste
                </button>
                <button type="button" className="cdm__btn" onClick={copyCsv}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  className="cdm__btn"
                  onClick={() => downloadCsv(spec, csvFilename(spec.title))}
                >
                  <Download size={13} /> Download
                </button>
              </div>
            </div>

            {pasting && (
              <div className="cdm__paste">
                <textarea
                  className="cdm__pasteBox"
                  value={pasteText}
                  autoFocus
                  placeholder={'Paste from a spreadsheet, or CSV:\n\nMonth,Revenue,Cost\nJan,12,8'}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <div className="cdm__pasteActions">
                  <button type="button" className="cdm__btn" onClick={() => setPasting(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="cdm__btn cdm__btn--primary"
                    disabled={!pasteText.trim()}
                    onClick={applyPaste}
                  >
                    Replace the table
                  </button>
                </div>
              </div>
            )}

            <div className="cdm__sheet" ref={gridRef}>
              <table className="cdm__table">
                <thead>
                  <tr>
                    <th className="cdm__corner" scope="col">
                      <span className="cdm__mutedLabel">Category</span>
                    </th>
                    {series.map((s, si) => (
                      <th key={si} scope="col" className="cdm__colHead">
                        <ColorPickerPopover
                          color={s.color ?? seriesColor(undefined, si)}
                          onChange={(color) =>
                            commit({
                              series: series.map((x, i) => (i === si ? { ...x, color } : x)),
                            })
                          }
                        />
                        <input
                          className="cdm__seriesName"
                          value={s.name}
                          aria-label={`Name of series ${si + 1}`}
                          onChange={(e) =>
                            commit({
                              series: series.map((x, i) =>
                                i === si ? { ...x, name: e.target.value } : x
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          className="cdm__rowBtn"
                          aria-label={`Delete series ${s.name}`}
                          disabled={series.length <= 1}
                          onClick={() => deleteSeries(si)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </th>
                    ))}
                    <th className="cdm__gutter" />
                  </tr>
                </thead>
                <tbody>
                  {categories.map((_, row) => (
                    <tr key={row}>
                      <th scope="row" className="cdm__rowHead">
                        <input
                          className="cdm__cell cdm__cell--label"
                          data-cell={`${row}:-1`}
                          value={cellText(row, -1)}
                          aria-label={`Category ${row + 1}`}
                          onChange={(e) => setDraft({ row, col: -1, text: e.target.value })}
                          onFocus={() => setDraft({ row, col: -1, text: categories[row] ?? '' })}
                          onBlur={() => flush(null)}
                          onKeyDown={(e) => onCellKey(e, row, -1)}
                        />
                      </th>
                      {series.map((s, col) => (
                        <td key={col}>
                          <input
                            className="cdm__cell cdm__cell--num"
                            data-cell={`${row}:${col}`}
                            inputMode="decimal"
                            value={cellText(row, col)}
                            aria-label={`${s.name}, ${categories[row] ?? row + 1}`}
                            placeholder="—"
                            onChange={(e) => setDraft({ row, col, text: e.target.value })}
                            onFocus={() =>
                              setDraft({
                                row,
                                col,
                                text:
                                  s.values[row] === null || s.values[row] === undefined
                                    ? ''
                                    : String(s.values[row]),
                              })
                            }
                            onBlur={() => flush(null)}
                            onKeyDown={(e) => onCellKey(e, row, col)}
                          />
                        </td>
                      ))}
                      <td className="cdm__gutter">
                        <button
                          type="button"
                          className="cdm__rowBtn"
                          aria-label={`Delete row ${row + 1}`}
                          disabled={categories.length <= 1}
                          onClick={() => deleteRow(row)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="cdm__source">
            {/*
              The security note is shown, not buried in a comment.

              The URL is part of the chart and therefore reaches everyone in
              the room. Whose browser actually makes the request is the whole
              design of this feature, and it is the sort of thing a person is
              entitled to know before typing an internal hostname into a
              shared board.
            */}
            <p className="cdm__note">
              <Globe size={13} aria-hidden />
              <span>
                The address is saved with the chart, so everyone in the room can see it. Only
                <strong> your </strong>
                browser fetches it — refreshing is local to you, and what everyone else receives
                is the data that came back.
              </span>
            </p>

            <label className="cdm__field">
              <span>Address</span>
              <input
                className="cdm__input"
                type="url"
                value={source.url ?? ''}
                placeholder="https://api.example.com/quarterly.csv"
                onChange={(e) => patchSource({ url: e.target.value || undefined })}
              />
            </label>

            <label className="cdm__field">
              <span>Path to the records</span>
              <input
                className="cdm__input"
                value={source.dataPath ?? ''}
                placeholder="data.rows — leave empty for CSV, or JSON that is already a list"
                onChange={(e) => patchSource({ dataPath: e.target.value || undefined })}
              />
            </label>

            <label className="cdm__field">
              <span>Refresh</span>
              <select
                className="cdm__input"
                value={live?.interval ?? 0}
                onChange={(e) => setLiveInterval(nodeId, Number(e.target.value), readSpec)}
              >
                {POLL_INTERVALS.map((n) => (
                  <option key={n} value={n}>
                    {POLL_LABELS[n]}
                  </option>
                ))}
              </select>
            </label>
            <p className="cdm__hint">
              Refreshing runs in this browser, for this session. It stops when you close the
              board, and nobody else starts fetching because you turned it on.
            </p>

            <div className="cdm__sourceActions">
              <button
                type="button"
                className="cdm__btn cdm__btn--primary"
                disabled={syncing || !source.url}
                onClick={syncNow}
              >
                <RefreshCw size={13} className={syncing ? 'spin' : undefined} />
                {syncing ? 'Fetching' : 'Fetch now'}
              </button>
              {(live?.lastSyncedAt ?? source.lastSyncedAt) && (
                <span className="cdm__mutedLabel">
                  Last update {new Date(live?.lastSyncedAt ?? source.lastSyncedAt!).toLocaleTimeString()}
                </span>
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
            {rows} {rows === 1 ? 'row' : 'rows'} · {series.length}{' '}
            {series.length === 1 ? 'series' : 'series'}
          </span>
          {notice && (
            <span className="cdm__notice" data-tone={notice.tone}>
              {notice.text}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
};
