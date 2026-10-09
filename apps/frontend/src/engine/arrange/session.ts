import { applyNodePatches, undoManager } from '../document';
import { liveTransformStore } from '../model/liveTransformStore';
import { canEditObjects } from '../model/permissions';
import type { AnyNode } from '../model/schema';
import type { GroupRecord } from '../model/groupTree';
import type { NodePatch } from '../model/selection';
import { guessGrid, layoutGrid, moveInOrder, normaliseSpec, slotAt, type GridLayout, type GridSpec } from './grid';
import { arrangeUnits, memberPatches, type ArrangeUnit } from './units';

/**
 * The live grid, while it is being adjusted.
 *
 * ## Live on the board, one step in the history
 *
 * Every change (columns, a gap scrubbed or dragged on the board, an item
 * dragged to a new slot) is drawn at once through `liveTransformStore`, the
 * board's own channel for a gesture in progress: the objects, their connectors
 * and the selection box all follow it, and nothing is written to the document.
 * Settling writes every position in one `applyNodePatches`, between two
 * capture breaks, so the whole session is exactly one undo step and peers see
 * one move rather than a stream of them.
 *
 * ## Ending
 *
 * Settled by Enter, Done, a press anywhere off the grid's own handles, a
 * selection change, or any other key (so an undo pressed now undoes the whole
 * grid). Escape reverts. Nothing is left live when it ends, whichever way.
 */

export interface ArrangeSessionState {
  /** The selection it was started for, as sorted ids joined. */
  selection: string;
  units: ArrangeUnit[];
  order: string[];
  spec: GridSpec;
  origin: { x: number; y: number };
  layout: GridLayout;
  /** An item being dragged to a new slot: where the pointer holds it, and the slot it would take. */
  drag: { key: string; grab: { dx: number; dy: number }; at: { x: number; y: number }; to: number } | null;
  /** Locked objects left where they are. */
  locked: number;
}

type Listener = () => void;

let state: ArrangeSessionState | null = null;
const listeners = new Set<Listener>();
let detachKeys: (() => void) | null = null;

const selectionKey = (ids: readonly string[]) => [...ids].sort().join(',');

function emit(next: ArrangeSessionState | null): void {
  state = next;
  listeners.forEach((fn) => fn());
}

function relayout(s: ArrangeSessionState, order = s.order, spec = s.spec): GridLayout {
  const byKey = new Map(s.units.map((u) => [u.key, u]));
  const items = order.map((key) => {
    const box = byKey.get(key)!.box;
    return { key, width: box.width, height: box.height };
  });
  return layoutGrid(items, spec, s.origin);
}

/** How far each unit moves to reach its slot, the dragged one following the pointer. */
function deltasOf(s: ArrangeSessionState): Map<string, { dx: number; dy: number }> {
  const byKey = new Map(s.units.map((u) => [u.key, u]));
  const out = new Map<string, { dx: number; dy: number }>();
  for (const cell of s.layout.cells) {
    const unit = byKey.get(cell.key);
    if (!unit) continue;
    if (s.drag && s.drag.key === cell.key) {
      out.set(cell.key, { dx: s.drag.at.x - s.drag.grab.dx - unit.box.x, dy: s.drag.at.y - s.drag.grab.dy - unit.box.y });
    } else {
      out.set(cell.key, { dx: cell.place.x - unit.box.x, dy: cell.place.y - unit.box.y });
    }
  }
  return out;
}

function publish(s: ArrangeSessionState): void {
  const deltas = deltasOf(s);
  const batch: Array<[string, { x: number; y: number }]> = [];
  for (const unit of s.units) {
    const d = deltas.get(unit.key) ?? { dx: 0, dy: 0 };
    for (const node of unit.members) batch.push([node.id, { x: node.x + d.dx, y: node.y + d.dy }]);
  }
  liveTransformStore.setBatch(batch);
}

function memberIds(s: ArrangeSessionState): string[] {
  return s.units.flatMap((u) => u.members.map((n) => n.id));
}

function onKey(e: KeyboardEvent): void {
  if (!state) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  // Modifiers, and Space, which pans the board to look at the grid.
  if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta' || e.key === ' ') return;
  // On the rail or in its panels the keys are the controls' own (Tab, arrows,
  // Enter on a button); only Escape still means "put it back".
  const onRail = Boolean(target?.closest?.('.ctx-toolbar, .ctx-popover'));
  if (onRail && e.key !== 'Escape') return;
  if (e.key === 'Escape') {
    // From a panel the key carries on, so the panel closes and hands focus
    // back to its button; on the board it stops here, so the selection stays.
    if (!onRail) {
      e.preventDefault();
      e.stopPropagation();
    }
    arrangeSession.cancel();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    arrangeSession.commit();
    return;
  }
  // Anything else settles first and then does what it does: an undo pressed
  // now takes the whole grid back in one step.
  arrangeSession.commit();
}

function attachKeys(): void {
  if (detachKeys || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKey, true);
  detachKeys = () => window.removeEventListener('keydown', onKey, true);
}

function finish(): void {
  detachKeys?.();
  detachKeys = null;
}

export const arrangeSession = {
  get(): ArrangeSessionState | null {
    return state;
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Whether a session is running for exactly this selection. */
  activeFor(ids: readonly string[]): boolean {
    return state !== null && state.selection === selectionKey(ids);
  },

  /**
   * Begin a live grid for a selection, reading the grid it is already trying
   * to be. Returns false when there is nothing to lay out (fewer than two
   * movable objects) or this person cannot edit the board.
   */
  start(
    nodes: readonly AnyNode[],
    objects: Readonly<Record<string, AnyNode>>,
    groups: Readonly<Record<string, GroupRecord>> = {}
  ): boolean {
    if (!canEditObjects()) return false;
    const ids = nodes.map((n) => n.id);
    if (arrangeSession.activeFor(ids)) return true;
    if (state) arrangeSession.commit();
    const { units, locked } = arrangeUnits(nodes, objects, groups);
    if (units.length < 2) return false;
    const guess = guessGrid(units.map((u) => ({ key: u.key, box: u.box })));
    const draft: ArrangeSessionState = {
      selection: selectionKey(ids),
      units,
      order: guess.order,
      spec: guess.spec,
      origin: guess.origin,
      layout: null as unknown as GridLayout,
      drag: null,
      locked,
    };
    draft.layout = relayout(draft);
    attachKeys();
    emit(draft);
    publish(draft);
    return true;
  },

  /** Change the columns, gaps or cell alignment. */
  update(patch: Partial<GridSpec>): void {
    if (!state) return;
    const spec = normaliseSpec({ ...state.spec, ...patch }, state.units.length);
    const next = { ...state, spec };
    next.layout = relayout(next);
    emit(next);
    publish(next);
  },

  /** Pick up an item at a world point. */
  beginDrag(key: string, at: { x: number; y: number }): void {
    if (!state) return;
    const unit = state.units.find((u) => u.key === key);
    const cell = state.layout.cells.find((c) => c.key === key);
    if (!unit || !cell) return;
    const next = {
      ...state,
      drag: { key, grab: { dx: at.x - cell.place.x, dy: at.y - cell.place.y }, at, to: cell.index },
    };
    emit(next);
  },

  /** Carry the dragged item; the others close up around the slot under it. */
  moveDrag(at: { x: number; y: number }): void {
    if (!state?.drag) return;
    const { drag } = state;
    // Measured against the layout without the item lifted, so the slot under
    // the pointer does not shift because the item left it.
    const resting = relayout(state, moveInOrder(state.order, drag.key, drag.to));
    const centre = {
      x: at.x - drag.grab.dx + (state.units.find((u) => u.key === drag.key)?.box.width ?? 0) / 2,
      y: at.y - drag.grab.dy + (state.units.find((u) => u.key === drag.key)?.box.height ?? 0) / 2,
    };
    const to = slotAt(resting, centre);
    const next = { ...state, drag: { ...drag, at, to } };
    next.layout = to === drag.to ? state.layout : relayout(next, moveInOrder(state.order, drag.key, to));
    emit(next);
    publish(next);
  },

  /** Drop the dragged item into its slot. */
  endDrag(): void {
    if (!state?.drag) return;
    const order = moveInOrder(state.order, state.drag.key, state.drag.to);
    const next = { ...state, order, drag: null };
    next.layout = relayout(next);
    emit(next);
    publish(next);
  },

  /** The positions settling would write. */
  patches(): NodePatch[] {
    if (!state) return [];
    const settled = state.drag ? { ...state, drag: null, order: moveInOrder(state.order, state.drag.key, state.drag.to) } : state;
    if (state.drag) settled.layout = relayout(settled);
    return memberPatches(settled.units, deltasOf(settled));
  },

  /** Write the grid as one undo step and end the session. */
  commit(): void {
    if (!state) return;
    const patches = arrangeSession.patches();
    const ids = memberIds(state);
    finish();
    emit(null);
    if (patches.length > 0) {
      undoManager.stopCapturing();
      applyNodePatches(patches);
      undoManager.stopCapturing();
    }
    // After the write, so the objects never flash back to where they started.
    liveTransformStore.deleteBatch(ids);
  },

  /** Put everything back and end the session. */
  cancel(): void {
    if (!state) return;
    const ids = memberIds(state);
    finish();
    emit(null);
    liveTransformStore.deleteBatch(ids);
  },
};
