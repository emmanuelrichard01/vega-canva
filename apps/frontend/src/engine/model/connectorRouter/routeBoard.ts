/**
 * Routing from a plain snapshot of the board, with no live state: the commit
 * path's derived boxes, the SVG export and tests.
 *
 * The canvas routes through `routeStore` instead, which adds gestures in
 * flight and reroutes incrementally. Both build their options here, so a
 * connector takes the same route on the board and in the file.
 */

import RBush from 'rbush';
import type { AnyNode, ConnectorNode } from '../schema';
import { connectorRoute, type Box, type Point, type RouteOptions } from '../connector';
import { inflate, type Rect } from './geometry';
import { blocksRoutes, nodeRect, obstaclesIn, pairShiftFor, type ObstacleCandidate } from './obstacles';
import { OBSTACLE_MARGIN, type Segment } from './router';
import { adjustNetwork, type JumpStyle, type NetworkRoute } from './network';
import type { Hop } from './pathOps';

interface CandidateItem extends Rect {
  candidate: ObstacleCandidate;
}

/** Every object routes keep clear of on a snapshot, indexed by area, built once per snapshot. */
const candidateIndexes = new WeakMap<object, RBush<CandidateItem>>();

function candidateIndex(objects: Record<string, AnyNode>): RBush<CandidateItem> {
  let tree = candidateIndexes.get(objects);
  if (!tree) {
    tree = new RBush<CandidateItem>(9);
    const items: CandidateItem[] = [];
    for (const node of Object.values(objects)) {
      if (!blocksRoutes(node)) continue;
      const rect = nodeRect(node);
      items.push({ ...rect, candidate: { node, rect } });
    }
    tree.load(items);
    candidateIndexes.set(objects, tree);
  }
  return tree;
}

/** Whether a connector is drawn at all: hidden ones are neither routed nor read by others. */
export function isRoutedConnector(node: AnyNode | undefined): node is ConnectorNode {
  return Boolean(node && node.type === 'connector' && !node.hidden);
}

/** The line-jump style a connector draws with, after the board default. */
export function jumpStyleOf(node: ConnectorNode, boardDefault?: JumpStyle | null): JumpStyle {
  if (node.routing === 'curved') return 'none';
  if (node.jumps) return node.jumps;
  if (boardDefault) return boardDefault;
  return node.avoid ? 'arc' : 'none';
}

/** Router options for one connector, read from a snapshot of the board. */
export function boardOptions(
  node: ConnectorNode,
  objects: Record<string, AnyNode>,
  segmentsIn?: (corridor: Rect) => readonly Segment[]
): RouteOptions {
  const exclude = new Set<string>([node.id]);
  if (node.from.nodeId) exclude.add(node.from.nodeId);
  if (node.to.nodeId) exclude.add(node.to.nodeId);
  return {
    avoid: Boolean(node.avoid),
    obstaclesIn: (corridor) => {
      // Grown by the margin: an object just outside the corridor still
      // blocks it once inflated.
      const near = candidateIndex(objects).search(inflate(corridor, OBSTACLE_MARGIN));
      return obstaclesIn(
        near.map((item) => item.candidate),
        corridor,
        exclude
      );
    },
    segmentsIn,
    ownRectOf: (id) => (objects[id] ? nodeRect(objects[id]) : null),
    nudges: node.nudges,
    pairShift: pairShiftFor(objects, node.id),
  };
}

export interface BoardRoute {
  points: Point[];
  hops: Hop[];
  orthogonal: boolean;
  curved: boolean;
  degraded: boolean;
}

function segmentsOf(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    out.push({ x1: points[i].x, y1: points[i].y, x2: points[i + 1].x, y2: points[i + 1].y });
  }
  return out;
}

interface SegmentItem extends Rect {
  segment: Segment;
  /** Draw order, so a corridor's segments come back in the order they were drawn. */
  order: number;
}

function segmentItem(s: Segment, order: number): SegmentItem {
  return {
    minX: Math.min(s.x1, s.x2),
    minY: Math.min(s.y1, s.y2),
    maxX: Math.max(s.x1, s.x2),
    maxY: Math.max(s.y1, s.y2),
    segment: s,
    order,
  };
}

/**
 * Every connector on a snapshot, routed in id order, then spread and jumped
 * as a network. Each route's crossing penalty counts only connectors routed
 * before it, which is what makes the order, and so the result, fixed.
 */
export function routeBoard(
  objects: Record<string, AnyNode>,
  lookups: {
    boxOf: (id: string) => Box | null;
    attachOf: ((id: string, p: Point) => Point | null) | null;
  },
  boardJumps?: JumpStyle | null
): Map<string, BoardRoute> {
  const connectors = Object.values(objects)
    .filter(isRoutedConnector)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const drawn = new RBush<SegmentItem>(9);
  let drawnCount = 0;
  const network: NetworkRoute[] = [];
  const raw: Array<{ degraded: boolean; orthogonal: boolean; curved: boolean }> = [];

  for (const node of connectors) {
    const options = boardOptions(node, objects, (corridor) =>
      drawn
        .search(corridor)
        .sort((p, q) => p.order - q.order)
        .map((item) => item.segment)
    );
    const route = connectorRoute(node.from, node.to, node.routing, lookups.boxOf, lookups.attachOf, options);
    if (route.orthogonal) for (const s of segmentsOf(route.points)) drawn.insert(segmentItem(s, drawnCount++));
    network.push({
      id: node.id,
      points: route.points,
      orthogonal: route.orthogonal,
      curved: node.routing === 'curved',
      skeleton: route.skeleton,
      clearance: route.clearance,
      zIndex: node.zIndex ?? 0,
      jumps: jumpStyleOf(node, boardJumps),
      strokeWidth: node.appearance?.stroke?.width ?? 2,
    });
    raw.push({ degraded: route.degraded, orthogonal: route.orthogonal, curved: node.routing === 'curved' });
  }

  const adjusted = adjustNetwork(network);
  const out = new Map<string, BoardRoute>();
  connectors.forEach((node, i) => {
    out.set(node.id, { points: adjusted[i].points, hops: adjusted[i].hops, ...raw[i] });
  });
  return out;
}
