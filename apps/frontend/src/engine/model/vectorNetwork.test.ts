import { describe, it, expect } from 'vitest';
import {
  createEmptyVectorNetwork,
  addVertex,
  addEdge,
  getVertexDegree,
  getAdjacentVertices,
  removeVertex,
  removeEdge,
  splitEdge,
  toSvgPathData,
  getConnectedComponents,
  fromBezierGeometry,
  branchFromVertex,
  findHighDegreeVertices,
} from './vectorNetwork';

describe('VectorNetwork data structure and graph operations', () => {
  it('creates an empty vector network', () => {
    const net = createEmptyVectorNetwork();
    expect(net.vertices).toEqual([]);
    expect(net.edges).toEqual([]);
  });

  it('adds vertices and edges', () => {
    let net = createEmptyVectorNetwork();
    const v0 = addVertex(net, 0, 0);
    net = v0.network;
    const v1 = addVertex(net, 100, 0);
    net = v1.network;
    const v2 = addVertex(net, 50, 100);
    net = v2.network;

    expect(net.vertices.length).toBe(3);

    const e0 = addEdge(net, 0, 1);
    net = e0.network;
    const e1 = addEdge(net, 1, 2);
    net = e1.network;
    const e2 = addEdge(net, 2, 0);
    net = e2.network;

    expect(net.edges.length).toBe(3);
    expect(getVertexDegree(net, 0)).toBe(2);
    expect(getAdjacentVertices(net, 0)).toEqual([1, 2]);
  });

  it('supports multi-branching vertices with degree 3 or more (T-junction / Star)', () => {
    let net = createEmptyVectorNetwork();
    // Central vertex 0
    net = addVertex(net, 100, 100).network;
    // Branch vertices 1, 2, 3, 4
    net = addVertex(net, 100, 0).network;
    net = addVertex(net, 200, 100).network;
    net = addVertex(net, 100, 200).network;
    net = addVertex(net, 0, 100).network;

    net = addEdge(net, 0, 1).network;
    net = addEdge(net, 0, 2).network;
    net = addEdge(net, 0, 3).network;
    net = addEdge(net, 0, 4).network;

    expect(getVertexDegree(net, 0)).toBe(4);
    expect(getAdjacentVertices(net, 0).sort()).toEqual([1, 2, 3, 4]);
  });

  it('removes a vertex and cascades edge deletions while re-indexing', () => {
    let net = createEmptyVectorNetwork();
    net = addVertex(net, 0, 0).network;   // 0
    net = addVertex(net, 50, 50).network; // 1
    net = addVertex(net, 100, 0).network; // 2

    net = addEdge(net, 0, 1).network; // e0
    net = addEdge(net, 1, 2).network; // e1

    // Remove middle vertex 1
    net = removeVertex(net, 1);

    expect(net.vertices.length).toBe(2);
    expect(net.edges.length).toBe(0);
  });

  it('removes an edge by its index', () => {
    let net = createEmptyVectorNetwork();
    net = addVertex(net, 0, 0).network;
    net = addVertex(net, 10, 0).network;
    net = addEdge(net, 0, 1).network;

    expect(net.edges.length).toBe(1);
    net = removeEdge(net, 0);
    expect(net.edges.length).toBe(0);
    expect(net.vertices.length).toBe(2);
  });

  it('splits a straight edge at midpoint inserting a new vertex', () => {
    let net = createEmptyVectorNetwork();
    net = addVertex(net, 0, 0).network;     // 0
    net = addVertex(net, 100, 100).network; // 1
    net = addEdge(net, 0, 1).network;       // 0

    const split = splitEdge(net, 0, 0.5);
    net = split.network;

    expect(net.vertices.length).toBe(3);
    expect(net.vertices[2]).toEqual({ x: 50, y: 50 });
    expect(net.edges.length).toBe(2);
    expect(net.edges[0]).toEqual({ start: 0, end: 2, control1: undefined, control2: undefined });
    expect(net.edges[1]).toEqual({ start: 2, end: 1, control1: undefined, control2: undefined });
  });

  it('splits a cubic Bézier edge using De Casteljau subdivision', () => {
    let net = createEmptyVectorNetwork();
    net = addVertex(net, 0, 0).network;
    net = addVertex(net, 100, 0).network;
    net = addEdge(net, 0, 1, { x: 25, y: 50 }, { x: 75, y: 50 }).network;

    const split = splitEdge(net, 0, 0.5);
    net = split.network;

    expect(net.vertices.length).toBe(3);
    // At t=0.5, y is 37.5 on symmetrical curve
    expect(net.vertices[2].x).toBeCloseTo(50);
    expect(net.vertices[2].y).toBeCloseTo(37.5);
    expect(net.edges.length).toBe(2);
    expect(net.edges[0].control1).toBeDefined();
    expect(net.edges[1].control2).toBeDefined();
  });

  it('exports VectorNetwork to SVG path string data', () => {
    let net = createEmptyVectorNetwork();
    net = addVertex(net, 10, 20).network;
    net = addVertex(net, 30, 40).network;
    net = addEdge(net, 0, 1).network;

    const svg = toSvgPathData(net);
    expect(svg).toBe('M 10.00 20.00 L 30.00 40.00');
  });

  it('identifies separate connected components', () => {
    let net = createEmptyVectorNetwork();
    // Component A: 0 - 1
    net = addVertex(net, 0, 0).network;
    net = addVertex(net, 10, 10).network;
    net = addEdge(net, 0, 1).network;

    // Component B: 2 - 3
    net = addVertex(net, 100, 100).network;
    net = addVertex(net, 110, 110).network;
    net = addEdge(net, 2, 3).network;

    const comps = getConnectedComponents(net);
    expect(comps.length).toBe(2);
    expect(comps[0].vertices.length).toBe(2);
    expect(comps[1].vertices.length).toBe(2);
  });

  it('converts a closed BezierGeometry into a VectorNetwork', () => {
    const geo = {
      segments: [
        { x: 0, y: 0, cp1: { x: 0, y: 50 }, cp2: { x: 0, y: 100 } },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      closed: true,
    };

    const net = fromBezierGeometry(geo);
    expect(net.vertices.length).toBe(3);
    expect(net.edges.length).toBe(3);
    // Closing edge connects last index (2) to 0
    expect(net.edges[2].start).toBe(2);
    expect(net.edges[2].end).toBe(0);
  });

  it('branches off an existing vertex creating a T-junction or star hub', () => {
    let net = createEmptyVectorNetwork();
    net = addVertex(net, 0, 0).network;   // 0
    net = addVertex(net, 100, 0).network; // 1
    net = addEdge(net, 0, 1).network;

    // Branch from vertex 0 to (0, 100) and (0, -100)
    const b1 = branchFromVertex(net, 0, { x: 0, y: 100 });
    net = b1.network;
    expect(getVertexDegree(net, 0)).toBe(2);

    const b2 = branchFromVertex(net, 0, { x: 0, y: -100 });
    net = b2.network;
    expect(getVertexDegree(net, 0)).toBe(3);

    const hubs = findHighDegreeVertices(net);
    expect(hubs).toEqual([0]);
  });
});
