/**
 * The one place connector routes are computed for the canvas.
 *
 * Renderers subscribe per connector id and read finished routes; nothing else
 * routes on the board. The store keeps every connector's route cached, decides
 * which ones a change can affect, reroutes those within a per-frame budget,
 * then runs the network passes (channel spreading and line jumps) over the
 * whole set and notifies only the connectors whose drawing changed.
 *
 * ## What reroutes when
 *
 * - A connector that changed, or whose objects changed or moved.
 * - A connector that avoids, when something moved into its way or away from
 *   beside it.
 * - Connectors sharing both objects with one that was added or removed.
 * - A connector that avoids, when a lower-id route overlapping it changed (the crossing penalty reads lower-id routes only, which is what
 *   makes the result independent of the order things happened in).
 *
 * During a gesture the moving objects' live boxes are used and the work is
 * capped at `FRAME_BUDGET_MS` per frame, bound connectors first. Whatever does
 * not fit keeps its last route and finishes on the next frame.
 */

import type { AnyNode, ConnectorNode } from '../schema';
import { connectorRoute, type Box, type ConnectorRoute, type Point } from '../connector';
import { attachPoint, boxOfNode } from '../connectorTargets';
import type { LiveTransform } from '../liveTransformStore';
import { boundsOfPoints, inflate, intersects, type Rect } from './geometry';
import { blocksRoutes, nodeRect, obstaclesIn, pairKey, pairShifts, type ObstacleCandidate } from './obstacles';
import { OBSTACLE_MARGIN, type Segment } from './router';
import {
  CHANNEL_GAP,
  bundleClosure,
  interiorSegments,
  pairHops,
  spreadChannels,
  type JumpStyle,
  type NetworkRoute,
} from './network';
import type { Hop } from './pathOps';
import { jumpStyleOf } from './routeBoard';

/** Routing work allowed per animation frame. */
export const FRAME_BUDGET_MS = 3;

export interface RouteOutput {
  points: Point[];
  /** Flat, for Konva. */
  flat: number[];
  hops: Hop[];
  orthogonal: boolean;
  curved: boolean;
  degraded: boolean;
}

export interface RouteEnv {
  getObjects: () => Record<string, AnyNode>;
  /** Ids that changed in the latest snapshot, or null when unknown (route everything). */
  getChanges: () => { changed: readonly string[]; removed: readonly string[] } | null;
  subscribeObjects: (fn: () => void) => () => void;
  getLive: (id: string) => LiveTransform | undefined;
  liveIds: () => string[];
  subscribeLive: (fn: () => void) => () => void;
  /** Nodes whose committed bounds meet a rect. */
  query: (rect: Rect) => AnyNode[];
  now: () => number;
  /** Schedule `fn` on the next frame; returns a cancel. */
  frame: (fn: () => void) => () => void;
  boardJumps: () => JumpStyle | null;
}

interface Entry {
  route: ConnectorRoute;
  /** Where a change can affect this route. */
  corridor: Rect;
  bbox: Rect;
}

function corridorOf(points: readonly Point[]): { corridor: Rect; bbox: Rect } {
  const bbox = boundsOfPoints(points);
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  return { bbox, corridor: inflate(bbox, Math.max(96, diag * 0.35)) };
}

function sameOutput(a: RouteOutput, b: RouteOutput): boolean {
  if (a.orthogonal !== b.orthogonal || a.curved !== b.curved || a.degraded !== b.degraded) return false;
  if (a.flat.length !== b.flat.length || a.hops.length !== b.hops.length) return false;
  for (let i = 0; i < a.flat.length; i += 1) if (Math.abs(a.flat[i] - b.flat[i]) > 0.01) return false;
  for (let i = 0; i < a.hops.length; i += 1) {
    const p = a.hops[i];
    const q = b.hops[i];
    if (p.seg !== q.seg || p.kind !== q.kind || Math.abs(p.at - q.at) > 0.01 || p.half !== q.half) return false;
  }
  return true;
}

/**
 * Whether a box comes near a route: within reach of any of its segments.
 *
 * Only an obstacle near the path can change it. One that blocks the path is on
 * it; one whose removal would shorten it was next to it, forcing the detour.
 * Anything farther away leaves the route as it is.
 */
const PATH_REACH = OBSTACLE_MARGIN + CHANNEL_GAP * 2;

/**
 * How far from a route an object can sit and still be what bent it: a detour
 * runs down the middle of whatever channel it found, which can be some way
 * off the object it goes around.
 */
function detourReach(bbox: Rect): number {
  const short = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  return Math.max(PATH_REACH, Math.min(240, short * 0.6));
}

function touchesPath(points: readonly Point[], r: Rect, reach: number): boolean {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    if (
      Math.min(p.x, q.x) - reach <= r.maxX &&
      Math.max(p.x, q.x) + reach >= r.minX &&
      Math.min(p.y, q.y) - reach <= r.maxY &&
      Math.max(p.y, q.y) + reach >= r.minY
    ) {
      return true;
    }
  }
  return false;
}

function segmentsOf(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    out.push({ x1: points[i].x, y1: points[i].y, x2: points[i + 1].x, y2: points[i + 1].y });
  }
  return out;
}

export class RouteStore {
  private entries = new Map<string, Entry>();
  private outputs = new Map<string, RouteOutput>();
  private listeners = new Map<string, Set<() => void>>();
  private urgent = new Set<string>();
  private pending = new Set<string>();
  private snapshot: Record<string, AnyNode> | null = null;
  private shifts = new Map<string, number>();
  private moving = new Set<string>();
  private lastLive = new Map<string, Rect>();
  private cancelFrame: (() => void) | null = null;
  private networkDirty = false;
  /** Routes whose drawing changed, and areas a route left, since the last network pass. */
  private netSeeds = new Set<string>();
  /** Interior legs routes had before they changed or left, for finding the bundles they leave. */
  private netGoneSegs: ReturnType<typeof interiorSegments> = [];
  private netGone = new Set<string>();
  /** Points after channel spreading, per route. */
  private spread = new Map<string, Point[]>();
  /** The jumps each route draws because of each other route. */
  private pairs = new Map<string, Map<string, Hop[]>>();
  /** A moving average of one route's cost, so a frame stops before it overruns. */
  private routeCost = 0.5;
  private disposers: Array<() => void> = [];
  /** Sum of routing time in the last frame, for the perf HUD and tests. */
  lastFrameMs = 0;
  degradedCount = 0;

  private env: RouteEnv;

  constructor(env: RouteEnv) {
    this.env = env;
  }

  /** Start listening. Separate from the constructor so tests control timing. */
  attach(): void {
    if (this.disposers.length > 0) return;
    this.disposers.push(this.env.subscribeObjects(() => this.onObjects()));
    this.disposers.push(this.env.subscribeLive(() => this.onLive()));
    this.onObjects();
  }

  detach(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.cancelFrame?.();
    this.cancelFrame = null;
  }

  subscribe(id: string, fn: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(fn);
    this.attach();
    return () => {
      set?.delete(fn);
      if (set && set.size === 0) this.listeners.delete(id);
    };
  }

  /**
   * The finished route for a connector.
   *
   * A connector the store has not seen yet is routed on the spot, so a newly
   * mounted renderer never draws an empty frame; the network passes catch up
   * on the next frame.
   */
  get(id: string): RouteOutput | null {
    const out = this.outputs.get(id);
    if (out) return out;
    const objects = this.objects();
    const node = objects[id];
    if (!node || node.type !== 'connector') return null;
    this.routeOne(node as ConnectorNode, objects);
    const entry = this.entries.get(id);
    if (!entry) return null;
    const fresh: RouteOutput = {
      points: entry.route.points,
      flat: entry.route.points.flatMap((p) => [p.x, p.y]),
      hops: [],
      orthogonal: entry.route.orthogonal,
      curved: node.routing === 'curved',
      degraded: entry.route.degraded,
    };
    this.outputs.set(id, fresh);
    this.networkDirty = true;
    this.netSeeds.add(id);
    this.schedule();
    return fresh;
  }

  /** Route everything outstanding now, ignoring the budget. For export and tests. */
  flush(): void {
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.run(Infinity);
  }

  private objects(): Record<string, AnyNode> {
    const current = this.env.getObjects();
    if (current !== this.snapshot) {
      this.snapshot = current;
      this.shifts = pairShifts(current);
    }
    return current;
  }

  private onObjects(): void {
    const before = this.snapshot;
    const objects = this.objects();
    const changes = this.env.getChanges();
    if (!before || !changes) {
      for (const node of Object.values(objects)) if (node.type === 'connector') this.pending.add(node.id);
      this.schedule();
      return;
    }
    const touched: string[] = [];
    for (const id of changes.removed) {
      this.forget(id);
      touched.push(id);
    }
    for (const id of changes.changed) touched.push(id);

    for (const id of touched) {
      const node = objects[id];
      const was = before[id];
      if (node?.type === 'connector' || was?.type === 'connector') {
        if (node) {
          this.pending.add(id);
          // Stacking or jump style may have changed without the route moving.
          this.netSeeds.add(id);
        }
        // A connector arriving or leaving reshuffles the lanes of its pair.
        const key = pairKey((node ?? was) as ConnectorNode);
        if (key) this.markPair(key, objects);
        this.networkDirty = true;
        continue;
      }
      this.markAround(id, was ? nodeRect(was) : undefined, node ? nodeRect(node) : undefined, objects, false);
    }
    this.schedule();
  }

  private onLive(): void {
    const objects = this.objects();
    const now = new Set(this.env.liveIds());
    const affected = new Set<string>([...now, ...this.moving]);
    this.moving = now;
    for (const id of affected) {
      const node = objects[id];
      if (!node || node.type === 'connector') {
        if (node) this.urgent.add(id);
        this.lastLive.delete(id);
        continue;
      }
      const live = this.env.getLive(id);
      const current = live ? nodeRect(node, live) : nodeRect(node);
      // Compared with where it was last frame, so a shape sliding past a far
      // route reroutes it once, as it passes, not on every frame of the drag.
      const previous = this.lastLive.get(id) ?? nodeRect(node);
      if (live) this.lastLive.set(id, current);
      else this.lastLive.delete(id);
      this.markAround(id, previous, current, objects, true);
    }
    this.schedule();
  }

  private markPair(key: string, objects: Record<string, AnyNode>): void {
    for (const node of Object.values(objects)) {
      if (node.type === 'connector' && pairKey(node as ConnectorNode) === key) this.pending.add(node.id);
    }
  }

  /**
   * Mark connectors bound to `id`, and avoiders the move can change: those
   * the object now comes near (it may be in the way) and those it was beside
   * before (it may have been forcing a detour that can now straighten).
   */
  private markAround(
    id: string,
    before: Rect | undefined,
    after: Rect | undefined,
    objects: Record<string, AnyNode>,
    urgent: boolean
  ): void {
    const target = urgent ? this.urgent : this.pending;
    for (const node of Object.values(objects)) {
      if (node.type !== 'connector') continue;
      const c = node as ConnectorNode;
      if (c.from.nodeId === id || c.to.nodeId === id) {
        target.add(c.id);
        continue;
      }
      if (!c.avoid) continue;
      const entry = this.entries.get(c.id);
      if (!entry) continue;
      if (
        (after && touchesPath(entry.route.points, after, PATH_REACH)) ||
        // Mid-gesture, only routes that hug the object follow it out of the
        // way; wider detours are rechecked once, when the gesture commits.
        (before && touchesPath(entry.route.points, before, urgent ? PATH_REACH * 2 : detourReach(entry.bbox)))
      ) {
        target.add(c.id);
      }
    }
  }

  private schedule(): void {
    if (this.cancelFrame) return;
    if (this.urgent.size === 0 && this.pending.size === 0 && !this.networkDirty) return;
    this.cancelFrame = this.env.frame(() => {
      this.cancelFrame = null;
      this.run(FRAME_BUDGET_MS);
    });
  }

  private boxOf = (objects: Record<string, AnyNode>) => (id: string): Box | null => {
    const n = objects[id];
    if (!n) return null;
    const live = this.env.getLive(id);
    const base = boxOfNode(n);
    if (!live) return base;
    return {
      x: live.x ?? base.x,
      y: live.y ?? base.y,
      width: live.width ?? base.width,
      height: live.height ?? base.height,
    };
  };

  private attachOf = (objects: Record<string, AnyNode>) => (id: string, p: Point): Point | null => {
    const n = objects[id];
    if (!n) return null;
    const live = this.env.getLive(id);
    if (!live) return attachPoint(n, p);
    return attachPoint(
      {
        ...n,
        x: live.x ?? n.x,
        y: live.y ?? n.y,
        width: live.width ?? n.width,
        height: live.height ?? n.height,
        rotation: live.rotation ?? n.rotation,
      } as AnyNode,
      p
    );
  };

  private candidatesIn(corridor: Rect, objects: Record<string, AnyNode>): ObstacleCandidate[] {
    const out: ObstacleCandidate[] = [];
    const seen = new Set<string>();
    for (const node of this.env.query(corridor)) {
      if (seen.has(node.id) || this.moving.has(node.id)) continue;
      seen.add(node.id);
      const current = objects[node.id];
      if (!current || !blocksRoutes(current)) continue;
      out.push({ node: current, rect: nodeRect(current) });
    }
    // Moving objects are where the gesture has them, not where the index does.
    for (const id of this.moving) {
      const node = objects[id];
      if (!node || !blocksRoutes(node)) continue;
      out.push({ node, rect: nodeRect(node, this.env.getLive(id)) });
    }
    return out;
  }

  private routeOne(node: ConnectorNode, objects: Record<string, AnyNode>): boolean {
    const exclude = new Set<string>([node.id]);
    if (node.from.nodeId) exclude.add(node.from.nodeId);
    if (node.to.nodeId) exclude.add(node.to.nodeId);
    const lower = (corridor: Rect): Segment[] => {
      const out: Segment[] = [];
      for (const [id, entry] of this.entries) {
        if (id >= node.id || !entry.route.orthogonal || !intersects(entry.bbox, corridor)) continue;
        out.push(...segmentsOf(entry.route.points));
      }
      return out;
    };
    const route = connectorRoute(node.from, node.to, node.routing, this.boxOf(objects), this.attachOf(objects), {
      avoid: Boolean(node.avoid),
      obstaclesIn: (corridor) => obstaclesIn(this.candidatesIn(corridor, objects), corridor, exclude),
      segmentsIn: lower,
      ownRectOf: (id) => (objects[id] ? nodeRect(objects[id], this.env.getLive(id)) : null),
      nudges: node.nudges,
      pairShift: this.shifts.get(node.id) ?? 0,
    });
    const prev = this.entries.get(node.id);
    const { corridor, bbox } = corridorOf(route.points);
    this.entries.set(node.id, { route, corridor, bbox });
    const changed =
      !prev ||
      prev.route.points.length !== route.points.length ||
      prev.route.points.some((p, i) => Math.abs(p.x - route.points[i].x) > 0.01 || Math.abs(p.y - route.points[i].y) > 0.01);
    if (changed) {
      this.networkDirty = true;
      this.netSeeds.add(node.id);
      if (prev) this.netGoneSegs.push(...interiorSegments(node.id, prev.route.points));
    }
    if (changed && route.orthogonal) {
      // Higher-id avoiders read this route for their crossing cost.
      const area = prev ? [prev.bbox, bbox] : [bbox];
      for (const [id, entry] of this.entries) {
        if (id <= node.id) continue;
        const other = objects[id] as ConnectorNode | undefined;
        if (other?.avoid && area.some((r) => intersects(r, entry.bbox))) this.pending.add(id);
      }
    }
    return changed;
  }

  private run(budget: number): void {
    const objects = this.objects();
    const start = this.env.now();
    const order = (set: Set<string>) => {
      const moving = this.moving;
      return Array.from(set).sort((a, b) => {
        const na = objects[a] as ConnectorNode | undefined;
        const nb = objects[b] as ConnectorNode | undefined;
        const boundA = na && ((na.from.nodeId && moving.has(na.from.nodeId)) || (na.to.nodeId && moving.has(na.to.nodeId)));
        const boundB = nb && ((nb.from.nodeId && moving.has(nb.from.nodeId)) || (nb.to.nodeId && moving.has(nb.to.nodeId)));
        if (boundA !== boundB) return boundA ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    };

    // During a gesture only what the gesture touches is rerouted; knock-on
    // work (crossing costs, unrelated edits) waits until the hand is still.
    const queues = this.moving.size > 0 ? [this.urgent] : [this.urgent, this.pending];
    let done = 0;
    for (const queue of queues) {
      for (const id of order(queue)) {
        const elapsed = this.env.now() - start;
        // At least one route per frame, so a gesture always makes progress.
        if (done > 0 && elapsed + this.routeCost > budget) break;
        queue.delete(id);
        const node = objects[id];
        if (!node || node.type !== 'connector') {
          this.forget(id);
          continue;
        }
        const t = this.env.now();
        this.routeOne(node as ConnectorNode, objects);
        this.routeCost = this.routeCost * 0.8 + (this.env.now() - t) * 0.2;
        done += 1;
      }
    }

    if (this.networkDirty) this.adjust(objects);
    this.lastFrameMs = this.env.now() - start;
    this.schedule();
  }

  private forget(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.netGoneSegs.push(...interiorSegments(id, entry.route.points));
    this.netGone.add(id);
    this.entries.delete(id);
    this.outputs.delete(id);
    this.networkDirty = true;
  }

  private networkRoute(id: string, objects: Record<string, AnyNode>, boardJumps: JumpStyle | null): NetworkRoute {
    const node = objects[id] as ConnectorNode;
    const route = this.entries.get(id)!.route;
    return {
      id,
      points: route.points,
      orthogonal: route.orthogonal,
      curved: node.routing === 'curved',
      zIndex: node.zIndex ?? 0,
      jumps: jumpStyleOf(node, boardJumps),
      strokeWidth: node.appearance?.stroke?.width ?? 2,
    };
  }

  /**
   * Spreading and jumps, redone only where a change can reach.
   *
   * Spreading moves segments within a channel bundle, so only the bundles a
   * changed route enters or leaves are re-spread. Jumps belong to pairs of
   * routes, so only pairs with a route whose drawing moved are recomputed.
   * Everything else keeps what the last pass gave it, which is exactly what a
   * whole-board pass would give it again.
   */
  private adjust(objects: Record<string, AnyNode>): void {
    this.networkDirty = false;
    const boardJumps = this.env.boardJumps();
    const isLive = (id: string) => objects[id]?.type === 'connector' && this.entries.has(id);

    // Routes that are gone: drop them, and their partners re-assemble their jumps.
    const reassemble = new Set<string>();
    for (const id of this.netGone) {
      if (isLive(id)) continue;
      this.spread.delete(id);
      const mine = this.pairs.get(id);
      if (mine) for (const other of mine.keys()) {
        this.pairs.get(other)?.delete(id);
        reassemble.add(other);
      }
      this.pairs.delete(id);
    }

    const seeds = Array.from(this.netSeeds).filter(isLive);
    const orthogonal = new Map<string, readonly Point[]>();
    for (const [id, entry] of this.entries) {
      if (entry.route.orthogonal && isLive(id) && (objects[id] as ConnectorNode).routing !== 'curved') {
        orthogonal.set(id, entry.route.points);
      }
    }
    const seedSegs = [...this.netGoneSegs];
    for (const id of seeds) seedSegs.push(...interiorSegments(id, this.entries.get(id)!.route.points));
    const members = bundleClosure(orthogonal, seedSegs);
    for (const id of seeds) if (orthogonal.has(id)) members.add(id);

    const moved = new Set<string>(seeds);
    const memberIds = Array.from(members).sort();
    const spreadPoints = spreadChannels(memberIds.map((id) => this.networkRoute(id, objects, boardJumps)));
    memberIds.forEach((id, i) => {
      const prev = this.spread.get(id);
      const next = spreadPoints[i];
      if (!prev || prev.length !== next.length || prev.some((p, k) => p.x !== next[k].x || p.y !== next[k].y)) {
        moved.add(id);
      }
      this.spread.set(id, next);
    });
    for (const id of seeds) if (!members.has(id)) this.spread.set(id, this.entries.get(id)!.route.points.map((p) => ({ ...p })));

    // Jumps for every pair involving a route whose drawing moved.
    const live = Array.from(this.entries.keys()).filter(isLive);
    const boxOf = (id: string) => boundsOfPoints(this.spread.get(id) ?? this.entries.get(id)!.route.points);
    for (const id of moved) {
      const mine = this.pairs.get(id);
      if (mine) for (const other of mine.keys()) {
        this.pairs.get(other)?.delete(id);
        reassemble.add(other);
      }
      this.pairs.set(id, new Map());
      reassemble.add(id);
    }
    const movedList = Array.from(moved);
    for (let i = 0; i < movedList.length; i += 1) {
      const a = movedList[i];
      const ra = this.networkRoute(a, objects, boardJumps);
      if (ra.curved) continue;
      const pa = this.spread.get(a) ?? ra.points;
      const ba = boxOf(a);
      for (const b of live) {
        if (b === a || (moved.has(b) && b < a)) continue;
        const bb = boxOf(b);
        if (!intersects(ba, bb)) continue;
        const rb = this.networkRoute(b, objects, boardJumps);
        const [ha, hb] = pairHops(ra, pa, rb, this.spread.get(b) ?? rb.points);
        if (ha.length > 0) this.pairs.get(a)!.set(b, ha);
        if (hb.length > 0) {
          if (!this.pairs.has(b)) this.pairs.set(b, new Map());
          this.pairs.get(b)!.set(a, hb);
        }
        reassemble.add(b);
      }
    }

    for (const id of reassemble) {
      if (!isLive(id)) continue;
      const route = this.entries.get(id)!.route;
      const points = this.spread.get(id) ?? route.points;
      const hops: Hop[] = [];
      for (const list of this.pairs.get(id)?.values() ?? []) hops.push(...list);
      hops.sort((p, q) => p.seg - q.seg || p.at - q.at || (p.kind < q.kind ? -1 : 1));
      const next: RouteOutput = {
        points,
        flat: points.flatMap((p) => [p.x, p.y]),
        hops,
        orthogonal: route.orthogonal,
        curved: (objects[id] as ConnectorNode).routing === 'curved',
        degraded: route.degraded,
      };
      const prev = this.outputs.get(id);
      if (prev && sameOutput(prev, next)) continue;
      this.outputs.set(id, next);
      this.listeners.get(id)?.forEach((fn) => fn());
    }

    this.netSeeds.clear();
    this.netGone.clear();
    this.netGoneSegs = [];
    let degraded = 0;
    for (const entry of this.entries.values()) if (entry.route.degraded) degraded += 1;
    this.degradedCount = degraded;
  }
}
