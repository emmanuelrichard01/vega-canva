/**
 * A parsed flowchart, as objects on the board — and back again.
 *
 * The two directions live in one file on purpose. They are inverses, and an
 * inverse pair kept apart drifts: the moment the writer learns a shape the
 * reader does not, a diagram stops surviving its own round trip and the failure
 * shows up as silently changed geometry rather than as an error.
 */

import { nanoid } from 'nanoid';
import type { AnyNode, ConnectorNode, ShapeNode } from '../model/schema';
import type { NewNodeInput } from '../document/mutations';
import { DEFAULT_INK, DEFAULT_TYPOGRAPHY } from '../model/schema';
import { layoutGraph } from './layout';
import {
  DIAGRAM_THEMES,
  SHAPE_SPECS,
  emitMermaid,
  keyFor,
  shapeFromCanvas,
  type DiagramThemeId,
  type EdgeLine,
  type FlowDirection,
  type MermaidGraph,
  type NodeStyle,
} from './mermaid';

/**
 * Marks a node as belonging to a generated diagram.
 *
 * On the node rather than held in a side list, because the board is a CRDT: a
 * list kept anywhere else is a second copy of the truth that a collaborator's
 * delete can contradict. Regenerating a diagram has to know exactly which
 * objects were the last generation's, and this is how it asks.
 */
export const DIAGRAM_TAG = 'diagramId';

/**
 * Which generated diagram a node belongs to, if any.
 *
 * The tag is not on the schema — it is a per-feature marker, and adding a field
 * to `BaseNode` that only one feature reads is exactly the kind of declaration
 * this codebase treats as dead weight. So the cast lives here, once, behind a
 * typed answer, rather than at every call site where forgetting it is a
 * compile error and remembering it wrong is not.
 */
export function diagramIdOf(node: AnyNode): string | undefined {
  const tagged = (node as unknown as Record<string, unknown>)[DIAGRAM_TAG];
  return typeof tagged === 'string' && tagged ? tagged : undefined;
}

/** Roughly how wide a label needs its box to be, before anything is measured. */
function estimateSize(label: string, square: boolean): { width: number; height: number } {
  const longest = label.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  const lines = label.split('\n').length;
  const width = Math.max(96, Math.min(320, longest * 8.4 + 36));
  const height = Math.max(56, lines * 22 + 34);
  // A diamond or a circle with a 3:1 box reads as a lozenge, not as the symbol
  // mermaid asked for, so those are squared off to their larger side.
  return square ? { width: Math.max(width, height), height: Math.max(width, height) } : { width, height };
}

const LINE_DASH: Record<EdgeLine, number[] | undefined> = {
  solid: undefined,
  dotted: [1, 6],
  thick: undefined,
};

export interface DiagramBuildOptions {
  theme?: DiagramThemeId;
  renderStyle?: 'crisp' | 'sketch';
}

export interface BuiltDiagram {
  nodes: NewNodeInput[];
  /** The id stamped on every node, so a regenerate can find them again. */
  diagramId: string;
}

/**
 * Build the canvas objects for a graph.
 *
 * Shapes first, then connectors — order matters because a connector stores the
 * *ids* of what it joins and computes its route from wherever those objects
 * are. It never stores a coordinate, which is exactly what lets the diagram
 * survive being rearranged by hand afterwards: drag a box and its arrows
 * follow, because they were never told where the box was.
 */
export function buildDiagram(
  graph: MermaidGraph,
  origin: { x: number; y: number },
  existingId?: string,
  options?: DiagramBuildOptions
): BuiltDiagram {
  const diagramId = existingId ?? nanoid(8);
  const theme = DIAGRAM_THEMES[options?.theme ?? 'indigo'] || DIAGRAM_THEMES.indigo;
  const isSketch = options?.renderStyle === 'sketch';

  const sizes = new Map<string, { width: number; height: number }>();
  for (const node of graph.nodes) {
    sizes.set(node.key, estimateSize(node.label, Boolean(SHAPE_SPECS[node.shape].square)));
  }

  const { nodes: placedNodes, clusters } = layoutGraph(graph, {
    originX: origin.x,
    originY: origin.y,
    sizeOf: (key) => sizes.get(key),
  });
  const at = new Map(placedNodes.map((p) => [p.key, p]));
  const clusterAt = new Map(clusters.map((c) => [c.key, c]));

  /** Mermaid keys are only unique within the diagram, so ids are namespaced. */
  const idFor = (key: string) => `${diagramId}-${key}`;

  const nodes: NewNodeInput[] = [];

  graph.nodes.forEach((node, nodeIdx) => {
    const spot = at.get(node.key);
    if (!spot) return;
    const spec = SHAPE_SPECS[node.shape] || { kind: 'rect' };

    const defaultFill = theme.accentFills[nodeIdx % theme.accentFills.length] || theme.primaryFill;
    const fillColor = node.style?.fill ?? defaultFill;
    const strokeColor = node.style?.stroke ?? theme.primaryStroke;
    const strokeWidth = node.style?.strokeWidth ?? (isSketch ? 2 : 1.75);
    const textColor = node.style?.color ?? theme.textColor;

    nodes.push({
      id: idFor(node.key),
      type: 'shape',
      x: spot.x,
      y: spot.y,
      width: spot.width,
      height: spot.height,
      [DIAGRAM_TAG]: diagramId,
      /** The mermaid key, so the reader can emit the same source it was given. */
      diagramKey: node.key,
      geometry: {
        kind: spec.kind,
        ...(spec.points !== undefined ? { points: spec.points } : {}),
      },
      appearance: {
        fill: [{ type: 'solid', color: fillColor }],
        stroke: { color: strokeColor, width: strokeWidth },
        ...(isSketch ? { sketch: 'light' } : {}),
        ...(spec.cornerRadius !== undefined
          ? // Clamped by the renderer to half the shorter side, so a stadium's
            // deliberately absurd radius resolves to exactly semicircular ends.
            { cornerRadius: spec.cornerRadius }
          : {}),
      },
      text: node.label,
      typography: {
        ...DEFAULT_TYPOGRAPHY,
        fontSize: 14,
        fontFamily: isSketch ? 'Caveat' : DEFAULT_TYPOGRAPHY.fontFamily,
        align: 'center',
        verticalAlign: 'middle',
        color: textColor,
      },
    });
  });

  // Generate FrameNodes for Subgraphs / Clusters
  if (graph.subgraphs && graph.subgraphs.length > 0) {
    for (const sub of graph.subgraphs) {
      const clusterBox = clusterAt.get(sub.id);
      if (!clusterBox) continue;

      const frameId = `${diagramId}-sub-${sub.id}`;
      nodes.unshift({
        id: frameId,
        type: 'frame',
        x: clusterBox.x,
        y: clusterBox.y,
        width: Math.max(120, clusterBox.width),
        height: Math.max(80, clusterBox.height),
        title: sub.title,
        [DIAGRAM_TAG]: diagramId,
        appearance: {
          fill: [{ type: 'solid', color: theme.clusterFill }],
          stroke: { color: theme.clusterStroke, width: 1.5, dash: [5, 4] },
          ...(isSketch ? { sketch: 'light' } : {}),
        },
      });

      // Associate children with frameId
      for (const k of sub.nodeKeys) {
        const childNode = nodes.find((n) => n.id === idFor(k));
        if (childNode) {
          childNode.frameId = frameId;
        }
      }
    }
  }

  const resolveTargetId = (key: string): string | null => {
    if (at.has(key)) return idFor(key);
    if (clusterAt.has(key)) return `${diagramId}-sub-${key}`;
    return null;
  };

  for (const edge of graph.edges) {
    const fromId = resolveTargetId(edge.from);
    const toId = resolveTargetId(edge.to);
    if (!fromId || !toId) continue;
    nodes.push({
      id: `${diagramId}-e-${nanoid(6)}`,
      type: 'connector',
      // Derived from the endpoints on every read; these are a placeholder box
      // the renderer overwrites on its first frame.
      x: origin.x,
      y: origin.y,
      width: 1,
      height: 1,
      [DIAGRAM_TAG]: diagramId,
      from: { nodeId: fromId, port: 'auto' },
      to: { nodeId: toId, port: 'auto' },
      // Right angles, because that is what a flowchart reads as — the same
      // reasoning the routing control's own hint gives.
      routing: 'orthogonal',
      endStart: edge.bidirectional ? 'arrow' : 'none',
      endEnd: edge.arrow ? 'arrow' : 'none',
      ...(edge.label ? { label: edge.label } : {}),
      appearance: {
        stroke: {
          color: theme.connectorColor,
          width: edge.line === 'thick' ? 3 : 2,
          ...(LINE_DASH[edge.line] ? { dash: LINE_DASH[edge.line], cap: 'round' } : {}),
        },
        ...(isSketch ? { sketch: 'light' } : {}),
      },
    });
  }

  return { nodes, diagramId };
}

// ---------------------------------------------------------------------------
// Reading a board back out
// ---------------------------------------------------------------------------

/**
 * Canvas objects to mermaid source.
 *
 * Works on **any** selection of shapes and connectors, not only on something
 * this feature generated. That is deliberate and is most of the value: a
 * flowchart someone drew by hand, box by box, can be turned into code they can
 * paste into a README — and a generated one that has since been edited emits
 * what it actually is now rather than the source it came from.
 *
 * Keys are re-derived rather than trusted. A node carries the key it was built
 * with, but a hand-drawn box has none, a duplicated one carries a copy of
 * somebody else's, and either would produce source where two boxes share an
 * identifier and silently merge on re-import.
 */
export function diagramToMermaid(
  selection: readonly AnyNode[],
  direction: FlowDirection = 'TD'
): string {
  const shapes = selection.filter(
    (n): n is ShapeNode => n.type === 'shape'
  );
  const connectors = selection.filter(
    (n): n is ConnectorNode => n.type === 'connector'
  );

  /**
   * Ordered by position along the flow, so the emitted source reads in the same
   * order as the picture. Emitting in document order would list the boxes in
   * whatever sequence they happened to be created, which for a diagram anyone
   * has edited is no order at all.
   */
  const vertical = direction === 'TD' || direction === 'TB' || direction === 'BT';
  const ordered = [...shapes].sort((a, b) =>
    vertical ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y
  );

  const keyOf = new Map<string, string>();
  ordered.forEach((node, i) => keyOf.set(node.id, keyFor(i)));

  const graph: MermaidGraph = {
    direction,
    nodes: ordered.map((node) => {
      const firstPaint = node.appearance?.fill?.[0];
      const fill = firstPaint && 'color' in firstPaint ? firstPaint.color : undefined;
      const stroke = node.appearance?.stroke?.color;
      const strokeWidth = node.appearance?.stroke?.width;
      const color = node.typography?.color;

      const style: NodeStyle = {};
      if (fill && fill !== '#FFFFFF') style.fill = fill;
      if (stroke && stroke !== DEFAULT_INK) style.stroke = stroke;
      if (strokeWidth && strokeWidth !== 2) style.strokeWidth = strokeWidth;
      if (color && color !== DEFAULT_TYPOGRAPHY.color) style.color = color;

      return {
        key: keyOf.get(node.id)!,
        label: (node.text ?? '').trim() || keyOf.get(node.id)!,
        shape: shapeFromCanvas(
          node.geometry.kind,
          node.geometry.points,
          node.appearance?.cornerRadius
        ),
        ...(Object.keys(style).length > 0 ? { style } : {}),
      };
    }),
    edges: connectors
      .map((c) => {
        const from = c.from.nodeId ? keyOf.get(c.from.nodeId) : undefined;
        const to = c.to.nodeId ? keyOf.get(c.to.nodeId) : undefined;
        if (!from || !to) return null;
        const dash = c.appearance?.stroke?.dash;
        const width = c.appearance?.stroke?.width ?? 2;
        return {
          from,
          to,
          line: (dash?.length ? 'dotted' : width >= 3 ? 'thick' : 'solid') as EdgeLine,
          // `none` at the end is mermaid's plain link; anything else is an arrow.
          arrow: (c.endEnd ?? 'arrow') !== 'none',
          ...(c.label ? { label: c.label } : {}),
        };
      })
      // An arrow whose endpoint is outside the selection cannot be written —
      // there would be no node for it to name.
      .filter((e): e is NonNullable<typeof e> => e !== null),
  };

  return emitMermaid(graph);
}

/** Whether a selection has anything this can turn into code. */
export function canEmitDiagram(selection: readonly AnyNode[]): boolean {
  return selection.some((n) => n.type === 'shape');
}
