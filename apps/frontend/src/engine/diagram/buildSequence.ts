/**
 * Canvas objects for a sequence diagram.
 *
 * ## The lifeline is the load-bearing object
 *
 * The obvious build is a head box per participant and a free-floating arrow
 * per message, positioned by the coordinates `layoutSequence` computed. It
 * draws correctly and it is dead: move one participant and its messages stay
 * where they were, because nothing ever told them what they belonged to.
 *
 * So the lifeline is not decoration here, it is the thing messages attach
 * *to*. It is a `line` shape with a **zero-width box** -- a line runs corner to
 * corner, so a box with no width and the column's full depth is exactly a
 * vertical lifeline -- and every message is a connector bound to two of them.
 *
 * That makes the row an `Anchor`. `Anchor` is normalised to the node's own box
 * (`{u, v}` in 0..1), so a message at world y on a lifeline spanning
 * `top..bottom` is stored as `v = (y - top) / (bottom - top)` and nothing
 * remembers a coordinate. Drag a participant and its whole conversation goes
 * with it; stretch a lifeline and the messages redistribute along it, still in
 * order, still level with their opposite ends. The invariant `connector.ts`
 * states -- a connector stores which objects it joins, not where its ends are
 * -- holds, and it is what buys the behaviour rather than costing it.
 *
 * The zero width also disposes of the one awkward case: `u` picks a side of
 * the box, and on a box with no width both sides are the same x. A degenerate
 * coordinate that cannot be wrong is better than a real one that can.
 */

import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import { DIAGRAM_THEMES, type DiagramThemeId } from './mermaid';
import { DIAGRAM_TAG, diagramTypography } from './build';
import {
  layoutSequence,
  SELF_DROP,
  SEQ_TYPE,
  type SequenceDiagram,
  type SeqLayoutOptions,
} from './sequence';
import { sequenceMeasurer } from './sequenceMeasure';

export interface SequenceBuildOptions {
  theme?: DiagramThemeId;
  renderStyle?: 'crisp' | 'sketch';
  layout?: Partial<SeqLayoutOptions>;
}

export interface BuiltSequence {
  nodes: NewNodeInput[];
  diagramId: string;
}

export function buildSequenceDiagram(
  diagram: SequenceDiagram,
  origin: { x: number; y: number },
  existingId?: string,
  options?: SequenceBuildOptions,
): BuiltSequence {
  const diagramId = existingId ?? nanoid(8);
  const theme = DIAGRAM_THEMES[options?.theme ?? 'indigo'] || DIAGRAM_THEMES.indigo;
  const isSketch = options?.renderStyle === 'sketch';
  const typography = diagramTypography(isSketch);

  const layout = layoutSequence(diagram, {
    originX: origin.x,
    originY: origin.y,
    // The face the labels will actually be drawn in. Measuring in the wrong
    // one sizes every box by the ratio between the two.
    measure: sequenceMeasurer(isSketch),
    ...options?.layout,
  });

  const nodes: NewNodeInput[] = [];
  const headId = (key: string) => `${diagramId}-p-${key}`;
  const footId = (key: string) => `${diagramId}-f-${key}`;
  const lifeId = (key: string) => `${diagramId}-l-${key}`;
  const laneOf = new Map(layout.lanes.map((l) => [l.key, l]));

  /**
   * Frames first of all, so they sit under everything they contain.
   *
   * Document order is paint order, and a frame is a background -- drawn later
   * it would cover the messages it is supposed to be framing. Outermost first
   * within that, so a nested `alt` reads as being inside its `loop`.
   *
   * The label carries its own keyword ("loop Daily query") because that is
   * both what mermaid shows in the tab and, exactly, the line that has to be
   * written back out when the board is read as code -- one string doing both
   * jobs cannot drift from itself.
   */
  for (const frame of [...layout.frames].sort((a, b) => a.depth - b.depth)) {
    nodes.push({
      id: `${diagramId}-b-${nanoid(6)}`,
      type: 'shape',
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      [DIAGRAM_TAG]: diagramId,
      geometry: { kind: 'rect' },
      appearance: {
        /**
         * No interior at all, and the label carried by the stroke colour.
         *
         * Two wrong answers preceded this. `fill: []` is not "no fill" --
         * `fillColor` reads `fill[0]` and falls back to the renderer's default
         * when there is nothing there, so frames came out in a colour nobody
         * chose. Tinting them instead fixed that and broke something worse: a
         * frame covers the messages it contains, so every arrow and every
         * lifeline inside a `loop` was read through a wash, and a nested block
         * washed them twice.
         *
         * Mermaid draws these as an outline and a label, and that is right --
         * a frame is an annotation about a range, not a surface. The label
         * takes `clusterStroke` rather than `textColor` because it sits
         * directly on the board: `textColor` is chosen to read on the node
         * fills, and a stroke tone is the one in this palette meant to be seen
         * against the canvas itself.
         */
        fill: [{ type: 'solid', color: 'transparent' }],
        stroke: { color: theme.canvasInk, width: 1.25 },
        cornerRadius: 4,
        ...(isSketch ? { sketch: 'light' } : {}),
      },
      text: frame.label ? `${frame.block} ${frame.label}` : frame.block,
      typography: {
        ...typography,
        fontSize: SEQ_TYPE.message,
        color: theme.canvasInk,
        align: 'left',
        verticalAlign: 'top',
      },
    } as NewNodeInput);

    // `else` / `and`: a rule across the frame with its own condition beside it.
    for (const section of frame.sections) {
      nodes.push({
        id: `${diagramId}-s-${nanoid(6)}`,
        type: 'shape',
        x: frame.x,
        y: section.y,
        width: frame.width,
        height: 0,
        [DIAGRAM_TAG]: diagramId,
        geometry: { kind: 'line' },
        appearance: {
          stroke: { color: theme.canvasInk, width: 1, dash: [4, 4] },
          ...(isSketch ? { sketch: 'light' } : {}),
        },
      } as NewNodeInput);
      nodes.push({
        id: `${diagramId}-sl-${nanoid(6)}`,
        type: 'text',
        x: frame.x + 8,
        y: section.y + 2,
        width: Math.max(60, frame.width - 16),
        height: 18,
        [DIAGRAM_TAG]: diagramId,
        text: `else ${section.label}`.trim(),
        typography: {
          ...typography,
          fontSize: SEQ_TYPE.message,
          color: theme.canvasInk,
          align: 'left',
        },
      } as NewNodeInput);
    }
  }

  /**
   * Lifelines next, so they sit *under* the heads and the notes.
   *
   * Document order is paint order, and a lifeline runs the full depth of the
   * diagram -- drawn last it would rule a dashed line straight through every
   * note it passes behind.
   */
  for (const lane of layout.lanes) {
    nodes.push({
      id: lifeId(lane.key),
      type: 'shape',
      x: lane.centreX,
      y: lane.lineTop,
      width: 0,
      height: Math.max(1, lane.lineBottom - lane.lineTop),
      [DIAGRAM_TAG]: diagramId,
      diagramKey: lane.key,
      geometry: { kind: 'line' },
      appearance: {
        // On the board with nothing behind it: see `canvasInk`.
        stroke: { color: theme.canvasInk, width: 1.5, dash: [4, 5], cap: 'round' },
        ...(isSketch ? { sketch: 'light' } : {}),
      },
    } as NewNodeInput);
  }

  /**
   * Each participant twice: once at the head, once at the foot.
   *
   * Mermaid draws the cast at both ends of the lifelines, and the reason is
   * scrolling -- on a long exchange the top row is off the screen by the time
   * it matters, so a reader following the last few messages has nothing to
   * tell the columns apart by. The two boxes are identical apart from their y,
   * and both carry the same `diagramKey`, so reading the board back finds one
   * participant rather than two.
   */
  layout.lanes.forEach((lane, i) => {
    for (const [which, top] of [
      ['p', lane.y],
      ['f', lane.footY],
    ] as const) {
    nodes.push({
      id: which === 'p' ? headId(lane.key) : footId(lane.key),
      type: 'shape',
      x: lane.x,
      y: top,
      width: lane.width,
      height: lane.height,
      [DIAGRAM_TAG]: diagramId,
      diagramKey: lane.key,
      geometry: { kind: 'rect' },
      appearance: {
        fill: [
          {
            type: 'solid',
            color: theme.accentFills[i % theme.accentFills.length] || theme.primaryFill,
          },
        ],
        stroke: { color: theme.primaryStroke, width: isSketch ? 2 : 1.75 },
        /**
         * An `actor` is mermaid's stick figure. There is no figure in this
         * shape vocabulary, and inventing one would be a drawing rather than
         * an object -- so the distinction is carried by the corner radius,
         * which the renderer clamps to half the shorter side. The result is a
         * pill, which reads as *not a box* beside the boxes it stands next to.
         */
        cornerRadius: lane.actor ? 999 : 8,
        ...(isSketch ? { sketch: 'light' } : {}),
      },
      // Pre-wrapped by the layout, which is what sized the box. Letting
      // Konva re-wrap it would be a second opinion about where the lines
      // break, and the box only fits the first one.
      text: lane.lines.join('\n'),
      typography: { ...typography, fontSize: SEQ_TYPE.head, color: theme.textColor },
    } as NewNodeInput);
    }
  });

  /** A world y as a fraction of a lifeline's own depth. */
  const rowOn = (key: string, y: number): number => {
    const lane = laneOf.get(key);
    if (!lane) return 0.5;
    const depth = lane.lineBottom - lane.lineTop;
    return depth > 0 ? (y - lane.lineTop) / depth : 0.5;
  };

  for (const step of layout.steps) {
    if (step.kind === 'note') {
      nodes.push({
        id: `${diagramId}-n-${nanoid(6)}`,
        type: 'shape',
        x: step.x,
        y: step.y,
        width: step.width,
        height: step.height,
        [DIAGRAM_TAG]: diagramId,
        geometry: { kind: 'rect' },
        appearance: {
          fill: [{ type: 'solid', color: theme.clusterFill }],
          stroke: { color: theme.clusterStroke, width: 1.25 },
          cornerRadius: 4,
          ...(isSketch ? { sketch: 'light' } : {}),
        },
        text: step.lines.join('\n'),
        typography: { ...typography, fontSize: SEQ_TYPE.note, color: theme.textColor },
      } as NewNodeInput);
      continue;
    }

    const fromLane = laneOf.get(step.from);
    const toLane = laneOf.get(step.to);
    if (!fromLane || !toLane) continue;

    // Which face each end leaves by, so the arrow crosses the gap between the
    // two lifelines rather than doubling back around one of them.
    const rightwards = toLane.centreX >= fromLane.centreX;
    const v = rowOn(step.from, step.y);

    /**
     * A self-message is the same lifeline twice, a little way apart.
     *
     * Both ends leave by the *right* face and the route is orthogonal, so it
     * bulges out to the right and returns -- which is the loop every sequence
     * renderer draws for a participant talking to itself, obtained from the
     * router rather than from a special-cased polyline. `layoutSequence`
     * reserves half again the row height for it.
     */
    const vTo = step.self ? rowOn(step.to, step.y + SELF_DROP) : v;

    nodes.push({
      id: `${diagramId}-m-${nanoid(6)}`,
      type: 'connector',
      // Derived from the endpoints on every read; a placeholder box the
      // renderer overwrites on its first frame.
      x: origin.x,
      y: origin.y,
      width: 1,
      height: 1,
      [DIAGRAM_TAG]: diagramId,
      from: {
        nodeId: lifeId(step.from),
        anchor: { u: step.self || rightwards ? 1 : 0, v },
      },
      to: {
        nodeId: lifeId(step.to),
        anchor: { u: step.self ? 1 : rightwards ? 0 : 1, v: vTo },
      },
      // Straight across for a message between two participants; the loop for a
      // self-message needs elbows.
      routing: step.self ? 'orthogonal' : 'straight',
      ...(step.self ? { cornerRadius: 6 } : {}),
      endStart: 'none',
      /**
       * `->` genuinely has no arrowhead in mermaid, so it gets none here.
       *
       * `-x` ends in a literal cross, which this cap vocabulary does not have.
       * `bar` is the substitute rather than a drawn glyph: it is a terminator
       * that reads as "stops here", which is what a lost message means, and it
       * stays a real end cap -- so it scales with `endScale`, flips with a
       * reverse, and can be changed in the panel like any other.
       */
      endEnd: step.head === 'cross' ? 'bar' : step.head === 'open' ? 'none' : 'arrow',
      ...(step.label ? { label: step.label } : {}),
      appearance: {
        stroke: {
          color: theme.connectorColor,
          width: 2,
          ...(step.line === 'dotted' ? { dash: [6, 4], cap: 'round' } : {}),
        },
        ...(isSketch ? { sketch: 'light' } : {}),
      },
    } as NewNodeInput);
  }

  return { nodes, diagramId };
}
