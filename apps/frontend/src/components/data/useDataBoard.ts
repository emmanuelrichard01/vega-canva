import React from 'react';
import {
  boardTables,
  chartsReading,
  ensureTableRegistry,
  linksVersion,
  namedRanges,
  registryVersion,
  subscribeLinks,
  subscribeRegistry,
  tableTitle,
  type NamedRange,
} from '../../engine/table/tableRegistry';

/**
 * The board's data sources, read from the table registry's index rather
 * than by walking the store, so a panel open beside a large board costs a
 * lookup per change rather than a scan.
 */

export interface BoardTable {
  id: string;
  name: string;
  rows: number;
  cols: number;
}

function useRegistryVersion(): number {
  ensureTableRegistry();
  return React.useSyncExternalStore(subscribeRegistry, registryVersion, registryVersion);
}

export function useLinksVersion(): number {
  return React.useSyncExternalStore(subscribeLinks, linksVersion, linksVersion);
}

/** Every table on the board, named as the Layers panel names it. */
export function useBoardTables(): BoardTable[] {
  const version = useRegistryVersion();
  return React.useMemo(
    () =>
      boardTables().map((t, i) => ({
        id: t.id,
        name: tableTitle(t) || `Table ${i + 1}`,
        rows: t.table.cells.length,
        cols: t.table.columns.length,
      })),
    // The registry is the source; its version says when to read it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );
}

/** The charts reading one table. */
export function useChartsReading(tableId: string): readonly string[] {
  const version = useLinksVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => chartsReading(tableId), [tableId, version]);
}

/** Named ranges across the board, each with its table. */
export function useNamedRanges(tables: readonly BoardTable[]): Array<NamedRange & { table: BoardTable }> {
  const version = useLinksVersion();
  return React.useMemo(
    () => tables.flatMap((table) => namedRanges(table.id).map((r) => ({ ...r, table }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, version]
  );
}
