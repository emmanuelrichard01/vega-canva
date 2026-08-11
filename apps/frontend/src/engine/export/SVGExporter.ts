import type { Exporter, ExportOptions, ExportFormat } from './ExportTypes';
import { useStore } from '../../hooks/useStore';
import { computeContentBounds } from './bounds';
import { THEMES } from '../../components/canvas/renderers/StickyRenderer';
import type { AnyNode, PathNode, ShapeNode, Typography } from '../model/schema';
import { SvgPaintDefs } from './svgPaint';

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

function regularPolygonPoints(cx: number, cy: number, sides: number, rx: number, ry: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
    pts.push(`${cx + rx * Math.cos(angle)},${cy + ry * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

function starPoints(cx: number, cy: number, numPoints: number, innerRatio: number, rx: number, ry: number): string {
  const pts: string[] = [];
  for (let i = 0; i < numPoints * 2; i++) {
    const scale = i % 2 === 0 ? 1 : innerRatio;
    const angle = (i * Math.PI) / numPoints - Math.PI / 2;
    pts.push(`${cx + rx * scale * Math.cos(angle)},${cy + ry * scale * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

function bezierPathData(node: PathNode, offsetX: number, offsetY: number): string {
  if (node.geometry.kind !== 'bezier') return '';
  const { segments, closed } = node.geometry;
  if (!segments.length) return '';

  let d = `M ${segments[0].x + offsetX} ${segments[0].y + offsetY}`;
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i];
    const c1x = (s.cp1x ?? segments[i - 1].x) + offsetX;
    const c1y = (s.cp1y ?? segments[i - 1].y) + offsetY;
    const c2x = (s.cp2x ?? s.x) + offsetX;
    const c2y = (s.cp2y ?? s.y) + offsetY;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${s.x + offsetX} ${s.y + offsetY}`;
  }
  if (closed) d += ' Z';
  return d;
}

/** SVG text attributes for a typography block. */
function textAttrs(t: Typography): string {
  const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
  return [
    `font-family="${escapeXml(t.fontFamily)}"`,
    `font-size="${t.fontSize}"`,
    `font-weight="${t.fontWeight}"`,
    `font-style="${t.italic ? 'italic' : 'normal'}"`,
    t.underline ? 'text-decoration="underline"' : '',
    `fill="${t.color}"`,
    `text-anchor="${anchor}"`,
    t.letterSpacing ? `letter-spacing="${t.letterSpacing}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function anchorX(node: AnyNode, t: Typography): number {
  if (t.align === 'center') return node.x + node.width / 2;
  if (t.align === 'right') return node.x + node.width;
  return node.x;
}

function multilineTspans(text: string, x: number, fontSize: number, lineHeight: number): string {
  return text
    .split('\n')
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? fontSize : fontSize * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
}

function rotationTransform(node: AnyNode): string {
  if (!node.rotation) return '';
  // Objects rotate about their centre, matching the canvas.
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return ` transform="rotate(${node.rotation} ${cx} ${cy})"`;
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
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dashAttrs(node.appearance.stroke)}`;

  switch (node.geometry.kind) {
    case 'rect':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${node.appearance.cornerRadius ?? 0}" ${paint}${rot} />`;
    case 'ellipse':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${paint}${rot} />`;
    case 'hexagon':
      return `<polygon points="${regularPolygonPoints(cx, cy, 6, w / 2, h / 2)}" ${paint}${rot} />`;
    case 'star':
      return `<polygon points="${starPoints(cx, cy, node.geometry.points ?? 5, node.geometry.innerRatio ?? 0.5, w / 2, h / 2)}" ${paint}${rot} />`;
    case 'triangle':
    default:
      return `<polygon points="${regularPolygonPoints(cx, cy, 3, w / 2, h / 2)}" ${paint}${rot} />`;
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
              `<text y="${node.y + node.height / 2}" ${textAttrs({ ...t, align: 'center' })} dominant-baseline="middle">${multilineTspans(node.text, tx, t.fontSize, t.lineHeight)}</text>`
            );
          }
          break;
        }

        case 'text': {
          const t = node.typography;
          parts.push(
            `<text y="${node.y}" ${textAttrs(t)}${rotationTransform(node)}>${multilineTspans(node.text, anchorX(node, t), t.fontSize, t.lineHeight)}</text>`
          );
          break;
        }

        case 'path': {
          const stroke = node.appearance.stroke?.color;
          const sw = node.appearance.stroke?.width ?? 2;
          const paintBox = { x: node.x, y: node.y, width: node.width, height: node.height };
          const fill = node.appearance.fill?.length
            ? defs.fill(node.appearance.fill[0], paintBox, 'none')
            : undefined;

          if (node.geometry.kind === 'bezier') {
            const dash = dashAttrs(node.appearance.stroke);
            // The round cap is this renderer's default for pen paths, so it is
            // only emitted when the dash pattern has not already supplied one.
            const cap = node.appearance.stroke?.cap ? '' : ' stroke-linecap="round"';
            parts.push(
              `<path d="${bezierPathData(node, node.x, node.y)}" fill="${fill && fill !== 'transparent' ? fill : 'none'}" stroke="${stroke ?? 'none'}" stroke-width="${sw}"${dash}${cap} stroke-linejoin="round" />`
            );
          } else if (node.geometry.svgPath) {
            // Freehand strokes store their outline relative to the node origin.
            parts.push(
              `<path d="${node.geometry.svgPath}" fill="${fill ?? '#1F2937'}" transform="translate(${node.x}, ${node.y})" />`
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
