import type { NewNodeInput } from '../../engine/document/mutations';
import { normalizeNode } from '../../engine/document/normalize';
import type { AnyNode, FrameNode, Typography } from '../../engine/model/schema';
import { compareStacking } from '../../engine/model/stacking';
import { canvasFontFamily, konvaFontStyle } from '../canvas/renderers/shared';
import { attr, escapeXml, num } from '../../engine/export/markup';
import { nodesToSvg } from '../../engine/export/nodesToSvg';
import { textWidth as estimateTextWidth } from '../../engine/templates/templateKit';

/**
 * A board drawn read-only, as SVG, from the nodes a template builds.
 *
 * The gallery's covers and its peek both show *the board you will get*, not a
 * diagram of it. The editor draws with Konva against the live document, and
 * the SVG exporter reads the room's store; neither can be used on the
 * dashboard, which has no room and must not open one. So this hands the nodes
 * to `nodesToSvg`, the same per-type writers the SVG export is drawn with, and
 * adds what a still picture of a board needs and an export does not: frame
 * names above each frame, ids of its own, and its own crop.
 *
 * What it leaves out is chrome the canvas draws on top of the work (selection,
 * presence, comment pins) and remote images, which a template never carries.
 */

export interface BoardSvgOptions {
  /**
   * Prefixed onto every id in the markup, so several pictures of the same
   * board can sit in one document without their gradients, masks and filters
   * resolving to each other's.
   */
  idPrefix: string;
  /**
   * How wide the picture is shown, in screen pixels. Frame names are drawn at
   * a constant screen size, as on the board, so they need the scale.
   */
  displayWidth?: number;
  /** Draw notes and code on the dark board's paper. */
  dark?: boolean;
  /** Fill behind everything; `null` leaves it transparent. */
  ground?: string | null;
  /** World units of air round the content. */
  padding?: number;
  /**
   * Most samples a plotted function is drawn with. A cover is a few hundred
   * pixels wide, and a curve sampled 1,400 times draws the same line there as
   * one sampled 240 times, at a sixth of the cost.
   */
  maxSamples?: number;
  /**
   * Give the main thread back between objects once a slice of work has run,
   * so drawing a large board never holds up a scroll. On by default where
   * there is a window.
   */
  cooperative?: boolean;
}

export interface BoardSvg {
  svg: string;
  /** The world rectangle the picture covers, padding included. */
  bounds: { x: number; y: number; width: number; height: number };
  objectCount: number;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Glyph advances as the canvas will draw them, or the kit's estimate without a DOM. */
function measurerFor(t: Typography): (text: string) => number {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  const ctx = measureCtx;
  if (!ctx) return (text) => estimateTextWidth(text, t.fontSize, t.fontWeight);
  const font = `${konvaFontStyle(t)} ${t.fontSize}px ${canvasFontFamily(t.fontFamily)}`;
  return (text) => {
    if (!text) return 0;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** Frame names sit above the frame at a constant screen size, as Figma draws them. */
const FRAME_NAME_PX = 12;
const FRAME_DESC_PX = 11;
const FRAME_ROW_PX = 18;

/**
 * The free space above a frame: down from the lowest thing that sits over it.
 * On the board a frame's name is screen-sized chrome and may overlap what is
 * above when zoomed out; in a still picture it is part of the drawing, so it
 * is fitted to the room it has rather than drawn over its neighbour.
 */
function roomAbove(frame: FrameNode, nodes: readonly AnyNode[]): number {
  let floor = -Infinity;
  for (const n of nodes) {
    if (n === frame || n.type === 'connector' || n.type === 'comment') continue;
    const bottom = n.y + n.height;
    if (bottom > frame.y || n.x >= frame.x + frame.width || n.x + n.width <= frame.x) continue;
    floor = Math.max(floor, bottom);
  }
  return floor === -Infinity ? Infinity : frame.y - floor;
}

function frameHeader(node: FrameNode, unit: number, dark: boolean, room: number): string {
  const name = node.title || 'Frame';
  const quiet = dark ? '#A1A1AA' : '#6B7280';
  const full = FRAME_ROW_PX + (node.description ? 16 : 0) + 6;
  const fits = (u: number, px: number) => u * px <= room;
  // The name and its line at full size; else the name alone; else both smaller.
  const withDesc = Boolean(node.description) && fits(unit, full);
  const u = withDesc || fits(unit, FRAME_ROW_PX + 6)
    ? unit
    : Math.max(0, room / (FRAME_ROW_PX + 6));
  // Squeezed below about half its size on screen, a name is noise; leave it out.
  if ((u / unit) * FRAME_NAME_PX < 6) return '';
  unit = u;
  const description = withDesc ? node.description : undefined;
  const rowH = FRAME_ROW_PX * unit;
  const descH = description ? 16 * unit : 0;
  const top = node.y - (rowH + descH + 6 * unit);
  const icon = node.icon ? `${node.icon} ` : '';
  const clip = `fh-${node.id.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const parts = [
    `<clipPath id="${clip}"><rect x="${num(node.x)}" y="${num(top)}" width="${num(node.width)}" height="${num(rowH + descH)}" /></clipPath>`,
    `<g clip-path="url(#${clip})">`,
    `<text x="${num(node.x)}" y="${num(top + rowH / 2)}" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="${num(FRAME_NAME_PX * unit)}" font-weight="500" fill="${quiet}">${escapeXml(icon + name)}</text>`,
  ];
  if (description) {
    parts.push(
      `<text x="${num(node.x)}" y="${num(top + rowH + FRAME_DESC_PX * unit)}" font-family="Inter, system-ui, sans-serif" font-size="${num(FRAME_DESC_PX * unit)}" fill="${quiet}">${escapeXml(description)}</text>`
    );
  }
  parts.push('</g>');
  return parts.join('');
}

// ---------------------------------------------------------------- the board

/** Normalise creation input into document nodes, renamed under `prefix` so their ids are this picture's own. */
export function boardNodes(input: readonly NewNodeInput[], prefix: string): AnyNode[] {
  const rename = (id: unknown) => (typeof id === 'string' && id ? `${prefix}${id}` : id);
  return input.map((raw, i) => {
    const node = normalizeNode({ ...(raw as object), zIndex: i }) as AnyNode;
    const renamed = { ...node, id: rename(node.id) as string } as AnyNode;
    if (renamed.type === 'connector') {
      renamed.from = { ...renamed.from, nodeId: rename(renamed.from.nodeId) as string | undefined };
      renamed.to = { ...renamed.to, nodeId: rename(renamed.to.nodeId) as string | undefined };
    }
    return renamed;
  });
}

/** The world box everything on the board covers, frame names included. */
export function boardBounds(nodes: readonly AnyNode[], headerSpace = 0): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.hidden || n.type === 'comment' || n.type === 'connector') continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y - (n.type === 'frame' ? headerSpace : 0));
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/**
 * Draw a built board as one SVG document.
 *
 * Async only for the two pieces of artwork read from elsewhere: icon-pack
 * glyphs and emoji stamps. Everything else is synchronous and deterministic.
 */
export async function renderBoardSvg(input: readonly NewNodeInput[], options: BoardSvgOptions): Promise<BoardSvg> {
  const prefix = options.idPrefix.replace(/[^A-Za-z0-9_-]/g, '');
  const nodes = boardNodes(input, prefix).filter((n) => !n.hidden).sort(compareStacking);
  const objects: Record<string, AnyNode> = {};
  for (const n of nodes) objects[n.id] = n;

  const dark = Boolean(options.dark);
  const content = boardBounds(nodes);
  const unit = options.displayWidth ? Math.max(0.5, content.width / options.displayWidth) : 1;
  const headerSpace = (FRAME_ROW_PX + 22) * unit;
  const ground = options.ground ?? null;

  const cooperative = options.cooperative ?? typeof window !== 'undefined';
  // Normalising a large board is its own stretch of work; let a frame through before drawing it.
  if (cooperative) await new Promise<void>((resolve) => setTimeout(resolve, 0));

  // Templates carry no board-wide sketch mode, so only a node's own choice applies.
  const { body, defs } = await nodesToSvg(nodes, {
    objects,
    boardSketch: null,
    dark,
    ground: ground ?? '#FFFFFF',
    maxSamples: options.maxSamples,
    measure: measurerFor,
    cooperative,
  });
  // Names are drawn last, so nothing covers them.
  const headers = nodes
    .filter((n): n is FrameNode => n.type === 'frame')
    .map((frame) => frameHeader(frame, unit, dark, roomAbove(frame, nodes)));

  const raw = boardBounds(nodes, headers.length ? headerSpace : 0);
  const pad = options.padding ?? Math.max(24, Math.max(raw.width, raw.height) * 0.04);
  const bounds = { x: raw.x - pad, y: raw.y - pad, width: raw.width + pad * 2, height: raw.height + pad * 2 };
  const backdrop = ground
    ? `<rect x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(bounds.width)}" height="${num(bounds.height)}" fill="${attr(ground)}" />`
    : '';

  // Gradient ids come from the shared collector and are not prefixed there.
  const paint = defs.markup().replace(/id="vg(\d+)"/g, `id="${prefix}vg$1"`);
  const artwork = body.join('').replace(/url\(#vg(\d+)\)/g, `url(#${prefix}vg$1)`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${num(bounds.x)} ${num(bounds.y)} ${num(bounds.width)} ${num(bounds.height)}" width="${num(bounds.width)}" height="${num(bounds.height)}">` +
    paint + backdrop + artwork + headers.join('') +
    `</svg>`;
  return { svg, bounds, objectCount: nodes.length };
}
