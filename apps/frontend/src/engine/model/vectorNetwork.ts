import type { Point } from './schema';

/**
 * Vector Network Topology.
 *
 * ## Why Vector Networks (Figma-style non-linear paths)
 *
 * Traditional vector formats (like standard SVG `<path>` and Canvas2D path commands)
 * represent paths as linear sequences or closed loops of segments where each point
 * connects to at most two neighbours (previous and next).
 *
 * A Vector Network represents vector graphics as a directed/undirected graph of
 * vertices and edges. Any vertex can have arbitrary degree (1 for endpoints,
 * 2 for standard curves, 3+ for T-junctions, star hubs, and mesh intersections).
 *
 * Each edge can be straight or a cubic Bézier curve with two optional control points.
 */

export interface VectorVertex {
  x: number;
  y: number;
}

export interface VectorEdge {
  id?: string;
  start: number; // Index into vertices array
  end: number;   // Index into vertices array
  control1?: Point; // Cubic control point relative to start vertex or absolute world
  control2?: Point; // Cubic control point relative to end vertex or absolute world
}

export interface VectorNetwork {
  vertices: VectorVertex[];
  edges: VectorEdge[];
}

export function createEmptyVectorNetwork(): VectorNetwork {
  return { vertices: [], edges: [] };
}

/** Adds a vertex to the network and returns its index */
export function addVertex(network: VectorNetwork, x: number, y: number): { network: VectorNetwork; index: number } {
  const index = network.vertices.length;
  const vertices = [...network.vertices, { x, y }];
  return {
    network: { ...network, vertices },
    index,
  };
}

/** Adds an edge between two vertex indices */
export function addEdge(
  network: VectorNetwork,
  start: number,
  end: number,
  control1?: Point,
  control2?: Point
): { network: VectorNetwork; index: number } {
  if (start < 0 || start >= network.vertices.length || end < 0 || end >= network.vertices.length) {
    throw new Error(`Invalid vertex indices: start=${start}, end=${end}, total=${network.vertices.length}`);
  }

  const index = network.edges.length;
  const edge: VectorEdge = { start, end, control1, control2 };
  const edges = [...network.edges, edge];

  return {
    network: { ...network, edges },
    index,
  };
}

/** Returns the number of edges connected to a vertex */
export function getVertexDegree(network: VectorNetwork, vertexIndex: number): number {
  let count = 0;
  for (const edge of network.edges) {
    if (edge.start === vertexIndex || edge.end === vertexIndex) {
      count++;
    }
  }
  return count;
}

/** Returns all vertex indices that have a degree of 3 or higher (junction hubs) */
export function findHighDegreeVertices(network: VectorNetwork, minDegree = 3): number[] {
  const result: number[] = [];
  for (let i = 0; i < network.vertices.length; i++) {
    if (getVertexDegree(network, i) >= minDegree) {
      result.push(i);
    }
  }
  return result;
}

/**
 * Branches a new edge and new vertex off an existing vertex in the network.
 * This is the fundamental operation for creating T-junctions, star branches, and non-linear paths.
 */
export function branchFromVertex(
  network: VectorNetwork,
  fromVertexIndex: number,
  targetPoint: Point,
  control1?: Point,
  control2?: Point
): { network: VectorNetwork; newVertexIndex: number; newEdgeIndex: number } {
  if (fromVertexIndex < 0 || fromVertexIndex >= network.vertices.length) {
    throw new Error(`Invalid source vertex index: ${fromVertexIndex}`);
  }

  const { network: netWithVertex, index: newVertexIndex } = addVertex(
    network,
    targetPoint.x,
    targetPoint.y
  );

  const { network: finalNetwork, index: newEdgeIndex } = addEdge(
    netWithVertex,
    fromVertexIndex,
    newVertexIndex,
    control1,
    control2
  );

  return {
    network: finalNetwork,
    newVertexIndex,
    newEdgeIndex,
  };
}

/** Returns all adjacent vertex indices for a given vertex */
export function getAdjacentVertices(network: VectorNetwork, vertexIndex: number): number[] {
  const adjacent = new Set<number>();
  for (const edge of network.edges) {
    if (edge.start === vertexIndex) adjacent.add(edge.end);
    if (edge.end === vertexIndex) adjacent.add(edge.start);
  }
  return Array.from(adjacent);
}

/** Removes a vertex and all incident edges, cleanly re-indexing remaining edge endpoints */
export function removeVertex(network: VectorNetwork, vertexIndex: number): VectorNetwork {
  if (vertexIndex < 0 || vertexIndex >= network.vertices.length) return network;

  const vertices = network.vertices.filter((_, idx) => idx !== vertexIndex);
  const edges: VectorEdge[] = [];

  for (const edge of network.edges) {
    // If edge is incident to deleted vertex, delete the edge
    if (edge.start === vertexIndex || edge.end === vertexIndex) continue;

    // Remap remaining vertex indices
    const newStart = edge.start > vertexIndex ? edge.start - 1 : edge.start;
    const newEnd = edge.end > vertexIndex ? edge.end - 1 : edge.end;

    edges.push({
      ...edge,
      start: newStart,
      end: newEnd,
    });
  }

  return { vertices, edges };
}

/** Removes an edge by its index */
export function removeEdge(network: VectorNetwork, edgeIndex: number): VectorNetwork {
  if (edgeIndex < 0 || edgeIndex >= network.edges.length) return network;
  const edges = network.edges.filter((_, idx) => idx !== edgeIndex);
  return { ...network, edges };
}

/**
 * Splits an edge at parameter t (0..1) using De Casteljau algorithm,
 * inserting a new vertex and replacing the edge with two connected sub-edges.
 */
export function splitEdge(
  network: VectorNetwork,
  edgeIndex: number,
  t = 0.5
): { network: VectorNetwork; newVertexIndex: number } {
  if (edgeIndex < 0 || edgeIndex >= network.edges.length) {
    throw new Error(`Invalid edge index: ${edgeIndex}`);
  }

  const edge = network.edges[edgeIndex];
  const p0 = network.vertices[edge.start];
  const p3 = network.vertices[edge.end];

  let splitPoint: Point;
  let edge1Control1: Point | undefined;
  let edge1Control2: Point | undefined;
  let edge2Control1: Point | undefined;
  let edge2Control2: Point | undefined;

  if (edge.control1 && edge.control2) {
    const p1 = edge.control1;
    const p2 = edge.control2;

    const lerp = (a: Point, b: Point, ratio: number): Point => ({
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
    });

    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    const p23 = lerp(p2, p3, t);

    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);

    splitPoint = lerp(p012, p123, t);

    edge1Control1 = p01;
    edge1Control2 = p012;
    edge2Control1 = p123;
    edge2Control2 = p23;
  } else {
    // Straight line
    splitPoint = {
      x: p0.x + (p3.x - p0.x) * t,
      y: p0.y + (p3.y - p0.y) * t,
    };
  }

  const newVertexIndex = network.vertices.length;
  const vertices = [...network.vertices, { x: splitPoint.x, y: splitPoint.y }];

  // Replace original edge with edge1, and append edge2
  const edge1: VectorEdge = {
    start: edge.start,
    end: newVertexIndex,
    control1: edge1Control1,
    control2: edge1Control2,
  };

  const edge2: VectorEdge = {
    start: newVertexIndex,
    end: edge.end,
    control1: edge2Control1,
    control2: edge2Control2,
  };

  const edges = [...network.edges];
  edges[edgeIndex] = edge1;
  edges.push(edge2);

  return {
    network: { vertices, edges },
    newVertexIndex,
  };
}

/**
 * Converts a Vector Network into SVG path string `d`.
 * Disjoint edges and multi-branch junctions each emit appropriate `M` move commands.
 */
export function toSvgPathData(network: VectorNetwork): string {
  if (network.vertices.length === 0 || network.edges.length === 0) return '';

  const parts: string[] = [];

  for (const edge of network.edges) {
    const start = network.vertices[edge.start];
    const end = network.vertices[edge.end];
    if (!start || !end) continue;

    parts.push(`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`);

    if (edge.control1 && edge.control2) {
      parts.push(
        `C ${edge.control1.x.toFixed(2)} ${edge.control1.y.toFixed(2)}, ${edge.control2.x.toFixed(2)} ${edge.control2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
      );
    } else {
      parts.push(`L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`);
    }
  }

  return parts.join(' ');
}

/**
 * Finds all connected components (sub-graphs) within the Vector Network.
 */
export function getConnectedComponents(network: VectorNetwork): VectorNetwork[] {
  const visitedVertices = new Set<number>();
  const components: VectorNetwork[] = [];

  for (let i = 0; i < network.vertices.length; i++) {
    if (visitedVertices.has(i)) continue;

    const componentVerticesIndices: number[] = [];
    const queue = [i];
    visitedVertices.add(i);

    while (queue.length > 0) {
      const current = queue.shift()!;
      componentVerticesIndices.push(current);

      for (const neighbour of getAdjacentVertices(network, current)) {
        if (!visitedVertices.has(neighbour)) {
          visitedVertices.add(neighbour);
          queue.push(neighbour);
        }
      }
    }

    // Build subnetwork
    const oldToNewIndex = new Map<number, number>();
    const subVertices: VectorVertex[] = componentVerticesIndices.map((oldIdx, newIdx) => {
      oldToNewIndex.set(oldIdx, newIdx);
      return network.vertices[oldIdx];
    });

    const subEdges: VectorEdge[] = [];
    for (const edge of network.edges) {
      if (oldToNewIndex.has(edge.start) && oldToNewIndex.has(edge.end)) {
        subEdges.push({
          ...edge,
          start: oldToNewIndex.get(edge.start)!,
          end: oldToNewIndex.get(edge.end)!,
        });
      }
    }

    components.push({ vertices: subVertices, edges: subEdges });
  }

  return components;
}

/**
 * Converts a BezierGeometry (linear segment chain or closed contour) into a VectorNetwork.
 */
export function fromBezierGeometry(geo: { segments?: Array<{ x: number; y: number; cp1?: Point; cp2?: Point }>; closed?: boolean }): VectorNetwork {
  if (!geo.segments || geo.segments.length === 0) return createEmptyVectorNetwork();

  const vertices: VectorVertex[] = geo.segments.map((s) => ({ x: s.x, y: s.y }));
  const edges: VectorEdge[] = [];

  for (let i = 1; i < geo.segments.length; i++) {
    const curr = geo.segments[i];
    edges.push({
      start: i - 1,
      end: i,
      control1: curr.cp1 ? { x: curr.cp1.x, y: curr.cp1.y } : undefined,
      control2: curr.cp2 ? { x: curr.cp2.x, y: curr.cp2.y } : undefined,
    });
  }

  if (geo.closed && geo.segments.length > 1) {
    const seg0 = geo.segments[0];
    edges.push({
      start: geo.segments.length - 1,
      end: 0,
      control1: seg0.cp1 ? { x: seg0.cp1.x, y: seg0.cp1.y } : undefined,
      control2: seg0.cp2 ? { x: seg0.cp2.x, y: seg0.cp2.y } : undefined,
    });
  }

  return { vertices, edges };
}
