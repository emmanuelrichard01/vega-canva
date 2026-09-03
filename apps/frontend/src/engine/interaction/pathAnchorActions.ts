import { deleteNode, updateNode } from '../document';
import { useStore } from '../../hooks/useStore';
import {
  alignAnchors,
  anchorBounds,
  contours,
  deleteAnchors,
  moveAnchors,
  setAnchorsMode,
  type AnchorRef,
} from '../model/pathEditing';
import { reframePath, type ContourGeometry } from '../model/pathGeometry';
import type { HandleMode } from '../model/pathGeometry';
import { flattenToPath } from '../document/vectorOps';
import type { AlignEdge } from '../model/align';
import { pathEdit } from './pathEdit';

/** The path currently open for editing, and its geometry, or `null`. */
function editing(): { id: string; node: { x: number; y: number }; geometry: ContourGeometry; anchors: AnchorRef[] } | null {
  const selection = pathEdit.getSnapshot();
  if (!selection) return null;
  const node = useStore.getState().objects[selection.nodeId];
  if (!node || node.type !== 'path' || node.geometry.kind === 'freehand') return null;
  return { id: node.id, node, geometry: node.geometry, anchors: selection.anchors };
}

/** Write an edited geometry back from outside the component. */
function write(id: string, node: { x: number; y: number }, next: ContourGeometry | null) {
  if (!next) {
    deleteNode(id);
    pathEdit.exit();
    return;
  }
  const framed = reframePath(next);
  updateNode(id, {
    geometry: framed.geometry,
    x: node.x + framed.dx,
    y: node.y + framed.dy,
    width: framed.width,
    height: framed.height,
  });
}

/**
 * Delete every picked anchor, if any are picked.
 */
export function deletePickedAnchor(): boolean {
  const state = editing();
  if (!state || state.anchors.length === 0) return false;

  const { geometry, selection } = deleteAnchors(state.geometry, state.anchors);
  write(state.id, state.node, geometry);
  if (geometry) pathEdit.select(selection);
  return true;
}

/**
 * Nudge the picked anchors, if any are picked.
 */
export function nudgePickedAnchors(dx: number, dy: number): boolean {
  const state = editing();
  if (!state || state.anchors.length === 0) return false;
  write(state.id, state.node, moveAnchors(state.geometry, state.anchors, dx, dy));
  return true;
}

/** Straighten or round the picked anchors (or all anchors if none picked). Returns whether anything happened. */
export function setPickedAnchorMode(mode: HandleMode): boolean {
  const state = editing();
  if (!state) return false;
  const targetAnchors = state.anchors.length > 0
    ? state.anchors
    : contours(state.geometry).flatMap((c) => c.anchors.map((_, index) => ({ sub: c.sub, index })));
  if (targetAnchors.length === 0) return false;
  write(state.id, state.node, setAnchorsMode(state.geometry, targetAnchors, mode));
  return true;
}

/**
 * Straighten or round every anchor across multiple selected paths/shapes.
 */
export function setMultiplePathsAnchorMode(ids: readonly string[], mode: HandleMode): boolean {
  const objects = useStore.getState().objects;
  let changed = false;
  for (const id of ids) {
    let node = objects[id];
    if (!node) continue;
    if (node.type === 'shape') {
      const newId = flattenToPath(id);
      if (!newId) continue;
      node = useStore.getState().objects[newId];
    }
    if (node && node.type === 'path' && node.geometry.kind !== 'freehand') {
      const allRefs = contours(node.geometry).flatMap((c) =>
        c.anchors.map((_, index) => ({ sub: c.sub, index }))
      );
      if (allRefs.length === 0) continue;
      const next = setAnchorsMode(node.geometry, allRefs, mode);
      const framed = reframePath(next);
      updateNode(node.id, {
        geometry: framed.geometry,
        x: node.x + framed.dx,
        y: node.y + framed.dy,
        width: framed.width,
        height: framed.height,
      });
      changed = true;
    }
  }
  return changed;
}

/** Line the picked anchors up. Returns whether anything happened. */
export function alignPickedAnchors(edge: AlignEdge): boolean {
  const state = editing();
  if (!state || state.anchors.length < 2) return false;
  write(state.id, state.node, alignAnchors(state.geometry, state.anchors, edge));
  return true;
}

/** How many anchors are picked, and the box they occupy. For the toolbar. */
export function pickedAnchorSummary(): { count: number; width: number; height: number } | null {
  const state = editing();
  if (!state) return null;
  const box = anchorBounds(state.geometry, state.anchors);
  return { count: state.anchors.length, width: box?.width ?? 0, height: box?.height ?? 0 };
}

/** Select every anchor on the open path. */
export function selectAllAnchors(): boolean {
  const state = editing();
  if (!state) return false;
  pathEdit.select(contours(state.geometry).flatMap((c) => c.anchors.map((_, index) => ({ sub: c.sub, index }))));
  return true;
}
