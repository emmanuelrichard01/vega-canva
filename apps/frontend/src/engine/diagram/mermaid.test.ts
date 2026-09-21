import { describe, it, expect } from 'vitest';
import { emitMermaid, parseMermaid, formatMermaid, parseMermaidLenient } from './mermaid';
import { layoutGraph } from './layout';
import { buildDiagram, diagramToMermaid } from './build';
import { connectorPoints } from '../model/connector';
import type { AnyNode } from '../model/schema';

describe('parsing a flowchart', () => {
  it('reads nodes, labels and the arrow between them', () => {
    const { graph } = parseMermaid('flowchart TD\n  A[Start] --> B[Finish]');
    expect(graph?.direction).toBe('TD');
    expect(graph?.nodes).toEqual([
      { key: 'A', label: 'Start', shape: 'rect' },
      { key: 'B', label: 'Finish', shape: 'rect' },
    ]);
    expect(graph?.edges).toEqual([{ from: 'A', to: 'B', line: 'solid', arrow: true }]);
  });

  it('picks the longest bracket form, not the first that matches', () => {
    // `([x])` also matches `(...)`, and `[[x]]` also matches `[...]`. Testing
    // the short form first would claim the text and leave stray brackets in
    // the label, which is the bug the ordering exists to prevent.
    const { graph } = parseMermaid(
      'graph LR\n A([Stadium]) --> B[[Sub]] --> C((Round)) --> D{{Hex}}'
    );
    expect(graph?.nodes.map((n) => [n.shape, n.label])).toEqual([
      ['stadium', 'Stadium'],
      ['subroutine', 'Sub'],
      ['circle', 'Round'],
      ['hexagon', 'Hex'],
    ]);
  });

  it('chains a multi-hop line into separate edges', () => {
    const { graph } = parseMermaid('flowchart TD\n A --> B --> C');
    expect(graph?.edges).toHaveLength(2);
    expect(graph?.edges.map((e) => `${e.from}${e.to}`)).toEqual(['AB', 'BC']);
  });

  it('reads an edge label written either way mermaid allows', () => {
    const piped = parseMermaid('flowchart TD\n A -->|yes| B').graph;
    const inline = parseMermaid('flowchart TD\n A -- no --> B').graph;
    expect(piped?.edges[0].label).toBe('yes');
    expect(inline?.edges[0].label).toBe('no');
  });

  it('distinguishes dotted, thick and headless links', () => {
    const { graph } = parseMermaid('flowchart TD\n A -.-> B\n B ==> C\n C --- D');
    expect(graph?.edges.map((e) => [e.line, e.arrow])).toEqual([
      ['dotted', true],
      ['thick', true],
      ['solid', false],
    ]);
  });

  it('lets a later declaration name a node first seen bare', () => {
    const { graph } = parseMermaid('flowchart TD\n A --> B\n A[Real name]');
    expect(graph?.nodes.find((n) => n.key === 'A')?.label).toBe('Real name');
  });

  it('names the diagram type it is declining, rather than failing generically', () => {
    const { graph, error } = parseMermaid('sequenceDiagram\n Alice->>Bob: Hi');
    expect(graph).toBeNull();
    expect(error).toMatch(/sequenceDiagram/);
  });

  it('never throws on half-typed input, because the preview runs per keystroke', () => {
    for (const partial of ['flowchart', 'flowchart TD\n A[', 'flowchart TD\n A -->', '', '   ']) {
      expect(() => parseMermaid(partial)).not.toThrow();
    }
  });

  it('ignores comments and styling directives', () => {
    const { graph } = parseMermaid(
      'flowchart TD\n %% a note\n A --> B\n style A fill:#f9f\n classDef big font-size:20px'
    );
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.edges).toHaveLength(1);
  });
});

describe('emitting', () => {
  it('round-trips a diagram back to an equivalent graph', () => {
    const source = 'flowchart TD\n A[Start] --> B{Choose}\n B -->|yes| C([Done])\n B -.->|no| A';
    const first = parseMermaid(source).graph!;
    const again = parseMermaid(emitMermaid(first)).graph!;
    expect(again.nodes).toEqual(first.nodes);
    expect(again.edges).toEqual(first.edges);
  });

  it('quotes a label that would otherwise break the grammar', () => {
    const source = emitMermaid({
      direction: 'TD',
      nodes: [{ key: 'A', label: 'Ship it (v2)', shape: 'rect' }],
      edges: [],
    });
    // Unquoted, the inner bracket closes the node early and the file will not parse.
    expect(parseMermaid(source).graph?.nodes[0].label).toBe('Ship it (v2)');
  });

  it('drops an edge naming a node nothing declared', () => {
    const source = emitMermaid({
      direction: 'TD',
      nodes: [{ key: 'A', label: 'A', shape: 'rect' }],
      edges: [{ from: 'A', to: 'GHOST', line: 'solid', arrow: true }],
    });
    expect(source).not.toMatch(/GHOST/);
  });
});

describe('layout', () => {
  const chain = parseMermaid('flowchart TD\n A --> B\n A --> C\n B --> D\n C --> D').graph!;

  it('ranks by longest path, so no edge points backwards', () => {
    const { nodes: placed } = layoutGraph(chain, { originX: 0, originY: 0 });
    const y = new Map(placed.map((p) => [p.key, p.y]));
    // D is reachable in two hops by either branch and must sit below both.
    expect(y.get('D')!).toBeGreaterThan(y.get('B')!);
    expect(y.get('D')!).toBeGreaterThan(y.get('C')!);
    expect(y.get('B')).toBe(y.get('C'));
  });

  it('does not let a retry loop push its own decision below its branches', () => {
    // The shape the live preview exposed and the tests had missed: `D --> B`
    // is an ordinary retry edge, and ranking on it dragged B beneath both of
    // the branches leaving it, so the diagram read backwards.
    const retry = parseMermaid(
      [
        'flowchart TD',
        '  A[Start] --> B{Ready?}',
        '  B -->|yes| C([Ship])',
        '  B -->|no| D[Fix]',
        '  D --> B',
      ].join(String.fromCharCode(10))
    ).graph!;
    const { nodes: placed } = layoutGraph(retry, { originX: 0, originY: 0 });
    const y = new Map(placed.map((p) => [p.key, p.y]));
    expect(y.get('B')!).toBeGreaterThan(y.get('A')!);
    expect(y.get('B')!).toBeLessThan(y.get('C')!);
    expect(y.get('B')!).toBeLessThan(y.get('D')!);
  });

  it('terminates on a cycle rather than ranking forever', () => {
    const loop = parseMermaid('flowchart TD\n A --> B\n B --> C\n C --> A').graph!;
    expect(() => layoutGraph(loop, { originX: 0, originY: 0 })).not.toThrow();
    expect(layoutGraph(loop, { originX: 0, originY: 0 }).nodes).toHaveLength(3);
  });

  it('runs across the screen for LR and down it for TD', () => {
    const lr = parseMermaid('graph LR\n A --> B').graph!;
    const td = parseMermaid('graph TD\n A --> B').graph!;
    const { nodes: [a1, b1] } = layoutGraph(lr, { originX: 0, originY: 0 });
    const { nodes: [a2, b2] } = layoutGraph(td, { originX: 0, originY: 0 });
    expect(b1.x).toBeGreaterThan(a1.x);
    expect(b1.y).toBe(a1.y);
    expect(b2.y).toBeGreaterThan(a2.y);
  });

  it('reverses BT against TD rather than keeping a second ordering', () => {
    const bt = parseMermaid('graph BT\n A --> B').graph!;
    const { nodes: placed } = layoutGraph(bt, { originX: 0, originY: 0 });
    const y = new Map(placed.map((p) => [p.key, p.y]));
    expect(y.get('B')!).toBeLessThan(y.get('A')!);
  });
});

describe('reading a board back out as code', () => {
  const shape = (id: string, x: number, y: number, text: string, geometry: object): AnyNode =>
    ({
      id, type: 'shape', x, y, width: 120, height: 60, geometry, text,
      appearance: {},
    } as unknown as AnyNode);

  it('emits boxes in flow order, not in document order', () => {
    // Declared bottom-first on purpose: the source must still read top-down.
    const source = diagramToMermaid([
      shape('n2', 0, 300, 'Second', { kind: 'rect' }),
      shape('n1', 0, 0, 'First', { kind: 'rect' }),
    ]);
    expect(source.indexOf('First')).toBeLessThan(source.indexOf('Second'));
  });

  it('maps canvas primitives back to the mermaid shape that produced them', () => {
    const source = diagramToMermaid([
      shape('a', 0, 0, 'Rhombus', { kind: 'polygon', points: 4 }),
      shape('b', 0, 100, 'Circle', { kind: 'ellipse' }),
      shape('c', 0, 200, 'Hex', { kind: 'polygon', points: 6 }),
    ]);
    expect(source).toMatch(/\{Rhombus\}/);
    expect(source).toMatch(/\(\(Circle\)\)/);
    expect(source).toMatch(/\{\{Hex\}\}/);
  });

  it('drops a connector whose other end is outside the selection', () => {
    const connector = {
      id: 'c', type: 'connector', x: 0, y: 0, width: 1, height: 1,
      from: { nodeId: 'a', port: 'auto' }, to: { nodeId: 'missing', port: 'auto' },
      routing: 'orthogonal', appearance: {},
    } as unknown as AnyNode;
    const source = diagramToMermaid([shape('a', 0, 0, 'Only', { kind: 'rect' }), connector]);
    expect(source).not.toMatch(/missing/);
    expect(source).toMatch(/Only/);
  });

  it('produces source that parses back into the same picture', () => {
    const nodes: AnyNode[] = [
      shape('a', 0, 0, 'Start', { kind: 'rect' }),
      shape('b', 0, 150, 'Decide', { kind: 'polygon', points: 4 }),
      {
        id: 'c', type: 'connector', x: 0, y: 0, width: 1, height: 1,
        from: { nodeId: 'a', port: 'auto' }, to: { nodeId: 'b', port: 'auto' },
        routing: 'orthogonal', label: 'go', appearance: {},
      } as unknown as AnyNode,
    ];
    const parsed = parseMermaid(diagramToMermaid(nodes)).graph!;
    expect(parsed.nodes.map((n) => n.label)).toEqual(['Start', 'Decide']);
    expect(parsed.edges[0]).toMatchObject({ label: 'go', arrow: true });
  });
});

describe('styling', () => {
  it('reads a style directive it used to skip', () => {
    const { graph } = parseMermaid(
      ['flowchart TD', '  A[Start] --> B[End]', '  style A fill:#f9f,stroke:#333,stroke-width:4px'].join(
        String.fromCharCode(10)
      )
    );
    expect(graph?.nodes.find((n) => n.key === 'A')?.style).toEqual({
      fill: '#f9f',
      stroke: '#333',
      strokeWidth: 4,
    });
    // An unstyled node stays unstyled rather than picking up a default.
    expect(graph?.nodes.find((n) => n.key === 'B')?.style).toBeUndefined();
  });

  it('applies a classDef to every node assigned to it', () => {
    const { graph } = parseMermaid(
      [
        'flowchart TD',
        '  A --> B',
        '  A --> C',
        '  classDef warn fill:#fee,stroke:#b00',
        '  class A,B warn',
      ].join(String.fromCharCode(10))
    );
    expect(graph?.nodes.find((n) => n.key === 'A')?.style?.fill).toBe('#fee');
    expect(graph?.nodes.find((n) => n.key === 'B')?.style?.fill).toBe('#fee');
    expect(graph?.nodes.find((n) => n.key === 'C')?.style).toBeUndefined();
  });

  it('lets a direct style beat the class the node also belongs to', () => {
    const { graph } = parseMermaid(
      [
        'flowchart TD',
        '  A --> B',
        '  classDef warn fill:#fee',
        '  class A warn',
        '  style A fill:#0f0',
      ].join(String.fromCharCode(10))
    );
    expect(graph?.nodes.find((n) => n.key === 'A')?.style?.fill).toBe('#0f0');
  });

  it('ignores a property it cannot honour rather than refusing the diagram', () => {
    const { graph } = parseMermaid(
      ['flowchart TD', '  A --> B', '  style A fill:#f9f,stroke-dasharray:5 5'].join(
        String.fromCharCode(10)
      )
    );
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.nodes.find((n) => n.key === 'A')?.style?.fill).toBe('#f9f');
  });

  it('styles a node named before it was declared', () => {
    // `style` may come first; mermaid does not require declaration order.
    const { graph } = parseMermaid(
      ['flowchart TD', '  style A fill:#abc', '  A[Later] --> B'].join(String.fromCharCode(10))
    );
    expect(graph?.nodes.find((n) => n.key === 'A')?.style?.fill).toBe('#abc');
  });

  it('supports inline class syntax (A:::className)', () => {
    const { graph } = parseMermaid(
      [
        'flowchart TD',
        '  classDef highlight fill:#ff0,stroke:#000',
        '  A[Start]:::highlight --> B[End]',
      ].join('\n')
    );
    expect(graph?.nodes.find((n) => n.key === 'A')?.style?.fill).toBe('#ff0');
  });
});

describe('subgraphs and advanced syntax', () => {
  it('parses subgraphs and associates child nodes with their cluster', () => {
    const source = `flowchart TD
      subgraph client ["Client Side"]
        A[Browser] --> B[Mobile]
      end
      subgraph server ["Server Side"]
        C[API] --> D[(DB)]
      end
      A --> C`;

    const { graph } = parseMermaid(source);
    expect(graph?.subgraphs).toHaveLength(2);
    expect(graph?.subgraphs?.[0]).toEqual({
      id: 'client',
      title: 'Client Side',
      nodeKeys: ['A', 'B'],
    });
    expect(graph?.subgraphs?.[1]).toEqual({
      id: 'server',
      title: 'Server Side',
      nodeKeys: ['C', 'D'],
    });

    const dbNode = graph?.nodes.find((n) => n.key === 'D');
    expect(dbNode?.shape).toBe('database');
    expect(dbNode?.subgraphId).toBe('server');
  });

  it('handles multi-node fan-in and fan-out (A & B --> C & D)', () => {
    const source = `flowchart LR
      A[Front1] & B[Front2] --> C[Gateway] & D[Auth]`;

    const { graph } = parseMermaid(source);
    expect(graph?.nodes).toHaveLength(4);
    // 2 sources * 2 targets = 4 edges
    expect(graph?.edges).toHaveLength(4);
    expect(graph?.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'A->C',
      'A->D',
      'B->C',
      'B->D',
    ]);
  });

  it('parses bidirectional arrows (<-->)', () => {
    const source = `flowchart TD
      A <--> B
      C <-.-> D
      E <==> F`;

    const { graph } = parseMermaid(source);
    expect(graph?.edges).toHaveLength(3);
    expect(graph?.edges[0]).toMatchObject({ line: 'solid', arrow: true, bidirectional: true });
    expect(graph?.edges[1]).toMatchObject({ line: 'dotted', arrow: true, bidirectional: true });
    expect(graph?.edges[2]).toMatchObject({ line: 'thick', arrow: true, bidirectional: true });
  });

  it('parses extended shapes: database, double circle, parallelogram, trapezoid', () => {
    const source = `flowchart TD
      A[(Database)] --> B(((Double Circle))) --> C[/Parallelogram/] --> D[/Trapezoid\\]`;

    const { graph } = parseMermaid(source);
    expect(graph?.nodes.map((n) => n.shape)).toEqual([
      'database',
      'double_circle',
      'parallelogram',
      'trapezoid',
    ]);
  });

  it('reports exact line number on unrecognized syntax error', () => {
    const source = `flowchart TD
      A[Start] --> B[Mid]
      ??? INVALID SYNTAX ???
      B --> C[End]`;

    const res = parseMermaid(source);
    expect(res.graph).toBeNull();
    expect(res.errorLine).toBe(3);
    expect(res.error).toContain('Line 3');
  });

  it('formats and prettifies Mermaid flowchart source code', () => {
    const unformatted = `flowchart TD
A[Start]-->B[End]
B-->|yes|C([Done])`;

    const formatted = formatMermaid(unformatted);
    expect(formatted).toContain('flowchart TD');
    expect(formatted).toContain('    A[Start]');
    expect(formatted).toContain('    A --> B');
    expect(formatted).toContain('    B -->|yes| C');
  });
});

describe('themes and sketch styling in buildDiagram', () => {
  it('applies selected theme colors to shapes, clusters and connectors', () => {
    const { graph } = parseMermaid(`flowchart TD
      subgraph cloud ["Cloud"]
        A[API] --> B[(DB)]
      end`);
    expect(graph).not.toBeNull();

    const built = buildDiagram(graph!, { x: 0, y: 0 }, undefined, {
      theme: 'emerald',
      renderStyle: 'crisp',
    });

    const shapeA: any = built.nodes.find((n: any) => n.diagramKey === 'A');
    expect(shapeA).toBeDefined();
    expect(shapeA?.appearance?.stroke?.color).toBe('#059669');

    const frame: any = built.nodes.find((n: any) => n.type === 'frame');
    expect(frame).toBeDefined();
    expect(frame?.appearance?.stroke?.color).toBe('#6EE7B7');

    const connector: any = built.nodes.find((n: any) => n.type === 'connector');
    expect(connector).toBeDefined();
    expect(connector?.appearance?.stroke?.color).toBe('#047857');
  });

  it('sets sketch appearance when renderStyle is sketch', () => {
    const { graph } = parseMermaid(`flowchart TD\n A[Start] --> B[End]`);
    const built = buildDiagram(graph!, { x: 0, y: 0 }, undefined, {
      theme: 'pastel',
      renderStyle: 'sketch',
    });

    const shapeA: any = built.nodes.find((n: any) => n.diagramKey === 'A');
    expect(shapeA?.appearance?.sketch).toBe('light');
    expect(shapeA?.typography?.fontFamily).toBe('Caveat');
  });

  it('preserves custom node styling when exporting diagramToMermaid', () => {
    const fakeNodes: AnyNode[] = [
      {
        id: 'node-1',
        type: 'shape',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        geometry: { kind: 'rect' },
        text: 'Custom Box',
        appearance: {
          fill: [{ type: 'solid', color: '#FEF3C7' }],
          stroke: { color: '#D97706', width: 2 },
        },
        typography: { fontSize: 14, align: 'center', color: '#B45309' },
      } as any,
    ];

    const source = diagramToMermaid(fakeNodes);
    expect(source).toContain('style A fill:#FEF3C7,stroke:#D97706,color:#B45309');
  });

  it('parses and builds complex architecture with subgraphs and cross-subgraph edges without crashing', () => {
    const code = `flowchart TB
  subgraph Client["Browser Client (React 19 + Konva + Matter.js)"]
    Canvas["Canvas Engine (rAF Loop Outside React)"]
    Spatial["Spatial Index (RBush R-Tree)"]
    Scene["Scene Graph (AABB Transforms)"]
    Doc["Yjs Doc (CRDT)"]
    IDB["IndexedDB Cache (y-indexeddb)"]
    Zustand["Zustand Store (useStore)"]
  end

  Client -- "WebSocket (Yjs Binary Frames)" --> Server
  Client -- "REST (Multipart / Streaming)" --> MediaProxy

  subgraph Backend["Sync & API Server (Node / Express / Hocuspocus v4)"]
    Hocuspocus["Hocuspocus Server Engine"]
    History["History Buffer (Batching & Backpressure)"]
    MediaProxy["Hardened Media Proxy (S3 Streamer)"]
    Reaper["Retention & Reaper Engine"]
  end

  subgraph Infra["Infrastructure Layer"]
    Postgres[("PostgreSQL\\n(Snapshots & Delta Log)")]
    Redis[("Redis Cluster / PubSub\\n(Cross-node Fanout & Distributed Quotas)")]
    MinIO[("MinIO / Cloudflare R2\\n(Private S3 Storage)")]
  end

  Hocuspocus -- "Snapshots & Deltas" --> Postgres
  Hocuspocus -- "Multi-node Sync" --> Redis
  History -- "Flushed Delta Batches" --> Postgres
  MediaProxy -- "Private Bucket Ops" --> MinIO`;

    const { graph, error } = parseMermaid(code);
    expect(error).toBeNull();
    expect(graph).not.toBeNull();

    const built = buildDiagram(graph!, { x: 100, y: 100 });
    expect(built.nodes.length).toBeGreaterThan(10);
  });
});

describe('parseMermaidLenient', () => {
  /**
   * A live preview spends most of its life looking at a half-typed document.
   * Blanking it on every incomplete line is a flicker in exactly the moment
   * the reader is trying to see the effect of what they typed.
   */
  it('is identical to the strict parse when the source is clean', () => {
    const src = 'flowchart TD\n  A[Start] --> B[End]';
    const lenient = parseMermaidLenient(src);

    expect(lenient.graph).toEqual(parseMermaid(src).graph);
    expect(lenient.skippedLines).toEqual([]);
    expect(lenient.error).toBeNull();
  });

  it('draws the lines that parse and skips the one that does not', () => {
    const src = 'flowchart TD\n  A[Start] --> B[Middle]\n  --> nowhere\n  B --> C[End]';

    expect(parseMermaid(src).graph).toBeNull();

    const lenient = parseMermaidLenient(src);
    expect(lenient.graph).not.toBeNull();
    expect(lenient.skippedLines).toEqual([3]);
    expect(lenient.graph!.nodes.map((n) => n.key).sort()).toEqual(['A', 'B', 'C']);
  });

  it('keeps reporting the error it recovered from', () => {
    // Recovery, not suppression: the diagnostic stays exactly as loud.
    const lenient = parseMermaidLenient('flowchart TD\n  A --> B\n  --> nowhere\n');

    expect(lenient.strictError).not.toBeNull();
    expect(lenient.error).toBe(lenient.strictError);
    expect(lenient.strictErrorLine).toBe(3);
  });

  it('numbers skipped lines against the original document', () => {
    // Blanked rather than removed: `errorLine` is what the gutter marks, and
    // renumbering underneath it would point the marker at the wrong row.
    const src = 'flowchart TD\n  A --> B\n  --> x\n  B --> C\n  (((\n  C --> D';
    const lenient = parseMermaidLenient(src);

    expect(lenient.skippedLines).toEqual([3, 5]);
    expect(lenient.graph!.nodes.map((n) => n.key).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('gives up rather than looping when nothing can be salvaged', () => {
    const lenient = parseMermaidLenient('not a diagram at all');

    expect(lenient.graph).toBeNull();
    expect(lenient.skippedLines.length).toBeLessThanOrEqual(12);
  });

  it('respects the skip budget', () => {
    const src = ['flowchart TD', '  A --> B', ...Array(30).fill('  --> x')].join('\n');
    const lenient = parseMermaidLenient(src, 3);

    expect(lenient.skippedLines.length).toBeLessThanOrEqual(3);
  });
});

describe('subgraph membership is recorded once', () => {
  /**
   * Membership is written to two places -- `subgraph.nodeKeys` and the node's
   * own `subgraphId` -- and they used to be able to disagree, because the push
   * to `nodeKeys` was unconditional while `subgraphId` only survived on the
   * branches that replaced the stored node.
   *
   * Both are read, by different code. `layout.ts` parents to dagre by
   * `subgraphId`, so a node missing the stamp was laid out *outside* the
   * cluster. `build.ts` assigned `frameId`, and `ObjectRenderer` clips a framed
   * node to its frame's rectangle. The node was placed outside a box and then
   * cut to fit it: the clipped, broken diagram.
   */
  const agree = (src: string) => {
    const { graph } = parseMermaid(src);
    expect(graph, src).not.toBeNull();
    for (const sub of graph!.subgraphs ?? []) {
      const byId = graph!.nodes.filter((n) => n.subgraphId === sub.id).map((n) => n.key);
      expect([...sub.nodeKeys].sort(), `subgraph ${sub.id}`).toEqual([...byId].sort());
    }
    return graph!;
  };

  it('stamps a node first mentioned before the block it belongs to', () => {
    const graph = agree(
      'flowchart TD\n  B -->|yes| C[Process]\n  subgraph S1 [Pipeline]\n    C --> E[Transform]\n  end'
    );

    expect(graph.nodes.find((n) => n.key === 'C')!.subgraphId).toBe('S1');
    expect(graph.nodes.find((n) => n.key === 'B')!.subgraphId).toBeUndefined();
  });

  it('does not remove a node from its block when it is mentioned again outside', () => {
    const graph = agree(
      'flowchart TD\n  subgraph S1 [Pipeline]\n    C[Process] --> E[Transform]\n  end\n  C --> Z[After]'
    );

    expect(graph.nodes.find((n) => n.key === 'C')!.subgraphId).toBe('S1');
    expect(graph.nodes.find((n) => n.key === 'Z')!.subgraphId).toBeUndefined();
  });

  it('keeps the two records in step across the shapes people actually write', () => {
    agree('flowchart TD\n  subgraph A [One]\n    X --> Y\n  end\n  subgraph B [Two]\n    P --> Q\n  end\n  Y --> P');
    agree('flowchart LR\n  S[Start]\n  subgraph G [Group]\n    S --> M[Middle]\n  end\n  M --> S');
    agree('flowchart TD\n  subgraph N [Outer]\n    a --> b\n    subgraph M [Inner]\n      c --> d\n    end\n  end');
  });

  it('gives a re-declared node its label without losing its block', () => {
    // The branch that used to drop the stamp: an existing node being upgraded
    // from bare key to a real label.
    const graph = agree(
      'flowchart TD\n  A --> C\n  subgraph S1 [Pipeline]\n    C[Process it] --> E\n  end'
    );

    const c = graph.nodes.find((n) => n.key === 'C')!;
    expect(c.label).toBe('Process it');
    expect(c.subgraphId).toBe('S1');
  });
});

describe('advanced mermaid syntax & developer ergonomics', () => {
  it('parses kebab-case node IDs and subgraph IDs seamlessly', () => {
    const src = `flowchart TD
      subgraph cloud-infra ["Cloud Infrastructure"]
        auth-service[Authentication] --> api-gw[API Gateway]
      end
      api-gw --> db-replica[(Database Replica)]`;
    const { graph, error } = parseMermaid(src);
    expect(error).toBeNull();
    expect(graph?.nodes.map((n) => n.key)).toEqual(['auth-service', 'api-gw', 'db-replica']);
    expect(graph?.nodes.find((n) => n.key === 'auth-service')?.subgraphId).toBe('cloud-infra');
    expect(graph?.edges).toHaveLength(2);
    expect(graph?.edges[0]).toEqual({ from: 'auth-service', to: 'api-gw', line: 'solid', arrow: true });
  });

  it('parses quoted node identifiers', () => {
    const src = `flowchart LR
      "Client Web"[Browser App] --> "API Gateway"
      "API Gateway" --> "PostgreSQL Database"[(Main DB)]`;
    const { graph, error } = parseMermaid(src);
    expect(error).toBeNull();
    expect(graph?.nodes.map((n) => n.key)).toEqual(['Client Web', 'API Gateway', 'PostgreSQL Database']);
    expect(graph?.nodes[0].label).toBe('Browser App');
    expect(graph?.nodes[1].label).toBe('API Gateway');
    expect(graph?.nodes[2].label).toBe('Main DB');
  });

  it('handles statement-separating and trailing semicolons cleanly', () => {
    const src = `flowchart TD; A[Start] --> B[Process]; B --> C[End];`;
    const { graph, error } = parseMermaid(src);
    expect(error).toBeNull();
    expect(graph?.nodes).toHaveLength(3);
    expect(graph?.edges).toHaveLength(2);
  });

  it('cleans trailing semicolons from style directives', () => {
    const src = `flowchart TD
      node-1[Node One] --> node-2[Node Two]
      style node-1 fill:#ff9900,stroke:#333333;
      classDef highlighted fill:#00ffff,stroke:#0000ff;
      class node-2 highlighted`;
    const { graph, error } = parseMermaid(src);
    expect(error).toBeNull();
    const node1 = graph?.nodes.find((n) => n.key === 'node-1');
    expect(node1?.style?.fill).toBe('#ff9900');
    expect(node1?.style?.stroke).toBe('#333333');
    const node2 = graph?.nodes.find((n) => n.key === 'node-2');
    expect(node2?.style?.fill).toBe('#00ffff');
    expect(node2?.style?.stroke).toBe('#0000ff');
  });

  it('handles multi-line labels inside quotes and brackets', () => {
    const src = `flowchart TB
  DocTier["Document Tier (Yjs CRDT)
Persisted, Synced, Undoable
(objectsMap, groupsMap)"] --> HocuspocusSrv["Hocuspocus CRDT Server"]`;
    const res = parseMermaid(src);
    expect(res.error).toBeNull();
    expect(res.graph?.nodes).toHaveLength(2);
    expect(res.graph?.nodes[0].label).toContain('Document Tier');
    expect(res.graph?.nodes[0].label).toContain('Persisted, Synced, Undoable');
    expect(res.graph?.edges).toHaveLength(1);
    expect(res.graph?.edges[0]).toEqual({ from: 'DocTier', to: 'HocuspocusSrv', line: 'solid', arrow: true });
  });

  it('handles user full exact diagram with nested subgraphs and cross-cluster edges', () => {
    const src = `flowchart TB
  subgraph Client ["Browser Client (React 19 + Vite)"]
    direction TB
    subgraph StateTiers ["Three Tiers of State"]
      DocTier["Document Tier (Yjs CRDT)\\nPersisted, Synced, Undoable\\n(objectsMap, groupsMap)"]
      AwarenessTier["Awareness Tier (Yjs Awareness)\\nEphemeral Multi-Client\\n(Cursors, Selections, In-Flight Throws)"]
      TransientTier["Transient Tier (Module Stores / uSES)\\nSingle-Client In-Memory 60fps\\n(liveTransformStore, cropMode, railVeil)"]
    end
    
    subgraph GraphicsEngine ["Canvas & Rendering Pipeline"]
      CamSys["CameraSystem (rAF, Outside React)"]
      SpatIdx["SpatialIndex (RBush R-Tree)"]
      KonvaStage["React-Konva Stage 2D Scene Graph"]
      MatterSim["Matter.js Physics (Client-Authoritative)"]
    end
  end

  subgraph ServerSync ["Backend Sync & Persistence (Node.js / Express / Hocuspocus)"]
    HocuspocusSrv["Hocuspocus CRDT Server"]
    NetGuardSSRF["NetGuard & SafeFetch (SSRF Blocker)"]
    ShareHMAC["ShareToken & Session Mint (HMAC-SHA256)"]
    QuotaMgr["Quota & IP Rate Limiter"]
    ReaperJob["Room Reaper Automation"]
  end

  subgraph Infra ["Storage & Infrastructure"]
    PostgresDB[("PostgreSQL\\nCompacted Snapshots & replay_base")]
    RedisBus[("Redis\\nPub/Sub Fanout & Shared Quotas")]
    MinIOStore[("MinIO / S3\\nOut-of-band Media")]
  end

  Client -- "WebSocket (Yjs Sync Protocol)" --> HocuspocusSrv
  Client -- "HTTP Uploads / Unfurl / Auth" --> ServerSync
  HocuspocusSrv --> PostgresDB
  HocuspocusSrv -.-> RedisBus
  ServerSync --> MinIOStore`;

    const parsed = parseMermaid(src);
    expect(parsed.error).toBeNull();
    const graph = parsed.graph!;

    // Verify subgraphs and compound nesting
    const clientSub = graph.subgraphs?.find((s) => s.id === 'Client');
    const stateTiersSub = graph.subgraphs?.find((s) => s.id === 'StateTiers');
    const graphicsSub = graph.subgraphs?.find((s) => s.id === 'GraphicsEngine');
    expect(clientSub).toBeDefined();
    expect(stateTiersSub?.parentSubgraphId).toBe('Client');
    expect(graphicsSub?.parentSubgraphId).toBe('Client');

    // Subgraphs should not be placed into graph.nodes
    expect(graph.nodes.some((n) => n.key === 'Client')).toBe(false);
    expect(graph.nodes.some((n) => n.key === 'ServerSync')).toBe(false);
    expect(graph.edges).toHaveLength(5);

    // Verify layout routing
    const layout = layoutGraph(graph, { originX: 0, originY: 0 });
    expect(layout.clusters).toHaveLength(5);
    expect(layout.edges).toHaveLength(5);

    const clientCluster = layout.clusters.find((c) => c.key === 'Client')!;
    const stateCluster = layout.clusters.find((c) => c.key === 'StateTiers')!;
    const graphicsCluster = layout.clusters.find((c) => c.key === 'GraphicsEngine')!;
    expect(clientCluster).toBeDefined();

    // Client frame bounds must enclose child clusters
    expect(clientCluster.x).toBeLessThanOrEqual(stateCluster.x);
    expect(clientCluster.x + clientCluster.width).toBeGreaterThanOrEqual(graphicsCluster.x + graphicsCluster.width);

    // Verify canvas buildDiagram
    const result = buildDiagram(graph, { x: 100, y: 100 }, undefined, { theme: 'indigo' });
    const connectors = result.nodes.filter((o) => o.type === 'connector');
    expect(connectors).toHaveLength(5);

    // Connectors originating from or targeting subgraphs must connect to frame IDs
    const clientToHocus = connectors.find((c: any) => c.label === 'WebSocket (Yjs Sync Protocol)');
    expect(clientToHocus).toBeDefined();
    expect((clientToHocus as any).from.nodeId).toBe(`${result.diagramId}-sub-Client`);
    expect((clientToHocus as any).to.nodeId).toBe(`${result.diagramId}-HocuspocusSrv`);

    const clientToServer = connectors.find((c: any) => c.label === 'HTTP Uploads / Unfurl / Auth');
    expect(clientToServer).toBeDefined();
    expect((clientToServer as any).from.nodeId).toBe(`${result.diagramId}-sub-Client`);
    expect((clientToServer as any).to.nodeId).toBe(`${result.diagramId}-sub-ServerSync`);

    // Verify all connectors have valid points on canvas
    const objectsMap: Record<string, any> = {};
    for (const obj of result.nodes) {
      objectsMap[obj.id] = obj;
    }
    const boxLookup = (id: string) => {
      const n = objectsMap[id];
      return n ? { x: n.x, y: n.y, width: n.width, height: n.height } : null;
    };
    for (const conn of connectors) {
      const pts = connectorPoints((conn as any).from, (conn as any).to, (conn as any).routing, boxLookup, null);
      expect(pts.length).toBeGreaterThanOrEqual(4);
    }
  });
});
