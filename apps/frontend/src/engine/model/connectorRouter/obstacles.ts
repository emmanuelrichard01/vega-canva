/**
 * What a connector routes around, and the per-connector inputs the router
 * needs from the board.
 *
 * Routes go around the things a diagram is made of: shapes, stickies, text,
 * images, tables, charts, cards. They pass over the things that are not
 * places: other connectors, comments, ink, open lines and arrows, frames
 * (containers, not obstacles, as in FigJam), hidden objects and grids used
 * only as guides.
 */

import { isOpenShape, type AnyNode, type ConnectorNode } from '../schema';
import { nodeBounds } from '../../SceneGraph';
import type { LiveTransform } from '../liveTransformStore';
import { inflate, intersects, type Rect } from './geometry';
import { OBSTACLE_MARGIN, type Obstacle } from './router';
import { CHANNEL_GAP } from './network';

/** Whether a node is something routes keep clear of. */
export function blocksRoutes(node: AnyNode): boolean {
  if (node.hidden) return false;
  switch (node.type) {
    case 'connector':
    case 'comment':
    case 'path':
    case 'frame':
      return false;
    case 'shape': {
      const kind = (node as { geometry?: { kind?: string } }).geometry?.kind;
      return !(kind && isOpenShape(kind as never));
    }
    case 'grid': {
      const mode = (node as { grid?: { style?: { mode?: string } } }).grid?.style?.mode;
      return mode !== 'guide';
    }
    default:
      return true;
  }
}

/**
 * A node's world box, rotation-aware, with a gesture's live position and
 * size laid over the committed one.
 */
export function nodeRect(node: AnyNode, live?: LiveTransform): Rect {
  if (!live) return nodeBounds(node);
  const resized = live.width !== undefined || live.height !== undefined;
  return nodeBounds({
    ...node,
    x: live.x ?? node.x,
    y: live.y ?? node.y,
    width: live.width ?? node.width,
    height: live.height ?? node.height,
    rotation: live.rotation ?? node.rotation,
    // A live resize publishes folded dimensions, already scaled.
    ...(resized ? { scaleX: 1, scaleY: 1 } : null),
  } as AnyNode);
}

export interface ObstacleCandidate {
  node: AnyNode;
  rect: Rect;
}

/**
 * The inflated obstacles inside a corridor, sorted by id so the router sees
 * the same list whatever order the board handed them over in.
 */
export function obstaclesIn(
  candidates: Iterable<ObstacleCandidate>,
  corridor: Rect,
  exclude: ReadonlySet<string>
): Obstacle[] {
  const out: Obstacle[] = [];
  for (const { node, rect } of candidates) {
    if (exclude.has(node.id) || !blocksRoutes(node)) continue;
    const inflated = inflate(rect, OBSTACLE_MARGIN);
    if (!intersects(inflated, corridor)) continue;
    out.push({ id: node.id, rect: inflated });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Both bound ends of a connector, as an order-free pair key, or null. */
export function pairKey(node: Pick<ConnectorNode, 'from' | 'to'>): string | null {
  const a = node.from.nodeId;
  const b = node.to.nodeId;
  if (!a || !b) return null;
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * How far each connector that shares both objects with another slides its
 * ends, so a bundle of them fans out along the sides instead of drawing one
 * line. Ordered by id, so every client agrees on who takes which lane.
 */
export function pairShifts(objects: Record<string, AnyNode>): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const node of Object.values(objects)) {
    if (node.type !== 'connector') continue;
    const key = pairKey(node as ConnectorNode);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(node.id);
    groups.set(key, list);
  }
  const out = new Map<string, number>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    const centre = (ids.length - 1) / 2;
    ids.forEach((id, i) => out.set(id, (i - centre) * CHANNEL_GAP));
  }
  return out;
}

const shiftCache = new WeakMap<object, Map<string, number>>();

/** `pairShifts`, computed once per board snapshot. */
export function pairShiftFor(objects: Record<string, AnyNode>, id: string): number {
  let map = shiftCache.get(objects);
  if (!map) {
    map = pairShifts(objects);
    shiftCache.set(objects, map);
  }
  return map.get(id) ?? 0;
}
