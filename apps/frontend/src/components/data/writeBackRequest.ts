import React from 'react';
import { planWriteBack, type WriteBackPlan } from '../../engine/chart/chartFromTable';
import type { ChartTableLink } from '../../engine/chart/chartTypes';
import { canEditObjects } from '../../engine/model/permissions';
import { tableNode } from '../../engine/table/tableRegistry';
import { notify } from '../../engine/ui/notices';
import { commitWriteBack } from './dataActions';

/**
 * A value dragged on a linked chart, waiting for its confirmation.
 *
 * The cell belongs to the table and may feed formulas and other charts, so a
 * drop never writes by itself: it plans the write, and the same question the
 * Data panel asks ("Write 25 to Sales!B2?") has to be answered first. One
 * request at a time; a new drop replaces an unanswered one.
 */

type OkPlan = Extract<WriteBackPlan, { ok: true }>;

export interface WriteBackRequest {
  tableId: string;
  tableName: string;
  plan: OkPlan;
}

let current: WriteBackRequest | null = null;
const listeners = new Set<() => void>();

function set(next: WriteBackRequest | null): void {
  current = next;
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The request waiting on an answer, or null. */
export const pendingWriteBack = () => current;

export function useWriteBackRequest(): WriteBackRequest | null {
  return React.useSyncExternalStore(subscribe, pendingWriteBack, pendingWriteBack);
}

/**
 * Plan the write a drop implies and ask for it. A reading that cannot be
 * written (a formula, a combined value, a table that is gone) is said so in a
 * notice instead. Nothing happens for anyone who is not an editor.
 */
export function proposeWriteBack(link: ChartTableLink, seriesIndex: number, categoryIndex: number, value: number): boolean {
  if (!canEditObjects()) return false;
  const node = tableNode(link.tableId);
  if (!node) {
    notify({ tone: 'warning', message: 'The table this chart reads is no longer on the board.' });
    return false;
  }
  const plan = planWriteBack(node.table, link, seriesIndex, categoryIndex, value);
  if (!plan.ok) {
    notify({ tone: 'warning', message: plan.reason });
    return false;
  }
  set({ tableId: link.tableId, tableName: node.title?.trim() || 'the table', plan });
  return true;
}

/** Dismiss the question without writing. */
export function cancelWriteBack(): void {
  if (current) set(null);
}

/** Write the planned value, once. Says what happened either way. */
export function confirmWriteBack(): boolean {
  const request = current;
  if (!request) return false;
  set(null);
  const ok = commitWriteBack(request.tableId, request.plan);
  notify(
    ok
      ? { tone: 'success', message: `Wrote ${request.plan.after} to ${request.plan.cell}` }
      : { tone: 'warning', message: `${request.plan.cell} changed meanwhile; nothing was written` }
  );
  return ok;
}
