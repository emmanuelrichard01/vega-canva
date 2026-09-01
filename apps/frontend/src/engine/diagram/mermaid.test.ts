import { describe, it, expect } from 'vitest';
import { emitMermaid, parseMermaid, formatMermaid } from './mermaid';
import { layoutGraph } from './layout';
import { buildDiagram, diagramToMermaid } from './build';
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
