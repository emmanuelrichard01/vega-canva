import React from 'react';
import { useStore } from '../../hooks/useStore';
import { changedReadings, resolveChartSpec, tweenValues } from '../../engine/chart/chartFromTable';
import { easeOut, MORPH_MS } from '../../engine/chart/chartMorph';
import { prefersReducedMotion } from '../../engine/cameraMotion';
import type { ChartSpec } from '../../engine/chart/chartTypes';
import type { TableSpec } from '../../engine/table/tableTypes';
import { publishFlash } from './linkSignals';

/** The table a chart reads, from the store: one lookup, so only that table's edits re-render the chart. */
export function useLinkedTable(tableId: string | undefined): TableSpec | null {
  return useStore((s) => {
    const n = tableId ? s.objects[tableId] : undefined;
    return n && n.type === 'table' ? n.table : null;
  });
}

/**
 * A chart as drawn: a linked chart's values read from its table.
 *
 * When the table changes under an unchanged chart, the new values are eased
 * in over the morph's duration, so bars grow and lines bend to them, and the
 * readings that changed are published for the board to mark. Reduced motion
 * goes straight to the new values; the mark stays, as a still outline.
 */
export function useLinkedChartSpec(id: string, chart: ChartSpec): ChartSpec {
  const table = useLinkedTable(chart.link?.tableId);
  const resolved = React.useMemo(() => resolveChartSpec(chart, table), [chart, table]);

  const last = React.useRef<{ chart: ChartSpec; table: TableSpec | null; resolved: ChartSpec } | null>(null);
  const [tween, setTween] = React.useState<{ from: ChartSpec; t: number } | null>(null);

  React.useEffect(() => {
    const prev = last.current;
    last.current = { chart, table, resolved };
    // Only the source moving under the chart is news; a chart edited in the
    // panel shows its edit at once.
    if (!prev || !chart.link || !table || !prev.table || prev.chart !== chart || prev.table === table) return;
    const changed = changedReadings(prev.resolved, resolved);
    if (changed.length === 0) return;
    publishFlash(id, changed);
    if (prefersReducedMotion()) return;
    const from = prev.resolved;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MORPH_MS);
      setTween(t < 1 ? { from, t: easeOut(t) } : null);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setTween(null);
    };
  }, [id, chart, table, resolved]);

  return React.useMemo(() => (tween ? tweenValues(tween.from, resolved, tween.t) : resolved), [tween, resolved]);
}
