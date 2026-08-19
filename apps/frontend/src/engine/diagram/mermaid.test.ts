import { describe, it, expect } from 'vitest';
import { emitMermaid, parseMermaid } from './mermaid';
import { layoutGraph } from './layout';
import { diagramToMermaid } from './build';
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
    const placed = layoutGraph(chain, { originX: 0, originY: 0 });
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
    const y = new Map(layoutGraph(retry, { originX: 0, originY: 0 }).map((p) => [p.key, p.y]));
    expect(y.get('B')!).toBeGreaterThan(y.get('A')!);
    expect(y.get('B')!).toBeLessThan(y.get('C')!);
    expect(y.get('B')!).toBeLessThan(y.get('D')!);
  });

  it('terminates on a cycle rather than ranking forever', () => {
    const loop = parseMermaid('flowchart TD\n A --> B\n B --> C\n C --> A').graph!;
    expect(() => layoutGraph(loop, { originX: 0, originY: 0 })).not.toThrow();
    expect(layoutGraph(loop, { originX: 0, originY: 0 })).toHaveLength(3);
  });

  it('runs across the screen for LR and down it for TD', () => {
    const lr = parseMermaid('graph LR\n A --> B').graph!;
    const td = parseMermaid('graph TD\n A --> B').graph!;
    const [a1, b1] = layoutGraph(lr, { originX: 0, originY: 0 });
    const [a2, b2] = layoutGraph(td, { originX: 0, originY: 0 });
    expect(b1.x).toBeGreaterThan(a1.x);
    expect(b1.y).toBe(a1.y);
    expect(b2.y).toBeGreaterThan(a2.y);
  });

  it('reverses BT against TD rather than keeping a second ordering', () => {
    const bt = parseMermaid('graph BT\n A --> B').graph!;
    const placed = layoutGraph(bt, { originX: 0, originY: 0 });
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
});
