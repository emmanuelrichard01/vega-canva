import type { AnyNode } from './schema';
import { linePoints } from './linePath';
import { localRunEnds } from './lineEnds';

/**
 * How many points of a line's run a summary keeps.
 *
 * A coil at twenty loops is several hundred, and this is stored in
 * `localStorage` for every line on every board. A card is a couple of hundred
 * pixels across, so past a few dozen the extra points are bytes nobody can see.
 */
const PREVIEW_LINE_POINTS = 48;

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
  /**
   * Text, drawn as text rather than as a filled box.
   *
   * A text node's fill is its *ink* colour, and its box is the area the words
   * occupy — so painting it the way every other node is painted produced a
   * solid near-black slab the size of the paragraph. Every template that
   * labelled itself got one across the top of its card, and it read as a
   * rendering failure rather than as a heading, because that is what a filled
   * black rectangle looks like.
   *
   * Real glyphs are not an option at cover size: the biggest heading on these
   * boards lands at roughly two pixels tall. The renderer draws ruled lines
   * instead — the same convention a wireframe uses — which reads as "there are
   * words here" at a glance and is honest about not being legible.
   */
  t?: 1;
  /**
   * Type size, normalised like everything else, so the ruled lines are spaced
   * the way the real text is.
   *
   * Without it a 36px title and a 14px paragraph in boxes of the same height
   * draw the identical stack of rules, and the board's typographic hierarchy —
   * often the clearest thing about its composition at thumbnail size —
   * disappears.
   */
  fs?: number;
  /**
   * A frame — paper, not a filled shape.
   *
   * A frame's default fill is white and its edge is a hairline, which is what
   * `FrameRenderer` draws. The preview had no idea, so it fell through to the
   * generic `#94A3B8` and painted every frame as a solid slate block. On the
   * boards built *out* of frames — the social kit, the sprint lanes, the
   * impact matrix — that meant the card was mostly grey slabs with the actual
   * content buried under them, which is not what the board looks like at all.
   *
   * Flagged rather than just recoloured, because white paper on a near-white
   * card needs the hairline to be visible at all, and only the renderer can
   * draw one.
   */
  k?: 1;
  /**
   * A shape that is neither a rectangle nor an ellipse.
   *
   * Everything the renderer did not recognise fell through to a filled rect,
   * so a star drew as a block, a triangle drew as a block, and a hexagon drew
   * as a block. On a board holding one star that is the entire picture: a
   * solid rectangle of the star's colour, which is not a thumbnail of
   * anything.
   *
   * The side count and the star's waist are carried rather than the vertices.
   * A star has ten points and a polygon can have many more; storing the two
   * numbers that generate them is a fraction of the size, and the arithmetic
   * is a line of trigonometry the renderer can do.
   */
  s?: 'polygon' | 'star' | 'line';
  /** Sides for a polygon, points for a star. */
  p?: number;
  /** Star only: waist as a fraction of the outer radius. */
  ir?: number;
  /**
   * Rotation in degrees, when there is any.
   *
   * The summary carried a box and a colour and nothing about which way the
   * object was facing, so every rotated thing on every board drew
   * axis-aligned. On a scatter of squares that is invisible; on the boards
   * whose whole subject *is* orientation it is the picture: Spectrum's three
   * hundred and sixty wedges each turned to face out of a circle, Bloom's
   * petals, Spirograph's bars lying along a tangent, Wave field's tiles
   * tipped by the height of the wave under them. All of them drew as if
   * someone had straightened every one.
   */
  rot?: number;
  /**
   * Outline only: a stroke with nothing inside it.
   *
   * `previewColorOf` falls back to the stroke colour when a shape has no
   * fill, and the renderer then filled the box with it — so an outlined
   * rectangle became a solid one, which is the same mistake as drawing a star
   * as a block. The flag says to stroke the silhouette rather than fill it.
   */
  no?: 1;
}

export interface BoardPreview {
  /** Aspect ratio of the content box, so the drawing is never stretched. */
  ratio: number;
  items: PreviewItem[];
  /** How many objects the board actually holds, including any not drawn. */
  total: number;
  /** Which shape of summary this is. See `PREVIEW_VERSION`. */
  v?: number;
}

/**
 * The summary's own version.
 *
 * Previews are cached in `localStorage` and only rewritten when the board is
 * next opened, so a card can go on drawing a summary written by an older
 * build indefinitely. That is fine while the format only gains *optional*
 * detail — until the missing detail is the difference between a star and a
 * block. A board drawn before shapes were carried keeps its old record, and
 * the card keeps drawing a rectangle, and nothing about the fix reaches it.
 *
 * Bumping this retires every stored summary at once. The cost is a placeholder
 * on cards whose boards have not been opened since; the alternative is a
 * confidently wrong picture, which is worse than an honest absence.
 *
 * Bump it whenever a *renderer* starts relying on a field older records do
 * not have.
 */
export const PREVIEW_VERSION = 3;

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
 * A richer cap, for previews that are computed rather than stored.
 *
 * The 48 above is a *storage* budget — stored previews ride in `localStorage`
 * beside the room list, and there is one per board. A template's picture is
 * computed fresh from its builder and never stored, so it pays none of that
 * and should not inherit the limit.
 *
 * It matters more than a count usually would, because items are kept
 * **largest-first**, and on a generated board size often carries the pattern.
 * Wave field sizes each tile by the height of the wave under it, so keeping
 * the biggest half kept the crests and discarded the troughs — the card
 * showed a grid with holes punched through it, which read as a rendering
 * fault rather than as a surface. The bias is invisible on a board of mixed
 * furniture and destroys any board whose subject *is* the variation.
 *
 * Sized above `PREVIEW_NODE_LIMIT` rather than near it, deliberately. The two
 * numbers meeting is what produced the holes: the builder made 135 tiles and
 * the cap kept 130, so five troughs went missing and the grid looked punched
 * through. Headroom means the cap only ever bites on a board nobody trimmed.
 */
export const MAX_ITEMS_RICH = 170;

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
  pointsOf?: (node: AnyNode) => number[] | null,
  /** Defaults to the storage budget; see `MAX_ITEMS_RICH`. */
  maxItems: number = MAX_ITEMS
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
    .slice(0, maxItems)
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
    if (n.type === 'shape') {
      const geo = n.geometry;
      if (geo.kind === 'ellipse') item.o = 1;
      else if (geo.kind === 'polygon') { item.s = 'polygon'; item.p = geo.points ?? 3; }
      else if (geo.kind === 'star') {
        item.s = 'star';
        item.p = geo.points ?? 5;
        item.ir = geo.innerRatio ?? 0.5;
      } else if (geo.kind === 'line' || geo.kind === 'arrow') {
        // Open shapes have no interior. Drawn as a filled box they became the
        // one thing they can never be: solid.
        item.s = 'line';
        item.c = n.appearance?.stroke?.color ?? item.c;

        /**
         * The run it actually draws, not a stroke across the middle of its box.
         *
         * The card drew every line as one horizontal rule from the left edge of
         * its box to the right, which is wrong twice over. A line that runs
         * corner to corner came out flat, and a line with a **profile** — wavy,
         * zigzag, curved, or the coil — lost the entire thing that makes it that
         * profile. A board of loops had a thumbnail of plain rules, which is a
         * confidently wrong picture rather than a simplified one.
         *
         * Through `linePoints`, so the card and the canvas draw from one
         * description. The point list is normalised into the same 0..1 space
         * `x`/`y` use, reusing the `l` polyline field connectors already added
         * for exactly this reason.
         */
        const ends = localRunEnds(n);
        const run = linePoints(
          { x: n.x + ends.a.x, y: n.y + ends.a.y },
          { x: n.x + ends.b.x, y: n.y + ends.b.y },
          geo.lineProfile,
          geo.lineWaves
        );
        if (run.length >= 2) {
          /**
           * Sampled down before it is stored.
           *
           * A coil at twenty loops is several hundred points, and this goes
           * into `localStorage` for every line on every board. A thumbnail is
           * at most a couple of hundred pixels across, so anything past a few
           * dozen points is bytes nobody can see. The first and last are always
           * kept, because the ends are where a line visibly starts and stops.
           */
          const stride = Math.max(1, Math.ceil(run.length / PREVIEW_LINE_POINTS));
          const flat: number[] = [];
          for (let i = 0; i < run.length; i += stride) {
            flat.push(round((run[i].x - minX) / boardW), round((run[i].y - minY) / boardH));
          }
          const last = run[run.length - 1];
          flat.push(round((last.x - minX) / boardW), round((last.y - minY) / boardH));
          item.l = flat;
        }
      }
    }
    // Only when it is actually turned: a `rotate(0 …)` on every object is
    // bytes in `localStorage` and an attribute on every node for nothing.
    const angle = n.rotation || 0;
    if (Math.abs(angle) > 0.01) item.rot = round(angle);

    /**
     * A shape with a stroke and no fill is an outline.
     *
     * Frames are excluded: their fill is genuinely white paper and they carry
     * their own hairline in the renderer.
     */
    const paint = (n as { appearance?: { fill?: unknown[]; stroke?: { color?: string } } }).appearance;
    if (n.type !== 'frame' && !paint?.fill?.length && paint?.stroke?.color) item.no = 1;

    if (n.type === 'frame') item.k = 1;
    if (n.type === 'text') {
      item.t = 1;
      const size = (n as { typography?: { fontSize?: number } }).typography?.fontSize;
      if (size && size > 0) item.fs = round(size / boardH);
    }

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
export const EMPTY_PREVIEW: BoardPreview = { ratio: 1, items: [], total: 0 };

export function savePreview(roomId: string, preview: BoardPreview | null): void {
  try {
    /**
     * An empty board is recorded, not forgotten.
     *
     * `buildPreview` returns null when there is nothing visible to draw, and
     * this used to answer by deleting the key — which collapsed two different
     * facts into one absence. A missing record means *this device has never
     * opened that board*; an empty one means *it has, and there is nothing on
     * it*. With only the absence to go on, every empty board you had made
     * yourself was captioned "Not opened on this device", which is simply
     * untrue and is exactly the kind of confident wrong answer a placeholder
     * must never give.
     */
    const record = { ...(preview ?? EMPTY_PREVIEW), v: PREVIEW_VERSION };
    localStorage.setItem(KEY_PREFIX + roomId, JSON.stringify(record));
  } catch {
    /* A full or unavailable store must never take the room down with it. */
  }
}

export function loadPreview(roomId: string): BoardPreview | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + roomId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BoardPreview;
    if (!Array.isArray(parsed?.items)) return null;
    // An older summary is not drawn. It would be drawn *wrongly* — the fields
    // the renderer now needs are simply absent, and absent reads as "plain
    // rectangle" rather than as "unknown".
    if (parsed.v !== PREVIEW_VERSION) return null;
    return parsed;
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

/**
 * The vertices of a preview item that is a polygon or a star.
 *
 * Lives here rather than inside the cover component for the reason every
 * other piece of arithmetic in this project does: a shape that draws wrongly
 * is a bug you can only find by looking at a thumbnail, and looking at a
 * thumbnail is exactly what nobody does before shipping. As a pure function
 * it can simply be asserted.
 *
 * Both start at twelve o'clock, which is where the shape tool draws them, so
 * the silhouette matches the board rather than being the same shape at some
 * other rotation.
 */
export function previewPolygonPoints(
  item: Pick<PreviewItem, 's' | 'p' | 'ir'>,
  x: number,
  y: number,
  w: number,
  h: number
): Array<[number, number]> {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const count = Math.max(3, Math.round(item.p ?? 3));
  const isStar = item.s === 'star';
  const inner = isStar ? Math.min(0.95, Math.max(0.05, item.ir ?? 0.5)) : 1;
  const steps = isStar ? count * 2 : count;

  const out: Array<[number, number]> = [];
  for (let k = 0; k < steps; k += 1) {
    const angle = (k / steps) * Math.PI * 2 - Math.PI / 2;
    const r = isStar && k % 2 === 1 ? inner : 1;
    out.push([cx + Math.cos(angle) * rx * r, cy + Math.sin(angle) * ry * r]);
  }
  return out;
}
