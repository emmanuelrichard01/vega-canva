/**
 * Canvas objects for a pie chart.
 *
 * Each slice is a closed `bezier` path — two straight runs to and from the
 * centre and a curved run along the rim — because the shape vocabulary has no
 * arc and `ShapeGeometry.points` is a side *count*, not a list of vertices.
 * See `pie.ts` for why the rim is cut into quarter-turn spans.
 *
 * The consequence worth having is that a wedge is a real editable path: its
 * anchors are anchors, so the pen tool can nudge one afterwards. That is the
 * whole promise of turning code into objects rather than into a picture.
 */

import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../document/mutations';
import { DIAGRAM_THEMES, type DiagramThemeId } from './mermaid';
import { DIAGRAM_TAG, diagramTypography } from './build';
import {
  layoutPie,
  PIE_LEGEND_SIZE,
  PIE_SLICE_SIZE,
  type PieChart,
  type PieLayoutOptions,
  type PieWedge,
} from './pie';
import { sequenceMeasurer } from './sequenceMeasure';

export interface PieBuildOptions {
  theme?: DiagramThemeId;
  renderStyle?: 'crisp' | 'sketch';
  layout?: Partial<PieLayoutOptions>;
}

export interface BuiltPie {
  nodes: NewNodeInput[];
  diagramId: string;
}

/**
 * A wedge's anchors and handles in the schema's *arriving-at* form.
 *
 * `segments[i]` describes the curve arriving at anchor `i`, and on a closed
 * path `segments[0]` is the run home from the last anchor — which for a wedge
 * is the straight edge back to the centre. Getting that wrong draws a slice
 * with one curved side and is the kind of thing that looks like a rendering
 * bug rather than a modelling one.
 */
function segmentsFor(wedge: PieWedge, originX: number, originY: number) {
  const { anchors, handles } = wedge;
  return anchors.map((anchor, i) => {
    const x = anchor.x - originX;
    const y = anchor.y - originY;
    if (i === 0) {
      // The closing edge: straight from the last rim point back to the centre,
      // so both controls sit on the line itself.
      const last = anchors[anchors.length - 1];
      return {
        x,
        y,
        cp1x: last.x - originX,
        cp1y: last.y - originY,
        cp2x: x,
        cp2y: y,
      };
    }
    const handle = handles[i - 1];
    return {
      x,
      y,
      cp1x: handle.cp1.x - originX,
      cp1y: handle.cp1.y - originY,
      cp2x: handle.cp2.x - originX,
      cp2y: handle.cp2.y - originY,
    };
  });
}

export function buildPieDiagram(
  chart: PieChart,
  origin: { x: number; y: number },
  existingId?: string,
  options?: PieBuildOptions,
): BuiltPie {
  const diagramId = existingId ?? nanoid(8);
  const theme = DIAGRAM_THEMES[options?.theme ?? 'indigo'] || DIAGRAM_THEMES.indigo;
  const isSketch = options?.renderStyle === 'sketch';
  const typography = diagramTypography(isSketch);

  const layout = layoutPie(chart, {
    originX: origin.x,
    originY: origin.y,
    // The face the labels will actually be drawn in, so the card is measured
    // against the type it has to hold.
    measure: sequenceMeasurer(isSketch),
    ...options?.layout,
  });

  const nodes: NewNodeInput[] = [];

  if (layout.titleBox) {
    nodes.push({
      id: `${diagramId}-title`,
      type: 'text',
      x: layout.titleBox.x,
      y: layout.titleBox.y,
      width: layout.titleBox.width,
      height: layout.titleBox.height,
      [DIAGRAM_TAG]: diagramId,
      text: layout.title,
      typography: {
        ...typography,
        fontSize: 20,
        fontWeight: 600,
        align: 'center',
        // A heading on the bare board, so it takes the ink meant for that --
        // `textColor` is chosen against the node fills and disappears on a
        // dark canvas. Large text needs less contrast, which is why a title
        // can do this and a legend row cannot.
        color: theme.canvasInk,
      },
    } as NewNodeInput);
  }

  layout.wedges.forEach((wedge, i) => {
    const colour = theme.accentFills[i % theme.accentFills.length] || theme.primaryFill;

    /**
     * The node's own box is the *bounding box of the wedge*, and the anchors
     * are stored relative to it.
     *
     * Not the whole circle: a slice whose box was the pie would be almost
     * entirely empty, and every one of them would sit on top of every other
     * for selection and for the marquee.
     */
    const xs = wedge.anchors.map((a) => a.x);
    const ys = wedge.anchors.map((a) => a.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);

    nodes.push({
      id: `${diagramId}-w-${nanoid(6)}`,
      type: 'path',
      x: left,
      y: top,
      width: Math.max(1, Math.max(...xs) - left),
      height: Math.max(1, Math.max(...ys) - top),
      [DIAGRAM_TAG]: diagramId,
      geometry: {
        kind: 'bezier',
        closed: true,
        segments: segmentsFor(wedge, left, top),
      },
      appearance: {
        fill: [{ type: 'solid', color: colour }],
        stroke: { color: theme.primaryStroke, width: isSketch ? 2 : 1.5 },
        ...(isSketch ? { sketch: 'light' } : {}),
      },
    } as NewNodeInput);
  });

  /**
   * The share on each wedge that has room for it.
   *
   * After the wedges, so it is drawn on top of them, and only where it fits --
   * see `sliceLabel`. `textColor` is right here because, unlike everything on
   * the bare canvas, this genuinely has a surface: the wedge's own fill.
   */
  layout.wedges.forEach((wedge) => {
    if (!wedge.sliceLabel) return;
    const box = 64;
    nodes.push({
      id: `${diagramId}-p-${nanoid(6)}`,
      type: 'text',
      x: wedge.centroid.x - box / 2,
      y: wedge.centroid.y - PIE_SLICE_SIZE,
      width: box,
      height: PIE_SLICE_SIZE * 2,
      [DIAGRAM_TAG]: diagramId,
      text: wedge.sliceLabel,
      typography: {
        ...typography,
        fontSize: PIE_SLICE_SIZE,
        fontWeight: 600,
        align: 'center',
        verticalAlign: 'middle',
        color: theme.textColor,
      },
    } as NewNodeInput);
  });

  /**
   * A legend as well as the shares.
   *
   * The slice carries the number and the legend carries the name, which is the
   * division that lets a 1% category exist at all.
   *
   * A thin slice has no room for its own name, and mermaid's own answer --
   * writing it anyway and letting it overhang -- is why a pie of ten
   * categories is unreadable there. The swatch carries the identity and the
   * row carries the words, so a 1% slice is as legible as a 40% one.
   */
  /**
   * The card the rows sit on, before the rows.
   *
   * Document order is paint order. It also gives every legend label a known
   * surface, so `textColor` is correct against it whatever the viewer's board
   * is set to -- see `legendCard`.
   */
  nodes.push({
    id: `${diagramId}-legend`,
    type: 'shape',
    x: layout.legendCard.x,
    y: layout.legendCard.y,
    width: layout.legendCard.width,
    height: layout.legendCard.height,
    [DIAGRAM_TAG]: diagramId,
    geometry: { kind: 'rect' },
    appearance: {
      fill: [{ type: 'solid', color: theme.clusterFill }],
      stroke: { color: theme.canvasInk, width: 1 },
      cornerRadius: 8,
      ...(isSketch ? { sketch: 'light' } : {}),
    },
  } as NewNodeInput);

  layout.wedges.forEach((wedge, i) => {
    const colour = theme.accentFills[i % theme.accentFills.length] || theme.primaryFill;
    const swatch = Math.min(14, wedge.legend.height - 8);

    nodes.push({
      id: `${diagramId}-ls-${nanoid(6)}`,
      type: 'shape',
      x: wedge.legend.x,
      y: wedge.legend.y + (wedge.legend.height - swatch) / 2,
      width: swatch,
      height: swatch,
      [DIAGRAM_TAG]: diagramId,
      geometry: { kind: 'rect' },
      appearance: {
        fill: [{ type: 'solid', color: colour }],
        stroke: { color: theme.primaryStroke, width: 1 },
        cornerRadius: 3,
        ...(isSketch ? { sketch: 'light' } : {}),
      },
    } as NewNodeInput);

    nodes.push({
      id: `${diagramId}-lt-${nanoid(6)}`,
      type: 'text',
      x: wedge.legend.x + swatch + 10,
      y: wedge.legend.y,
      width: Math.max(60, wedge.legend.width - swatch - 10),
      height: wedge.legend.height,
      [DIAGRAM_TAG]: diagramId,
      // Formatted and broken by the layout, which is what sized the card.
      // Composing the string here as well would be a second opinion about how
      // wide it is, and the card only fits the first one.
      text: wedge.legendLines.join('\n'),
      typography: {
        ...typography,
        fontSize: PIE_LEGEND_SIZE,
        align: 'left',
        verticalAlign: 'middle',
        color: theme.textColor,
      },
    } as NewNodeInput);
  });

  return { nodes, diagramId };
}
