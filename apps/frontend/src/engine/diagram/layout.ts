/**
 * Where a parsed flowchart's boxes go.
 *
 * Backed by @dagrejs/dagre, providing professional-grade Sugiyama layout with
 * robust crossing minimization, edge routing, and native support for compound
 * graphs (clusters/subgraphs).
 */

import dagre from '@dagrejs/dagre';
import type { MermaidGraph } from './mermaid';

export interface PlacedNode {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: PlacedNode[];
  clusters: PlacedNode[];
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

const DEFAULTS = { nodeWidth: 170, nodeHeight: 72, rankGap: 90, siblingGap: 40 };

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

  // Set edges (routed to leaf nodes to prevent ranker crashes on compound nodes)
  for (const edge of graph.edges) {
    const from = resolveLeafKey(edge.from, true);
    const to = resolveLeafKey(edge.to, false);
    if (from && to && from !== to && g.hasNode(from) && g.hasNode(to)) {
      g.setEdge(from, to);
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
    for (const edge of graph.edges) {
      const from = resolveLeafKey(edge.from, true);
      const to = resolveLeafKey(edge.to, false);
      if (from && to && fallbackG.hasNode(from) && fallbackG.hasNode(to)) {
        fallbackG.setEdge(from, to);
      }
    }
    dagre.layout(fallbackG);
    return extractLayout(fallbackG, graph, options);
  }

  return extractLayout(g, graph, options);
}

function extractLayout(
  g: any,
  graph: MermaidGraph,
  options: LayoutOptions
): LayoutResult {
  // Compute minimums to re-align to origin
  let minX = Infinity;
  let minY = Infinity;
  
  for (const node of graph.nodes) {
    const layoutNode = g.node(node.key);
    if (!layoutNode) continue;
    const x = layoutNode.x - layoutNode.width / 2;
    const y = layoutNode.y - layoutNode.height / 2;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  
  if (minX === Infinity) minX = 0;
  if (minY === Infinity) minY = 0;

  const placedNodes: PlacedNode[] = [];
  const placedClusters: PlacedNode[] = [];

  for (const node of graph.nodes) {
    const layoutNode = g.node(node.key);
    if (!layoutNode) continue;
    const x = layoutNode.x - layoutNode.width / 2;
    const y = layoutNode.y - layoutNode.height / 2;
    placedNodes.push({
      key: node.key,
      x: options.originX + (x - minX),
      y: options.originY + (y - minY),
      width: layoutNode.width,
      height: layoutNode.height,
    });
  }

  const placedMap = new Map(placedNodes.map((p) => [p.key, p]));

  if (graph.subgraphs) {
    for (const sub of graph.subgraphs) {
      const layoutNode = g.node(sub.id);
      if (layoutNode && layoutNode.width > 0 && layoutNode.height > 0) {
        const x = layoutNode.x - layoutNode.width / 2;
        const y = layoutNode.y - layoutNode.height / 2;
        placedClusters.push({
          key: sub.id,
          x: options.originX + (x - minX),
          y: options.originY + (y - minY),
          width: layoutNode.width,
          height: layoutNode.height,
        });
      } else {
        // Fallback: calculate cluster bounding box from child nodes
        const childBoxes = sub.nodeKeys
          .map((k) => placedMap.get(k))
          .filter((b): b is PlacedNode => Boolean(b));
        if (childBoxes.length > 0) {
          const pad = 24;
          const cMinX = Math.min(...childBoxes.map((c) => c.x)) - pad;
          const cMinY = Math.min(...childBoxes.map((c) => c.y)) - pad - 16;
          const cMaxX = Math.max(...childBoxes.map((c) => c.x + c.width)) + pad;
          const cMaxY = Math.max(...childBoxes.map((c) => c.y + c.height)) + pad;
          placedClusters.push({
            key: sub.id,
            x: cMinX,
            y: cMinY,
            width: cMaxX - cMinX,
            height: cMaxY - cMinY,
          });
        }
      }
    }
  }

  return { nodes: placedNodes, clusters: placedClusters };
}
