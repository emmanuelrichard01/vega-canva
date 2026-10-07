import React from 'react';
import { Group, Line, Rect } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../hooks/useStore';
import { useCameraZoom } from '../../engine/useCameraZoom';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { currentChartInk } from '../../engine/chart/chartInk';
import { setChartFocus } from '../../engine/chart/chartFocus';
import {
  bridge,
  crossTableLinks,
  rangeBox,
  type Box,
  type TableNodeLike,
} from '../../engine/chart/dataLinkGeometry';
import type { ChartTableLink } from '../../engine/chart/chartTypes';

/**
 * The visible half of the board's data links.
 *
 * - A linked chart, or the table it reads, selected: a dashed hairline from the
 *   chart to the range it draws, with the range outlined.
 * - A table selected or open for editing: the same line from every range in
 *   another table its formulas read, to the cell that reads it.
 *
 * Chrome: held at one screen pixel at any zoom, never exported, never hit.
 * Also publishes this client's selection to `chartFocus`, which is how a chart
 * knows it may offer its in-place editing.
 */

interface Link {
  from: Box;
  to: Box;
}

const asChart = (n: unknown) =>
  n && typeof n === 'object' && (n as { type?: string }).type === 'chart'
    ? (n as Box & { id: string; chart: { link?: ChartTableLink } })
    : null;

const asTable = (n: unknown) =>
  n && typeof n === 'object' && (n as { type?: string }).type === 'table' ? (n as TableNodeLike) : null;

export const DataLinkOverlay: React.FC<{ selectedIds: string[] }> = ({ selectedIds }) => {
  React.useEffect(() => {
    setChartFocus(selectedIds);
  }, [selectedIds]);

  const zoom = useCameraZoom();
  const editingTable = useStore((s) => s.tableEditNodeId);

  // Every node a link could be drawn from, flat, so the shallow compare sees
  // the node objects themselves and re-renders only when one of them changed.
  const nodes = useStore(
    useShallow((s) => {
      const picked = new Set(selectedIds);
      if (editingTable) picked.add(editingTable);
      if (picked.size === 0) return [] as unknown[];
      let wantsTables = false;
      const out: unknown[] = [];
      for (const [id, raw] of Object.entries(s.objects)) {
        const chart = asChart(raw);
        const link = chart?.chart.link;
        if (link && (picked.has(id) || picked.has(link.tableId))) out.push(raw, s.objects[link.tableId]);
        if (picked.has(id) && asTable(raw)) wantsTables = true;
      }
      // A picked table's formulas may read any table, so all of them are in play.
      if (wantsTables) for (const raw of Object.values(s.objects)) if (asTable(raw)) out.push(raw);
      return out;
    })
  );

  if (nodes.length === 0) return null;

  const picked = new Set(selectedIds);
  if (editingTable) picked.add(editingTable);
  const tables: TableNodeLike[] = [];
  const links: Link[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const chart = asChart(nodes[i]);
    if (chart) {
      const table = asTable(nodes[i + 1]);
      i += 1;
      if (!table || !chart.chart.link) continue;
      const range = rangeBox(table, chart.chart.link);
      if (range) links.push({ from: range, to: chart });
      continue;
    }
    const table = asTable(nodes[i]);
    if (table && !tables.some((t) => t.id === table.id)) tables.push(table);
  }
  for (const table of tables) {
    if (!picked.has(table.id)) continue;
    for (const l of crossTableLinks(table, tables)) links.push({ from: l.source, to: l.cell });
  }
  if (links.length === 0) return null;

  const ink = currentChartInk();
  const hair = 1 / Math.max(zoom, 0.05);

  return (
    <Group listening={false} name={EXPORT_CHROME}>
      {links.map(({ from, to }, i) => (
        <React.Fragment key={i}>
          <Rect
            x={from.x}
            y={from.y}
            width={from.width}
            height={from.height}
            stroke={ink.ink}
            strokeWidth={hair * 1.5}
            dash={[hair * 4, hair * 3]}
            perfectDrawEnabled={false}
          />
          <Line
            points={bridge(from, to)}
            stroke={ink.ink}
            strokeWidth={hair}
            dash={[hair * 4, hair * 3]}
            opacity={0.7}
            perfectDrawEnabled={false}
          />
        </React.Fragment>
      ))}
    </Group>
  );
};
