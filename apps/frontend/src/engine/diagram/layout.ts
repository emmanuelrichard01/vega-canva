/**
 * Where a parsed flowchart's boxes go.
 *
 * ## Why there is a layout step at all
 *
 * Mermaid source says nothing about position — that is the point of it. So
 * something has to decide, and "something" cannot be a grid: a flowchart laid
 * out in reading order rather than in *flow* order produces arrows that cross
 * each other and run backwards, which is worse than no diagram because the
 * shape of it actively misleads.
 *
 * This is a layered (Sugiyama-style) layout, cut down to the two passes that
 * do nearly all the work:
 *
 *  1. **Rank** every node by how far it is from a root, so an edge almost
 *     always points from one layer to the next.
 *  2. **Order** within each layer by the average position of the things
 *     pointing at it, which is the cheap approximation of crossing reduction.
 *     One pass down and one back up; further passes stop paying for themselves
 *     on diagrams of the size anyone writes by hand.
 *
 * Pure, so it runs without a canvas and is covered by tests.
 */

import type { FlowDirection, MermaidGraph } from './mermaid';

export interface PlacedNode {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

/** Whether the flow runs down the screen or across it. */
function isVertical(direction: FlowDirection): boolean {
  return direction === 'TD' || direction === 'TB' || direction === 'BT';
}

/**
 * The edges that close a cycle, found by depth-first search.
 *
 * An edge is a *back edge* when it points at a node already on the current DFS
 * stack — that is the textbook definition, and it is exactly the edge that has
 * to be set aside for the graph to have a ranking at all. Roots are visited
 * first so the choice is stable: a diagram ranks the same way every time it is
 * opened, which matters because the user rearranges what comes out.
 */
function findBackEdges(graph: MermaidGraph): Set<MermaidGraph['edges'][number]> {
  const out = new Map<string, Array<MermaidGraph['edges'][number]>>();
  for (const node of graph.nodes) out.set(node.key, []);
  for (const edge of graph.edges) out.get(edge.from)?.push(edge);

  const back = new Set<MermaidGraph['edges'][number]>();
  const done = new Set<string>();
  const onStack = new Set<string>();

  const walk = (key: string) => {
    onStack.add(key);
    for (const edge of out.get(key) ?? []) {
      if (edge.from === edge.to) continue;
      if (onStack.has(edge.to)) back.add(edge);
      else if (!done.has(edge.to)) walk(edge.to);
    }
    onStack.delete(key);
    done.add(key);
  };

  const hasIncoming = new Set(graph.edges.filter((e) => e.from !== e.to).map((e) => e.to));
  for (const node of graph.nodes) if (!hasIncoming.has(node.key)) walk(node.key);
  // A graph that is all cycle has no root; start anywhere left over.
  for (const node of graph.nodes) if (!done.has(node.key)) walk(node.key);
  return back;
}

/**
 * Rank by longest path from a root, not shortest.
 *
 * Shortest-path ranking puts a node immediately after the first thing that
 * reaches it, which drags long chains backwards and makes edges skip layers.
 * Longest-path keeps every edge pointing forward by exactly one rank wherever
 * the graph allows it, which is what makes the result read as a flow.
 */
function rankNodes(graph: MermaidGraph): Map<string, number> {
  const rank = new Map<string, number>();
  for (const node of graph.nodes) rank.set(node.key, 0);

  const backEdges = findBackEdges(graph);
  const forward = graph.edges.filter((e) => e.from !== e.to && !backEdges.has(e));
  /**
   * Only forward edges constrain the rank.
   *
   * This is the step that was missing, and the browser found it before the
   * tests did: `B --> D` with `D --> B` is a retry loop, which is one of the
   * most ordinary things a flowchart contains. Ranking on every edge let the
   * loop push its own head down — A, then B, then D, then B *again* at rank 3
   * — so the decision diamond ended up below both of its own branches and the
   * diagram read backwards.
   *
   * A cycle has no correct ranking; the standard answer is to choose the back
   * edges, leave them out of the ranking, and draw them anyway. They still
   * appear as arrows, they simply do not get a say in what is above what.
   */
  const cap = graph.nodes.length + 1;
  for (let pass = 0; pass < cap; pass++) {
    let moved = false;
    for (const edge of forward) {
      const from = rank.get(edge.from);
      const to = rank.get(edge.to);
      if (from === undefined || to === undefined) continue;
      if (to < from + 1) {
        rank.set(edge.to, from + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return rank;
}

/** Group keys by rank, preserving declaration order as the starting point. */
function layersOf(graph: MermaidGraph, rank: Map<string, number>): string[][] {
  // Built densely. Assigning by index leaves *holes* wherever a rank has no
  // node — which a cycle produces routinely — and `Array.prototype.map` skips
  // holes rather than filling them, so the `?? []` guard never ran and the
  // ordering pass dereferenced undefined.
  const highest = Math.max(0, ...graph.nodes.map((n) => rank.get(n.key) ?? 0));
  const layers: string[][] = Array.from({ length: highest + 1 }, () => []);
  for (const node of graph.nodes) {
    layers[rank.get(node.key) ?? 0].push(node.key);
  }
  return layers;
}

/**
 * Reorder each layer by the mean index of its neighbours in the previous one.
 *
 * The standard barycentre heuristic. It does not minimise crossings — that is
 * NP-hard — but it removes the great majority of them for the cost of two
 * sorts, and the ones it leaves are the ones a person would draw anyway.
 */
function order(layers: string[][], graph: MermaidGraph): string[][] {
  const result = layers.map((l) => [...l]);
  const neighbours = (key: string, back: boolean) =>
    graph.edges
      .filter((e) => (back ? e.to === key : e.from === key))
      .map((e) => (back ? e.from : e.to));

  const sweep = (back: boolean) => {
    const range = back
      ? [...result.keys()].slice(1)
      : [...result.keys()].slice(0, -1).reverse();
    for (const i of range) {
      const reference = new Map(result[back ? i - 1 : i + 1].map((k, idx) => [k, idx]));
      const score = new Map<string, number>();
      result[i].forEach((key, idx) => {
        const seen = neighbours(key, back)
          .map((n) => reference.get(n))
          .filter((v): v is number => v !== undefined);
        // A node with no neighbour in the reference layer keeps its place
        // rather than being swept to one end, where it would drag its own
        // edges across everything.
        score.set(key, seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : idx);
      });
      result[i].sort((a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0));
    }
  };

  sweep(true);
  sweep(false);
  return result;
}

/**
 * Positions for every node in a parsed graph.
 *
 * Layers are centred against the widest one, so a diagram that fans out and
 * back in reads as symmetrical rather than left-aligned against its own
 * largest row.
 */
export function layoutGraph(graph: MermaidGraph, options: LayoutOptions): PlacedNode[] {
  const nodeWidth = options.nodeWidth ?? DEFAULTS.nodeWidth;
  const nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
  const rankGap = options.rankGap ?? DEFAULTS.rankGap;
  const siblingGap = options.siblingGap ?? DEFAULTS.siblingGap;
  const vertical = isVertical(graph.direction);

  const layers = order(layersOf(graph, rankNodes(graph)), graph);
  const sizeOf = (key: string) =>
    options.sizeOf?.(key) ?? { width: nodeWidth, height: nodeHeight };

  // How far across the flow each layer runs, so they can be centred.
  const extents = layers.map((layer) =>
    layer.reduce((total, key, i) => {
      const s = sizeOf(key);
      return total + (vertical ? s.width : s.height) + (i > 0 ? siblingGap : 0);
    }, 0)
  );
  const widest = Math.max(1, ...extents);

  const placed: PlacedNode[] = [];
  let along = 0;

  layers.forEach((layer, rankIndex) => {
    let across = (widest - extents[rankIndex]) / 2;
    const deepest = layer.reduce(
      (m, key) => Math.max(m, vertical ? sizeOf(key).height : sizeOf(key).width),
      0
    );

    for (const key of layer) {
      const s = sizeOf(key);
      placed.push({
        key,
        x: options.originX + (vertical ? across : along),
        y: options.originY + (vertical ? along : across),
        width: s.width,
        height: s.height,
      });
      across += (vertical ? s.width : s.height) + siblingGap;
    }
    along += deepest + rankGap;
    void rankIndex;
  });

  /**
   * `BT` and `RL` are the same layout run backwards.
   *
   * Mirroring the finished positions is exact and costs one pass; threading the
   * direction through the ranking instead would mean two orderings to keep in
   * step, and the second one would be the one nobody tested.
   */
  if (graph.direction === 'BT' || graph.direction === 'RL') {
    const axis = graph.direction === 'BT' ? 'y' : 'x';
    const span = placed.reduce((m, p) => Math.max(m, p[axis] + (axis === 'y' ? p.height : p.width)), 0);
    const base = options[axis === 'y' ? 'originY' : 'originX'];
    for (const p of placed) {
      const size = axis === 'y' ? p.height : p.width;
      p[axis] = base + (span - base) - (p[axis] - base) - size;
    }
  }

  return placed;
}
