import { FORMAT_SPECS, resolveBackground, type Exporter, type ExportOptions, type ExportFormat } from './ExportTypes';
import { labelPlated, shapeLabelBox } from '../model/shapes/labelBox';
import { solidFillOf } from '../model/labelInk';
import { useStore } from '../../hooks/useStore';
import { THEMES } from '../model/stickyThemes';
import type { AnyNode, ConnectorNode, ImageNode, PathNode, ShapeNode, TextNode, Typography } from '../model/schema';
import { connectorPoints, ELBOW_RADIUS } from '../model/connector';
import { routeBoard, type BoardRoute } from '../model/connectorRouter/routeBoard';
import { connectorPathData } from '../model/connectorRouter/pathOps';
import { attachLookup, boxLookup } from '../model/connectorTargets';
import { connectorCaps, trimRunForCaps } from '../model/connectorEnds';
import { sketchedCap, sketchedRun } from '../model/connectorSketch';
import {
  LABEL_GAP,
  arrangeLabels,
  autoLabelKey,
  labelCentre,
  labelFontSize,
  labelTextWidth,
  labelsOf,
} from '../model/connectorLabelLayout';
import type { Placed } from '../model/connectorLabels';
import { readableOnSurface } from '../model/color';
import { DEFAULT_CONNECTOR_INK } from '../model/schema';
import { gridCellsOf } from '../grid/gridNode';
import { roundPolygon } from '../grid/gridLayout';
import { cellGeometry } from '../grid/gridBuild';
import {
  cellLabel,
  cellPaint,
  labelInk,
  LABEL_INSET,
  LABEL_SIZE,
} from '../grid/gridStyle';
import { fillsInterior } from '../model/rough';
import { SvgPaintDefs } from './svgPaint';
import { assembleSvg } from './svgDocument';
import { fetchBlob, inlineImageSources } from './inlineImages';
import { shapeFeaturePaths, shapeOutline } from '../model/shapeOutline';
import { shapeToPath } from '../model/shapeToPath';
import { defaultEndAlign } from '../model/linePath';
import { runPoints } from '../model/lineEnds';
import { endCapShape, terminateRun } from '../model/connectorEnds';
import { contourData, translatePath } from '../model/pathGeometry';
import { applyTextCase } from '../model/textCase';
import { contrastInk } from '../model/color';
import { layoutText } from '../text/layout';
import { measurerFor } from '../text/measure';
import { highlightPath } from '../text/highlight';
import { roughShape } from '../model/roughShape';
import { loopPath } from '../model/freehandLoop';
import { canvasFontFamily } from '../../components/canvas/renderers/shared';
import { DEFAULT_INK } from '../model/schema';
import { computeContentBounds } from './bounds';
import { exportIds, exportIdSet } from './exportScope';
import { chartToSvg } from '../chart/chartSvg';
import { tableToSvg } from '../table/tableSvg';
import { codeToSvg } from '../code/codeSvg';
import { linkToSvg } from '../link/linkSvg';
import { iconToSvg, preloadIcons } from '../icons/iconSvg';
import { cornerRadiiOf, fitRadii, isPerCorner, roundedRectPath } from '../model/cornerRadii';
import { attr, escapeXml, num } from './markup';
import { compareStacking } from '../model/stacking';
import { familiesInNodes, fontFaceCss } from '../text/fontEmbed';


/*
 * The polygon and star trigonometry used to live here, duplicating the
 * renderer's. It now lives in `model/shapeOutline`, which the effect layers
 * read too — three descriptions of what shape a hexagon is would be two too
 * many, and the first sign of a disagreement would be an exported star with a
 * different number of points from the one on screen.
 */

function bezierPathData(node: PathNode, offsetX: number, offsetY: number): string {
  if (node.geometry.kind === 'freehand') return '';
  // The same description the canvas draws from, moved into world coordinates.
  // The exporter used to carry its own copy of the segment-to-`d` walk, which
  // is exactly how the closing curve of a closed path came to be drawn one way
  // on screen and another in the file.
  return contourData(translatePath(node.geometry, offsetX, offsetY));
}

/** SVG text attributes for a typography block. */
function textAttrs(t: Typography): string {
  const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
  return [
    `font-family="${escapeXml(canvasFontFamily(t.fontFamily))}"`,
    `font-size="${num(t.fontSize)}"`,
    `font-weight="${attr(t.fontWeight)}"`,
    `font-style="${t.italic ? 'italic' : 'normal'}"`,
    // Both at once when both are set — SVG takes a space-separated list, the
    // same as Canvas2D, which is why the model keeps them as two flags.
    textDecoration(t) ? `text-decoration="${textDecoration(t)}"` : '',
    `fill="${attr(t.color)}"`,
    `text-anchor="${attr(anchor)}"`,
    t.letterSpacing ? `letter-spacing="${num(t.letterSpacing)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** `underline`, `line-through`, both, or nothing. */
function textDecoration(t: Typography): string {
  return [t.underline && 'underline', t.strikethrough && 'line-through'].filter(Boolean).join(' ');
}

/**
 * One `<tspan>` per line, with the case transform already applied.
 *
 * Applied here rather than emitted as a `text-transform` style: SVG's
 * `text-transform` is a CSS property that renderers apply inconsistently and
 * that several converters drop, so a file exported with it would show the
 * author's typing rather than what the canvas drew. Baking the case in is the
 * one place the transform touches a string that leaves the app — the document
 * still holds what was typed.
 */
function multilineTspans(text: string, x: number, fontSize: number, lineHeight: number): string {
  return text
    .split('\n')
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? fontSize : fontSize * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
}

/**
 * A text node as SVG, laid out the way the canvas lays it out.
 *
 * ## Why this does not just split on newlines
 *
 * It used to, and that was wrong before any of the effects existed: a wrapped
 * text node has line breaks the *renderer* chose, and the document holds none
 * of them. Splitting the stored string on `\n` therefore exported one long
 * line where the canvas drew four, so every wrapped text node came out of SVG
 * a different shape from the one on screen. Going through `layoutText` means
 * the exporter and the canvas ask the same function the same question.
 *
 * It also carries the three block effects, which is the point of doing it now:
 * a highlight, an outline and a glow are all things the canvas draws and a
 * file that claims to be the board has to contain.
 */
function textMarkup(node: TextNode): string {
  const t = node.typography;
  const layout = layoutText({
    text: applyTextCase(node.text, t.textCase),
    list: t.list,
    wrap: node.resize === 'width' ? 'none' : 'word',
    width: node.width,
    height: node.resize === 'fixed' ? node.height : undefined,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    paragraphSpacing: t.paragraphSpacing,
    align: t.align,
    verticalAlign: t.verticalAlign,
    ellipsis: node.resize === 'fixed',
    measure: measurerFor(t),
  });

  const parts: string[] = [];
  const ink = t.highlight?.autoContrast ? contrastInk(t.highlight.color) : t.color;

  if (t.highlight && layout.lines.length > 0) {
    // The ribbon is generated in node-local coordinates, so it moves with the
    // node by a translate rather than by regenerating every number.
    const d = highlightPath(layout.lines, t.highlight);
    if (d) {
      parts.push(
        `<path d="${d}" fill="${attr(t.highlight.color)}" transform="translate(${node.x} ${node.y})" />`
      );
    }
  }

  // `feDropShadow` with no offset is a halo, and it is one element rather than
  // the blur/flood/merge chain the same effect needs spelled out by hand.
  let filterRef = '';
  if (t.glow) {
    const id = `glow-${node.id}`;
    parts.push(
      `<defs><filter id="${attr(id)}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="0" dy="0" stdDeviation="${num(t.glow.blur / 2)}" flood-color="${attr(t.glow.color)}" flood-opacity="1" />` +
        `</filter></defs>`
    );
    filterRef = ` filter="url(#${attr(id)})"`;
  }

  // Alignment is already resolved into each line's x, so the anchor is always
  // `start` here — re-applying it would shift every line a second time.
  const attrs = textAttrs({ ...t, align: 'left', color: ink });
  // `paint-order="stroke"` is SVG's own answer to the problem the canvas
  // solves with two draws: it puts the stroke under the fill, so the whole
  // weight lands outside the letterforms instead of eating into them.
  const outline = t.outline
    ? ` stroke="${attr(t.outline.color)}" stroke-width="${num(t.outline.width * 2)}" paint-order="stroke" stroke-linejoin="round"`
    : '';

  const lines = layout.lines
    .map(
      (line) =>
        `<text x="${node.x + line.x}" y="${node.y + line.y + line.baseline}" ${attrs}${outline}>${escapeXml(line.text)}</text>`
    )
    .join('');

  parts.push(`<g${filterRef}${rotationTransform(node)}>${lines}</g>`);
  return parts.join('');
}

/**
 * Rotation and shear, both about the node's centre, matching the canvas.
 *
 * SVG has `skewX`/`skewY` primitives but they shear about the *origin*, so
 * they are wrapped in a translate to the centre and back — the same thing the
 * renderer achieves with `offsetX`/`offsetY`. Order matters and follows Konva:
 * rotate outermost, then shear, so a node that is both reads the same in the
 * file as on the board.
 */

/**
 * A connector as SVG, drawn the way the canvas draws it.
 *
 * The route comes from `routeBoard`, the same routing the canvas's route store
 * runs (avoidance, channel spreading, line jumps), from the same snapshot, so
 * the arrow in the file takes the board's path. The run is trimmed under its
 * markers by `trimRunForCaps`, elbows and jumps are drawn by
 * `connectorPathData`, and a sketched connector goes through
 * `connectorSketch`, with the run seeded by the id and each marker by the id
 * plus its end, exactly as on the canvas. Labels break the line through a
 * mask, as the canvas breaks it with a clip.
 */
const exportRoutes = new WeakMap<object, Map<string, BoardRoute>>();

function routesFor(objects: Record<string, AnyNode>): Map<string, BoardRoute> {
  let routes = exportRoutes.get(objects);
  if (!routes) {
    routes = routeBoard(objects, { boxOf: boxLookup(objects), attachOf: attachLookup(objects) });
    exportRoutes.set(objects, routes);
  }
  return routes;
}

const exportLabels = new WeakMap<object, Map<string, Placed>>();

/**
 * Where every unplaced label on the board goes: the canvas's arrangement
 * (`placeConnectorLabels`), run over the same routes, so a label that dodged
 * another on the board dodges it in the file too.
 */
function labelSlotsFor(objects: Record<string, AnyNode>): Map<string, Placed> {
  let slots = exportLabels.get(objects);
  if (!slots) {
    const routes = routesFor(objects);
    const drawn: Array<{ node: ConnectorNode; flat: number[] }> = [];
    for (const [id, route] of routes) {
      const node = objects[id] as ConnectorNode | undefined;
      if (node) drawn.push({ node, flat: route.points.flatMap((p) => [p.x, p.y]) });
    }
    slots = arrangeLabels(drawn);
    exportLabels.set(objects, slots);
  }
  return slots;
}

/** Jump size and clearance, matching the canvas at 100%. */
const EXPORT_HOP_RADIUS = 6;
const EXPORT_HOP_CLEARANCE = 8;

function connectorMarkup(node: ConnectorNode, objects: Record<string, AnyNode>): string {
  const route = routesFor(objects).get(node.id);
  const world = route
    ? route.points.flatMap((p) => [p.x, p.y])
    : connectorPoints(node.from, node.to, node.routing, boxLookup(objects), attachLookup(objects));
  if (world.length < 4) return '';

  const strokeValue = node.appearance?.stroke?.color;
  const stroke = strokeValue && strokeValue !== 'transparent' ? strokeValue : DEFAULT_CONNECTOR_INK;
  const width = node.appearance?.stroke?.width || 2;
  const dash = dashAttrs(node.appearance?.stroke);
  const dashed = (node.appearance?.stroke?.dash?.length ?? 0) > 0;
  const curved = route ? route.curved : node.routing === 'curved';
  const orthogonal = route ? route.orthogonal : false;

  const caps = connectorCaps(world, {
    start: node.endStart ?? 'none',
    end: node.endEnd ?? 'none',
    strokeWidth: width,
    scale: node.endScale,
  });
  const trimmed = trimRunForCaps(world, curved ? [] : route?.hops ?? [], caps.start?.inset ?? 0, caps.end?.inset ?? 0);
  const run: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < trimmed.flat.length; i += 2) run.push({ x: trimmed.flat[i], y: trimmed.flat[i + 1] });

  const sketch = node.appearance?.sketch
    ? { id: node.id, sketchSeed: node.appearance.sketchSeed, level: node.appearance.sketch, width, curved, dashed }
    : null;
  const d = sketch
    ? sketchedRun(run, sketch)
    : connectorPathData(run, {
        cornerRadius: orthogonal ? node.cornerRadius ?? ELBOW_RADIUS : 0,
        hops: trimmed.hops,
        hopRadius: EXPORT_HOP_RADIUS,
        hopClearance: EXPORT_HOP_CLEARANCE,
      });

  // Labels, and the holes they cut in the line.
  const fontSize = labelFontSize(width);
  const ink = readableOnSurface(stroke, '#FFFFFF');
  const slots = labelSlotsFor(objects);
  const placed = labelsOf(node)
    .filter((l) => l.text.trim())
    .map((l) => {
      const at = labelCentre(l, world, l.t === undefined ? slots.get(autoLabelKey(node.id, l.id)) : null);
      const w = labelTextWidth(l.text, fontSize) + 6;
      const h = fontSize + 6;
      return { text: l.text, x: at.x, y: at.y, w, h };
    });
  let mask = '';
  let maskRef = '';
  if (placed.length > 0) {
    const id = `cl-${node.id.replace(/[^A-Za-z0-9_-]/g, '')}`;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < world.length; i += 2) {
      minX = Math.min(minX, world[i]);
      maxX = Math.max(maxX, world[i]);
      minY = Math.min(minY, world[i + 1]);
      maxY = Math.max(maxY, world[i + 1]);
    }
    const pad = 64;
    const holes = placed
      .map(
        (p) =>
          `<rect x="${num(p.x - p.w / 2 - LABEL_GAP)}" y="${num(p.y - p.h / 2 - LABEL_GAP)}" width="${num(p.w + LABEL_GAP * 2)}" height="${num(p.h + LABEL_GAP * 2)}" fill="black" />`
      )
      .join('');
    mask = `<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(minX - pad)}" y="${num(minY - pad)}" width="${num(maxX - minX + pad * 2)}" height="${num(maxY - minY + pad * 2)}"><rect x="${num(minX - pad)}" y="${num(minY - pad)}" width="${num(maxX - minX + pad * 2)}" height="${num(maxY - minY + pad * 2)}" fill="white" />${holes}</mask>`;
    maskRef = ` mask="url(#${id})"`;
  }
  const labelMarkup = placed
    .map(
      (p) =>
        `<text x="${num(p.x)}" y="${num(p.y)}" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" font-weight="500" fill="${attr(ink)}">${escapeXml(p.text)}</text>`
    )
    .join('');

  const capPart = (cap: typeof caps.start, key: 'start' | 'end') => {
    const rough = sketch ? sketchedCap(cap, key, caps.size, sketch) : null;
    if (rough && cap) {
      return `<path d="${rough}" fill="${attr(cap.filled ? stroke : 'none')}" stroke="${attr(stroke)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`;
    }
    return capMarkup(cap, stroke, width);
  };

  const parts = [
    mask,
    `<path d="${d}" fill="none" stroke="${attr(stroke)}" stroke-width="${width}"${dash} stroke-linecap="round" stroke-linejoin="round"${maskRef} />`,
    capPart(caps.start, 'start'),
    capPart(caps.end, 'end'),
    labelMarkup,
  ];
  return parts.filter(Boolean).join('');
}

/**
 * One end cap as SVG, for whichever run produced it.
 *
 * Shared by connectors and by lines/arrows. It was written twice before — once
 * inside `openShapeMarkup` and, in an earlier revision, not at all for
 * connectors — which is the second-list failure invariant 7 names. A cap is a
 * cap; the only thing that varies is the paint it takes.
 */
function capMarkup(
  cap: ReturnType<typeof endCapShape>,
  stroke: string,
  sw: number
): string {
  if (!cap) return '';
  if (cap.circle) {
    return `<circle cx="${cap.circle.x.toFixed(2)}" cy="${cap.circle.y.toFixed(2)}" r="${cap.circle.radius.toFixed(2)}" fill="${attr(cap.filled ? stroke : 'none')}" stroke="${attr(stroke)}" stroke-width="${sw}" />`;
  }
  const pts = cap.points ?? [];
  const pairs: string[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i].toFixed(2)},${pts[i + 1].toFixed(2)}`);
  if (pairs.length === 0) return '';
  // Open markers — the bar — are a polyline, not a polygon: closing a
  // two-point run draws it back over itself and fills nothing.
  return cap.filled
    ? `<polygon points="${pairs.join(' ')}" fill="${attr(stroke)}" stroke="${attr(stroke)}" stroke-width="${sw}" stroke-linejoin="round" />`
    : `<polyline points="${pairs.join(' ')}" fill="none" stroke="${attr(stroke)}" stroke-width="${sw}" stroke-linecap="round" />`;
}

function rotationTransform(node: AnyNode): string {
  const { rotation, skewX, skewY } = node;
  /**
   * Scale belongs here too, and its absence was a silent data loss.
   *
   * `scaleX: -1` is how this app flips an object — it is what the Flip
   * horizontal command writes and what the transformer writes when a handle is
   * dragged through the opposite edge. Nothing in the SVG output read it, so
   * **every flipped object exported unflipped**: a mirrored arrow pointed the
   * wrong way in the file, and a flipped photo came out the right way round.
   * The raster path never showed it because Konva applies the scale itself.
   */
  const sx = node.scaleX ?? 1;
  const sy = node.scaleY ?? 1;
  const scaled = sx !== 1 || sy !== 1;
  if (!rotation && !skewX && !skewY && !scaled) return '';

  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const ops = [`translate(${cx} ${cy})`];
  /**
   * Rotate, then scale, then shear — the order Konva composes them in, all
   * about the centre because that is where `ObjectRenderer` puts the offset.
   * A different order is a different picture the moment two of them are set at
   * once, so this follows the renderer rather than reading well.
   */
  if (rotation) ops.push(`rotate(${rotation})`);
  if (scaled) ops.push(`scale(${sx} ${sy})`);
  // Degrees in both conventions: the document stores degrees, SVG's `skewX`
  // takes degrees. Only Konva wants the tangent, and the renderer converts.
  if (skewX) ops.push(`skewX(${skewX})`);
  if (skewY) ops.push(`skewY(${skewY})`);
  ops.push(`translate(${-cx} ${-cy})`);
  return ` transform="${ops.join(' ')}"`;
}

/**
 * `stroke-dasharray` and `stroke-linecap`, or an empty string.
 *
 * SVG and Canvas2D define dash arrays identically, so the stored value goes
 * out verbatim with no conversion. The cap has to travel with it: a dotted
 * pattern is `0 gap`, and an SVG viewer applying the default butt cap to that
 * renders nothing at all — an exported dotted outline would silently vanish.
 */
function dashAttrs(stroke: ShapeNode['appearance']['stroke']): string {
  if (!stroke?.dash || stroke.dash.length === 0) return '';
  const cap = stroke.cap ? ` stroke-linecap="${attr(stroke.cap)}"` : '';
  return ` stroke-dasharray="${stroke.dash.map(num).join(' ')}"${cap}`;
}

/**
 * `stroke-linejoin` and `stroke-miterlimit`, or an empty string.
 *
 * Both are stored only when they differ from the default, and SVG's defaults
 * are the same two values — `miter` and 10 — so an untouched stroke emits
 * nothing and the file stays as small as the document is.
 */
function joinAttrs(stroke: ShapeNode['appearance']['stroke']): string {
  const join = stroke?.join ? ` stroke-linejoin="${attr(stroke.join)}"` : '';
  const limit = stroke?.miterLimit !== undefined ? ` stroke-miterlimit="${num(stroke.miterLimit)}"` : '';
  return `${join}${limit}`;
}

/**
 * A line or an arrow: an open run with optional heads.
 *
 * The heads are drawn as a `<polygon>` each rather than through SVG's
 * `marker-end`. A marker is the idiomatic answer and the wrong one here:
 * markers take the marker's own fill rather than the line's, need a `<defs>`
 * entry per colour, and are dropped outright by several editors on import — so
 * an arrow exported that way arrives as a plain line.
 */
function openShapeMarkup(node: ShapeNode): string {
  const stroke = node.appearance.stroke?.color ?? DEFAULT_INK;
  const sw = node.appearance.stroke?.width ?? 2;
  const rot = rotationTransform(node);
  /**
   * Through `linePoints`, so an exported wavy line is the wavy line on screen.
   *
   * A straight profile gives back its two endpoints, so the common case is
   * still a `<line>` — the smaller, more readable markup, and what every
   * previously exported document contains.
   */
  /**
   * The run in world space, from the one reader the canvas draws through.
   *
   * `runPoints` answers all three storage forms — a run of vertices with its
   * bends, the two-point pair, and the legacy box — so a multi-point line
   * exports as the shape on screen and an old document exports exactly as it
   * always did. Building the run here from `a`/`b` instead is how the exporter
   * came to draw a wrapped text node as one long line: a second derivation of
   * something the renderer had already decided.
   */
  const run = runPoints(node).map((p) => ({ x: node.x + p.x, y: node.y + p.y }));
  /**
   * The heads, and the run pulled back under them.
   *
   * All three of the classic marker faults were here at once, and each has the
   * same cure — ask the geometry rather than assume it:
   *
   * 1. **Wrong angle.** The facing came from `atan2(y2 - y1, x2 - x1)`: the
   *    *box diagonal*. On a wave, a zigzag or a coil the run arrives at a
   *    completely different angle, so every exported profiled arrow had a head
   *    pointing flat while its line came in at a slope. This is what SVG's
   *    `orient="auto"` does for you and what has to be done by hand when the
   *    marker is a polygon you emit yourself.
   * 2. **Bad overlap.** Nothing shortened the run, so the stroke ran through
   *    the middle of the head and out past its tip. `trimPolyline` takes the
   *    marker's own depth off each end, which is the equivalent of stopping
   *    the path short.
   * 3. **Wrong anchor.** The head was always a plain triangle from a local
   *    helper, while the document may say circle, diamond, bar or none —
   *    the exporter read the *deprecated* `arrowStart`/`arrowEnd` booleans and
   *    never saw `endStart`/`endEnd` at all. `endCapShape` is the canvas's own
   *    geometry, including where each marker sits relative to the endpoint.
   */
  const { run: trimmedRun, start: startCap, end: endCap } = terminateRun(
    run.flatMap((p) => [p.x, p.y]),
    {
      start: node.geometry.endStart ?? (node.geometry.arrowStart ? 'arrow' : 'none'),
      end: node.geometry.endEnd ?? (node.geometry.arrowEnd ? 'arrow' : 'none'),
      strokeWidth: sw,
      scale: node.geometry.endScale,
      align: node.geometry.endAlign ?? defaultEndAlign(node.geometry.lineProfile),
    }
  );

  const drawn: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < trimmedRun.length; i += 2) {
    drawn.push({ x: trimmedRun[i], y: trimmedRun[i + 1] });
  }

  const parts = [
    drawn.length === 2
      ? `<line x1="${drawn[0].x.toFixed(2)}" y1="${drawn[0].y.toFixed(2)}" x2="${drawn[1].x.toFixed(2)}" y2="${drawn[1].y.toFixed(2)}" stroke="${attr(stroke)}" stroke-width="${sw}" stroke-linecap="round"${dashAttrs(node.appearance.stroke)} />`
      : `<polyline points="${drawn.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="none" stroke="${attr(stroke)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttrs(node.appearance.stroke)} />`,
  ];

  // Through the shared `capMarkup`, so a connector's arrowhead and a line's
  // arrowhead are the same markup from the same geometry.
  parts.push(capMarkup(startCap, stroke, sw));
  parts.push(capMarkup(endCap, stroke, sw));

  return rot ? `<g${rot}>${parts.join('')}</g>` : parts.join('');
}

function shapeMarkup(node: ShapeNode, defs: SvgPaintDefs): string {
  const { x, y, width: w, height: h } = node;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // The node's world box: gradient geometry is stored in unit space against
  // it, and `SvgPaintDefs` emits absolute coordinates so the SVG and the
  // canvas measure the same gradient.
  const fill = node.appearance.fill?.length
    ? defs.fill(node.appearance.fill[0], { x, y, width: w, height: h }, 'none')
    : 'none';
  const stroke = node.appearance.stroke?.color ?? 'none';
  const sw = node.appearance.stroke?.width ?? 0;
  const rot = rotationTransform(node);

  /**
   * A sketched shape exports as the sketch, not as the shape it was made from.
   *
   * The generator is seeded from the node id, so the strokes in the file are
   * the strokes on the screen — the same ones, not another draw from the same
   * distribution. That is the entire reason `roughShape` is shared between
   * this and the renderer rather than each having its own.
   */
  if (node.appearance.sketch) {
    const fillPaint = node.appearance.fill?.[0];
    const solidFill = fillPaint && fillPaint.type === 'solid' ? fillPaint.color : undefined;
    const sketch = roughShape(node, Boolean(solidFill));
    const nib = Math.max(1.2, sw || 2);
    // Generated in node-local coordinates, so it is placed by a translate
    // rather than by regenerating every number in world space.
    const place = ` transform="translate(${x} ${y})"`;
    const parts = [`<g${rot}>`];
    /**
     * Only a style that fills its interior paints the silhouette.
     *
     * The silhouette exists for every filled sketched shape now, because the
     * canvas needs it as a hit region — so the test that used to be implied by
     * it being empty has to be written. Without this, an exported hachured
     * shape would come out solid: a file that disagrees with the screen, which
     * is the one thing sharing `roughShape` between the two exists to prevent.
     */
    if (sketch.silhouette && solidFill && fillsInterior(node.appearance.fillStyle)) {
      parts.push(`<path d="${sketch.silhouette}" fill="${attr(solidFill)}"${place} />`);
    }
    if (sketch.fill && solidFill) {
      const fillSw =
        node.appearance.fillStyle === 'dots'
          ? node.appearance.sketch === 'heavy' ? 3.6 : node.appearance.sketch === 'light' ? 2.2 : 2.8
          : Math.max(0.8, nib * 0.7);
      parts.push(
        `<path d="${sketch.fill}" fill="none" stroke="${attr(solidFill)}" stroke-width="${fillSw}" stroke-linecap="round"${place} />`
      );
    }
    const sketchInk = stroke === 'none' ? DEFAULT_INK : stroke;
    /**
     * The interior lines, at the lighter nib the canvas uses.
     *
     * Absent from the file entirely until 2026-09-09 — the sketch branch drew
     * a silhouette, a shading and an outline, and the features were not among
     * the three things `roughShape` returned. So a sketched rack exported as a
     * plain rounded rectangle and a sketched chip as a square.
     */
    if (sketch.features) {
      parts.push(
        `<path d="${sketch.features}" fill="none" stroke="${attr(sketchInk)}" stroke-width="${Math.max(0.75, nib * 0.78)}" stroke-linecap="round" stroke-linejoin="round"${place} />`
      );
    }
    parts.push(
      `<path d="${sketch.outline}" fill="none" stroke="${attr(sketchInk)}" stroke-width="${nib}" stroke-linecap="round" stroke-linejoin="round"${place} />`
    );
    parts.push('</g>');
    return parts.join('');
  }
  const paint = `fill="${attr(fill)}" stroke="${attr(stroke)}" stroke-width="${sw}"${dashAttrs(node.appearance.stroke)}${joinAttrs(node.appearance.stroke)}`;

  switch (node.geometry.kind) {
    case 'rect':
      /**
       * A path when the corners differ, because SVG's `<rect>` cannot say it.
       * `rx` is one radius for both axes and has no per-corner form at all, so
       * an independent-cornered rectangle exported as a `<rect>` would come
       * out with one radius on all four — a file that disagrees with the
       * screen. `roundedRectPath` is the same function the renderer's outline
       * uses, so the two agree by construction.
       */
      if (isPerCorner(node.appearance.cornerRadius)) {
        const d = roundedRectPath(x, y, w, h, fitRadii(cornerRadiiOf(node.appearance.cornerRadius), w, h));
        return `<path d="${d}" ${paint}${rot} />`;
      }
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${cornerRadiiOf(node.appearance.cornerRadius)[0]}" ${paint}${rot} />`;
    case 'ellipse':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${paint}${rot} />`;
    /**
     * Polygons and stars are no longer built here.
     *
     * This file's own header says the trigonometry moved to `shapeOutline` so
     * the exporter and the renderer could not draw different hexagons — and
     * these two branches were the ones that never made the move. They called
     * the point generators directly and inscribed the shape in the box's
     * ellipse, which is what those functions do; the outline now normalises
     * the result to *fill* the box, and the two would have disagreed by the
     * band of empty air a pentagon leaves along its bottom edge.
     *
     * There is nothing left for them to do that `default` does not, so they
     * are gone rather than corrected. The same is true of the dozen curved
     * kinds that used to be listed here individually: the list had to be
     * extended by hand for every shape added, and `default` had always drawn
     * them identically.
     */
    case 'line':
    case 'arrow':
      return openShapeMarkup(node);
    default: {
      const d = contourData(translatePath(shapeToPath(node), x, y));
      const features = shapeFeaturePaths(node, x, y);
      if (features.length > 0) {
        const featureLines = features
          .map((f) => `<path d="${f}" fill="none" stroke="${attr(stroke)}" stroke-width="${sw}"${dashAttrs(node.appearance.stroke)} />`)
          .join('');
        return `<g${rot}><path d="${d}" fill-rule="evenodd" ${paint} />${featureLines}</g>`;
      }
      return `<path d="${d}" fill-rule="evenodd" ${paint}${rot} />`;
    }
  }
}

export class SVGExporter implements Exporter {
  type: ExportFormat = 'svg';

  async export(options: ExportOptions): Promise<string> {
    const state = useStore.getState();
    let nodes = Object.values(state.objects);

    const ids = exportIdSet(options);
    if (ids) nodes = nodes.filter((n) => ids.has(n.id));

    // Draw in stacking order so the export matches what is on screen.
    nodes = nodes.filter((n) => !n.hidden).sort(compareStacking);

    const parts: string[] = [];
    const defs = new SvgPaintDefs();
    await preloadIcons(nodes);

    /**
     * Image bytes are pulled into the file before the walk begins.
     *
     * An SVG that carries object-storage URLs is a picture only while that
     * server is reachable by whoever opens it — which, for the recipient of a
     * shared file, it never is. Fetched once per distinct URL; anything that
     * cannot be read stays a reference, so a CORS refusal degrades the export
     * rather than failing it.
     */
    const { embedded } = await inlineImageSources(
      nodes.filter((n) => n.type === 'image').map((n) => (n as ImageNode).src ?? ''),
      fetchBlob
    );

    /**
     * Everything one node draws, wrapped once in its own opacity.
     *
     * `BaseNode.opacity` is a required field the renderer applies to every
     * object, and nothing in this file read it — so a shape faded to 20% on the
     * board exported fully opaque, and the SVG of a document disagreed with the
     * PNG of the same document. Applied here, at the one point every type
     * passes through, rather than threaded into eleven markup builders that
     * would each have to remember it.
     */
    const emit = (node: AnyNode, markup: string) => {
      if (!markup) return;
      const opacity = node.opacity ?? 1;
      parts.push(opacity >= 1 ? markup : `<g opacity="${num(opacity)}">${markup}</g>`);
    };

    nodes.forEach((node) => {
      // Everything this node contributes, gathered before it is emitted, so
      // the opacity wrapper goes around all of it rather than around the first
      // element and not the label sitting on top of it.
      const chunk: string[] = [];
      const parts = chunk;

      switch (node.type) {
        case 'shape': {
          parts.push(shapeMarkup(node, defs));
          if (node.text && node.typography) {
            const t = node.typography;
            // Centred in the label box the canvas lays the text out in.
            const lb = shapeLabelBox(node);
            const tx = node.x + lb.x + lb.width / 2;
            const plate = labelPlated(node.geometry.kind) ? solidFillOf(node) : undefined;
            if (plate) {
              const r = Math.min(lb.width, lb.height) * 0.2;
              parts.push(
                `<rect x="${num(node.x + lb.x)}" y="${num(node.y + lb.y)}" width="${num(lb.width)}" height="${num(lb.height)}" rx="${num(r)}" fill="${attr(plate)}" />`
              );
            }
            parts.push(
              `<text y="${node.y + lb.y + lb.height / 2}" ${textAttrs({ ...t, align: 'center' })} dominant-baseline="middle">${multilineTspans(applyTextCase(node.text, t.textCase), tx, t.fontSize, t.lineHeight)}</text>`
            );
          }
          break;
        }

        case 'text': {
          parts.push(textMarkup(node));
          break;
        }

        case 'path': {
          const stroke = node.appearance.stroke?.color;
          const sw = node.appearance.stroke?.width ?? 2;
          const paintBox = { x: node.x, y: node.y, width: node.width, height: node.height };
          const fill = node.appearance.fill?.length
            ? defs.fill(node.appearance.fill[0], paintBox, 'none')
            : undefined;

          if (node.geometry.kind !== 'freehand') {
            const dash = dashAttrs(node.appearance.stroke);
            // The round cap is this renderer's default for pen paths, so it is
            // only emitted when the dash pattern has not already supplied one.
            const cap = node.appearance.stroke?.cap ? '' : ' stroke-linecap="round"';
            const join = node.appearance.stroke?.join ? joinAttrs(node.appearance.stroke) : ' stroke-linejoin="round"';
            // Several contours in one `d` need the even-odd rule to read the
            // inner ones as holes — SVG's default is nonzero, which would fill
            // the hole in and lose the entire result of a subtraction.
            const rule = node.geometry.kind === 'compound' ? ' fill-rule="evenodd"' : '';
            parts.push(
              `<path d="${bezierPathData(node, node.x, node.y)}" fill="${attr(fill && fill !== 'transparent' ? fill : 'none')}"${rule} stroke="${attr(stroke ?? 'none')}" stroke-width="${sw}"${dash}${cap}${join} />`
            );
          } else if (node.geometry.svgPath) {
            /**
             * A freehand stroke: the ink from `stroke`, the interior from
             * `fill`.
             *
             * The outline polygon was exported with `fill`, matching what the
             * canvas used to do — and the canvas has stopped, because that made
             * the pencil the one node type where `fill` did not mean the
             * interior. Both read `stroke.color` for the ink now, which is what
             * keeps the file and the screen the same picture.
             *
             * The enclosed area is emitted **first** so the ink paints over it,
             * exactly as the canvas layers them. It only exists for a stroke
             * that came back to where it started; an open one has no inside for
             * a fill to land in, and emitting one would fill the region between
             * the two loose ends with a shape nobody drew.
             */
            const ink = stroke ?? DEFAULT_INK;
            const loop =
              node.geometry.closed && node.geometry.points.length > 2 && fill && fill !== 'transparent'
                ? loopPath(node.geometry.points)
                : '';
            if (loop) {
              parts.push(
                `<path d="${loop}" fill="${attr(fill)}" transform="translate(${node.x}, ${node.y})" />`
              );
            }
            // Freehand strokes store their outline relative to the node origin.
            parts.push(
              `<path d="${attr(node.geometry.svgPath)}" fill="${attr(ink)}" transform="translate(${node.x}, ${node.y})" />`
            );
          }
          break;
        }

        case 'image': {
          if (!node.src) break;
          // The inlined bytes when they could be read, the original URL when
          // they could not — so the file is self-contained where possible and
          // no worse than before where it is not.
          const href = embedded.get(node.src) ?? node.src;
          parts.push(
            `<image href="${escapeXml(href)}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" preserveAspectRatio="xMidYMid slice"${rotationTransform(node)} />`
          );
          break;
        }

        case 'sticky': {
          const theme = THEMES[node.theme] ?? THEMES.yellow;
          parts.push(
            `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="${attr(theme.bg)}"${rotationTransform(node)} />`
          );
          if (node.text) {
            parts.push(
              `<text y="${node.y + 16}" font-family="Caveat, cursive" font-size="${num(node.fontSize)}" font-weight="bold" fill="${attr(theme.text)}">${multilineTspans(node.text, node.x + 16, node.fontSize, 1.4)}</text>`
            );
          }
          break;
        }

        case 'audio': {
          // Sound has no static visual form — a labelled placeholder keeps the
          // object present in the export rather than silently dropping it.
          parts.push(
            `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="#F3F4F6" stroke="#D1D5DB" stroke-width="1" />`
          );
          parts.push(
            `<text x="${node.x + 12}" y="${node.y + node.height / 2 + 4}" font-family="Inter" font-size="12" fill="#6B7280">🎤 ${escapeXml(node.author.name)} · ${Math.round(node.durationMs / 1000)}s</text>`
          );
          break;
        }

        case 'frame': {
          parts.push(
            `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${cornerRadiiOf(node.appearance.cornerRadius)[0]}" fill="${defs.fill(node.appearance.fill?.[0], { x: node.x, y: node.y, width: node.width, height: node.height }, '#FFFFFF')}" />`
          );
          break;
        }

        // Comments are collaboration annotations, not document content —
        // deliberately excluded, matching how Figma and Illustrator exclude
        // comment pins from exports.
        case 'connector': {
          parts.push(connectorMarkup(node, state.objects));
          break;
        }

        /**
         * A grid exports as the modules it draws, not as its box.
         *
         * Derived here from the same `gridCellsOf` the canvas renders from, for
         * the reason the connector case gives one branch up: geometry that is a
         * function of the node has to be recomputed by every consumer, or the
         * two answers drift and the export stops matching the board. The box
         * itself is scaffolding and is deliberately not drawn -- nobody wants a
         * grey rectangle behind their composition.
         */
        case 'grid': {
          const style = node.grid.style;
          const cells = gridCellsOf(node);

          cells.forEach((cell) => {
            // The same resolver the canvas renderer calls. It carried its own
            // copy of the display-mode branch until this line, which is how an
            // export and a board come to disagree about what colour a guide is.
            const { fill, stroke, strokeWidth } = cellPaint(cell, style);

            const paint =
              `fill="${attr(fill)}"` +
              (strokeWidth > 0 && stroke ? ` stroke="${attr(stroke)}" stroke-width="${strokeWidth}"` : '');

            // A sector carries its own silhouette; nothing else here can
            // describe it. Rounded by the layout's own rounder, so the file and
            // the canvas cut the same fillet.
            if (cell.outline) {
              const pts = roundPolygon(cell.outline, cell.radius)
                .map((pt) => `${node.x + cell.x + pt.x},${node.y + cell.y + pt.y}`)
                .join(' ');
              parts.push(`<polygon points="${pts}" ${paint} />`);
              return;
            }

            const geo = cellGeometry(cell);
            const outline = shapeOutline({
              geometry: geo as never,
              width: cell.width,
              height: cell.height,
              appearance: { cornerRadius: cell.radius },
            });
            const x = node.x + cell.x;
            const y = node.y + cell.y;
            switch (outline.kind) {
              case 'rect':
                parts.push(`<rect x="${x}" y="${y}" width="${outline.width}" height="${outline.height}" rx="${outline.radius}" ${paint} />`);
                break;
              case 'ellipse':
                parts.push(`<ellipse cx="${x + outline.cx}" cy="${y + outline.cy}" rx="${outline.rx}" ry="${outline.ry}" ${paint} />`);
                break;
              case 'polygon':
                parts.push(`<polygon points="${outline.points.map((p) => `${x + p.x},${y + p.y}`).join(' ')}" ${paint} />`);
                break;
              case 'bezier':
                parts.push(`<path d="${contourData(outline.geometry)}" transform="translate(${x}, ${y})" ${paint} />`);
                break;
              default:
                break;
            }
          });

          /**
           * The track labels, which the export used to leave out entirely --
           * a grid annotated on the board and bare in the file. Drawn from
           * `cellLabel`, so the two agree about which modules are named.
           */
          if (style.showLabels) {
            const ink = labelInk(style);
            cells.forEach((cell) => {
              const label = cellLabel(cell);
              if (label === null) return;
              parts.push(
                `<text x="${node.x + cell.x + LABEL_INSET}" y="${node.y + cell.y + LABEL_INSET + LABEL_SIZE}" ` +
                  `font-family="Inter, sans-serif" font-size="${LABEL_SIZE}" font-weight="600" ` +
                  `fill="${attr(ink)}" fill-opacity="0.85">${escapeXml(label)}</text>`
              );
            });
          }
          break;
        }

        /**
         * A chart, from the same layout the canvas renderer draws.
         *
         * There was no case here for two commits, so a chart exported as
         * *nothing* -- silently, in a format with no way to say so. The
         * layout being shared is what makes this a wrapper rather than a
         * second implementation with its own arithmetic to drift.
         */
        case 'chart': {
          parts.push(
            `<g transform="translate(${node.x} ${node.y})">${chartToSvg(node.chart, node.width, node.height, {
              id: node.id,
              sketch: node.appearance?.sketch,
              sketchSeed: node.appearance?.sketchSeed,
            })}</g>`
          );
          break;
        }

        /** A table, from the same layout `TableRenderer` paints. */
        case 'table': {
          parts.push(
            `<g transform="translate(${node.x} ${node.y})">${tableToSvg(node.table, node.width, node.height, {
              id: node.id,
              sketch: node.appearance?.sketch,
              sketchSeed: node.appearance?.sketchSeed,
            })}</g>`
          );
          break;
        }

        /** Code as real text, one tspan per coloured run. */
        case 'code':
          parts.push(`<g transform="translate(${node.x} ${node.y})">${codeToSvg(node.code, node.width, node.height, node.id)}</g>`);
          break;

        /** A link as its card, and as a link. An embed exports as its poster. */
        case 'link':
          parts.push(`<g transform="translate(${node.x} ${node.y})">${linkToSvg(node.link, node.width, node.height, node.id)}</g>`);
          break;

        /** A library icon: the pack's sanitised paths, and its caption. */
        case 'icon':
          parts.push(`<g transform="translate(${node.x} ${node.y})">${iconToSvg(node, node.width, node.height)}</g>`);
          break;

        case 'comment':
          break;
      }

      emit(node, chunk.filter(Boolean).join(''));
    });

    /**
     * Frame to the actual content, with the caller's own padding.
     *
     * `options.padding` was not passed, so the padding control moved the PNG's
     * crop and left the SVG's alone — the two formats framed the same document
     * differently, which is precisely what sharing `computeContentBounds` was
     * meant to prevent.
     */
    const bounds =
      options.bounds ??
      computeContentBounds(
        state.objects,
        exportIds(options) ?? undefined,
        options.padding
      );

    /**
     * Assembled by `assembleSvg`, which drains the paint collector.
     *
     * The gradient definitions used to be collected here and thrown away — the
     * call to `markup()` existed nowhere in the codebase — so every gradient
     * fill referenced a paint server the file did not contain. Handing the
     * collector to the assembler rather than its output makes that omission
     * impossible to repeat, and the background is resolved through the same
     * `resolveBackground` the raster path uses so the two formats cannot
     * disagree about what "White" means.
     */
    // Uploaded faces travel inside the file; see `text/fontEmbed.ts`.
    const styles = await fontFaceCss(familiesInNodes(nodes), { embedLocal: options.embedLocalFonts });

    return assembleSvg({
      bounds,
      defs,
      background: resolveBackground(options.background, FORMAT_SPECS.svg),
      body: parts,
      styles,
    });
  }
}
