/**
 * The one place connector routes are computed for the canvas.
 *
 * Renderers subscribe per connector id and read finished routes; nothing else
 * routes on the board. The store keeps every visible connector's route
 * cached, decides which ones a change can affect, reroutes those, then runs
 * the network passes (channel spreading and line jumps) over the routes that
 * moved and notifies only the connectors whose drawing changed. Hidden
 * connectors are not routed and nothing reads them, exactly as in
 * `routeBoard`.
 *
 * ## What reroutes when
 *
 * - A connector that changed, or whose objects changed or moved.
 * - A connector that avoids, when something moved into its way or away from
 *   beside it.
 * - Connectors sharing both objects with one that was added or removed.
 * - A connector that avoids, when a lower-id route it reads (one with a leg
 *   inside the area its search read) changed or went. The crossing penalty
 *   reads lower-id routes only, which is what makes the result independent of
 *   the order things happened in.
 *
 * ## The frame budget
 *
 * All of it, routing and the network pass together, runs inside a per-frame
 * budget: `FRAME_BUDGET_MS` while a gesture is moving things,
 * `SETTLE_BUDGET_MS` once the hand is still. Every step is costed before it
 * is taken (each connector keeps a running estimate of its own routing time)
 * and a step that would overrun waits for the next frame. Nothing is forced
 * through to "make progress".
 *
 * During a gesture the moving objects' live boxes are used, routes are
 * searched with a smaller expansion cap (a route that runs out of it is
 * provisional and is searched in full once the gesture ends), and only the
 * routes the gesture touches are spread and jumped. Knock-on work (crossing
 * costs of other routes, lanes and jumps of routes outside the dragged
 * region) waits until the hand is still, and then finishes over as many
 * frames as it needs.
 *
 * All lookups by area (which routes a moved object comes near, which lower
 * routes a search reads, which routes cross) go through R-tree indexes of the
 * routes' boxes, so a live event costs the routes near it, not the board.
 */

import type { AnyNode, ConnectorNode } from '../schema';
import { connectorRoute, type Box, type ConnectorRoute, type Point } from '../connector';
import { attachPoint, boxOfNode } from '../connectorTargets';
import type { LiveTransform } from '../liveTransformStore';
import { boundsOfPoints, inflate, type Rect } from './geometry';
import { blocksRoutes, nodeRect, obstaclesIn, pairKey, pairShifts, type ObstacleCandidate } from './obstacles';
import { OBSTACLE_MARGIN, type Segment } from './router';
import {
  ChannelIndex,
  CHANNEL_GAP,
  applyOffsets,
  lineOffsets,
  spreadRoute,
  pairHops,
  type JumpStyle,
  type NetworkRoute,
} from './network';
import type { Hop, LegRef } from './pathOps';
import { isRoutedConnector, jumpStyleOf } from './routeBoard';
import { RectIndex } from './rectIndex';

/** Work allowed per animation frame while a gesture is moving things. */
export const FRAME_BUDGET_MS = 3;
/**
 * Work allowed per frame once the hand is still. Nothing else is animating
 * then, so settling can take more of each frame and finish sooner, and still
 * leave most of a 60Hz frame to React and Konva.
 */
export const SETTLE_BUDGET_MS = 8;
/** The search's expansion cap mid-gesture; see `routeOrthogonalAvoiding`. */
export const GESTURE_EXPANSIONS = 1500;
/** The cap for a route that has measured too slow for a gesture frame even so. */
const HEAVY_EXPANSIONS = 300;

export interface RouteOutput {
  points: Point[];
  /** Flat, for Konva. */
  flat: number[];
  hops: Hop[];
  orthogonal: boolean;
  curved: boolean;
  degraded: boolean;
  /** For an elbow route, what each segment is; see `ConnectorRoute.legs`. */
  legs?: Array<LegRef | null>;
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
  bbox: Rect;
  /** Where the search read other routes from: a change of a lower route here can move this one. */
  reads: Rect;
  /** The route's legs as the crossing penalty of higher routes reads them (elbow routes only). */
  segments: Segment[];
  /** Routed mid-gesture with a capped search that ran out: searched in full once the gesture ends. */
  provisional: boolean;
}

function sameHops(a: readonly Hop[], b: readonly Hop[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    const q = b[i];
    if (p.seg !== q.seg || p.kind !== q.kind || Math.abs(p.at - q.at) > 0.01 || p.half !== q.half) return false;
  }
  return true;
}

function sameLegs(a: readonly (LegRef | null)[] | undefined, b: readonly (LegRef | null)[] | undefined): boolean {
  const la = a ?? [];
  const lb = b ?? [];
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i += 1) {
    const p = la[i];
    const q = lb[i];
    if (!p !== !q || (p && q && (p.axis !== q.axis || p.at !== q.at || p.nudge !== q.nudge))) return false;
  }
  return true;
}

function sameOutput(a: RouteOutput, b: RouteOutput): boolean {
  if (a.orthogonal !== b.orthogonal || a.curved !== b.curved || a.degraded !== b.degraded) return false;
  if (a.flat.length !== b.flat.length) return false;
  for (let i = 0; i < a.flat.length; i += 1) if (Math.abs(a.flat[i] - b.flat[i]) > 0.01) return false;
  return sameHops(a.hops, b.hops) && sameLegs(a.legs, b.legs);
}

/**
 * Whether a box comes near a route: within reach of any of its segments.
 *
 * Only an obstacle near the path can change it. One that blocks the path is on
 * it; one whose removal would shorten it was next to it, forcing the detour.
 * Anything farther away leaves the route as it is.
 */
const PATH_REACH = OBSTACLE_MARGIN + CHANNEL_GAP * 2;
/** The farthest `detourReach` goes. */
const MAX_DETOUR_REACH = 240;

/**
 * How far from a route an object can sit and still be what bent it: a detour
 * runs down the middle of whatever channel it found, which can be some way
 * off the object it goes around.
 */
function detourReach(bbox: Rect): number {
  const short = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  return Math.max(PATH_REACH, Math.min(MAX_DETOUR_REACH, short * 0.6));
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

function segmentMeets(s: Segment, r: Rect): boolean {
  return (
    Math.min(s.x1, s.x2) <= r.maxX &&
    Math.max(s.x1, s.x2) >= r.minX &&
    Math.min(s.y1, s.y2) <= r.maxY &&
    Math.max(s.y1, s.y2) >= r.minY
  );
}

function boundsOfSegments(segs: readonly Segment[]): Rect | null {
  if (segs.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  return { minX, minY, maxX, maxY };
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
  /** A moving average of one route's cost, the estimate for a route not yet timed. */
  private routeCost = 0.5;
  /** Each connector's own running cost estimate. */
  private costs = new Map<string, number>();
  /** Interior legs of every elbow route, by channel line. */
  private channels = new ChannelIndex();
  /** Each route's box as routed, by area. */
  private routeIndex = new RectIndex();
  /** The area each avoiding route's search read lower routes from, by area. */
  private readIndex = new RectIndex();
  /** Each route's box as drawn (after spreading), by area, for pairing jumps. */
  private drawnIndex = new RectIndex();
  /** Connectors on the current snapshot, in id order, and which ones each object holds. */
  private connectorIds: string[] = [];
  private boundBy = new Map<string, string[]>();
  private disposers: Array<() => void> = [];
  private degraded = new Set<string>();

  // The network pass's work, carried between frames until it is done.
  /** Channel lines to re-spread. */
  private dirtyLines = new Set<number>();
  /** Routes whose drawing must be recomputed from their route and offsets. */
  private respread = new Set<string>();
  /** Routes whose jumps against every partner are redone. */
  private rejump = new Set<string>();
  /** Routes redrawn whose jumps are not yet redone for the new drawing: not published until they are. */
  private unjumped = new Set<string>();
  /** Routes whose output is rebuilt from their drawing and jumps. */
  private reassemble = new Set<string>();
  /** Routes that went, whose partners drop the jumps they drew because of them. */
  private gone = new Set<string>();
  /** Routes the current gesture reroutes: the only ones spread and jumped until it ends. */
  private focus = new Set<string>();
  /** A moving average of one route's spreading, and of one route's jumps. */
  private spreadCost = 0.05;
  private jumpCost = 0.05;

  /** Points after channel spreading, per route. */
  private spread = new Map<string, Point[]>();
  /** The jumps each route draws because of each other route. */
  private pairs = new Map<string, Map<string, Hop[]>>();
  /** Each route's leg offsets from channel spreading, by leg index. */
  private offsets = new Map<string, Map<number, number>>();

  /** Sum of routing and network time in the last frame, for the perf HUD and tests. */
  lastFrameMs = 0;

  private env: RouteEnv;

  constructor(env: RouteEnv) {
    this.env = env;
  }

  get degradedCount(): number {
    return this.degraded.size;
  }

  /** Whether any work is still queued. */
  get busy(): boolean {
    return (
      this.urgent.size > 0 ||
      this.pending.size > 0 ||
      this.dirtyLines.size > 0 ||
      this.respread.size > 0 ||
      this.rejump.size > 0 ||
      this.reassemble.size > 0 ||
      this.gone.size > 0
    );
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
   * on the next frame. A hidden connector has no route.
   */
  get(id: string): RouteOutput | null {
    const out = this.outputs.get(id);
    if (out) return out;
    const objects = this.objects();
    const node = objects[id];
    if (!isRoutedConnector(node)) return null;
    this.routeOne(node, objects);
    const entry = this.entries.get(id);
    if (!entry) return null;
    const fresh: RouteOutput = {
      points: entry.route.points,
      flat: entry.route.points.flatMap((p) => [p.x, p.y]),
      hops: [],
      orthogonal: entry.route.orthogonal,
      curved: node.routing === 'curved',
      degraded: entry.route.degraded,
      legs: entry.route.legs,
    };
    this.outputs.set(id, fresh);
    this.schedule();
    return fresh;
  }

  /** Route everything outstanding now, ignoring the budget. For export and tests. */
  flush(): void {
    this.cancelFrame?.();
    this.cancelFrame = null;
    // Each pass can queue knock-on work (a lower route moving reroutes the
    // higher ones that read it), so this runs until nothing is left.
    for (let pass = 0; pass < 64; pass += 1) {
      this.run(Infinity, true);
      if (!this.busy) break;
    }
  }

  private objects(): Record<string, AnyNode> {
    const current = this.env.getObjects();
    if (current !== this.snapshot) {
      this.snapshot = current;
      this.shifts = pairShifts(current);
      const ids: string[] = [];
      const bound = new Map<string, string[]>();
      for (const node of Object.values(current)) {
        if (!isRoutedConnector(node)) continue;
        ids.push(node.id);
        for (const end of [node.from.nodeId, node.to.nodeId]) {
          if (!end) continue;
          const list = bound.get(end);
          if (list) list.push(node.id);
          else bound.set(end, [node.id]);
        }
      }
      ids.sort(byId);
      this.connectorIds = ids;
      this.boundBy = bound;
      // Whatever the change list says, a route whose connector is gone or
      // hidden on this snapshot is dropped, so nothing keeps reading it.
      for (const id of Array.from(this.entries.keys())) {
        if (!isRoutedConnector(current[id])) this.forget(id);
      }
    }
    return current;
  }

  private onObjects(): void {
    const before = this.snapshot;
    const objects = this.objects();
    const changes = this.env.getChanges();
    if (!before || !changes) {
      for (const id of this.connectorIds) this.pending.add(id);
      this.schedule();
      return;
    }
    const touched = new Set<string>(changes.removed);
    for (const id of changes.changed) touched.add(id);

    for (const id of touched) {
      const node = objects[id];
      const was = before[id];
      if (node?.type === 'connector' || was?.type === 'connector') {
        if (isRoutedConnector(node)) {
          this.pending.add(id);
          // Stacking or jump style may have changed without the route moving.
          this.rejump.add(id);
        } else {
          this.forget(id);
        }
        // A connector arriving or leaving reshuffles the lanes of its pair.
        const key = pairKey((node ?? was) as ConnectorNode);
        if (key) this.markPair(key, objects);
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
    const ended = this.moving.size > 0 && now.size === 0;
    this.moving = now;
    for (const id of affected) {
      const node = objects[id];
      if (!node || node.type === 'connector') {
        if (isRoutedConnector(node)) this.urgent.add(id);
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
    if (ended) {
      // Routes searched with the gesture's cap get their full search now.
      for (const [id, entry] of this.entries) if (entry.provisional) this.pending.add(id);
      this.focus.clear();
    }
    this.schedule();
  }

  private markPair(key: string, objects: Record<string, AnyNode>): void {
    for (const id of this.connectorIds) {
      if (pairKey(objects[id] as ConnectorNode) === key) this.pending.add(id);
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
    const bound = this.boundBy.get(id);
    if (bound) for (const cid of bound) target.add(cid);
    // Mid-gesture, only routes that hug the object follow it out of the
    // way; wider detours are rechecked once, when the gesture commits.
    const beforeReach = urgent ? PATH_REACH * 2 : MAX_DETOUR_REACH;
    const near = new Set<string>();
    if (after) for (const cid of this.routeIndex.search(inflate(after, PATH_REACH))) near.add(cid);
    if (before) for (const cid of this.routeIndex.search(inflate(before, beforeReach))) near.add(cid);
    for (const cid of near) {
      if (target.has(cid)) continue;
      const c = objects[cid] as ConnectorNode | undefined;
      if (!c?.avoid || c.from.nodeId === id || c.to.nodeId === id) continue;
      const entry = this.entries.get(cid);
      if (!entry) continue;
      if (
        (after && touchesPath(entry.route.points, after, PATH_REACH)) ||
        (before && touchesPath(entry.route.points, before, urgent ? PATH_REACH * 2 : detourReach(entry.bbox)))
      ) {
        target.add(cid);
      }
    }
  }

  /**
   * Higher-id avoiders whose search read any of `segs`: their crossing cost
   * changed, so their route may have.
   */
  private markReaders(id: string, segs: readonly Segment[], objects: Record<string, AnyNode>): void {
    const area = boundsOfSegments(segs);
    if (!area) return;
    for (const other of this.readIndex.search(area)) {
      if (other <= id || this.pending.has(other) || this.urgent.has(other)) continue;
      const node = objects[other] as ConnectorNode | undefined;
      const entry = this.entries.get(other);
      if (!node?.avoid || !entry) continue;
      if (segs.some((s) => segmentMeets(s, entry.reads))) this.pending.add(other);
    }
  }

  private schedule(): void {
    if (this.cancelFrame) return;
    if (!this.hasWork()) return;
    this.cancelFrame = this.env.frame(() => {
      this.cancelFrame = null;
      this.run(this.moving.size > 0 ? FRAME_BUDGET_MS : SETTLE_BUDGET_MS, false);
    });
  }

  /** Whether a frame now would have anything to do: mid-gesture, deferred work does not count. */
  private hasWork(): boolean {
    if (this.urgent.size > 0 || this.gone.size > 0 || this.dirtyLines.size > 0 || this.reassemble.size > 0) return true;
    if (this.moving.size === 0) return this.busy;
    for (const id of this.respread) if (this.focus.has(id)) return true;
    for (const id of this.rejump) if (this.focus.has(id)) return true;
    return false;
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
    // Grown by the margin: an object just outside the corridor still blocks
    // it once inflated.
    for (const node of this.env.query(inflate(corridor, OBSTACLE_MARGIN))) {
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

  /** Legs of lower-id elbow routes meeting a corridor, in id order: what the crossing penalty reads. */
  private lowerSegments(id: string, corridor: Rect): Segment[] {
    const ids = this.routeIndex.search(corridor).filter((other) => other < id);
    ids.sort(byId);
    const out: Segment[] = [];
    for (const other of ids) {
      const entry = this.entries.get(other);
      if (!entry) continue;
      for (const s of entry.segments) if (segmentMeets(s, corridor)) out.push(s);
    }
    return out;
  }

  private routeOne(node: ConnectorNode, objects: Record<string, AnyNode>, cap?: number): boolean {
    const exclude = new Set<string>([node.id]);
    if (node.from.nodeId) exclude.add(node.from.nodeId);
    if (node.to.nodeId) exclude.add(node.to.nodeId);
    const route = connectorRoute(node.from, node.to, node.routing, this.boxOf(objects), this.attachOf(objects), {
      avoid: Boolean(node.avoid),
      obstaclesIn: (corridor) => obstaclesIn(this.candidatesIn(corridor, objects), corridor, exclude),
      segmentsIn: (corridor) => this.lowerSegments(node.id, corridor),
      ownRectOf: (id) => (objects[id] ? nodeRect(objects[id], this.env.getLive(id)) : null),
      nudges: node.nudges,
      pairShift: this.shifts.get(node.id) ?? 0,
      maxExpansions: cap,
    });
    const prev = this.entries.get(node.id);
    const bbox = boundsOfPoints(route.points);
    const segments = route.orthogonal ? segmentsOf(route.points) : [];
    const entry: Entry = {
      route,
      bbox,
      reads: route.reads ?? bbox,
      segments,
      provisional: cap !== undefined && route.degraded,
    };
    this.entries.set(node.id, entry);
    this.routeIndex.set(node.id, bbox);
    if (node.avoid) this.readIndex.set(node.id, entry.reads);
    else this.readIndex.delete(node.id);
    if (route.degraded && !entry.provisional) this.degraded.add(node.id);
    else this.degraded.delete(node.id);

    const oldLines = this.channels.keysOf(node.id);
    const legs = route.orthogonal ? route.points : route.skeleton;
    if (legs) this.channels.set(node.id, legs);
    else this.channels.delete(node.id);
    const changed =
      !prev ||
      prev.route.orthogonal !== route.orthogonal ||
      prev.route.points.length !== route.points.length ||
      prev.route.points.some((p, i) => Math.abs(p.x - route.points[i].x) > 0.01 || Math.abs(p.y - route.points[i].y) > 0.01);
    if (changed || !sameLegs(prev?.route.legs, route.legs)) {
      for (const k of oldLines) this.dirtyLines.add(k);
      for (const k of this.channels.keysOf(node.id)) this.dirtyLines.add(k);
      // Offsets are by leg index, which a new route renumbers: the lines
      // it runs down assign them afresh.
      if (changed) this.offsets.delete(node.id);
      this.respread.add(node.id);
    }
    if (changed) {
      // Higher-id avoiders read this route's legs for their crossing cost.
      const before = prev?.segments ?? [];
      if (before.length > 0 || segments.length > 0) this.markReaders(node.id, [...before, ...segments], objects);
    }
    return changed;
  }

  private forget(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      for (const k of this.channels.keysOf(id)) this.dirtyLines.add(k);
      // Higher routes that read this one's legs lose a crossing.
      if (entry.segments.length > 0 && this.snapshot) this.markReaders(id, entry.segments, this.snapshot);
    }
    this.gone.add(id);
    this.entries.delete(id);
    this.outputs.delete(id);
    this.channels.delete(id);
    this.offsets.delete(id);
    this.routeIndex.delete(id);
    this.readIndex.delete(id);
    this.drawnIndex.delete(id);
    this.degraded.delete(id);
    this.costs.delete(id);
    this.urgent.delete(id);
    this.pending.delete(id);
    this.respread.delete(id);
    this.rejump.delete(id);
    this.reassemble.delete(id);
    this.unjumped.delete(id);
    this.focus.delete(id);
  }

  /**
   * One frame's work. `budget` caps routing and the network pass together;
   * `full` (for `flush`) does everything, gesture or not.
   */
  private run(budget: number, full: boolean): void {
    const objects = this.objects();
    const start = this.env.now();
    const gesture = this.moving.size > 0 && !full;
    const deadline = start + budget;
    const moving = this.moving;
    const isBound = (id: string) => {
      const n = objects[id] as ConnectorNode | undefined;
      return Boolean(n && ((n.from.nodeId && moving.has(n.from.nodeId)) || (n.to.nodeId && moving.has(n.to.nodeId))));
    };
    const order = (set: Set<string>) =>
      Array.from(set).sort((a, b) => {
        const ba = isBound(a);
        const bb = isBound(b);
        if (ba !== bb) return ba ? -1 : 1;
        return byId(a, b);
      });

    // Routing takes the frame up to what the network pass is expected to
    // need for the routes it reroutes, and never starts a route it does not
    // expect to finish in time.
    const queues = gesture ? [this.urgent] : [this.urgent, this.pending];
    let rerouted = 0;
    let stop = false;
    for (const queue of queues) {
      if (stop) break;
      for (const id of order(queue)) {
        const node = objects[id];
        if (!isRoutedConnector(node)) {
          queue.delete(id);
          this.forget(id);
          continue;
        }
        let cap = gesture ? GESTURE_EXPANSIONS : undefined;
        let estimate = this.costs.get(id) ?? this.routeCost;
        const reserve = (rerouted + 1) * (this.spreadCost + this.jumpCost);
        let alone = false;
        if (!full && this.env.now() + estimate + reserve > deadline) {
          if (estimate + reserve <= budget) {
            // It fits a frame, just not what is left of this one.
            stop = true;
            break;
          }
          // Too slow for any frame at its usual size. Mid-gesture it is
          // searched with a small cap, and finishes in full when the gesture
          // ends; once the hand is still it is searched in a frame of its own.
          if (gesture) {
            cap = HEAVY_EXPANSIONS;
            estimate = Math.min(estimate, budget * 0.5);
            if (this.env.now() + estimate + reserve > deadline) {
              stop = true;
              break;
            }
          } else if (rerouted > 0) {
            stop = true;
            break;
          } else {
            alone = true;
          }
        }
        queue.delete(id);
        const t = this.env.now();
        this.routeOne(node, objects, cap);
        const cost = this.env.now() - t;
        if (cap !== HEAVY_EXPANSIONS) this.costs.set(id, (this.costs.get(id) ?? cost) * 0.5 + cost * 0.5);
        this.routeCost = this.routeCost * 0.8 + cost * 0.2;
        if (gesture) this.focus.add(id);
        rerouted += 1;
        if (alone) {
          stop = true;
          break;
        }
      }
    }

    this.network(objects, gesture, full ? Infinity : deadline);
    this.lastFrameMs = this.env.now() - start;
    if (!full) this.schedule();
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
   * Spreading and jumps, redone only where a change can reach, a step at a
   * time inside the frame's deadline.
   *
   * A channel line's spreading depends only on the legs on it, so only the
   * lines a changed route enters or leaves are re-spread, and only the routes
   * whose offsets moved are redrawn. Jumps belong to pairs of routes, so only
   * pairs with a route whose drawing moved are recomputed, against the
   * partners an index of drawn boxes finds. Whatever does not fit waits in
   * its queue for the next frame; mid-gesture, routes outside the gesture's
   * focus wait until it ends. Everything else keeps what the last pass gave
   * it, which is exactly what a whole-board pass would give it again.
   */
  private network(objects: Record<string, AnyNode>, gesture: boolean, deadline: number): void {
    const isLive = (id: string) => this.entries.has(id) && isRoutedConnector(objects[id]);
    const boardJumps = this.env.boardJumps();
    const now = () => this.env.now();

    // Routes that are gone: drop them, and their partners re-assemble their jumps.
    for (const id of this.gone) {
      if (isLive(id)) continue;
      this.spread.delete(id);
      const mine = this.pairs.get(id);
      if (mine) {
        for (const other of mine.keys()) {
          this.pairs.get(other)?.delete(id);
          this.reassemble.add(other);
        }
      }
      this.pairs.delete(id);
    }
    this.gone.clear();

    // Re-spread the channel lines a change touched. Cheap: a sort of the legs
    // on each line. Routes whose offsets moved are queued to be redrawn.
    for (const k of this.dirtyLines) {
      const segs = this.channels.line(k).filter((seg) => isLive(seg.id));
      const offs = lineOffsets(segs);
      segs.forEach((seg, i) => {
        let mine = this.offsets.get(seg.id);
        const before = mine?.get(seg.seg) ?? 0;
        if (before === offs[i]) return;
        if (!mine) {
          mine = new Map();
          this.offsets.set(seg.id, mine);
        }
        if (offs[i] === 0) mine.delete(seg.seg);
        else mine.set(seg.seg, offs[i]);
        this.respread.add(seg.id);
      });
    }
    this.dirtyLines.clear();

    const ready = (id: string) => !gesture || this.focus.has(id);
    let out = false;
    const fits = (cost: number) => {
      if (!out && now() + cost > deadline) out = true;
      return !out;
    };

    // Redraw each queued route from its route and offsets.
    for (const id of Array.from(this.respread).sort(byId)) {
      if (!isLive(id)) {
        this.respread.delete(id);
        continue;
      }
      if (!ready(id)) continue;
      if (!fits(this.spreadCost)) break;
      this.respread.delete(id);
      const t = now();
      const route = this.entries.get(id)!.route;
      const next = route.skeleton
        ? spreadRoute({ ...route, curved: true }, this.offsets.get(id))
        : applyOffsets(route.points, this.offsets.get(id));
      const prev = this.spread.get(id);
      this.spread.set(id, next);
      this.drawnIndex.set(id, boundsOfPoints(next));
      if (!prev || prev.length !== next.length || prev.some((p, k) => p.x !== next[k].x || p.y !== next[k].y)) {
        this.rejump.add(id);
        this.unjumped.add(id);
      }
      // Legs or flags may have changed with the same points.
      this.reassemble.add(id);
      this.spreadCost = this.spreadCost * 0.8 + (now() - t) * 0.2;
    }

    // Jumps for every pair involving a route whose drawing moved.
    const routes = new Map<string, NetworkRoute>();
    const routeOf = (id: string): NetworkRoute => {
      let r = routes.get(id);
      if (!r) routes.set(id, (r = this.networkRoute(id, objects, boardJumps)));
      return r;
    };
    for (const a of Array.from(this.rejump).sort(byId)) {
      if (!isLive(a)) {
        this.rejump.delete(a);
        continue;
      }
      // A route still waiting to be redrawn is jumped once it has been.
      if (!ready(a) || this.respread.has(a)) continue;
      if (!fits(this.jumpCost)) break;
      this.rejump.delete(a);
      this.unjumped.delete(a);
      const t = now();
      // Clear what this route drew with every partner, remembering what each
      // partner drew because of it so a partner is reassembled only on change.
      const old = new Map<string, Hop[]>();
      const mine = this.pairs.get(a);
      if (mine) {
        for (const other of mine.keys()) {
          const theirs = this.pairs.get(other);
          const was = theirs?.get(a);
          if (was && was.length > 0) old.set(other, was);
          theirs?.delete(a);
        }
      }
      const fresh = new Map<string, Hop[]>();
      this.pairs.set(a, fresh);
      this.reassemble.add(a);
      const ra = routeOf(a);
      const box = this.drawnIndex.get(a);
      if (!ra.curved && box) {
        const pa = this.spread.get(a) ?? ra.points;
        for (const b of this.drawnIndex.search(box)) {
          if (b === a || !isLive(b)) continue;
          const rb = routeOf(b);
          if (rb.curved) continue;
          const [ha, hb] = pairHops(ra, pa, rb, this.spread.get(b) ?? rb.points);
          const before = old.get(b) ?? [];
          old.delete(b);
          if (ha.length > 0 || hb.length > 0) {
            // Recorded on both sides, even when one side draws nothing, so
            // clearing either route later finds its partner.
            fresh.set(b, ha);
            let theirs = this.pairs.get(b);
            if (!theirs) this.pairs.set(b, (theirs = new Map()));
            theirs.set(a, hb);
          }
          if (!sameHops(before, hb)) this.reassemble.add(b);
        }
      }
      // Partners that drew something because of this route and no longer meet it.
      for (const other of old.keys()) this.reassemble.add(other);
      this.jumpCost = this.jumpCost * 0.8 + (now() - t) * 0.2;
    }

    // Rebuild outputs: cheap, and done for every route ready for it, so a
    // partner's jumps never lag the route that moved under them.
    for (const id of Array.from(this.reassemble)) {
      if (!isLive(id)) {
        this.reassemble.delete(id);
        continue;
      }
      // A route whose drawing is still queued, or was redrawn and not yet
      // jumped, keeps its last output until both are done.
      if (this.respread.has(id) || this.unjumped.has(id)) continue;
      this.reassemble.delete(id);
      this.publish(id, objects);
    }
  }

  private publish(id: string, objects: Record<string, AnyNode>): void {
    const route = this.entries.get(id)!.route;
    const points = this.spread.get(id) ?? route.points;
    const hops: Hop[] = [];
    for (const list of this.pairs.get(id)?.values() ?? []) hops.push(...list);
    hops.sort((p, q) => p.seg - q.seg || p.at - q.at || (p.kind < q.kind ? -1 : 1));
    const prev = this.outputs.get(id);
    // A partner whose drawing did not move only needs its jumps compared.
    if (prev && prev.points === points && sameLegs(prev.legs, route.legs)) {
      if (sameHops(prev.hops, hops) && prev.degraded === route.degraded) return;
      this.outputs.set(id, { ...prev, hops, degraded: route.degraded });
      this.listeners.get(id)?.forEach((fn) => fn());
      return;
    }
    const flat = new Array<number>(points.length * 2);
    for (let k = 0; k < points.length; k += 1) {
      flat[k * 2] = points[k].x;
      flat[k * 2 + 1] = points[k].y;
    }
    const next: RouteOutput = {
      points,
      flat,
      hops,
      orthogonal: route.orthogonal,
      curved: (objects[id] as ConnectorNode).routing === 'curved',
      degraded: route.degraded,
      legs: route.legs,
    };
    if (prev && sameOutput(prev, next)) return;
    this.outputs.set(id, next);
    this.listeners.get(id)?.forEach((fn) => fn());
  }
}
