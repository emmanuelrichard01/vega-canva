import type { AnyNode } from './schema';

/**
 * A board, small enough to keep.
 *
 * ## Why this exists
 *
 * Workspace covers were a hash of the room id turned into one of three
 * abstract glyphs. They were deterministic, which made them *stable*, and that
 * is the only thing they had in common with a preview: two boards holding
 * completely different work could draw the same picture, and a board with two
 * hundred objects on it drew a single circle. A thumbnail that cannot
 * distinguish your boards from each other is decoration in the shape of
 * information.
 *
 * The real contents are already on the device — the dashboard just has no
 * connection to them, because it reads a list out of `localStorage` and never
 * opens a document. So the room writes a compact summary of itself as it goes,
 * and the dashboard draws that.
 *
 * ## Why a summary and not an image
 *
 * A captured PNG would be heavier, would need the canvas to be mounted and
 * rendered at capture time, and would be wrong the moment the board changed.
 * This is ~40 bytes per object of plain JSON, produced from data the store
 * already holds, and it draws as vector at any size.
 *
 * Everything here is pure. Colour resolution is *injected* rather than done
 * here, because a sticky's colour lives in a theme table owned by its
 * renderer — importing that would drag a React component into a module that
 * otherwise runs anywhere, and copying it would create a second source of
 * truth for what "yellow" means.
 */

/** One object, normalised into the board's own bounding box (0..1). */
export interface PreviewItem {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fill, already resolved to a CSS colour by the caller. */
  c: string;
  /** Rounded, for stickies and rounded rectangles. */
  r?: number;
  /** Drawn as an ellipse rather than a rectangle. */
  o?: 1;
  /**
   * A polyline, normalised like `x`/`y`, drawn as a stroke instead of a fill.
   *
   * Connectors are the reason this exists. Their `x`/`y`/`width`/`height` is
   * the *bounding box of the route* — correct, and used for culling — so
   * drawing every node as a filled rectangle turned each connector into a
   * solid block spanning the diagonal between the two objects it joined.
   *
   * Worse here than on the radar: items are chosen largest-first, and a
   * connector's box is often the biggest thing on the board, so the blocks
   * crowded out the actual content they were drawn on top of.
   */
  l?: number[];
}

export interface BoardPreview {
  /** Aspect ratio of the content box, so the drawing is never stretched. */
  ratio: number;
  items: PreviewItem[];
  /** How many objects the board actually holds, including any not drawn. */
  total: number;
}

/**
 * The most objects worth keeping.
 *
 * A 140px cover cannot show more than this legibly, and the point of the cap
 * is the storage: this rides in `localStorage` beside the room list, which is
 * a few megabytes for the whole origin. The largest objects are kept, because
 * they are what makes a board recognisable at a glance — a wall of small
 * stickies reads as texture whichever forty of them survive.
 */
const MAX_ITEMS = 48;

/**
 * How much of the cover an object deserves.
 *
 * Area, except for a connector — whose bounding box is mostly the empty space
 * between the two things it joins, and would otherwise outrank all of them.
 * Its route length is the honest measure of how much of the board it occupies.
 */
function previewWeight(n: AnyNode): number {
  const w = n.width * Math.abs(n.scaleX || 1);
  const h = n.height * Math.abs(n.scaleY || 1);
  if (n.type === 'connector') return Math.max(w, h);
  return w * h;
}

export function buildPreview(
  nodes: readonly AnyNode[],
  colorOf: (node: AnyNode) => string,
  /** Route points in world space, for nodes that are lines rather than boxes. */
  pointsOf?: (node: AnyNode) => number[] | null
): BoardPreview | null {
  const visible = nodes.filter((n) => !n.hidden && n.type !== 'comment');
  if (visible.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  visible.forEach((n) => {
    const w = n.width * Math.abs(n.scaleX || 1);
    const h = n.height * Math.abs(n.scaleY || 1);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  });

  const boardW = Math.max(1, maxX - minX);
  const boardH = Math.max(1, maxY - minY);

  const chosen = [...visible]
    /**
     * Largest first — but a connector is measured by its *route*, not by its
     * bounding box, which is mostly empty space. Ranking it by that box let a
     * single arrow across the board outrank every object it connected.
     */
    .sort((a, b) => previewWeight(b) - previewWeight(a))
    .slice(0, MAX_ITEMS)
    // Back into stacking order, so the drawing layers the way the board does.
    .sort((a, b) => a.zIndex - b.zIndex);

  const round = (n: number) => Math.round(n * 1000) / 1000;

  const items: PreviewItem[] = chosen.map((n) => {
    const w = n.width * Math.abs(n.scaleX || 1);
    const h = n.height * Math.abs(n.scaleY || 1);
    const item: PreviewItem = {
      x: round((n.x - minX) / boardW),
      y: round((n.y - minY) / boardH),
      w: round(w / boardW),
      h: round(h / boardH),
      c: colorOf(n),
    };
    if (n.type === 'shape' && n.geometry.kind === 'ellipse') item.o = 1;

    /**
     * A connector draws its route, not its box.
     *
     * The points come from the caller, for the same reason the colour does:
     * resolving them needs the other objects on the board, and this module is
     * pure so that it runs anywhere.
     */
    const route = pointsOf?.(n);
    if (route && route.length >= 4) {
      item.l = route.map((v, i) =>
        round(i % 2 === 0 ? (v - minX) / boardW : (v - minY) / boardH)
      );
    }
    // Stickies and rounded rectangles keep their corner, because at this size
    // the silhouette is most of what distinguishes one object from another.
    const radius = n.type === 'sticky' ? 0.08 : cornerFraction(n, Math.min(w, h));
    if (radius > 0) item.r = round(radius);
    return item;
  });

  return { ratio: round(boardW / boardH), items, total: visible.length };
}

function cornerFraction(node: AnyNode, shortSide: number): number {
  const radius = (node as { appearance?: { cornerRadius?: number } }).appearance?.cornerRadius;
  if (!radius || shortSide <= 0) return 0;
  // As a fraction of the object's own short side, so it survives normalisation.
  return Math.min(0.5, radius / shortSide);
}

const KEY_PREFIX = 'vega_preview_';

/**
 * Previews live in `localStorage`, never in the document.
 *
 * What *your* device has cached of a board is not a fact about the board — it
 * must not sync to collaborators, must not enter the update log, and is
 * allowed to be lossy. Losing it costs a placeholder cover until the next
 * visit. Same call the tag filter and the comment read marks make.
 */
export function savePreview(roomId: string, preview: BoardPreview | null): void {
  try {
    if (!preview) localStorage.removeItem(KEY_PREFIX + roomId);
    else localStorage.setItem(KEY_PREFIX + roomId, JSON.stringify(preview));
  } catch {
    /* A full or unavailable store must never take the room down with it. */
  }
}

export function loadPreview(roomId: string): BoardPreview | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + roomId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BoardPreview;
    return Array.isArray(parsed?.items) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Route points for a node, when it is a line rather than a box.
 *
 * Paired with `previewColorOf` below so a caller can hand `buildPreview` both
 * of its injected dependencies in one import instead of reassembling them.
 */
export type PreviewPoints = (node: AnyNode) => number[] | null;
