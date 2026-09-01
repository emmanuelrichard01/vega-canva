/**
 * Where a parsed flowchart's boxes go, and which face each arrow leaves by.
 *
 * Backed by @dagrejs/dagre: Sugiyama layering, crossing minimisation, edge
 * routing, and compound graphs for subgraph clusters.
 *
 * ## What happens to dagre's edge routing
 *
 * `dagre.layout` computes a polyline for every edge -- a real route, bent
 * around the nodes in its way. The first version of this module threw all of
 * them away: `LayoutResult` carried only nodes and clusters, and `build.ts`
 * attached every connector with `port: 'auto'`, so the canvas re-derived each
 * path with a router that knew nothing about the channels dagre had reserved.
 * The layering was dagre's and the arrows were not, which is most of the way
 * to a tangle -- and precisely the problem dagre had been introduced to solve.
 *
 * They are still not stored, and that is deliberate. `connector.ts` opens by
 * stating the invariant this engine has to live inside:
 *
 *   > a connector stores **which objects it joins**, not where its ends
 *   > happen to be [...] the arrow never knew a coordinate to begin with
 *
 * Storing a polyline would break that on the first drag: the route would be
 * stale the moment anybody moved a box, and a connector that remembers a path
 * through a diagram that has changed is worse than one that re-derives a
 * plain path. So what is kept is not the route but its **intent** -- the point
 * on each node where dagre chose to leave and arrive, expressed as an
 * `Anchor`, which is normalised to the node's own box and therefore survives
 * the node being moved *and* resized. `anchorPoint` projects it back to the
 * perimeter on every read.
 *
 * The practical difference is fan-out. Three arrows leaving one decision node
 * all attach to the bottom edge; with `auto` they leave from the same midpoint
 * and immediately cross. With anchors they leave at the x-offsets dagre
 * separated them to, and they do not.
 */

import dagre from '@dagrejs/dagre';
import type { MermaidGraph } from './mermaid';
import type { Anchor } from '../model/connectorAnchor';

export interface PlacedNode {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where dagre chose to leave and arrive, in each node's own proportions. */
export interface PlacedEdge {
  /** The graph's own endpoints, before subgraph redirection. */
  from: string;
  to: string;
  /** The leaf nodes the route actually connects. */
  fromLeaf: string;
  toLeaf: string;
  fromAnchor?: Anchor;
  toAnchor?: Anchor;
}

export interface LayoutResult {
  nodes: PlacedNode[];
  clusters: PlacedNode[];
  edges: PlacedEdge[];
}

export interface LayoutOptions {
  /** Top-left of the whole diagram, in world coordinates. */
  originX: number;
  originY: number;
  nodeWidth?: number;
  nodeHeight?: number;
  /** Between layers, along the flow. */
  rankGap?: number;
  /** Between siblings, across the flow. */
  siblingGap?: number;
  /** Measured label sizes, where the caller has them. */
  sizeOf?: (key: string) => { width: number; height: number } | undefined;
}

/**
 * `rankGap` was 90, which put a five-box flowchart at 232x558 -- a 1:2.4
 * column of small boxes separated by more empty space than box, which is what
 * reads as sparse and unfinished on a wide canvas.
 *
 * 64 is the floor that still works: an edge label reserves a 24px band in the
 * gap (see `labelBox`), so anything under about 50 puts the word against the
 * node above or below it. This leaves 20px clear on each side of a label and
 * takes the same chart to 232x479.
 */
const DEFAULTS = { nodeWidth: 170, nodeHeight: 72, rankGap: 64, siblingGap: 36 };

/**
 * Roughly how much room an edge label needs dagre to keep clear.
 *
 * An estimate is the right tool here, unlike node boxes: this reserves a gap
 * rather than sizing anything that gets drawn, so being a few pixels out
 * moves an arrow slightly and never clips a word. Node sizing goes through
 * the real text measurer in `build.ts`, because there the number *is* the box.
 */
function labelBox(label: string): { width: number; height: number; labelpos: 'c' } {
  return { width: Math.min(160, label.length * 7 + 16), height: 24, labelpos: 'c' };
}

/** Where a point on a node's box falls in that node's own 0..1 proportions. */
function anchorFor(
  point: { x: number; y: number } | undefined,
  box: { x: number; y: number; width: number; height: number } | undefined
): Anchor | undefined {
  if (!point || !box || !(box.width > 0) || !(box.height > 0)) return undefined;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {
    u: clamp((point.x - (box.x - box.width / 2)) / box.width),
    v: clamp((point.y - (box.y - box.height / 2)) / box.height),
  };
}

/**
 * Positions for every node in a parsed graph using Dagre.
 */
export function layoutGraph(graph: MermaidGraph, options: LayoutOptions): LayoutResult {
  const g = new dagre.graphlib.Graph({ compound: true });
  
  // Dagre uses TB instead of TD
  const rankdir = graph.direction === 'TD' ? 'TB' : graph.direction;
  
  g.setGraph({
    rankdir,
    nodesep: options.siblingGap ?? DEFAULTS.siblingGap,
    ranksep: options.rankGap ?? DEFAULTS.rankGap,
    edgesep: options.siblingGap ?? DEFAULTS.siblingGap,
    marginx: 24,
    marginy: 44,
  });
  
  g.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = options.nodeWidth ?? DEFAULTS.nodeWidth;
  const nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
  const sizeOf = (key: string) =>
    options.sizeOf?.(key) ?? { width: nodeWidth, height: nodeHeight };

  const subgraphMap = new Map((graph.subgraphs ?? []).map((s) => [s.id, s]));

  // Helper to resolve edge endpoints so Dagre edges connect between leaf nodes
  const resolveLeafKey = (key: string, isFrom: boolean): string => {
    const sub = subgraphMap.get(key);
    if (sub && sub.nodeKeys.length > 0) {
      return isFrom ? sub.nodeKeys[sub.nodeKeys.length - 1] : sub.nodeKeys[0];
    }
    return key;
  };

  // Set subgraphs first so they exist for parenting in compound graph
  if (graph.subgraphs) {
    for (const sub of graph.subgraphs) {
      if (sub.nodeKeys.length > 0) {
        g.setNode(sub.id, {});
      }
    }
  }

  // Set nodes
  for (const node of graph.nodes) {
    const size = sizeOf(node.key);
    g.setNode(node.key, { width: size.width, height: size.height });
    
    // Assign to cluster if specified and cluster has children
    if (node.subgraphId && subgraphMap.has(node.subgraphId)) {
      const parentSub = subgraphMap.get(node.subgraphId);
      if (parentSub && parentSub.nodeKeys.length > 0) {
        g.setParent(node.key, node.subgraphId);
      }
    }
  }

  /**
   * Routed to leaf nodes: dagre's ranker cannot take a cluster as an edge
   * endpoint. Which leaf is an unavoidable guess -- the edge has to be in the
   * graph before layout runs, so there is no position to choose by yet, and
   * declaration order is the only ordering that exists at that point.
   */
  const routed: Array<{ from: string; to: string; fromLeaf: string; toLeaf: string }> = [];
  for (const edge of graph.edges) {
    const fromLeaf = resolveLeafKey(edge.from, true);
    const toLeaf = resolveLeafKey(edge.to, false);
    if (fromLeaf && toLeaf && fromLeaf !== toLeaf && g.hasNode(fromLeaf) && g.hasNode(toLeaf)) {
      // A label needs a channel of its own. Without these dagre lays the graph
      // out as though the edges were bare, and `B -->|yes| C` renders its word
      // on top of whatever the tighter layout put underneath it.
      g.setEdge(fromLeaf, toLeaf, edge.label ? labelBox(edge.label) : {});
      routed.push({ from: edge.from, to: edge.to, fromLeaf, toLeaf });
    }
  }

  // Calculate layout with safe fallback
  try {
    dagre.layout(g);
  } catch {
    // If Dagre layout fails on an edge case, remove compound grouping and retry
    const fallbackG = new dagre.graphlib.Graph();
    fallbackG.setGraph({ rankdir, nodesep: 40, ranksep: 80 });
    fallbackG.setDefaultEdgeLabel(() => ({}));
    for (const node of graph.nodes) {
      const size = sizeOf(node.key);
      fallbackG.setNode(node.key, { width: size.width, height: size.height });
    }
    for (const route of routed) {
      if (fallbackG.hasNode(route.fromLeaf) && fallbackG.hasNode(route.toLeaf)) {
        const edge = graph.edges.find((e) => e.from === route.from && e.to === route.to);
        fallbackG.setEdge(route.fromLeaf, route.toLeaf, edge?.label ? labelBox(edge.label) : {});
      }
    }
    dagre.layout(fallbackG);
    return extractLayout(fallbackG as unknown as DagreGraph, graph, options, routed);
  }

  return extractLayout(g as unknown as DagreGraph, graph, options, routed);
}

interface DagreBox { x: number; y: number; width: number; height: number }
interface DagreGraph {
  node(key: string): DagreBox | undefined;
  edge(e: { v: string; w: string }): { points?: Array<{ x: number; y: number }> } | undefined;
  hasNode(key: string): boolean;
}

function extractLayout(
  g: DagreGraph,
  graph: MermaidGraph,
  options: LayoutOptions,
  routed: Array<{ from: string; to: string; fromLeaf: string; toLeaf: string }>
): LayoutResult {
  /**
   * The top-left of everything, so the caller's origin means the top-left of
   * what they get.
   *
   * Clusters are included, and were not before. A cluster's box is drawn with
   * padding around its children and a strip above them for the title, so it
   * always begins above and to the left of the topmost node inside it --
   * which meant any diagram containing a subgraph was placed with its frame
   * hanging outside the spot it was dropped on, by exactly that padding.
   */
  let minX = Infinity;
  let minY = Infinity;
  const consider = (box: DagreBox | undefined) => {
    if (!box || !(box.width > 0) || !(box.height > 0)) return;
    minX = Math.min(minX, box.x - box.width / 2);
    minY = Math.min(minY, box.y - box.height / 2);
  };

  for (const node of graph.nodes) consider(g.node(node.key));
  for (const sub of graph.subgraphs ?? []) consider(g.node(sub.id));

  if (minX === Infinity) minX = 0;
  if (minY === Infinity) minY = 0;

  const shift = (box: DagreBox, key: string): PlacedNode => ({
    key,
    x: options.originX + (box.x - box.width / 2 - minX),
    y: options.originY + (box.y - box.height / 2 - minY),
    width: box.width,
    height: box.height,
  });

  const placedNodes: PlacedNode[] = [];
  for (const node of graph.nodes) {
    const box = g.node(node.key);
    if (box) placedNodes.push(shift(box, node.key));
  }

  const placedMap = new Map(placedNodes.map((p) => [p.key, p]));
  const placedClusters: PlacedNode[] = [];

  for (const sub of graph.subgraphs ?? []) {
    const box = g.node(sub.id);
    if (box && box.width > 0 && box.height > 0) {
      placedClusters.push(shift(box, sub.id));
      continue;
    }
    // The non-compound fallback path leaves clusters unsized, so the frame is
    // derived from what ended up inside it.
    const children = sub.nodeKeys
      .map((k) => placedMap.get(k))
      .filter((b): b is PlacedNode => Boolean(b));
    if (children.length === 0) continue;
    const pad = 24;
    const cMinX = Math.min(...children.map((c) => c.x)) - pad;
    // Extra above, for the title strip.
    const cMinY = Math.min(...children.map((c) => c.y)) - pad - 16;
    const cMaxX = Math.max(...children.map((c) => c.x + c.width)) + pad;
    const cMaxY = Math.max(...children.map((c) => c.y + c.height)) + pad;
    placedClusters.push({
      key: sub.id,
      x: cMinX,
      y: cMinY,
      width: cMaxX - cMinX,
      height: cMaxY - cMinY,
    });
  }

  /**
   * The routing, kept as intent rather than as geometry.
   *
   * Dagre's polyline runs from the source's perimeter to the target's. Only
   * its two ends are read, and only as proportions of the box they touch --
   * see the note at the top of this file for why the middle is dropped on
   * purpose rather than for want of somewhere to put it.
   */
  const edges: PlacedEdge[] = [];
  for (const route of routed) {
    const points = g.edge({ v: route.fromLeaf, w: route.toLeaf })?.points;
    edges.push({
      ...route,
      fromAnchor: anchorFor(points?.[0], g.node(route.fromLeaf)),
      toAnchor: anchorFor(points?.[points.length - 1], g.node(route.toLeaf)),
    });
  }

  return { nodes: placedNodes, clusters: placedClusters, edges };
}
