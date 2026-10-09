import type {
  AnyNode, CommentNode, ConnectorNode, FrameNode, PathNode, ShapeNode, TextNode, Typography,
} from '../model/schema';
import { DEFAULT_CONNECTOR_INK, DEFAULT_INK, isOpenShape } from '../model/schema';
import { labelPlated, shapeLabelBox } from '../model/shapes/labelBox';
import { labelInk } from '../model/labelInk';
import { stickyToSvg } from './stickyExport';
import { isEmojiLike } from '../emoji/emojiText';
import { prefetchEmojiSvg } from '../emoji/emojiSvg';
import { STAMP_PLUS_ONE } from '../model/stickyStamps';
import { connectorPoints, ELBOW_RADIUS } from '../model/connector';
import { routeBoard, type BoardRoute } from '../model/connectorRouter/routeBoard';
import { connectorPathData } from '../model/connectorRouter/pathOps';
import { attachLookup, boxLookup } from '../model/connectorTargets';
import { connectorCaps, endCapShape, terminateRun, trimRunForCaps } from '../model/connectorEnds';
import { sketchedCap, sketchedRun } from '../model/connectorSketch';
import {
  LABEL_GAP, arrangeLabels, autoLabelKey, labelCentre, labelFontSize, labelTextWidth, labelsOf,
} from '../model/connectorLabelLayout';
import type { Placed } from '../model/connectorLabels';
import { contrastInk, readableOnSurface } from '../model/color';
import { gridCellsOf } from '../grid/gridNode';
import { roundPolygon } from '../grid/gridLayout';
import { cellGeometry } from '../grid/gridBuild';
import { cellLabel, cellPaint, labelInk as gridLabelInk, LABEL_INSET, LABEL_SIZE } from '../grid/gridStyle';
import { featureStrokeWidth, fillsInterior, shadingStrokeWidth, sketchNib, type SketchLevel } from '../model/rough';
import { boardSketchFor, resolveSketch, type SketchChoice } from '../model/roughMode';
import { roughPencil } from '../model/roughNodes';
import { roughLineCaps, roughShape } from '../model/roughShape';
import { SvgPaintDefs } from './svgPaint';
import { shapeFeaturePaths, shapeOutline } from '../model/shapeOutline';
import { shapeToPath } from '../model/shapeToPath';
import { defaultEndAlign } from '../model/linePath';
import { runPoints } from '../model/lineEnds';
import { lineLabelBox, lineLabelWorld, lineStrokeEnds } from '../model/lineLabel';
import { contourData, translatePath } from '../model/pathGeometry';
import { applyTextCase } from '../model/textCase';
import { layoutText, type TextMeasurer } from '../text/layout';
import { highlightPath } from '../text/highlight';
import { loopPath } from '../model/freehandLoop';
import { canvasFontFamily, konvaFontStyle } from '../../components/canvas/renderers/shared';
import { chartToSvg } from '../chart/chartSvg';
import { chartInkFor } from '../chart/chartInk';
import { isDarkGround, plateFor, textInkOnSurface, wantsLightInk } from '../model/surfaceInk';
import { tableToSvg } from '../table/tableSvg';
import { codeToSvg } from '../code/codeSvg';
import { linkToSvg } from '../link/linkSvg';
import { iconToSvg, preloadIcons } from '../icons/iconSvg';
import { cornerRadiiOf, fitRadii, isPerCorner, roundedRectPath } from '../model/cornerRadii';
import { attr, escapeXml, num } from './markup';
import { dropShadowFilter, innerShadowMarkup, shadowFilterId, shadowRegion, withDropShadow, type ShadowSilhouetteMarkup } from './svgShadow';
import { castsShadow, colorHasAlpha, grownRadii, inkOf, innerShadowInset, needsKnockout } from '../model/dropShadow';
import { commentPin, pinOutline } from './commentPins';
import { abortError } from './abort';

/**
 * A list of document nodes as SVG markup, drawn the way the canvas draws them.
 *
 * Pure of the room: no store, no stage, no window required. The SVG exporter
 * calls it with the live board, and the dashboard's template gallery calls it
 * with nodes a template builds, so the file you export and the picture you
 * pick a template from come from one set of per-type writers. Each writer asks
 * the model for its geometry (`shapeToPath`, `routeBoard`, `layoutText`,
 * `roughShape`…) rather than deriving it, which is what keeps the markup in
 * step with the canvas.
 *
 * What the caller still owns: choosing and ordering the nodes, the document
 * bounds, the backdrop and the `<svg>` wrapper (see `svgDocument.assembleSvg`).
 */

export interface NodesToSvgOptions {
  /**
   * The whole board, for routing connectors and finding their ends. Defaults
   * to the nodes being drawn. Routes are cached per object map, so pass the
   * same map to draw several subsets of one board cheaply.
   */
  objects?: Readonly<Record<string, AnyNode>>;
  /** The board's sketch mode, which reaches some types; `null` for none. */
  boardSketch?: SketchLevel | null;
  /** Draw notes and code on the dark board's paper. */
  dark?: boolean;
  /**
   * The colour labels sit on (connector and line labels take readable ink
   * against it). Defaults to white; a transparent export is laid on white.
   */
  ground?: string | null;
  /** Image `src` → inlined data URL. A source not in the map is referenced as is. */
  images?: ReadonlyMap<string, string>;
  /** Most samples a plotted function is drawn with. */
  maxSamples?: number;
  /** Glyph advances for laying out text. Defaults to a Canvas 2D measure, or an estimate without a DOM. */
  measure?: (t: Typography) => TextMeasurer;
  /** Draw comment pins with their first line. Off unless asked for: comments are conversation, not content. */
  includeComments?: boolean;
  /** Markup to draw in place of particular nodes (text outlined as paths, for one). */
  replace?: ReadonlyMap<string, string>;
  /** Give the main thread back between objects once a slice of work has run. */
  cooperative?: boolean;
  /** Stops the walk between objects; the promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

export interface NodesSvg {
  /** One entry per drawn node, in the order given. */
  body: string[];
  /** The gradients the body refers to; hand to `assembleSvg`, which writes them. */
  defs: SvgPaintDefs;
}

// ---------------------------------------------------------------- measuring

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Canvas 2D advances in the canvas's own font string, or a width estimate where there is no DOM. */
export function canvasMeasurer(t: Typography): TextMeasurer {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      measureCtx = null;
    }
  }
  const ctx = measureCtx;
  if (!ctx) return (text) => (text ? text.length * t.fontSize * 0.55 : 0);
  const font = `${konvaFontStyle(t)} ${t.fontSize}px ${canvasFontFamily(t.fontFamily)}`;
  return (text) => {
    if (!text) return 0;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

// ---------------------------------------------------------------- shared bits

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '');

interface Ctx {
  objects: Readonly<Record<string, AnyNode>>;
  defs: SvgPaintDefs;
  level: (node: AnyNode) => SketchLevel | undefined;
  dark: boolean;
  /** Whether the board behind unframed content is dark. */
  boardDark: boolean;
  ground: string;
  images: ReadonlyMap<string, string> | undefined;
  maxSamples: number | undefined;
  measure: (t: Typography) => TextMeasurer;
}

/**
 * Rotation, scale and shear about the node's centre, composed in Konva's
 * order (rotate, then scale, then shear) because that is where
 * `ObjectRenderer` puts the offset. `scaleX: -1` is how a flip is stored.
 */
export function rotationTransform(node: AnyNode): string {
  const { rotation, skewX, skewY } = node;
  const sx = node.scaleX ?? 1;
  const sy = node.scaleY ?? 1;
  const scaled = sx !== 1 || sy !== 1;
  if (!rotation && !skewX && !skewY && !scaled) return '';
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const ops = [`translate(${num(cx)} ${num(cy)})`];
  if (rotation) ops.push(`rotate(${num(rotation)})`);
  if (scaled) ops.push(`scale(${num(sx)} ${num(sy)})`);
  // The document stores degrees, which is what SVG's skew takes.
  if (skewX) ops.push(`skewX(${num(skewX)})`);
  if (skewY) ops.push(`skewY(${num(skewY)})`);
  ops.push(`translate(${num(-cx)} ${num(-cy)})`);
  return ` transform="${ops.join(' ')}"`;
}

type Stroke = ShapeNode['appearance']['stroke'];

/**
 * The dash pattern and the line cap, written once each.
 *
 * `fallbackCap` applies only when the stroke names no cap of its own, so the
 * element never carries two `stroke-linecap` attributes (which is not
 * well-formed XML; a strict reader rejects the whole file). With no fallback
 * and no cap, a dashed stroke still gets its own cap only when it names one.
 * A dotted pattern is `0 gap`, which a butt cap draws as nothing, so callers
 * drawing dots pass `round`.
 */
export function strokeEnds(stroke: Stroke, fallbackCap?: string): string {
  const dash = stroke?.dash?.length ? ` stroke-dasharray="${stroke.dash.map(num).join(' ')}"` : '';
  const cap = stroke?.cap ?? fallbackCap;
  return `${dash}${cap ? ` stroke-linecap="${attr(cap)}"` : ''}`;
}

/** `stroke-linejoin` and `stroke-miterlimit`, only where they differ from SVG's defaults. */
function joinAttrs(stroke: Stroke): string {
  const join = stroke?.join ? ` stroke-linejoin="${attr(stroke.join)}"` : '';
  const limit = stroke?.miterLimit !== undefined ? ` stroke-miterlimit="${num(stroke.miterLimit)}"` : '';
  return `${join}${limit}`;
}

/** SVG text attributes for a typography block, with the anchor resolved by the caller. */
function textAttrs(t: Typography, color: string): string {
  const deco = [t.underline && 'underline', t.strikethrough && 'line-through'].filter(Boolean).join(' ');
  return [
    `font-family="${escapeXml(canvasFontFamily(t.fontFamily))}"`,
    `font-size="${num(t.fontSize)}"`,
    `font-weight="${attr(t.fontWeight)}"`,
    `font-style="${t.italic ? 'italic' : 'normal'}"`,
    deco ? `text-decoration="${deco}"` : '',
    `fill="${attr(color)}"`,
    t.letterSpacing ? `letter-spacing="${num(t.letterSpacing)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * One end marker (arrow, circle, diamond, bar), for connectors and lines
 * alike. Open markers are a polyline: closing a two-point bar fills nothing.
 */
function capMarkup(cap: ReturnType<typeof endCapShape>, stroke: string, sw: number): string {
  if (!cap) return '';
  if (cap.circle) {
    return `<circle cx="${cap.circle.x.toFixed(2)}" cy="${cap.circle.y.toFixed(2)}" r="${cap.circle.radius.toFixed(2)}" fill="${attr(cap.filled ? stroke : 'none')}" stroke="${attr(stroke)}" stroke-width="${num(sw)}" />`;
  }
  const pts = cap.points ?? [];
  const pairs: string[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i].toFixed(2)},${pts[i + 1].toFixed(2)}`);
  if (pairs.length === 0) return '';
  return cap.filled
    ? `<polygon points="${pairs.join(' ')}" fill="${attr(stroke)}" stroke="${attr(stroke)}" stroke-width="${num(sw)}" stroke-linejoin="round" />`
    : `<polyline points="${pairs.join(' ')}" fill="none" stroke="${attr(stroke)}" stroke-width="${num(sw)}" stroke-linecap="round" />`;
}

/**
 * Text laid out by `layoutText`, the function the canvas lays it out with, so
 * the file breaks lines where the board does. Case transforms are baked into
 * the string: SVG's `text-transform` is applied inconsistently by readers.
 */
function laidOutLines(
  ctx: Ctx,
  text: string,
  t: Typography,
  box: { x: number; y: number; width: number; height?: number },
  wrap: 'none' | 'word',
  color: string,
  ellipsis: boolean,
  extra = ''
): { markup: string; lines: ReturnType<typeof layoutText>['lines'] } {
  const layout = layoutText({
    text: applyTextCase(text, t.textCase),
    list: t.list,
    wrap,
    width: box.width,
    height: box.height,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    paragraphSpacing: t.paragraphSpacing,
    align: t.align,
    verticalAlign: t.verticalAlign,
    ellipsis,
    measure: ctx.measure(t),
  });
  // Alignment is already in each line's x, so every line anchors at its start.
  const attrs = textAttrs(t, color);
  const markup = layout.lines
    .map((line) => `<text x="${num(box.x + line.x)}" y="${num(box.y + line.y + line.baseline)}" ${attrs}${extra}>${escapeXml(line.text)}</text>`)
    .join('');
  return { markup, lines: layout.lines };
}

// ---------------------------------------------------------------- text

/** A text node with its highlight, outline, glow or glyph shadow. */
function textMarkup(node: TextNode, ctx: Ctx): string {
  const t = node.typography;
  const ink = t.highlight?.autoContrast ? contrastInk(t.highlight.color) : textInkOnSurface(t.color, node, ctx.objects, ctx.boardDark);
  const parts: string[] = [];

  let filterRef = '';
  const glyphShadow = node.appearance?.shadow;
  if (t.glow) {
    // `feDropShadow` with no offset is a halo.
    const id = `glow-${safeId(node.id)}`;
    parts.push(
      `<defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="0" dy="0" stdDeviation="${num(t.glow.blur / 2)}" flood-color="${attr(t.glow.color)}" flood-opacity="1" />` +
        `</filter></defs>`
    );
    filterRef = ` filter="url(#${id})"`;
  } else if (castsShadow(glyphShadow)) {
    // The glow takes the shadow's place where both are set, as on the canvas,
    // and the highlight casts none: the words cast onto their highlight.
    const id = shadowFilterId(node.id);
    parts.push(`<defs>${dropShadowFilter(id, glyphShadow, shadowRegion(node, glyphShadow, t.fontSize))}</defs>`);
    filterRef = ` filter="url(#${attr(id)})"`;
  }

  // `paint-order="stroke"` puts the outline under the fill, so its whole
  // weight lands outside the letterforms, as the canvas's two draws do.
  const outline = t.outline
    ? ` stroke="${attr(t.outline.color)}" stroke-width="${num(t.outline.width * 2)}" paint-order="stroke" stroke-linejoin="round"`
    : '';
  const { markup, lines } = laidOutLines(
    ctx,
    node.text,
    { ...t, align: t.align },
    { x: node.x, y: node.y, width: node.width, height: node.resize === 'fixed' ? node.height : undefined },
    node.resize === 'width' ? 'none' : 'word',
    ink,
    node.resize === 'fixed',
    outline
  );

  const rot = rotationTransform(node);
  let highlight = '';
  if (t.highlight && lines.length > 0) {
    const d = highlightPath(lines, t.highlight);
    if (d) highlight = `<path d="${d}" fill="${attr(t.highlight.color)}" transform="translate(${num(node.x)} ${num(node.y)})" />`;
  }
  parts.push(`<g${rot}>${highlight}<g${filterRef}>${markup}</g></g>`);
  return parts.join('');
}

// ---------------------------------------------------------------- shapes

/** A line or an arrow: the run from `runPoints`, trimmed under heads from `terminateRun`. */
function openShapeMarkup(node: ShapeNode): string {
  const stroke = node.appearance.stroke?.color ?? DEFAULT_INK;
  // An unset or zero weight draws at 2, as on the canvas.
  const sw = node.appearance.stroke?.width || 2;
  const run = runPoints(node).map((p) => ({ x: node.x + p.x, y: node.y + p.y }));
  const { run: trimmed, start, end } = terminateRun(run.flatMap((p) => [p.x, p.y]), {
    start: node.geometry.endStart ?? (node.geometry.arrowStart ? 'arrow' : 'none'),
    end: node.geometry.endEnd ?? (node.geometry.arrowEnd ? 'arrow' : 'none'),
    strokeWidth: sw,
    scale: node.geometry.endScale,
    align: node.geometry.endAlign ?? defaultEndAlign(node.geometry.lineProfile),
  });
  const drawn: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < trimmed.length; i += 2) drawn.push({ x: trimmed[i], y: trimmed[i + 1] });

  // Cap and join from `lineStrokeEnds`, the rule the canvas draws by.
  const ends = lineStrokeEnds(node.appearance, node.geometry.lineProfile);
  const dash = node.appearance.stroke?.dash?.length ? ` stroke-dasharray="${node.appearance.stroke.dash.map(num).join(' ')}"` : '';
  const miter =
    ends.join === 'miter' && node.appearance.stroke?.miterLimit !== undefined
      ? ` stroke-miterlimit="${num(node.appearance.stroke.miterLimit)}"`
      : '';
  const strokeAttrs = `stroke="${attr(stroke)}" stroke-width="${num(sw)}" stroke-linecap="${attr(ends.cap)}" stroke-linejoin="${attr(ends.join)}"${miter}${dash}`;
  const body =
    (drawn.length === 2
      ? `<line x1="${drawn[0].x.toFixed(2)}" y1="${drawn[0].y.toFixed(2)}" x2="${drawn[1].x.toFixed(2)}" y2="${drawn[1].y.toFixed(2)}" ${strokeAttrs} />`
      : `<polyline points="${drawn.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="none" ${strokeAttrs} />`) +
    capMarkup(start, stroke, sw) +
    capMarkup(end, stroke, sw);
  const rot = rotationTransform(node);
  return rot ? `<g${rot}>${body}</g>` : body;
}

/** A line's label, centred at its place along the run on a plate of the ground's colour. */
function lineLabelMarkup(node: ShapeNode, ground: string): string {
  const text = node.text ?? '';
  if (!text.trim()) return '';
  const stroke = node.appearance.stroke?.color ?? DEFAULT_INK;
  const box = lineLabelBox(text, node.appearance.stroke?.width || 2);
  const at = lineLabelWorld(node);
  return (
    `<rect x="${num(at.x - box.width / 2)}" y="${num(at.y - box.height / 2)}" width="${num(box.width)}" height="${num(box.height)}" rx="3" fill="${attr(ground)}" />` +
    `<text x="${num(at.x)}" y="${num(at.y)}" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="${num(box.fontSize)}" font-weight="500" fill="${attr(readableOnSurface(stroke, ground))}">${escapeXml(text)}</text>`
  );
}

/** A shape's ink: crisp outline, or the sketch seeded from its id so the strokes are the board's strokes. */
function shapeInk(node: ShapeNode, ctx: Ctx, level: SketchLevel | undefined): string {
  const { x, y, width: w, height: h } = node;
  const fill = node.appearance.fill?.length ? ctx.defs.fill(node.appearance.fill[0], { x, y, width: w, height: h }, 'none') : 'none';
  const stroke = node.appearance.stroke?.color ?? 'none';
  const sw = node.appearance.stroke?.width ?? 0;
  const rot = rotationTransform(node);

  if (level) {
    const fillPaint = node.appearance.fill?.[0];
    const solidFill = fillPaint && fillPaint.type === 'solid' ? fillPaint.color : undefined;
    const open = isOpenShape(node.geometry.kind);
    const sketch = roughShape(node, Boolean(fillPaint) && !open, level);
    const nib = sketchNib(sw);
    const place = ` transform="translate(${num(x)} ${num(y)})"`;
    const fillOpacity = fillPaint?.opacity !== undefined && fillPaint.opacity < 1 ? ` fill-opacity="${num(fillPaint.opacity)}"` : '';
    const parts = [`<g${rot}>`];
    // Only a style that fills its interior paints the silhouette; hachure is lines.
    if (sketch.silhouette && solidFill && fillsInterior(node.appearance.fillStyle)) {
      parts.push(`<path d="${sketch.silhouette}" fill="${attr(solidFill)}"${fillOpacity}${place} />`);
    }
    // A gradient or pattern has no single colour to shade with, so it fills the silhouette.
    if (sketch.silhouette && fillPaint && !solidFill) parts.push(`<path d="${sketch.silhouette}" fill="${attr(fill)}"${place} />`);
    if (sketch.fill && solidFill) {
      parts.push(
        `<path d="${sketch.fill}" fill="none" stroke="${attr(solidFill)}" stroke-width="${num(shadingStrokeWidth(node.appearance.fillStyle, level, nib))}" stroke-linecap="round" stroke-linejoin="round"${fillOpacity}${place} />`
      );
    }
    const ink = stroke === 'none' ? DEFAULT_INK : stroke;
    if (sketch.features) {
      parts.push(`<path d="${sketch.features}" fill="none" stroke="${attr(ink)}" stroke-width="${num(featureStrokeWidth(nib))}" stroke-linecap="round" stroke-linejoin="round"${place} />`);
    }
    for (const cap of roughLineCaps(node, level)) {
      parts.push(`<path d="${cap}" fill="none" stroke="${attr(ink)}" stroke-width="${num(nib)}" stroke-linecap="round" stroke-linejoin="round"${place} />`);
    }
    // The dash survives being sketched: sketch is how the marks are made, dash is whether the line breaks.
    parts.push(
      `<path d="${sketch.outline}" fill="none" stroke="${attr(ink)}" stroke-width="${num(nib)}"${strokeEnds(node.appearance.stroke, 'round')} stroke-linejoin="round"${place} />`
    );
    parts.push('</g>');
    return parts.join('');
  }

  const paint = `fill="${attr(fill)}" stroke="${attr(stroke)}" stroke-width="${num(sw)}"${strokeEnds(node.appearance.stroke)}${joinAttrs(node.appearance.stroke)}`;
  switch (node.geometry.kind) {
    case 'rect':
      // `<rect rx>` has one radius for all four corners; independent corners need a path.
      if (isPerCorner(node.appearance.cornerRadius)) {
        return `<path d="${roundedRectPath(x, y, w, h, fitRadii(cornerRadiiOf(node.appearance.cornerRadius), w, h))}" ${paint}${rot} />`;
      }
      // Fitted, so a radius past half the short side stays a circular corner,
      // as the canvas draws it. SVG would clamp `rx` and `ry` separately and
      // draw an elliptical one.
      return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(fitRadii(cornerRadiiOf(node.appearance.cornerRadius), w, h)[0])}" ${paint}${rot} />`;
    case 'ellipse':
      return `<ellipse cx="${num(x + w / 2)}" cy="${num(y + h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}" ${paint}${rot} />`;
    case 'line':
    case 'arrow':
      return openShapeMarkup(node);
    default: {
      // Every other kind (polygons, stars, the flowchart and advanced library)
      // is the outline the renderer draws, plus its interior feature lines.
      const d = contourData(translatePath(shapeToPath(node), x, y));
      const features = shapeFeaturePaths(node, x, y)
        .map((f) => `<path d="${f}" fill="none" stroke="${attr(stroke)}" stroke-width="${num(sw)}"${strokeEnds(node.appearance.stroke)} />`)
        .join('');
      if (!features) return `<path d="${d}" fill-rule="evenodd" ${paint}${rot} />`;
      return `<g${rot}><path d="${d}" fill-rule="evenodd" ${paint} />${features}</g>`;
    }
  }
}

/**
 * A crisp rectangle's or ellipse's outline grown by `grow` on every side, as
 * path data in board units before the node's transform; null for any other
 * kind. A rounded corner grows to `radius + grow` and a square one stays
 * square, which is what the canvas's mitred spread draws.
 */
function grownOutline(node: ShapeNode, grow: number): string | null {
  const { x, y, width: w, height: h } = node;
  if (node.geometry.kind === 'rect') {
    const radii = grownRadii(fitRadii(cornerRadiiOf(node.appearance.cornerRadius), w, h), w, h, grow);
    return roundedRectPath(x - grow, y - grow, Math.max(0, w + grow * 2), Math.max(0, h + grow * 2), radii);
  }
  if (node.geometry.kind === 'ellipse') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = Math.max(0, w / 2 + grow);
    const ry = Math.max(0, h / 2 + grow);
    return `M ${num(cx - rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(cx + rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(cx - rx)} ${num(cy)} Z`;
  }
  return null;
}

/** How far a shape's stroke reaches past its outline: half a centred stroke, all of an outside one. */
function strokeOutset(node: ShapeNode): number {
  const s = node.appearance.stroke;
  if (!s || !s.color || s.color === 'transparent' || !(s.width > 0)) return 0;
  const align = s.align ?? 'center';
  return align === 'inside' ? 0 : align === 'outside' ? s.width : s.width / 2;
}

/** A shape: its ink with the inner and drop shadows `ShapeRenderer` draws, then its label. */
function shapeMarkup(node: ShapeNode, ctx: Ctx): string {
  const level = ctx.level(node);
  const open = isOpenShape(node.geometry.kind);
  let ink = shapeInk(node, ctx, level);
  // The inner shadow, over the fill and off the stroke, for a crisp closed shape.
  if (!level && !open && castsShadow(node.appearance?.innerShadow)) {
    const kind = node.geometry.kind;
    const hole = contourData(translatePath(shapeToPath(node), node.x, node.y));
    const s = node.appearance.stroke;
    const stroked = Boolean(s?.color && s.color !== 'transparent' && s.width > 0);
    ink += innerShadowMarkup(node, hole, {
      transform: rotationTransform(node),
      inset: innerShadowInset(s, stroked),
      rule: kind === 'rect' || kind === 'ellipse' ? 'nonzero' : 'evenodd',
    });
  }
  const shadow = node.appearance?.shadow;
  if (castsShadow(shadow)) {
    const read = inkOf(node.appearance, { absentFill: !level, stroked: open || undefined });
    // A run has no interior, whatever fill it happens to carry.
    const used = open ? { ...read, filled: false, fillOpaque: false } : read;
    const shaded = !open && level && !fillsInterior(node.appearance?.fillStyle);
    // A filled crisp box or ellipse with spread casts from its grown outline,
    // so a rounded corner grows round rather than by a square morphology.
    let silhouette: ShadowSilhouetteMarkup | undefined;
    if (!level && !open && read.filled && (shadow.spread ?? 0) !== 0) {
      const outset = strokeOutset(node);
      const d = grownOutline(node, outset + (shadow.spread ?? 0));
      const hole = grownOutline(node, outset);
      if (d && hole) silhouette = { d, hole, transform: rotationTransform(node) };
    }
    ink = withDropShadow(node, ink, {
      knockout: needsKnockout(shaded ? { ...used, fillOpaque: false } : used),
      inkPad: (node.appearance.stroke?.width ?? 0) * 6 + 16,
      silhouette,
    });
  }
  if (open) return ink + lineLabelMarkup(node, plateFor(node, ctx.objects, ctx.ground));
  if (!node.text?.trim() || !node.typography) return ink;

  // Laid out in the label box the canvas lays it out in, in the ink the canvas
  // derives from the fill (`labelInk`), turning with the shape.
  const lb = shapeLabelBox(node);
  const fillPaint = labelPlated(node.geometry.kind) ? node.appearance.fill?.[0] : undefined;
  const plate =
    fillPaint && fillPaint.type === 'solid'
      ? `<rect x="${num(node.x + lb.x)}" y="${num(node.y + lb.y)}" width="${num(lb.width)}" height="${num(lb.height)}" rx="${num(Math.min(lb.width, lb.height) * 0.2)}" fill="${attr(fillPaint.color)}" />`
      : '';
  const { markup } = laidOutLines(
    ctx,
    node.text,
    { ...node.typography, verticalAlign: node.typography.verticalAlign ?? 'middle' },
    { x: node.x + lb.x, y: node.y + lb.y, width: lb.width, height: lb.height },
    'word',
    labelInk(node) ?? node.typography.color,
    true
  );
  const rot = rotationTransform(node);
  return `${ink}${rot ? `<g${rot}>${plate}${markup}</g>` : plate + markup}`;
}

// ---------------------------------------------------------------- paths

/** A pen path or a freehand stroke, with one drop shadow for its interior and ink together. */
function pathMarkup(node: PathNode, ctx: Ctx): string {
  const stroke = node.appearance.stroke?.color;
  const sw = node.appearance.stroke?.width ?? 2;
  const fill = node.appearance.fill?.length
    ? ctx.defs.fill(node.appearance.fill[0], { x: node.x, y: node.y, width: node.width, height: node.height }, 'none')
    : undefined;
  const parts: string[] = [];
  if (node.geometry.kind !== 'freehand') {
    // Several contours need even-odd to read the inner ones as holes.
    const rule = node.geometry.kind === 'compound' ? ' fill-rule="evenodd"' : '';
    const join = node.appearance.stroke?.join ? joinAttrs(node.appearance.stroke) : ' stroke-linejoin="round"';
    parts.push(
      `<path d="${contourData(translatePath(node.geometry, node.x, node.y))}" fill="${attr(fill && fill !== 'transparent' ? fill : 'none')}"${rule} stroke="${attr(stroke ?? 'none')}" stroke-width="${num(sw)}"${strokeEnds(node.appearance.stroke, 'round')}${join} />`
    );
  } else if (node.geometry.svgPath) {
    // Ink from `stroke`, interior from `fill`; the enclosed area exists only
    // for a stroke that came back to where it started, and is drawn first.
    const ink = stroke ?? DEFAULT_INK;
    const place = ` transform="translate(${num(node.x)}, ${num(node.y)})"`;
    if (node.geometry.closed && node.geometry.points.length > 2 && fill && fill !== 'transparent') {
      parts.push(`<path d="${loopPath(node.geometry.points)}" fill="${attr(fill)}"${place} />`);
    }
    // Only a level the stroke pins reaches a pencil stroke; the board's mode leaves its taper alone.
    const pencil =
      node.appearance.sketch && node.geometry.points.length > 1
        ? roughPencil({ id: node.id, appearance: node.appearance, geometry: node.geometry }, node.appearance.sketch)
        : null;
    parts.push(
      pencil
        ? `<path d="${pencil.d}" fill="none" stroke="${attr(ink)}" stroke-width="${num(pencil.nib)}" stroke-linecap="round" stroke-linejoin="round"${place} />`
        : `<path d="${attr(node.geometry.svgPath)}" fill="${attr(ink)}"${place} />`
    );
  }
  if (parts.length === 0) return '';
  const rot = rotationTransform(node);
  return withDropShadow(node, rot ? `<g${rot}>${parts.join('')}</g>` : parts.join(''), {
    knockout: needsKnockout(inkOf(node.appearance, { absentFill: false, stroked: true })),
    inkPad: sw + (node.geometry.kind === 'freehand' ? node.geometry.strokeSize : 0),
  });
}

// ---------------------------------------------------------------- connectors

/** Jump size and clearance, matching the canvas at 100%. */
const HOP_RADIUS = 6;
const HOP_CLEARANCE = 8;

interface Routing {
  routes: Map<string, BoardRoute>;
  slots: Map<string, Placed>;
}

const routingCache = new WeakMap<object, Routing>();

/**
 * The canvas's routing (avoidance, channel spreading, jumps) and label
 * arrangement, run once per object map from the same snapshot.
 */
function routingFor(objects: Readonly<Record<string, AnyNode>>): Routing {
  let found = routingCache.get(objects);
  if (!found) {
    const map = objects as Record<string, AnyNode>;
    const routes = routeBoard(map, { boxOf: boxLookup(map), attachOf: attachLookup(map) });
    const drawn: Array<{ node: ConnectorNode; flat: number[] }> = [];
    for (const [id, route] of routes) {
      const node = map[id] as ConnectorNode | undefined;
      if (node) drawn.push({ node, flat: route.points.flatMap((p) => [p.x, p.y]) });
    }
    found = { routes, slots: arrangeLabels(drawn) };
    routingCache.set(objects, found);
  }
  return found;
}

/**
 * A connector: the board's route, trimmed under its markers, elbows and jumps
 * from `connectorPathData` (or the seeded sketch), labels cutting holes in the
 * line through a mask as the canvas cuts them with a clip.
 */
function connectorMarkup(node: ConnectorNode, ctx: Ctx): string {
  const map = ctx.objects as Record<string, AnyNode>;
  const { routes, slots } = routingFor(ctx.objects);
  const route = routes.get(node.id);
  const world = route
    ? route.points.flatMap((p) => [p.x, p.y])
    : connectorPoints(node.from, node.to, node.routing, boxLookup(map), attachLookup(map));
  if (world.length < 4) return '';

  const strokeValue = node.appearance?.stroke?.color;
  const stroke = strokeValue && strokeValue !== 'transparent' ? strokeValue : DEFAULT_CONNECTOR_INK;
  const width = node.appearance?.stroke?.width || 2;
  const dashed = (node.appearance?.stroke?.dash?.length ?? 0) > 0;
  const curved = route ? route.curved : node.routing === 'curved';
  const orthogonal = route ? route.orthogonal : false;
  const level = ctx.level(node);

  const caps = connectorCaps(world, { start: node.endStart ?? 'none', end: node.endEnd ?? 'none', strokeWidth: width, scale: node.endScale });
  const trimmed = trimRunForCaps(world, curved ? [] : route?.hops ?? [], caps.start?.inset ?? 0, caps.end?.inset ?? 0);
  const run: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < trimmed.flat.length; i += 2) run.push({ x: trimmed.flat[i], y: trimmed.flat[i + 1] });

  const sketch = level ? { id: node.id, sketchSeed: node.appearance?.sketchSeed, level, width, curved, dashed } : null;
  const d = sketch
    ? sketchedRun(run, sketch)
    : connectorPathData(run, {
        cornerRadius: orthogonal ? node.cornerRadius ?? ELBOW_RADIUS : 0,
        hops: trimmed.hops,
        hopRadius: HOP_RADIUS,
        hopClearance: HOP_CLEARANCE,
      });

  const fontSize = labelFontSize(width);
  const ink = readableOnSurface(stroke, plateFor(node, ctx.objects, ctx.ground));
  const placed = labelsOf(node)
    .filter((l) => l.text.trim())
    .map((l) => {
      const at = labelCentre(l, world, l.t === undefined ? slots.get(autoLabelKey(node.id, l.id)) : null);
      return { text: l.text, x: at.x, y: at.y, w: labelTextWidth(l.text, fontSize) + 6, h: fontSize + 6 };
    });

  let mask = '';
  let maskRef = '';
  if (placed.length > 0) {
    const id = `cl-${safeId(node.id)}`;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < world.length; i += 2) {
      minX = Math.min(minX, world[i]); maxX = Math.max(maxX, world[i]);
      minY = Math.min(minY, world[i + 1]); maxY = Math.max(maxY, world[i + 1]);
    }
    const pad = 64;
    const box = `x="${num(minX - pad)}" y="${num(minY - pad)}" width="${num(maxX - minX + pad * 2)}" height="${num(maxY - minY + pad * 2)}"`;
    const holes = placed
      .map((p) => `<rect x="${num(p.x - p.w / 2 - LABEL_GAP)}" y="${num(p.y - p.h / 2 - LABEL_GAP)}" width="${num(p.w + LABEL_GAP * 2)}" height="${num(p.h + LABEL_GAP * 2)}" fill="black" />`)
      .join('');
    mask = `<mask id="${id}" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="white" />${holes}</mask>`;
    maskRef = ` mask="url(#${id})"`;
  }
  const labels = placed
    .map((p) => `<text x="${num(p.x)}" y="${num(p.y)}" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="${num(fontSize)}" font-weight="500" fill="${attr(ink)}">${escapeXml(p.text)}</text>`)
    .join('');

  const capPart = (cap: typeof caps.start, key: 'start' | 'end') => {
    const rough = sketch ? sketchedCap(cap, key, caps.size, sketch) : null;
    if (rough && cap) {
      return `<path d="${rough}" fill="${attr(cap.filled ? stroke : 'none')}" stroke="${attr(stroke)}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round" />`;
    }
    return capMarkup(cap, stroke, width);
  };

  // The line and its markers cast one shadow; the labels cast none.
  const line =
    `<path d="${d}" fill="none" stroke="${attr(stroke)}" stroke-width="${num(width)}"${strokeEnds(node.appearance?.stroke, 'round')} stroke-linejoin="round"${maskRef} />` +
    capPart(caps.start, 'start') +
    capPart(caps.end, 'end');
  return mask + withDropShadow(node, line, { knockout: colorHasAlpha(stroke), inkPad: width * 2 + caps.size + 8 }) + labels;
}

// ---------------------------------------------------------------- grids, frames, comments

/** A grid as the modules it draws, from `gridCellsOf`, and its track labels. The box itself is scaffolding. */
function gridMarkup(node: Extract<AnyNode, { type: 'grid' }>): string {
  const style = node.grid.style;
  const cells = gridCellsOf(node);
  const parts: string[] = [];
  for (const cell of cells) {
    const { fill, stroke, strokeWidth } = cellPaint(cell, style);
    const paint = `fill="${attr(fill)}"` + (strokeWidth > 0 && stroke ? ` stroke="${attr(stroke)}" stroke-width="${num(strokeWidth)}"` : '');
    if (cell.outline) {
      const pts = roundPolygon(cell.outline, cell.radius).map((pt) => `${num(node.x + cell.x + pt.x)},${num(node.y + cell.y + pt.y)}`).join(' ');
      parts.push(`<polygon points="${pts}" ${paint} />`);
      continue;
    }
    const outline = shapeOutline({
      geometry: cellGeometry(cell) as never,
      width: cell.width,
      height: cell.height,
      appearance: { cornerRadius: cell.radius },
    });
    const x = node.x + cell.x;
    const y = node.y + cell.y;
    if (outline.kind === 'rect') parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(outline.width)}" height="${num(outline.height)}" rx="${num(outline.radius)}" ${paint} />`);
    else if (outline.kind === 'ellipse') parts.push(`<ellipse cx="${num(x + outline.cx)}" cy="${num(y + outline.cy)}" rx="${num(outline.rx)}" ry="${num(outline.ry)}" ${paint} />`);
    else if (outline.kind === 'polygon') parts.push(`<polygon points="${outline.points.map((p) => `${num(x + p.x)},${num(y + p.y)}`).join(' ')}" ${paint} />`);
    else if (outline.kind === 'bezier') parts.push(`<path d="${contourData(outline.geometry)}" transform="translate(${num(x)}, ${num(y)})" ${paint} />`);
  }
  if (style.showLabels) {
    const ink = gridLabelInk(style);
    for (const cell of cells) {
      const label = cellLabel(cell);
      if (label === null) continue;
      parts.push(
        `<text x="${num(node.x + cell.x + LABEL_INSET)}" y="${num(node.y + cell.y + LABEL_INSET + LABEL_SIZE)}" font-family="Inter, sans-serif" font-size="${LABEL_SIZE}" font-weight="600" fill="${attr(ink)}" fill-opacity="0.85">${escapeXml(label)}</text>`
      );
    }
  }
  return parts.join('');
}

/**
 * A frame's page as `FrameRenderer` draws it: its fill (white unless it has
 * none), the hairline edge, and a diagram frame's name inside its top-left.
 * The frame's own name above it is screen chrome and is not part of the work.
 */
function frameMarkup(node: FrameNode, ctx: Ctx): string {
  const hasFill = node.appearance?.fill === undefined || node.appearance.fill.length > 0;
  const box = { x: node.x, y: node.y, width: node.width, height: node.height };
  const fill = hasFill ? ctx.defs.fill(node.appearance?.fill?.[0], box, '#FFFFFF') : 'none';
  const stroke = node.appearance?.stroke;
  const diagram = Boolean((node as unknown as Record<string, unknown>).diagramId);
  const radius = node.appearance?.cornerRadius !== undefined ? cornerRadiiOf(node.appearance.cornerRadius)[0] : diagram ? 8 : 0;
  const edge = stroke?.color ?? (hasFill ? 'rgba(115,115,115,0.22)' : 'rgba(115,115,115,0.45)');
  const dash = stroke?.dash?.length ? ` stroke-dasharray="${stroke.dash.map(num).join(' ')}"` : '';
  let out = `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" rx="${num(radius)}" fill="${attr(fill)}" stroke="${attr(edge)}" stroke-width="${num(stroke?.width ?? 1)}"${dash} />`;
  if (diagram && node.title) {
    out += `<text x="${num(node.x + 12)}" y="${num(node.y + 12 + 11)}" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="${attr(stroke?.color ?? '#374151')}">${escapeXml(node.title)}</text>`;
  }
  return out;
}

/** A comment as its pin (see `commentPins`). */
function commentMarkup(node: CommentNode): string {
  const pin = commentPin(node);
  const cy = pin.y + pin.height / 2;
  return (
    `<g${pin.resolved ? ' opacity="0.55"' : ''}>` +
    `<path d="${pinOutline(pin)}" fill="#FFFFFF" stroke="rgba(15,23,42,0.16)" stroke-width="1" />` +
    `<circle cx="${num(pin.x + 14)}" cy="${num(cy)}" r="11" fill="${attr(pin.colour)}" />` +
    `<text x="${num(pin.x + 14)}" y="${num(cy)}" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="${attr(pin.initialInk)}">${escapeXml(pin.initial)}</text>` +
    `<text x="${num(pin.x + 32)}" y="${num(cy)}" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="11.5" font-weight="500" fill="#18181B">${escapeXml(pin.words)}</text>` +
    `</g>`
  );
}

// ---------------------------------------------------------------- the walk

/** Every emoji stamped on a sticky among these nodes, for one artwork prefetch. */
function stickyStampsOf(nodes: readonly AnyNode[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.type !== 'sticky') continue;
    for (const [key, ids] of Object.entries(n.reactions ?? {})) {
      if (ids.length > 0 && key !== STAMP_PLUS_ONE && isEmojiLike(key)) out.add(key);
    }
  }
  return [...out];
}

const SLICE_MS = 12;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));


/** Wrap a translate-placed writer's output in the node's own rotation. */
function placed(node: AnyNode, inner: string): string {
  const rot = rotationTransform(node);
  const body = `<g transform="translate(${num(node.x)} ${num(node.y)})">${inner}</g>`;
  return rot ? `<g${rot}>${body}</g>` : body;
}

/** One node's markup, before its opacity. */
function nodeMarkup(node: AnyNode, ctx: Ctx): string {
  switch (node.type) {
    case 'shape':
      return shapeMarkup(node, ctx);
    case 'text':
      return textMarkup(node, ctx);
    case 'path':
      return pathMarkup(node, ctx);
    case 'image': {
      if (!node.src) return '';
      // The inlined bytes when they could be read, else the original reference.
      const href = ctx.images?.get(node.src) ?? node.src;
      // Rounded corners clip the picture, and so the shadow it casts, as on the canvas.
      const radii = fitRadii(cornerRadiiOf(node.appearance?.cornerRadius), node.width, node.height);
      const clipId = `ic-${safeId(node.id)}`;
      const clip = radii.some((r) => r > 0)
        ? `<defs><clipPath id="${clipId}"><path d="${roundedRectPath(node.x, node.y, node.width, node.height, radii)}" /></clipPath></defs>`
        : '';
      return withDropShadow(
        node,
        `${clip}<image href="${escapeXml(href)}" x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" preserveAspectRatio="xMidYMid slice"${clip ? ` clip-path="url(#${clipId})"` : ''}${rotationTransform(node)} />`
      );
    }
    case 'sticky':
      return stickyToSvg(node, { sketch: ctx.level(node), darkBoard: ctx.dark, transform: rotationTransform(node) });
    case 'audio':
      // Sound has no still form; a labelled placeholder keeps it present.
      return (
        `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" rx="8" fill="#F3F4F6" stroke="#D1D5DB" stroke-width="1" />` +
        `<text x="${num(node.x + 12)}" y="${num(node.y + node.height / 2 + 4)}" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#6B7280">${escapeXml(`${node.author?.name ?? 'Voice note'} · ${Math.round((node.durationMs ?? 0) / 1000)}s`)}</text>`
      );
    case 'frame':
      return frameMarkup(node, ctx);
    case 'connector':
      return connectorMarkup(node, ctx);
    case 'grid':
      return gridMarkup(node);
    case 'chart': {
      const spec = ctx.maxSamples && (node.chart.samples ?? 0) > ctx.maxSamples ? { ...node.chart, samples: ctx.maxSamples } : node.chart;
      return placed(node, chartToSvg(spec, node.width, node.height, { id: node.id, sketch: ctx.level(node), sketchSeed: node.appearance?.sketchSeed, ink: chartInkFor(wantsLightInk(node, ctx.objects, ctx.boardDark)) }));
    }
    case 'table':
      return placed(node, tableToSvg(node.table, node.width, node.height, { id: node.id, sketch: ctx.level(node), sketchSeed: node.appearance?.sketchSeed }));
    case 'code':
      return placed(node, codeToSvg(node.code, node.width, node.height, node.id, ctx.dark));
    case 'link':
      return placed(node, linkToSvg(node.link, node.width, node.height, node.id));
    case 'icon':
      return placed(node, iconToSvg(node, node.width, node.height));
    default:
      return '';
  }
}

/**
 * Draw these nodes, in the order given (callers sort by `compareStacking`).
 *
 * Async for the artwork read from elsewhere (icon-pack glyphs and emoji
 * stamps, prefetched once; a failure draws a placeholder) and for the
 * cooperative yield. Everything else is synchronous and deterministic.
 */
export async function nodesToSvg(nodes: readonly AnyNode[], options: NodesToSvgOptions = {}): Promise<NodesSvg> {
  const objects = options.objects ?? Object.fromEntries(nodes.map((n) => [n.id, n]));
  const stamps = stickyStampsOf(nodes);
  await Promise.all([
    preloadIcons(nodes as AnyNode[]).catch(() => undefined),
    stamps.length ? prefetchEmojiSvg(stamps).catch(() => undefined) : Promise.resolve(),
  ]);

  const board = options.boardSketch ?? null;
  const ctx: Ctx = {
    objects,
    defs: new SvgPaintDefs(),
    level: (node) => resolveSketch((node as { appearance?: SketchChoice }).appearance, boardSketchFor(node.type, board)),
    dark: Boolean(options.dark),
    boardDark: options.ground ? isDarkGround(options.ground) : Boolean(options.dark),
    ground: options.ground || '#FFFFFF',
    images: options.images,
    maxSamples: options.maxSamples,
    measure: options.measure ?? canvasMeasurer,
  };

  const body: string[] = [];
  const pins: string[] = [];
  let slice = now();
  for (const node of nodes) {
    if (options.signal?.aborted) throw abortError();
    if (options.cooperative && now() - slice > SLICE_MS) {
      await yieldToMain();
      slice = now();
      if (options.signal?.aborted) throw abortError();
    }
    if (node.hidden) continue;
    // Pins sit over the work, whatever their place in the stack.
    if (node.type === 'comment') {
      if (options.includeComments) pins.push(commentMarkup(node));
      continue;
    }
    const markup = options.replace?.get(node.id) ?? nodeMarkup(node, ctx);
    if (!markup) continue;
    // Opacity once, round everything the node draws, label included.
    const opacity = node.opacity ?? 1;
    body.push(opacity >= 1 ? markup : `<g opacity="${num(opacity)}">${markup}</g>`);
  }
  return { body: [...body, ...pins], defs: ctx.defs };
}
