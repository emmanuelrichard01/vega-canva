import React from 'react';
import { chartToSvg } from '../../engine/chart/chartSvg';
import { chartInkFor } from '../../engine/chart/chartInk';
import { measureChartText } from '../../engine/chart/chartMeasure';
import { CHART_LABELS } from '../../engine/chart/chartKinds';
import { createChartFromTableRange, rangeLabel, specForRange, type TableRange } from '../../engine/chart/chartFromTable';
import { guessChart } from '../../engine/chart/chartFromTableGuess';
import type { ChartKind } from '../../engine/chart/chartTypes';
import type { TableSpec } from '../../engine/table/tableTypes';
import { ThemeService } from '../../engine/ThemeService';
import { editor } from '../../engine/api/EditorAPI';
import { SegmentedControl } from '../panel/grammar';
import { useCanEditData } from './dataActions';
import { focusRange, rangeFocus } from './linkSignals';

/**
 * "Chart this", shown before it is done: the range read, which way the series
 * run, the kind that suits it and why, drawn small with the real data. The
 * guess can be overridden; nothing is added to the board until Add chart.
 */

const W = 272;
const H = 164;
const KINDS: ChartKind[] = ['bar', 'line', 'area', 'donut'];

interface Props {
  tableId: string;
  table: TableSpec;
  /** The cells asked for; absent, the whole table. A single cell stands for the block around it. */
  range?: TableRange;
  /** After adding (with the new chart's id) or cancelling (with null). */
  onDone: (chartId: string | null) => void;
}

export const ChartThisPreview: React.FC<Props> = ({ tableId, table, range, onDone }) => {
  const canEdit = useCanEditData();
  const guess = React.useMemo(() => guessChart(table, range), [table, range]);
  const [kind, setKind] = React.useState<ChartKind | null>(null);
  const [seriesIn, setSeriesIn] = React.useState<'columns' | 'rows' | null>(null);

  const chosenIn = seriesIn ?? guess?.seriesIn ?? 'columns';
  const spec = React.useMemo(() => {
    if (!guess) return null;
    const s = specForRange(table, tableId, guess.range, { seriesIn: chosenIn });
    return s && { ...s, kind: kind ?? (seriesIn && seriesIn !== guess.seriesIn ? s.kind : guess.kind), title: undefined };
  }, [guess, table, tableId, chosenIn, kind, seriesIn]);

  // The board outlines the range being previewed.
  React.useEffect(() => {
    if (!guess) return;
    focusRange({ tableId, range: guess.range, from: 'panel' });
    return () => {
      if (rangeFocus.get()?.from === 'panel') focusRange(null);
    };
  }, [guess, tableId]);

  const svg = React.useMemo(
    () => (spec ? chartToSvg(spec, W, H, { id: `preview-${tableId}`, measure: measureChartText, ink: chartInkFor(ThemeService.isDarkMode()) }) : ''),
    [spec, tableId]
  );

  if (!guess || !spec) {
    return (
      <div className="data-preview" role="group" aria-label="Chart this">
        <p className="pg-note">No numbers here to chart. Add some, or choose cells that hold them.</p>
        <div className="data-confirm__actions">
          <button type="button" className="data-textbtn" onClick={() => onDone(null)}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const shownKind = spec.kind;
  const add = () => {
    const id = createChartFromTableRange(tableId, guess.range, { kind: shownKind, seriesIn: chosenIn });
    if (id) editor.select(id);
    onDone(id);
  };

  return (
    <div className="data-preview" role="group" aria-label="Chart this">
      <svg
        className="data-preview__art"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${CHART_LABELS[shownKind]} chart preview of ${rangeLabel(guess.range)}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="data-preview__title">
        {`${CHART_LABELS[shownKind]} chart of ${rangeLabel(guess.range)}`}
        {shownKind === guess.kind && chosenIn === guess.seriesIn && <span className="data-preview__tag">Suggested</span>}
      </p>
      <p className="pg-note">{guess.why.charAt(0).toUpperCase() + guess.why.slice(1)}</p>
      <SegmentedControl
        ariaLabel="Chart kind"
        fill
        value={shownKind}
        onChange={(v) => setKind(v as ChartKind)}
        segments={(KINDS.includes(guess.kind) ? KINDS : [guess.kind, ...KINDS]).map((k) => ({
          value: k,
          label: k === 'barHorizontal' ? 'Horizontal' : CHART_LABELS[k],
          hint: CHART_LABELS[k],
        }))}
      />
      <SegmentedControl
        ariaLabel="Where the series are"
        fill
        value={chosenIn}
        onChange={(v) => setSeriesIn(v as 'columns' | 'rows')}
        segments={[
          { value: 'columns', label: 'Series in columns' },
          { value: 'rows', label: 'Series in rows' },
        ]}
      />
      <div className="data-confirm__actions">
        <button type="button" className="data-textbtn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="button" className="data-primary" disabled={!canEdit} data-tooltip={canEdit ? undefined : 'Only editors add charts'} onClick={add}>
          Add chart
        </button>
      </div>
    </div>
  );
};
