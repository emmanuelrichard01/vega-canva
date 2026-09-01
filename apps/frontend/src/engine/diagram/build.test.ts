import { describe, it, expect } from 'vitest';
import { parseMermaid } from './mermaid';
import { buildDiagram, diagramNodeSizes, diagramTypography } from './build';
import type { AnyNode } from '../model/schema';

function build(src: string) {
  const { graph, error } = parseMermaid(src);
  if (!graph) throw new Error(`parse failed: ${error}`);
  const { nodes } = buildDiagram(graph, { x: 0, y: 0 });
  const list = nodes as unknown as AnyNode[];
  return {
    shapes: list.filter((n) => n.type === 'shape') as never[],
    connectors: list.filter((n) => n.type === 'connector') as never[],
  };
}

describe('buildDiagram: label boxes', () => {
  it('grows the box to fit the lines the width cap creates', () => {
    /**
     * The defect: width was capped at 320 and height counted explicit
     * newlines only, so a long label wrapped to three lines inside a box
     * sized for one and ran outside its shape. The cap made the wrapping and
     * the height never heard about it.
     */
    const { shapes } = build(
      'flowchart TD\n  A[Reject the payload with a long explanatory message that a real person would write] --> B[Ok]'
    );

    const long = shapes.find((s: never) => (s as { text: string }).text.length > 60)!;
    const box = long as unknown as { width: number; height: number };

    expect(Math.round(box.width)).toBeLessThanOrEqual(320);
    // One line at 14px is ~56 tall. Three needs meaningfully more.
    expect(box.height).toBeGreaterThan(70);
  });

  it('keeps a short label in a compact box', () => {
    const { shapes } = build('flowchart TD\n  A[Ok] --> B[No]');
    for (const s of shapes) {
      const box = s as unknown as { width: number; height: number };
      expect(box.width).toBeLessThanOrEqual(120);
      expect(box.height).toBe(56);
    }
  });

  it('grows monotonically with the label', () => {
    const area = (src: string) => {
      const { shapes } = build(src);
      const s = shapes[0] as unknown as { width: number; height: number };
      return s.width * s.height;
    };

    expect(area('flowchart TD\n  A[Hi] --> Z[x]')).toBeLessThan(
      area('flowchart TD\n  A[A somewhat longer label] --> Z[x]')
    );
  });

  it('squares off a diamond so it reads as the symbol mermaid asked for', () => {
    const { shapes } = build('flowchart TD\n  A{Is it valid?} --> B[Ok]');
    const diamond = shapes.find(
      (s: never) => (s as { geometry?: { kind: string } }).geometry?.kind === 'diamond'
    ) as unknown as { width: number; height: number } | undefined;

    if (diamond) expect(diamond.width).toBe(diamond.height);
  });
});

describe('buildDiagram: connector attachment', () => {
  it('carries dagre\'s routing as an anchor rather than port auto', () => {
    const { connectors } = build('flowchart TD\n  A --> B');
    const end = connectors[0] as unknown as {
      from: { anchor?: { u: number; v: number }; port?: string };
    };

    expect(end.from.anchor).toBeDefined();
    expect(end.from.port).toBeUndefined();
  });

  it('splits a fan-out across the face instead of stacking it', () => {
    const { connectors } = build('flowchart TD\n  B --> C\n  B --> D\n  B --> E');
    const us = connectors.map(
      (c: never) => (c as { from: { anchor?: { u: number } } }).from.anchor!.u
    );

    expect(new Set(us).size).toBe(3);
  });

  it('stores no coordinates, so the binding survives the node moving', () => {
    /**
     * The invariant `connector.ts` opens with. An anchor is normalised to the
     * node's own box; a polyline would be stale on the first drag.
     */
    const { connectors } = build('flowchart TD\n  A --> B');
    const c = connectors[0] as unknown as {
      from: { anchor?: { u: number; v: number } };
      to: { anchor?: { u: number; v: number } };
    };

    for (const end of [c.from, c.to]) {
      expect(Object.keys(end.anchor!).sort()).toEqual(['u', 'v']);
      expect(end.anchor!.u).toBeGreaterThanOrEqual(0);
      expect(end.anchor!.u).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to auto for an edge pointing at a cluster', () => {
    // Dagre never gives a cluster box an anchor, and the connector is drawn to
    // the frame rather than to a member.
    const { connectors } = build(
      'flowchart TD\n  subgraph S [Group]\n    A --> B\n  end\n  C --> S'
    );

    const toCluster = connectors.find(
      (c: never) => (c as { to: { nodeId: string } }).to.nodeId.includes('-sub-')
    ) as unknown as { to: { port?: string; anchor?: unknown } } | undefined;

    if (toCluster) {
      expect(toCluster.to.port).toBe('auto');
      expect(toCluster.to.anchor).toBeUndefined();
    }
  });
});

describe('diagramNodeSizes: one answer, shared by preview and board', () => {
  it('is what buildDiagram actually uses', () => {
    /**
     * The drift guard. `MermaidModal` used to size its preview nodes with its
     * own copy of the old character-count estimate and a hard-coded height of
     * 56, under a comment promising "the exact geometry the board will use" --
     * so a long label previewed 320x56 and built 320x93.
     *
     * The fix was to delete the second copy, and this is what stops a third
     * appearing: the sizes the preview asks for have to be the sizes the board
     * builds with.
     */
    const src =
      'flowchart TD\n  A[Reject the payload with a long explanatory message] --> B{Ok?}\n  B --> C[No]';
    const { graph } = parseMermaid(src);
    const sizes = diagramNodeSizes(graph!, false);
    const { shapes } = build(src);

    for (const shape of shapes) {
      const s = shape as unknown as { diagramKey: string; width: number; height: number };
      const expected = sizes.get(s.diagramKey)!;
      expect(expected, s.diagramKey).toBeDefined();
      expect(Math.round(s.width), s.diagramKey).toBe(Math.round(expected.width));
      expect(Math.round(s.height), s.diagramKey).toBe(Math.round(expected.height));
    }
  });

  it('measures in the face the mode actually draws in', () => {
    /**
     * Only the typography is asserted, not the resulting width. Sketch mode
     * swaps Inter for Caveat, which is materially narrower -- but the headless
     * measurer falls back to `length * fontSize * 0.55` with no DOM canvas to
     * ask, so both faces measure identically here. Asserting the widths differ
     * would be asserting a browser, in node.
     */
    expect(diagramTypography(false).fontFamily).not.toBe(diagramTypography(true).fontFamily);
    expect(diagramTypography(true).fontFamily).toBe('Caveat');
  });
});
