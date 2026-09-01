import { DEFAULT_INK, DEFAULT_TYPOGRAPHY, type Point } from '../model/schema';

/**
 * Pasted SVG, turned into objects you can edit.
 *
 * ## Why a subset, and why it says so
 *
 * SVG is enormous — filters, gradients on gradients, `<use>`, nested viewports,
 * CSS, clip paths, masks, text on a path. A converter that silently drops what
 * it does not understand produces a picture missing pieces with nothing to say
 * which, and the person is left comparing two images by eye.
 *
 * So this handles the shapes people actually paste out of Figma, Illustrator
 * and Sketch — rectangles, ellipses, lines, polylines, polygons and paths —
 * reports what it **skipped by name**, and lets the caller say so. That is the
 * same rule the Mermaid importer follows: decline out loud rather than
 * approximate silently.
 *
 * A raster fallback is deliberately not offered. The entire point of pasting
 * vector is getting objects you can move; handing back a picture instead is the
 * one outcome that looks like success and is not.
 */

export interface SvgImportResult {
  /** Ready for `createNode`, positioned relative to the artwork's own origin. */
  nodes: Record<string, unknown>[];
  /** Element names that were recognised but not converted, each once. */
  skipped: string[];
  /** The artwork's own size, so the caller can place it sensibly. */
  width: number;
  height: number;
}

/** Recognisably SVG, without parsing it first. */
export function looksLikeSvg(text: string): boolean {
  const head = text.trimStart().slice(0, 2048).toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

const num = (v: string | null, fallback = 0): number => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};

/**
 * A colour attribute, resolved the way SVG resolves it.
 *
 * `none` is a real value meaning "do not paint", and it is not the same as
 * absent — an absent `fill` on a shape means black. Treating them alike is how
 * an outlined rectangle arrives filled.
 */
function paintOf(el: SvgLike, attr: 'fill' | 'stroke'): string | null {
  const raw = (el.getAttribute(attr) ?? '').trim();
  if (raw === 'none') return null;
  if (raw === '') return attr === 'fill' ? '#000000' : null;
  // A gradient or pattern reference cannot be honoured, so it falls back to a
  // flat colour rather than to nothing — a shape with no paint at all is
  // invisible, which looks like the paste having failed.
  if (raw.startsWith('url(')) return '#9CA3AF';
  return raw;
}

function strokeOf(el: SvgLike): { color: string; width: number } | undefined {
  const color = paintOf(el, 'stroke');
  if (!color) return undefined;
  return { color, width: Math.max(0.1, num(el.getAttribute('stroke-width'), 1)) };
}

function appearanceOf(el: SvgLike) {
  const fill = paintOf(el, 'fill');
  return {
    fill: fill ? [{ type: 'solid' as const, color: fill, opacity: 1 }] : [],
    stroke: strokeOf(el),
  };
}

/**
 * Parse a `d` attribute into polylines, one per subpath.
 *
 * ## Why flattened rather than kept as curves
 *
 * The document's path geometry is anchor-centric with explicit handles, and
 * mapping every SVG command onto it faithfully — arcs especially, which are
 * defined by radii and flags rather than by control points — is a conversion
 * with a lot of ways to be subtly wrong. Flattening to points is exact for
 * lines, accurate to a fraction of a pixel for curves at this tolerance, and
 * produces a path the pen tool can edit like any other.
 *
 * Arcs are the one command not implemented. They are rare in exported artwork
 * (both Figma and Illustrator emit cubics) and are reported as skipped rather
 * than approximated with a straight line, which would silently flatten a
 * rounded corner into a chamfer.
 */
export function parsePathData(d: string): { subpaths: Point[][]; usedArc: boolean } {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let usedArc = false;

  // Commands are a letter followed by numbers; numbers may be separated by
  // commas, spaces, or nothing at all when the sign does the separating.
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];

  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let command = '';

  const readNum = () => {
    const t = tokens[i++];
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? n : 0;
  };

  const push = (x: number, y: number) => {
    current.push({ x, y });
    cx = x;
    cy = y;
  };

  const cubicTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const from = { x: cx, y: cy };
    // Sixteen segments per curve: below a pixel of error at the sizes pasted
    // artwork arrives at, and cheap enough that a complex path is still fast.
    for (let s = 1; s <= 16; s += 1) {
      const t = s / 16;
      const m = 1 - t;
      current.push({
        x: m * m * m * from.x + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x,
        y: m * m * m * from.y + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y,
      });
    }
    cx = x;
    cy = y;
  };

  const endSubpath = () => {
    if (current.length > 1) subpaths.push(current);
    current = [];
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/[a-zA-Z]/.test(token)) {
      command = token;
      i += 1;
      if (command === 'Z' || command === 'z') {
        if (current.length > 1) {
          current.push({ x: startX, y: startY });
          subpaths.push(current);
        }
        current = [];
        cx = startX;
        cy = startY;
        continue;
      }
    }

    const rel = command === command.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;

    switch (command.toUpperCase()) {
      case 'M': {
        endSubpath();
        const x = readNum() + ox;
        const y = readNum() + oy;
        startX = x;
        startY = y;
        current = [{ x, y }];
        cx = x;
        cy = y;
        // A second coordinate pair after M is an implicit lineto.
        command = rel ? 'l' : 'L';
        break;
      }
      case 'L':
        push(readNum() + ox, readNum() + oy);
        break;
      case 'H':
        push(readNum() + ox, cy);
        break;
      case 'V':
        push(cx, readNum() + oy);
        break;
      case 'C':
        cubicTo(
          readNum() + ox, readNum() + oy,
          readNum() + ox, readNum() + oy,
          readNum() + ox, readNum() + oy
        );
        break;
      case 'S': {
        // Smooth cubic: the first control point mirrors the previous one. With
        // no previous curve it coincides with the current point, per the spec.
        const x2 = readNum() + ox;
        const y2 = readNum() + oy;
        const x = readNum() + ox;
        const y = readNum() + oy;
        cubicTo(cx, cy, x2, y2, x, y);
        break;
      }
      case 'Q': {
        // Quadratics are raised to cubics rather than given their own sampler.
        const qx = readNum() + ox;
        const qy = readNum() + oy;
        const x = readNum() + ox;
        const y = readNum() + oy;
        cubicTo(
          cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy),
          x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
          x, y
        );
        break;
      }
      case 'T': {
        const x = readNum() + ox;
        const y = readNum() + oy;
        cubicTo(cx, cy, x, y, x, y);
        break;
      }
      case 'A': {
        // Radii, rotation, two flags, endpoint. Consumed so parsing stays in
        // step, then reported rather than approximated.
        readNum(); readNum(); readNum(); readNum(); readNum();
        const x = readNum() + ox;
        const y = readNum() + oy;
        usedArc = true;
        push(x, y);
        break;
      }
      default:
        // An unknown command would loop forever on its own operands.
        i += 1;
    }
  }

  endSubpath();
  return { subpaths, usedArc };
}

/** Points → the freehand-style path node the document already renders. */
function pathNode(points: Point[], el: SvgLike): Record<string, unknown> | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - minX);
  const height = Math.max(1, Math.max(...ys) - minY);

  // Stored relative to the node's own origin, which is how `PathRenderer`
  // reads a freehand outline.
  const d =
    `M ${points.map((p) => `${(p.x - minX).toFixed(2)} ${(p.y - minY).toFixed(2)}`).join(' L ')}`;

  const appearance = appearanceOf(el);
  return {
    type: 'path',
    x: minX,
    y: minY,
    width,
    height,
    geometry: { kind: 'freehand', svgPath: d },
    appearance: {
      // A pasted outline with no fill must not become a filled blob; the
      // freehand renderer fills its path, so an unfilled source becomes a
      // stroke-coloured hairline shape instead of a black silhouette.
      fill: appearance.fill.length > 0 ? appearance.fill : [],
      stroke: appearance.stroke,
    },
  };
}

/**
 * The little of an element this needs.
 *
 * Declared rather than taking `Element`, so the conversion can be asserted
 * without a DOM. `DOMParser` does not exist in Node, and adding a DOM
 * implementation to the test environment to check a mapping from attributes to
 * numbers would be a dependency bought for one file — this codebase keeps its
 * arithmetic runnable without a browser instead.
 *
 * A real `Element` satisfies this already, which is what makes the split free.
 */
export interface SvgLike {
  tagName: string;
  textContent?: string | null;
  getAttribute(name: string): string | null;
  children: ArrayLike<SvgLike>;
}

/**
 * Convert pasted SVG markup into nodes.
 *
 * Uses the browser's own parser rather than a regex: SVG is XML, and the
 * DOMParser is already present, already correct, and already handles the
 * entities and namespaces that a pattern would get wrong. The walk itself is
 * `convertSvgTree`, which needs no DOM at all.
 */
export function importSvg(text: string): SvgImportResult | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    return null;
  }
  if (doc.querySelector('parsererror')) return null;

  const root = doc.querySelector('svg');
  if (!root) return null;
  return convertSvgTree(root as unknown as SvgLike);
}

/** The walk, over anything shaped like an element tree. */
export function convertSvgTree(root: SvgLike): SvgImportResult | null {
  const nodes: Record<string, unknown>[] = [];
  const skipped = new Set<string>();

  const walk = (el: SvgLike) => {
    switch (el.tagName.toLowerCase()) {
      case 'svg':
      case 'g':
        // Groups are walked through rather than represented. A transform on
        // one would move its children, and honouring the full transform stack
        // is a different feature — so a transformed group is reported.
        if (el.getAttribute('transform')) skipped.add('transform');
        Array.from(el.children).forEach(walk);
        return;

      case 'rect': {
        const rx = num(el.getAttribute('rx'));
        nodes.push({
          type: 'shape',
          x: num(el.getAttribute('x')),
          y: num(el.getAttribute('y')),
          width: Math.max(1, num(el.getAttribute('width'), 1)),
          height: Math.max(1, num(el.getAttribute('height'), 1)),
          geometry: { kind: 'rect' },
          appearance: { ...appearanceOf(el), cornerRadius: rx || undefined },
        });
        return;
      }

      case 'circle': {
        const r = num(el.getAttribute('r'), 1);
        nodes.push({
          type: 'shape',
          x: num(el.getAttribute('cx')) - r,
          y: num(el.getAttribute('cy')) - r,
          width: Math.max(1, r * 2),
          height: Math.max(1, r * 2),
          geometry: { kind: 'ellipse' },
          appearance: appearanceOf(el),
        });
        return;
      }

      case 'ellipse': {
        const rx = num(el.getAttribute('rx'), 1);
        const ry = num(el.getAttribute('ry'), 1);
        nodes.push({
          type: 'shape',
          x: num(el.getAttribute('cx')) - rx,
          y: num(el.getAttribute('cy')) - ry,
          width: Math.max(1, rx * 2),
          height: Math.max(1, ry * 2),
          geometry: { kind: 'ellipse' },
          appearance: appearanceOf(el),
        });
        return;
      }

      case 'line': {
        const a = { x: num(el.getAttribute('x1')), y: num(el.getAttribute('y1')) };
        const b = { x: num(el.getAttribute('x2')), y: num(el.getAttribute('y2')) };
        const node = pathNode([a, b], el);
        if (node) nodes.push(node);
        return;
      }

      case 'polyline':
      case 'polygon': {
        const pts = (el.getAttribute('points') ?? '')
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n));
        const points: Point[] = [];
        for (let i = 0; i + 1 < pts.length; i += 2) points.push({ x: pts[i], y: pts[i + 1] });
        // A polygon is closed; a polyline is not.
        if (el.tagName.toLowerCase() === 'polygon' && points.length > 2) {
          points.push({ ...points[0] });
        }
        const node = pathNode(points, el);
        if (node) nodes.push(node);
        return;
      }

      case 'path': {
        const { subpaths, usedArc } = parsePathData(el.getAttribute('d') ?? '');
        if (usedArc) skipped.add('arc segments');
        // One node per subpath: a compound path cannot be edited anchor by
        // anchor here anyway, and separate outlines are more useful than one
        // that cannot be taken apart.
        for (const sub of subpaths) {
          const node = pathNode(sub, el);
          if (node) nodes.push(node);
        }
        return;
      }

      case 'text': {
        const text = (el.textContent ?? '').trim();
        if (text) {
          const fontSize = Math.max(8, num(el.getAttribute('font-size'), 16));
          const fontFamily = el.getAttribute('font-family') || 'Inter';
          const fill = paintOf(el, 'fill') || DEFAULT_INK;
          const anchor = el.getAttribute('text-anchor');
          const align = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
          const fontWeight = num(el.getAttribute('font-weight'), 400);
          const x = num(el.getAttribute('x'));
          const y = num(el.getAttribute('y')) - fontSize;
          const width = Math.max(20, Math.round(text.length * fontSize * 0.6));
          const height = Math.max(fontSize * 1.4, 20);

          nodes.push({
            type: 'text',
            x,
            y,
            width,
            height,
            text,
            resize: 'auto-width',
            typography: {
              ...DEFAULT_TYPOGRAPHY,
              fontFamily,
              fontSize,
              fontWeight,
              color: fill,
              align,
            },
          });
        }
        return;
      }

      case 'tspan':
      case 'image':
      case 'use':
      case 'clippath':
      case 'mask':
      case 'filter':
        skipped.add(el.tagName.toLowerCase());
        return;

      case 'defs':
      case 'style':
      case 'title':
      case 'desc':
      case 'metadata':
        // Not content, and not worth reporting as missing.
        return;

      default:
        skipped.add(el.tagName.toLowerCase());
    }
  };

  walk(root);
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const x = n.x as number;
    const y = n.y as number;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + (n.width as number));
    maxY = Math.max(maxY, y + (n.height as number));
  }

  // Normalised to its own origin so the caller places the artwork, not the
  // coordinates the exporting tool happened to use.
  for (const n of nodes) {
    n.x = (n.x as number) - minX;
    n.y = (n.y as number) - minY;
  }

  return {
    nodes,
    skipped: [...skipped],
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
