import type { Exporter, ExportOptions, ExportFormat } from './ExportTypes';
import { useStore } from '../../hooks/useStore';
import { computeContentBounds } from './bounds';
import { THEMES } from '../../components/canvas/renderers/StickyRenderer';
import type { AnyNode, ConnectorNode, PathNode, ShapeNode, TextNode, Typography } from '../model/schema';
import { connectorPoints, type Box } from '../model/connector';
import { roughPolyline, seedFrom } from '../model/rough';
import { SvgPaintDefs } from './svgPaint';
import { pointsAttribute, regularPolygonPoints, starPoints } from '../model/shapeOutline';
import { shapeToPath } from '../model/shapeToPath';
import { pathData } from '../model/pathGeometry';
import { contourData, translatePath } from '../model/pathGeometry';
import { applyTextCase } from '../model/textCase';
import { contrastInk } from '../model/color';
import { layoutText } from '../text/layout';
import { measurerFor } from '../text/measure';
import { highlightPath } from '../text/highlight';
import { roughShape } from '../model/roughShape';
import { ARROW_HEAD_SCALE, DEFAULT_INK } from '../model/schema';

/**
 * Embedding raw user text into an SVG without escaping is an XML-corruption
 * bug — a name or note containing `&`, `<`, `>` or a quote produced a
 * malformed, unopenable file.
 */
function escapeXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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
    `font-family="${escapeXml(t.fontFamily)}"`,
    `font-size="${t.fontSize}"`,
    `font-weight="${t.fontWeight}"`,
    `font-style="${t.italic ? 'italic' : 'normal'}"`,
    // Both at once when both are set — SVG takes a space-separated list, the
    // same as Canvas2D, which is why the model keeps them as two flags.
    textDecoration(t) ? `text-decoration="${textDecoration(t)}"` : '',
    `fill="${t.color}"`,
    `text-anchor="${anchor}"`,
    t.letterSpacing ? `letter-spacing="${t.letterSpacing}"` : '',
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
        `<path d="${d}" fill="${t.highlight.color}" transform="translate(${node.x} ${node.y})" />`
      );
    }
  }

  // `feDropShadow` with no offset is a halo, and it is one element rather than
  // the blur/flood/merge chain the same effect needs spelled out by hand.
  let filterRef = '';
  if (t.glow) {
    const id = `glow-${node.id}`;
    parts.push(
      `<defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="0" dy="0" stdDeviation="${t.glow.blur / 2}" flood-color="${t.glow.color}" flood-opacity="1" />` +
        `</filter></defs>`
    );
    filterRef = ` filter="url(#${id})"`;
  }

  // Alignment is already resolved into each line's x, so the anchor is always
  // `start` here — re-applying it would shift every line a second time.
  const attrs = textAttrs({ ...t, align: 'left', color: ink });
  // `paint-order="stroke"` is SVG's own answer to the problem the canvas
  // solves with two draws: it puts the stroke under the fill, so the whole
  // weight lands outside the letterforms instead of eating into them.
  const outline = t.outline
    ? ` stroke="${t.outline.color}" stroke-width="${t.outline.width * 2}" paint-order="stroke" stroke-linejoin="round"`
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
 * A connector as SVG.
 *
 * **This case did not exist.** The exporter's switch handled every other type
 * and simply fell through for `connector`, so every arrow in a flowchart was
 * silently dropped from the file — the boxes exported, the lines joining them
 * did not, and the result was a diagram with its meaning removed. PNG never
 * showed it because that path captures the stage rather than walking the
 * document.
 *
 * The route is recomputed here from the same `connectorPoints` the renderer
 * uses, rather than read off the node: a connector's geometry is *derived*, so
 * there is nothing stored to serialize. Passing the same `boxOf` means the
 * arrow in the file takes the same path as the arrow on the board.
 */
function connectorMarkup(node: ConnectorNode, objects: Record<string, AnyNode>): string {
  const boxOf = (id: string): Box | null => {
    const n = objects[id];
    return n ? { x: n.x, y: n.y, width: n.width, height: n.height } : null;
  };
  const world = connectorPoints(node.from, node.to, node.routing, boxOf);
  if (world.length < 4) return '';

  const stroke = node.appearance?.stroke?.color ?? '#64748B';
  const width = node.appearance?.stroke?.width ?? 2;
  const dash = dashAttrs(node.appearance?.stroke);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < world.length; i += 2) pts.push({ x: world[i], y: world[i + 1] });

  // Sketched connectors export as the sketch, seeded identically to the canvas
  // so the strokes in the file are the same strokes. The geometry is generated
  // in node-local space by the renderer, so it is generated in world space here
  // and needs no transform.
  const d = node.appearance?.sketch
    ? roughPolyline(pts, { seed: seedFrom(node.id), closed: false, level: node.appearance.sketch })
    : `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`;

  // End caps are deliberately omitted rather than approximated. `endCapShape`
  // builds them in the renderer's local frame with a per-cap inset that trims
  // the run underneath them, and reproducing half of that here would export
  // arrowheads that sit slightly wrong on every line. A line without its head
  // is honestly incomplete; a head in the wrong place looks like a bug.
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash} stroke-linecap="round" stroke-linejoin="round" />`;
}

function rotationTransform(node: AnyNode): string {
  const { rotation, skewX, skewY } = node;
  if (!rotation && !skewX && !skewY) return '';
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const ops = [`translate(${cx} ${cy})`];
  if (rotation) ops.push(`rotate(${rotation})`);
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
  const cap = stroke.cap ? ` stroke-linecap="${stroke.cap}"` : '';
  return ` stroke-dasharray="${stroke.dash.join(' ')}"${cap}`;
}

/**
 * `stroke-linejoin` and `stroke-miterlimit`, or an empty string.
 *
 * Both are stored only when they differ from the default, and SVG's defaults
 * are the same two values — `miter` and 10 — so an untouched stroke emits
 * nothing and the file stays as small as the document is.
 */
function joinAttrs(stroke: ShapeNode['appearance']['stroke']): string {
  const join = stroke?.join ? ` stroke-linejoin="${stroke.join}"` : '';
  const limit = stroke?.miterLimit !== undefined ? ` stroke-miterlimit="${stroke.miterLimit}"` : '';
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
  const x1 = node.x;
  const y1 = node.y;
  const x2 = node.x + node.width;
  const y2 = node.y + node.height;

  const parts = [
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${dashAttrs(node.appearance.stroke)} />`,
  ];

  const head = Math.max(6, sw * ARROW_HEAD_SCALE);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const arrowHead = (tipX: number, tipY: number, facing: number) => {
    const wing = (offset: number) => ({
      x: tipX - head * Math.cos(facing + offset),
      y: tipY - head * Math.sin(facing + offset),
    });
    const a = wing(Math.PI / 7);
    const b = wing(-Math.PI / 7);
    return `<polygon points="${tipX},${tipY} ${a.x},${a.y} ${b.x},${b.y}" fill="${stroke}" />`;
  };

  if (node.geometry.arrowEnd) parts.push(arrowHead(x2, y2, angle));
  if (node.geometry.arrowStart) parts.push(arrowHead(x1, y1, angle + Math.PI));

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
    if (sketch.silhouette && solidFill) {
      parts.push(`<path d="${sketch.silhouette}" fill="${solidFill}"${place} />`);
    }
    if (sketch.fill && solidFill) {
      parts.push(
        `<path d="${sketch.fill}" fill="none" stroke="${solidFill}" stroke-width="${Math.max(0.8, nib * 0.7)}" stroke-linecap="round"${place} />`
      );
    }
    parts.push(
      `<path d="${sketch.outline}" fill="none" stroke="${stroke === 'none' ? DEFAULT_INK : stroke}" stroke-width="${nib}" stroke-linecap="round" stroke-linejoin="round"${place} />`
    );
    parts.push('</g>');
    return parts.join('');
  }
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dashAttrs(node.appearance.stroke)}${joinAttrs(node.appearance.stroke)}`;

  switch (node.geometry.kind) {
    case 'rect':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${node.appearance.cornerRadius ?? 0}" ${paint}${rot} />`;
    case 'ellipse':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${paint}${rot} />`;
    case 'heart':
      // Through `shapeToPath`, which is what the canvas draws from, so an
      // exported heart cannot be a second, hand-written approximation of the
      // one on screen — the failure this file's own header describes.
      return `<path d="${pathData(shapeToPath(node))}" ${paint}${rot} />`;

    case 'star':
      return `<polygon points="${pointsAttribute(starPoints(cx, cy, node.geometry.points ?? 5, node.geometry.innerRatio ?? 0.5, w / 2, h / 2))}" ${paint}${rot} />`;
    case 'line':
    case 'arrow':
      return openShapeMarkup(node);
    case 'polygon':
    default:
      return `<polygon points="${pointsAttribute(regularPolygonPoints(cx, cy, node.geometry.points ?? 3, w / 2, h / 2))}" ${paint}${rot} />`;
  }
}

export class SVGExporter implements Exporter {
  type: ExportFormat = 'svg';

  async export(options: ExportOptions): Promise<string> {
    const state = useStore.getState();
    let nodes = Object.values(state.objects);

    if (options.selectedOnly && options.selectedIds?.length) {
      const ids = new Set(options.selectedIds);
      nodes = nodes.filter((n) => ids.has(n.id));
    }

    // Draw in stacking order so the export matches what is on screen.
    nodes = nodes.filter((n) => !n.hidden).sort((a, b) => a.zIndex - b.zIndex);

    const parts: string[] = [];
    const defs = new SvgPaintDefs();

    nodes.forEach((node) => {
      switch (node.type) {
        case 'shape': {
          parts.push(shapeMarkup(node, defs));
          if (node.text && node.typography) {
            const t = node.typography;
            const tx = node.x + node.width / 2;
            parts.push(
              `<text y="${node.y + node.height / 2}" ${textAttrs({ ...t, align: 'center' })} dominant-baseline="middle">${multilineTspans(applyTextCase(node.text, t.textCase), tx, t.fontSize, t.lineHeight)}</text>`
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
              `<path d="${bezierPathData(node, node.x, node.y)}" fill="${fill && fill !== 'transparent' ? fill : 'none'}"${rule} stroke="${stroke ?? 'none'}" stroke-width="${sw}"${dash}${cap}${join} />`
            );
          } else if (node.geometry.svgPath) {
            // Freehand strokes store their outline relative to the node origin.
            parts.push(
              `<path d="${node.geometry.svgPath}" fill="${fill ?? DEFAULT_INK}" transform="translate(${node.x}, ${node.y})" />`
            );
          }
          break;
        }

        case 'image': {
          if (!node.src) break;
          parts.push(
            `<image href="${escapeXml(node.src)}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" preserveAspectRatio="xMidYMid slice"${rotationTransform(node)} />`
          );
          break;
        }

        case 'sticky': {
          const theme = THEMES[node.theme] ?? THEMES.yellow;
          parts.push(
            `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="${theme.bg}"${rotationTransform(node)} />`
          );
          if (node.text) {
            parts.push(
              `<text y="${node.y + 16}" font-family="Caveat, cursive" font-size="${node.fontSize}" font-weight="bold" fill="${theme.text}">${multilineTspans(node.text, node.x + 16, node.fontSize, 1.4)}</text>`
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
            `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.appearance.cornerRadius ?? 0}" fill="${defs.fill(node.appearance.fill?.[0], { x: node.x, y: node.y, width: node.width, height: node.height }, '#FFFFFF')}" />`
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

        case 'comment':
          break;
      }
    });

    // Frame to the actual content. Shared with the PNG exporter so the two
    // formats crop identically; a hardcoded viewBox exported a blank image for
    // any document not sitting at the world origin.
    const bounds = options.bounds ?? computeContentBounds(state.objects, options.selectedOnly ? options.selectedIds : undefined);

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">
${parts.join('\n')}
</svg>`;
  }
}
