/**
 * Commands the line editor issues that write to the document.
 *
 * The sibling of `pathAnchorActions`, and here for the same two reasons. One:
 * the keys that trigger them are handled by the canvas, because a Konva shape
 * has no focus and therefore no keydown of its own — and the canvas should not
 * have to know how a line stores its vertices. Two: keeping them out of
 * `LineEditor.tsx` keeps that file exporting only a component, which is what
 * Vite's fast refresh needs in order to work at all.
 */

import { updateNode } from '../document';
import { lineNodeFromVertices, localBends, worldVertices } from '../model/lineEnds';
import { MIN_VERTICES, removeVertex } from '../model/polyline';
import type { ShapeNode } from '../model/schema';
import { lineEdit } from './lineEdit';

/**
 * Remove the picked vertex, if there is one and the line can spare it.
 *
 * Returns whether anything happened, so the caller can let `Delete` fall
 * through to deleting the whole object when it did not. That fall-through is
 * the point: a key that silently does nothing is worse than one that does the
 * broader thing, and "the line is down to two points" is not a state anyone can
 * see before pressing.
 */
export function deletePickedVertex(node: ShapeNode, vertex: number | null): boolean {
  if (vertex === null) return false;
  const vertices = worldVertices(node);
  if (vertices.length <= MIN_VERTICES) return false;

  const next = removeVertex(vertices, localBends(node, vertices.length), vertex);
  if (next.vertices.length === vertices.length) return false;

  updateNode(
    node.id,
    lineNodeFromVertices(next.vertices, next.bends, node.geometry, node.appearance?.stroke?.width ?? 2)
  );
  // The pick would otherwise point past the end of a shorter run, and the next
  // Delete would silently do nothing.
  lineEdit.pick(Math.min(vertex, next.vertices.length - 1));
  return true;
}
