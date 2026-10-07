import React from 'react';
import { useStore } from '../../hooks/useStore';
import { editor } from '../../engine/api/EditorAPI';
import { applyNodePatches } from '../../engine/document/mutations';
import { canEditObjects, getRoomRole, subscribeRoomRole } from '../../engine/model/permissions';
import { prefersReducedMotion } from '../../engine/cameraMotion';
import { setCell } from '../../engine/table/tableModel';
import { updateTable } from '../../engine/table/tableApply';
import { chartsNamed } from '../../engine/table/tableRegistry';
import {
  currentRange,
  relinkedSpec,
  type TableRange,
  type WriteBackPlan,
} from '../../engine/chart/chartFromTable';
import type { ChartSpec, ChartTableLink } from '../../engine/chart/chartTypes';
import type { AnyNode } from '../../engine/model/schema';
import { focusRange, requestRangeSelection } from './linkSignals';

/**
 * The data link's writes, each one undo step, each refused before it is
 * attempted for anyone who is not an editor. Viewers and commenters see the
 * bindings and never send a write the server would refuse.
 */

type ChartNodeT = Extract<AnyNode, { type: 'chart' }>;
type TableNodeT = Extract<AnyNode, { type: 'table' }>;

const subscribeRole = (fn: () => void) => subscribeRoomRole(() => fn());

/** Whether this person may change bindings; re-renders when their role does. */
export function useCanEditData(): boolean {
  const role = React.useSyncExternalStore(subscribeRole, getRoomRole, getRoomRole);
  return role === 'editor';
}

const chartNode = (id: string) => {
  const n = useStore.getState().objects[id];
  return n && n.type === 'chart' ? (n as ChartNodeT) : null;
};

const tableNode = (id: string) => {
  const n = useStore.getState().objects[id];
  return n && n.type === 'table' ? (n as TableNodeT) : null;
};

/** The parts of a link that are the range itself, shared by every chart using its name. */
const RANGE_KEYS = ['r0', 'c0', 'r1', 'c1', 'ids', 'grow'] as const;

function sameRangeParts(a: ChartTableLink, b: ChartTableLink): boolean {
  return RANGE_KEYS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

/**
 * Give a chart a new link, its values read through it. When the link is a
 * named range and its cells moved, every other chart carrying that name on
 * the same table moves with it, in the same step.
 */
export function setChartLink(chartId: string, spec: ChartSpec, link: ChartTableLink): void {
  if (!canEditObjects()) return;
  const table = tableNode(link.tableId)?.table;
  const next = table ? relinkedSpec(spec, table, link) : { ...spec, link };
  const patches: Array<{ id: string; changes: Record<string, unknown> }> = [{ id: chartId, changes: { chart: next } }];
  const before = spec.link;
  if (table && link.name && before && before.tableId === link.tableId && !sameRangeParts(before, link)) {
    for (const id of chartsNamed(link.tableId, link.name)) {
      const other = id === chartId ? null : chartNode(id);
      if (!other?.chart.link) continue;
      const moved: ChartTableLink = { ...other.chart.link };
      for (const k of RANGE_KEYS) {
        if (link[k] === undefined) delete moved[k];
        else (moved as unknown as Record<string, unknown>)[k] = link[k];
      }
      patches.push({ id, changes: { chart: relinkedSpec(other.chart, table, moved) } });
    }
  }
  applyNodePatches(patches);
}

/** Rename a range on every chart that carries it. An empty name unnames it. */
export function renameRange(tableId: string, from: string, to: string, alsoChart?: { id: string; spec: ChartSpec }): void {
  if (!canEditObjects()) return;
  const name = to.trim().slice(0, 80);
  const ids = new Set(from.trim() ? chartsNamed(tableId, from) : []);
  if (alsoChart) ids.add(alsoChart.id);
  const patches = [...ids].flatMap((id) => {
    const spec = id === alsoChart?.id ? alsoChart.spec : chartNode(id)?.chart;
    if (!spec?.link) return [];
    const link = { ...spec.link };
    if (name) link.name = name;
    else delete link.name;
    return [{ id, changes: { chart: { ...spec, link } } }];
  });
  applyNodePatches(patches);
}

/** Write a planned value into its cell: one undo step, on the table. */
export function commitWriteBack(tableId: string, plan: Extract<WriteBackPlan, { ok: true }>): boolean {
  if (!canEditObjects()) return false;
  const node = tableNode(tableId);
  if (!node) return false;
  // The cell as it is now; a collaborator's edit since the plan was made wins.
  if ((node.table.cells[plan.r]?.[plan.c] ?? '') !== plan.before) return false;
  updateTable(node, setCell(node.table, plan.r, plan.c, plan.after));
  return true;
}

/** Select an object and bring it into view. */
export function jumpTo(id: string): void {
  const node = useStore.getState().objects[id];
  if (!node) return;
  editor.select(id);
  editor.zoomToNodes([node], { smooth: !prefersReducedMotion() });
}

/**
 * Show a chart's source: outline the range on the board, select the table,
 * and open it for editing with the range selected.
 */
export function showSource(link: ChartTableLink, open = true): TableRange | null {
  const node = tableNode(link.tableId);
  if (!node) return null;
  const range = currentRange(node.table, link);
  if (!range) return null;
  focusRange({ tableId: link.tableId, range, from: 'board' });
  requestRangeSelection(link.tableId, range);
  editor.select(link.tableId);
  if (open) useStore.getState().setTableEditNodeId(link.tableId);
  return range;
}
