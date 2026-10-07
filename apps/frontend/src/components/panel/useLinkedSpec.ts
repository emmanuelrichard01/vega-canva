import React from 'react';
import { useStore } from '../../hooks/useStore';
import { resolveChartSpec } from '../../engine/chart/chartFromTable';
import type { ChartSpec } from '../../engine/chart/chartTypes';
import type { TableSpec } from '../../engine/table/tableTypes';

/**
 * The chart as drawn: a linked chart's values read from its table.
 *
 * The panel edits this rather than the stored snapshot, so its rows and series
 * match the chart on the board, and any edit made here writes the current
 * values back as the snapshot a deleted table would leave behind.
 */
export function useLinkedSpec(spec: ChartSpec): ChartSpec {
  const id = spec.link?.tableId;
  const table = useStore((s) => {
    const n = id ? s.objects[id] : undefined;
    return n && (n as { type?: string }).type === 'table' ? (n as unknown as { table: TableSpec }).table : null;
  });
  return React.useMemo(() => resolveChartSpec(spec, table), [spec, table]);
}
