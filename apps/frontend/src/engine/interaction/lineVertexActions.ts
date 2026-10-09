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

import { nanoid } from 'nanoid';
import { createNode, deleteNode, doc, updateNode } from '../document';
import { lineNodeFromVertices, localBends, worldVertices } from '../model/lineEnds';
import { connectorFromLine } from '../model/lineBinding';
import type { ConnectorEnd, Point, Routing } from '../model/connector';
import { connectorDefaults } from '../tools/connectorDefaults';
import { ThemeService } from '../ThemeService';
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

/**
 * Round every corner of a line at once, or give the corners back.
 *
 * ## Why this is a flag and not a pass over the bends
 *
 * The first version wrote a bend into every segment, which produced a curvy
 * line with its corners intact — bowing a segment bends the middle of it and
 * leaves the ends where they were, so every sharp turn was still a sharp turn
 * between two arcs. Rounding a corner means the run leaves and arrives at that
 * point along one shared direction, and no arrangement of per-segment
 * quadratics can promise that; see `catmullRomPoints`.
 *
 * So this sets `geometry.smooth` and the renderer draws a spline through the
 * same points. Nothing is destroyed: any bends the user had dragged sit
 * underneath untouched, and turning it off gives back exactly the shape that
 * was there. That is the whole reason it is a flag — a pass that rewrote the
 * bends could not be undone without remembering what it overwrote.
 */
export function setLineCurved(node: ShapeNode, curved: boolean): void {
  const vertices = worldVertices(node);
  updateNode(
    node.id,
    lineNodeFromVertices(
      vertices,
      localBends(node, vertices.length),
      // `undefined` rather than `false`, so a line that was never smoothed does
      // not carry a field restating the default.
      { ...node.geometry, smooth: curved ? true : undefined },
      node.appearance?.stroke?.width ?? 2
    )
  );
}

/** Whether the run is currently drawn as a curve, so the control can say which. */
export function isLineCurved(node: ShapeNode): boolean {
  return node.geometry.smooth === true;
}

/**
 * Turn a line whose two ends now sit on two objects into a connector.
 *
 * The same rule the tool applies when a line is drawn between two objects
 * (`lineBinding.promotion`), reached by dragging an end of an existing line
 * instead. One transaction, so it is one undo step and nobody else ever sees
 * both objects or neither. Returns the connector's id, for the selection.
 */
export function promoteLineToConnector(
  node: ShapeNode,
  ends: { from: ConnectorEnd; to: ConnectorEnd; a: Point; b: Point; routing: Routing }
): string {
  const id = nanoid();
  const stroke = node.appearance?.stroke;
  doc.transact(() => {
    createNode(
      connectorFromLine({
        id,
        ...ends,
        endStart: node.geometry.endStart ?? 'none',
        endEnd: node.geometry.endEnd ?? 'none',
        stroke: {
          color: stroke?.color ?? ThemeService.getDefaultStrokeColor(),
          width: stroke?.width || 2,
          dash: stroke?.dash,
        },
        avoid: connectorDefaults.getSnapshot().avoid,
        label: node.text,
      })
    );
    deleteNode(node.id);
  });
  return id;
}

/**
 * A line's fields with its geometry changed and its box recomputed.
 *
 * Every change that alters what a line *draws* — its profile, its heads, their
 * size — changes the extent of the drawing too: a wave stands off the run, a
 * head reaches past the end. Writing the geometry alone leaves a box that
 * marquee selection, culling and export framing read wrongly, so every such
 * change goes through `lineNodeFromVertices`, as drawing and reshaping do.
 */
export function reshapedLine(node: ShapeNode, patch: Partial<ShapeNode['geometry']>) {
  const vertices = worldVertices(node);
  return lineNodeFromVertices(
    vertices,
    localBends(node, vertices.length),
    { ...node.geometry, ...patch },
    node.appearance?.stroke?.width || 2
  );
}

/** Write a geometry change to a line, box included — see `reshapedLine`. */
export function reshapeLine(node: ShapeNode, patch: Partial<ShapeNode['geometry']>): void {
  updateNode(node.id, reshapedLine(node, patch));
}

/**
 * Point the line the other way, in one step.
 *
 * The heads trade ends rather than the run reversing: the same picture with
 * the direction turned round, which is what "swap" means in FigJam and Miro,
 * and the line does not move under the pointer.
 */
export function swapLineEnds(node: ShapeNode): void {
  reshapeLine(node, {
    endStart: node.geometry.endEnd ?? 'none',
    endEnd: node.geometry.endStart ?? 'none',
  });
}
