import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layout';
import { parseMermaid } from './mermaid';
import type { MermaidGraph } from './mermaid';

function graphOf(src: string): MermaidGraph {
  const { graph, error } = parseMermaid(src);
  if (!graph) throw new Error(`parse failed: ${error}`);
  return graph;
}

const ORIGIN = { originX: 0, originY: 0 };

describe('layoutGraph: routing', () => {
  /**
   * Dagre computes a polyline for every edge. The first version of this module
   * discarded all of them and `build.ts` attached every connector with
   * `port: 'auto'`, so the canvas re-derived each path with a router that knew
   * nothing about the channels dagre had reserved -- the layering was dagre's
   * and the arrows were not.
   */
  it('reports where dagre chose to leave and arrive', () => {
    const result = layoutGraph(graphOf('flowchart TD\n  A --> B'), ORIGIN);

    expect(result.edges).toHaveLength(1);
    const [edge] = result.edges;
    expect(edge.from).toBe('A');
    expect(edge.to).toBe('B');
    expect(edge.fromAnchor).toBeDefined();
    expect(edge.toAnchor).toBeDefined();
  });

  it('separates a fan-out instead of stacking it on one midpoint', () => {
    // The whole point. Three edges off one decision node, top-to-bottom: with
    // `auto` all three resolve to the same bottom midpoint and cross
    // immediately, undoing the crossing minimisation that ordered the targets.
    const result = layoutGraph(
      graphOf('flowchart TD\n  B --> C\n  B --> D\n  B --> E'),
      ORIGIN
    );

    const outgoing = result.edges.filter((e) => e.from === 'B');
    expect(outgoing).toHaveLength(3);

    const us = outgoing.map((e) => e.fromAnchor!.u);
    expect(new Set(us).size).toBe(3);

    /**
     * Leaving the lower half, not exactly the boundary.
     *
     * This asserted `v` was 1.0 and broke when `rankGap` tightened, because
     * dagre then starts the polyline a little inside the box (0.89). That was
     * a test of dagre's routing internals rather than of anything that
     * matters: `anchorPoint` projects an anchor out to the perimeter on every
     * read, so the drawn result is identical either way. What has to hold is
     * that the three leave at *different* places on the *downstream* face.
     */
    for (const e of outgoing) expect(e.fromAnchor!.v).toBeGreaterThan(0.5);
  });

  it('keeps anchors inside the box they belong to', () => {
    const result = layoutGraph(
      graphOf('flowchart LR\n  A --> B\n  B --> C\n  A --> C'),
      ORIGIN
    );

    for (const edge of result.edges) {
      for (const a of [edge.fromAnchor, edge.toAnchor]) {
        expect(a!.u).toBeGreaterThanOrEqual(0);
        expect(a!.u).toBeLessThanOrEqual(1);
        expect(a!.v).toBeGreaterThanOrEqual(0);
        expect(a!.v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('follows the flow direction', () => {
    // Left-to-right leaves the right face; top-down leaves the bottom.
    const lr = layoutGraph(graphOf('flowchart LR\n  A --> B'), ORIGIN).edges[0];
    expect(lr.fromAnchor!.u).toBeCloseTo(1, 1);

    const td = layoutGraph(graphOf('flowchart TD\n  A --> B'), ORIGIN).edges[0];
    expect(td.fromAnchor!.v).toBeCloseTo(1, 1);
  });
});

describe('layoutGraph: edge labels', () => {
  it('reserves room for a label rather than laying out as though it were bare', () => {
    /**
     * Labels are parsed and drawn; before this they were invisible to the
     * layout, so `A -->|a long label|B` put its word on top of whatever the
     * tighter graph had underneath.
     */
    const bare = layoutGraph(graphOf('flowchart LR\n  A --> B'), ORIGIN);
    const labelled = layoutGraph(
      graphOf('flowchart LR\n  A -->|a reasonably long label| B'),
      ORIGIN
    );

    const span = (r: { nodes: { x: number; width: number }[] }) =>
      Math.max(...r.nodes.map((n) => n.x + n.width)) - Math.min(...r.nodes.map((n) => n.x));

    expect(span(labelled)).toBeGreaterThan(span(bare));
  });
});

describe('layoutGraph: origin', () => {
  it('places the top-left of the diagram at the origin it was given', () => {
    const result = layoutGraph(graphOf('flowchart TD\n  A --> B'), {
      originX: 500,
      originY: 300,
    });

    expect(Math.min(...result.nodes.map((n) => n.x))).toBeCloseTo(500, 0);
    expect(Math.min(...result.nodes.map((n) => n.y))).toBeCloseTo(300, 0);
  });

  it('counts the cluster frame, not just the nodes inside it', () => {
    /**
     * A cluster is drawn with padding around its children and a strip above
     * them for the title, so it always begins above and to the left of its
     * topmost node. Normalising on nodes alone put the frame outside the spot
     * the diagram was dropped on, by exactly that padding.
     */
    const result = layoutGraph(
      graphOf('flowchart TD\n  subgraph S [Group]\n    A --> B\n  end\n  B --> C'),
      { originX: 100, originY: 100 }
    );

    expect(result.clusters.length).toBeGreaterThan(0);
    const top = Math.min(
      ...result.nodes.map((n) => n.y),
      ...result.clusters.map((c) => c.y)
    );
    const left = Math.min(
      ...result.nodes.map((n) => n.x),
      ...result.clusters.map((c) => c.x)
    );
    expect(left).toBeCloseTo(100, 0);
    expect(top).toBeCloseTo(100, 0);
  });
});

describe('layoutGraph: robustness', () => {
  it('lays out a graph with no edges', () => {
    const result = layoutGraph(graphOf('flowchart TD\n  A\n  B'), ORIGIN);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
  });

  it('drops a self-edge rather than handing dagre a loop it cannot rank', () => {
    const result = layoutGraph(graphOf('flowchart TD\n  A --> A\n  A --> B'), ORIGIN);
    expect(result.edges.every((e) => e.fromLeaf !== e.toLeaf)).toBe(true);
  });

  it('survives a cycle', () => {
    const result = layoutGraph(
      graphOf('flowchart TD\n  A --> B\n  B --> C\n  C --> A'),
      ORIGIN
    );
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
  });

  it('sizes nodes from the caller when it is told how', () => {
    const result = layoutGraph(graphOf('flowchart TD\n  A --> B'), {
      ...ORIGIN,
      sizeOf: (key) => (key === 'A' ? { width: 400, height: 200 } : undefined),
    });

    expect(result.nodes.find((n) => n.key === 'A')!.width).toBe(400);
    expect(result.nodes.find((n) => n.key === 'B')!.width).toBe(170);
  });
});
