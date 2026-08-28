import type { Point } from '../model/schema';
import type { Rect, Size } from '../model/imageCrop';
import { pointInPolygon, rotatePoint } from '../model/shapePerimeter';
import type { StyledCell } from './gridStyle';

/**
 * Pictures that live in a grid's modules.
 *
 * ## What a slot is, and what it deliberately is not
 *
 * A slotted image is an **ordinary `ImageNode`** that happens to carry a
 * `gridSlot` naming the grid and the module it belongs to. It is not a new node
 * type, not a child in a Konva group, and not a field on the grid's recipe.
 *
 * That choice is the whole design, and it buys four things at once: the picture
 * appears in the Layers panel, keeps Adjust, crop and every other image
 * control, exports through the PNG, SVG and JSON paths with no new code in any
 * of them, and can be clicked, replaced or dragged out like anything else on
 * the board. The alternative — image sources stored per cell index on the
 * recipe and drawn by `GridRenderer` — would have needed a second image
 * pipeline in all three exporters and would have made the pictures unreachable
 * to every control that already exists.
 *
 * ## Where the position comes from
 *
 * Not from here, and not from the image. A grid stores a box and a recipe and
 * *derives* its modules on every draw (`gridNode.ts`), so the module a picture
 * sits in has no stored position to copy. The image's own `x`/`y`/`width`/
 * `height` stay real and authoritative — that is what keeps the spatial index,
 * the transformer, culling and export bounds working without a single special
 * case — and they are **recomputed from the grid** whenever the grid changes,
 * by one owner (`gridReflow.ts`).
 *
 * The rule that makes that safe is the one this file exists to hold: every
 * function here is a *pure function of the grid's box and the cell*, so any two
 * clients, at any time, compute the same answer. A slot cannot drift into being
 * wrong, only into being stale, and a stale slot is repaired by running the
 * same function again.
 *
 * ## Why the box is the cell and the crop does the fitting
 *
 * A covered picture could be expressed two ways: give the node the cell's box
 * and crop the source to the cell's aspect, or give the node the *picture's*
 * aspect and clip the overflow away. The first is used here because the node's
 * box is then exactly the module's box — so it lines up with the grid at every
 * zoom with no clipping needed for a rectangular module, the selection outline
 * is the module, and `computeContentBounds` (which every exporter frames from)
 * measures the grid rather than the untrimmed picture hanging off it.
 */

/** The grid module a picture or a caption is sitting in. */
export interface GridSlot {
  /** The grid node that owns the module. */
  gridId: string;
  /** Which module, by the index `layoutGrid` gave it. */
  cell: number;
  /**
   * Which point of the source sits under the module's centre, `0..1` on each
   * axis. Absent means the middle, which is what a fresh cover does.
   *
   * ## Why an intent rather than the crop it produces
   *
   * The crop is already stored on the image, so the obvious thing is to let a
   * drag write it and have the reflow leave it alone. That does not survive the
   * one event this feature exists to survive: **the module changing shape.** A
   * stored crop has the old module's aspect ratio, and there is no way to
   * recover, from the rectangle alone, which part of the picture the person
   * cared about — re-covering re-centres and throws their framing away, keeping
   * it stretches the picture.
   *
   * A focal point has neither problem because it is aspect-free. "Show me this
   * point" is answerable in any module of any shape, which is exactly why every
   * image CMS stores a focal point rather than a set of crops.
   *
   * Normalized to the *source*, not to the travel available. Travel depends on
   * the module and the zoom, so a fraction of it would mean something different
   * after every edit; a fraction of the bitmap means the same thing forever.
   */
  focus?: Point;
  /**
   * How far in, past the size that just covers the module. `1` is a plain
   * cover; `2` shows a quarter of the area. Absent means `1`.
   */
  zoom?: number;
}

/** A plain cover. Below this the picture would not fill the module. */
export const SLOT_MIN_ZOOM = 1;
/**
 * As far in as the control goes.
 *
 * Eight is where a 4000px photograph still has ~500px across a module, which is
 * about where any further and you are looking at the bitmap rather than the
 * picture. A cap is needed at all because the window shrinks as the reciprocal
 * of this, and nothing else stops it reaching zero.
 */
export const SLOT_MAX_ZOOM = 8;

/** How the content is framed inside its module. The adjustable half of a slot. */
export type SlotFit = Pick<GridSlot, 'focus' | 'zoom'>;

/** The part of a grid node this module needs. Kept structural so tests need no document. */
export interface SlotGrid {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * The window onto the source that fills a module edge to edge.
 *
 * "Cover", as CSS and every design tool mean it: the picture is scaled until it
 * covers the module completely and centred, and whatever hangs over the short
 * axis is trimmed. Expressed as a crop rather than as a scale because the node
 * box is already the module's box — the crop is the only remaining degree of
 * freedom, and it is the one Konva and `drawImage` both take directly.
 *
 * The aspect comparison is done by cross-multiplying rather than by dividing,
 * so a zero never reaches a denominator.
 *
 * Returns `null` when it cannot be computed — a module with no area, or a
 * bitmap whose natural size nobody has recorded yet. **`null` means "write no
 * crop", not "write nothing"**: the picture still takes the module's box and
 * shows its whole self, which is momentarily stretched but visible and correct
 * in every other respect. `ImageRenderer` records the natural size the first
 * time any client loads the bitmap, and the reflow that follows turns this into
 * a real cover. Refusing to place it until the size was known would instead
 * leave the module empty for as long as the picture took to load.
 */
export function coverCrop(cell: Size, natural: Size, fit?: SlotFit): Rect | null {
  if (!usable(cell.width) || !usable(cell.height)) return null;
  if (!usable(natural.width) || !usable(natural.height)) return null;

  // natural is wider than the cell  <=>  nw/nh > cw/ch  <=>  nw*ch > cw*nh
  const sourceIsWider = natural.width * cell.height > cell.width * natural.height;

  // The window at zoom 1: the largest one with the module's aspect that still
  // fits inside the bitmap. One of its two sides is therefore a whole side of
  // the source, which is what makes the clamp below always solvable.
  const base = sourceIsWider
    ? { width: (natural.height * cell.width) / cell.height, height: natural.height }
    : { width: natural.width, height: (natural.width * cell.height) / cell.width };

  const zoom = clampZoom(fit?.zoom);
  const width = base.width / zoom;
  const height = base.height / zoom;

  /**
   * Where the person wants the middle of the module to look, clamped to what
   * the bitmap can actually show.
   *
   * The clamp is the whole reason this is not two multiplications. A focal
   * point near an edge asks for a window that runs off the source, and
   * Canvas2D's answer to being asked for pixels outside a bitmap is to draw
   * transparent ones — a soft, partial edge that appears at some sizes and not
   * others, which `imageCrop.ts` records as "a genuinely horrible bug to
   * chase". Clamping the *centre* to the half-window inset means the window is
   * always wholly inside, and panning simply stops at the edge of the picture
   * the way it does in every photo tool.
   *
   * `width <= natural.width` always holds — the base window fits by
   * construction and zoom only shrinks it — so the interval never inverts.
   */
  const centre = {
    x: clamp(unit(fit?.focus?.x, 0.5) * natural.width, width / 2, natural.width - width / 2),
    y: clamp(unit(fit?.focus?.y, 0.5) * natural.height, height / 2, natural.height - height / 2),
  };

  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A stored `0..1` fraction, or the default when it is missing or nonsense. */
const unit = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? clamp(n, 0, 1) : fallback;

/** A stored zoom, brought into the range the window maths can express. */
export const clampZoom = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? clamp(n, SLOT_MIN_ZOOM, SLOT_MAX_ZOOM) : SLOT_MIN_ZOOM;

/**
 * Where the focal point moves when the content is nudged by a world distance.
 *
 * ## Why an arrow key means this and not what it usually means
 *
 * Arrows nudge the selection, and a slotted picture cannot be nudged: its box
 * belongs to the module, so the reflow would put it straight back. The press
 * would be swallowed and nothing would happen — a key that looks bound and is
 * not, which is the shape of dead capability this codebase keeps finding.
 *
 * What the gesture obviously means for a picture in a frame is *move the
 * picture inside the frame*, so that is what it does. The object is fixed and
 * the content moves under it.
 *
 * ## The sign, which is the part worth reading twice
 *
 * Pushing the picture **right** shows more of its **left**, so the window
 * travels left and the focal point *decreases*. Getting this backwards is not
 * a crash, it is a control that fights the hand holding it.
 *
 * The distance is converted through the window rather than through the bitmap:
 * one world unit of movement is `window.width / cell.width` source pixels,
 * which is what keeps a nudge the same visible distance whether the picture is
 * a 300px thumbnail or a 6000px original, and whether it is zoomed in or not.
 */
export function nudgeFocus(
  cell: Size,
  natural: Size,
  fit: SlotFit | undefined,
  dxWorld: number,
  dyWorld: number
): Point | null {
  const window = coverCrop(cell, natural, fit);
  if (!window || !usable(natural.width) || !usable(natural.height)) return null;
  if (!usable(cell.width) || !usable(cell.height)) return null;

  const sourcePerWorldX = window.width / cell.width;
  const sourcePerWorldY = window.height / cell.height;

  /**
   * Read back from the *clamped* window rather than from the stored focus.
   *
   * A focus that was already pushed against an edge is stored as whatever
   * number was written, while the window it produced sits at the limit. Adding
   * to the stored value would then do nothing visible for as many presses as it
   * took to get back inside the range — the control would ignore you and then
   * suddenly start working. Starting from where the window actually is means
   * the first press away from an edge moves.
   */
  const current = {
    x: (window.x + window.width / 2) / natural.width,
    y: (window.y + window.height / 2) / natural.height,
  };

  return {
    x: clamp(current.x - (dxWorld * sourcePerWorldX) / natural.width, 0, 1),
    y: clamp(current.y - (dyWorld * sourcePerWorldY) / natural.height, 0, 1),
  };
}

/**
 * Zooming about a point, so what is under the cursor stays under the cursor.
 *
 * ## Why the anchor matters
 *
 * Zooming about the centre is the easy version and it is the wrong one for a
 * picture in a frame. The reason anyone zooms in on a photograph is to make a
 * particular part of it fill the module, and a centre zoom pushes that part
 * away as it grows: you enlarge, the face drifts off the edge, you pan it
 * back, you enlarge again. Anchoring the gesture where the pointer is turns
 * two alternating gestures into one, and it is what every map and every photo
 * tool does.
 *
 * The anchor is given as a fraction of the module, `0..1` on each axis, which
 * is the one form that does not need to know where the module is on the board
 * or which way it is turned. The overlay converts the pointer once; this stays
 * pure arithmetic.
 *
 * ## Why the result can still drift
 *
 * `coverCrop` clamps the window to the bitmap, so anchoring near an edge of a
 * picture that is already against that edge cannot hold the point perfectly
 * still. That is not an error to correct: the alternative is showing
 * transparent pixels past the edge of the photograph, which `coverCrop`
 * documents at length as the bug worth never having again. Panning stops at
 * the edge of the picture, the way it does everywhere else.
 */
export function zoomAtPoint(
  cell: Size,
  natural: Size,
  fit: SlotFit | undefined,
  nextZoom: number,
  anchor: Point
): SlotFit | null {
  const window = coverCrop(cell, natural, fit);
  if (!window || !usable(natural.width) || !usable(natural.height)) return null;

  const from = clampZoom(fit?.zoom);
  const to = clampZoom(nextZoom);
  const ax = clamp(anchor.x, 0, 1);
  const ay = clamp(anchor.y, 0, 1);

  // The window at the new zoom. Derived from the current one rather than from
  // the base, so this needs no second opinion about what zoom 1 looks like.
  const width = (window.width * from) / to;
  const height = (window.height * from) / to;

  // The source pixel the pointer is over now, which is the one to hold.
  const held = { x: window.x + ax * window.width, y: window.y + ay * window.height };

  return {
    zoom: to,
    focus: {
      x: clamp((held.x - ax * width + width / 2) / natural.width, 0, 1),
      y: clamp((held.y - ay * height + height / 2) / natural.height, 0, 1),
    },
  };
}

/**
 * Where the whole picture sits in world space, given the part of it on show.
 *
 * The overlay draws the parts of the photograph the module is *not* showing,
 * faintly, outside the frame. Without them there is nothing to aim at: you
 * cannot judge a crop from the surviving rectangle alone, because the question
 * you are asking is about what sits one step outside it. `imageCrop.ts` calls
 * the equivalent for a loose image `sourceBoxInWorld` and gives the same
 * reasoning at more length.
 *
 * The two scales are equal by construction -- `coverCrop` returns a window
 * with the module's own aspect -- so either would do. Both are computed
 * because reading `box.height / window.height` beside its partner is what
 * makes the expression check itself.
 */
export function sourceBoxForSlot(
  box: Rect,
  natural: Size,
  window: Rect | null
): Rect | null {
  if (!window || !usable(window.width) || !usable(window.height)) return null;
  if (!usable(natural.width) || !usable(natural.height)) return null;

  const scaleX = box.width / window.width;
  const scaleY = box.height / window.height;

  return {
    x: box.x - window.x * scaleX,
    y: box.y - window.y * scaleY,
    width: natural.width * scaleX,
    height: natural.height * scaleY,
  };
}

/**
 * The smallest module that can usefully hold something, in world units.
 *
 * ## Why a size and not a list of grid kinds
 *
 * The obvious way to answer "which grids can hold pictures" is a list —
 * modular yes, orbit no. That list would be wrong twice over. It would be a
 * second record of a fact the geometry already carries (invariant 7), and it
 * would be wrong about the actual question: an orbit grid's modules are 22
 * units across *at the size people draw them*, and a large one's are not. The
 * property that matters is whether you could see what the picture is, and that
 * is a fact about the module, not about the kind it came from.
 *
 * So this is derived, and it falls out correctly for every kind without naming
 * any of them. At the default 600x400 it excludes exactly one — orbit, whose
 * modules are a scatter of dots — and admits a baseline grid's strips, which
 * are shallow but perfectly able to hold a letterboxed photograph.
 *
 * Thirty-two is about the smallest square in which a photograph is still a
 * picture rather than a swatch.
 */
export const MIN_SLOT_SIZE = 32;

/** Whether a module is big enough to be worth putting something in. */
export function canHoldContent(cell: { width: number; height: number }): boolean {
  return Math.min(cell.width, cell.height) >= MIN_SLOT_SIZE;
}

/** How many parked items sit side by side before the strip wraps. */
const PARK_PER_ROW = 6;
/** The air between parked items, and between them and the grid. */
const PARK_GAP = 8;
const PARK_OFFSET = 16;
/** A parked item is never smaller than this, or larger than this. */
const PARK_MIN = 24;
const PARK_MAX = 140;

/**
 * Where content waits when its module does not currently exist.
 *
 * ## The problem this solves, which is the whole reason it exists
 *
 * Changing a grid's kind changes how many modules it has, and the range is
 * enormous — one for a manuscript grid, thirty-six for an orbit. So cycling
 * through arrangements to see which you like is a gesture that repeatedly asks
 * nine pictures to fit into four modules, and then into thirty-six, and then
 * into one.
 *
 * The first implementation **released** the ones that did not fit: it dropped
 * the binding and left them where they were. That is defensible for a
 * deliberate "make this 2x2" and it is badly wrong for browsing, because
 * browsing is exactly what the shuffle button and the kind picker are for. Try
 * five arrangements and the fifth has permanently loosened your photographs
 * into a pile on top of the grid, and going back does not bring them home.
 *
 * **A gesture for exploring must not destroy anything.** So nothing is released
 * by changing a grid any more. Content that has no module waits in a tidy strip
 * below the grid, still bound, and walks straight back into place the moment an
 * arrangement with enough modules comes round again. Releasing is now only ever
 * something a person asks for.
 *
 * ## Why it moves rather than staying put
 *
 * Leaving it where it was is the other option and it looks broken: nine
 * pictures keep the positions of nine modules that are no longer there, so they
 * sit on top of whatever the new arrangement drew, overlapping it. The strip
 * says "these are yours, they are waiting, they are not in the composition" —
 * which is true, and legible at a glance.
 *
 * Laid out in the grid's own coordinates, below its bottom edge, so `slotBox`
 * carries it into the world and handles a rotated grid for free.
 */
export function parkedCell(
  ordinal: number,
  grid: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const across = Math.max(
    PARK_MIN,
    Math.min(PARK_MAX, (grid.width - PARK_GAP * (PARK_PER_ROW - 1)) / PARK_PER_ROW)
  );
  const row = Math.floor(ordinal / PARK_PER_ROW);
  const col = ordinal % PARK_PER_ROW;
  return {
    x: col * (across + PARK_GAP),
    y: grid.height + PARK_OFFSET + row * (across + PARK_GAP),
    width: across,
    height: across,
  };
}

/**
 * Where a module sits on the board, and how it is turned.
 *
 * Cells are laid out in the grid's **own** coordinates — `(0, 0)` is its top
 * left — because that is what lets the renderer draw them inside an already
 * positioned Konva group and what stops a move from re-laying the grid. A
 * slotted image is *not* inside that group, though: it is a sibling in the flat
 * node list, the same arrangement frames and their children have, and for the
 * same reasons (per-object subscriptions and spatial culling both need the list
 * flat). So the module's local rectangle has to be carried out to world space
 * here, and that is the one place the two spaces meet.
 *
 * Rotation is applied about the **grid's centre**, because that is what every
 * object on this canvas rotates about, and the picture is handed the grid's own
 * rotation so a turned grid holds turned pictures square to their modules
 * rather than upright inside a tilted frame.
 *
 * `x`/`y` come back as a top-left corner, which is what `BaseNode` stores —
 * Konva's group is placed at the centre and its contents offset back, but that
 * is the renderer's business and never the document's.
 */
export function slotBox(grid: SlotGrid, cell: { x: number; y: number; width: number; height: number }): Rect & { rotation: number } {
  const rotation = grid.rotation ?? 0;
  const gridCentre = { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 };
  const cellCentreUnturned = {
    x: grid.x + cell.x + cell.width / 2,
    y: grid.y + cell.y + cell.height / 2,
  };
  const centre = rotatePoint(cellCentreUnturned, gridCentre, rotation);
  return {
    x: centre.x - cell.width / 2,
    y: centre.y - cell.height / 2,
    width: cell.width,
    height: cell.height,
    rotation,
  };
}

/**
 * A world point, in the grid's own coordinates.
 *
 * The exact inverse of what `slotBox` does on the way out, and it exists so
 * that dropping a picture and placing a picture are answering the same question
 * in the same space rather than two arithmetics that have to agree. Turning the
 * *point* backwards about the grid's centre is what lets everything downstream
 * — the module hit test especially — work in the upright, unrotated layout the
 * grid was laid out in, instead of every consumer learning about rotation.
 */
export function gridLocalPoint(grid: SlotGrid, p: Point): Point {
  const centre = { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 };
  const unturned = rotatePoint(p, centre, -(grid.rotation ?? 0));
  return { x: unturned.x - grid.x, y: unturned.y - grid.y };
}

/**
 * Which module a point is in, in the grid's own coordinates.
 *
 * Two passes, and the second one is the one that makes dropping a picture feel
 * like aiming at a box rather than threading a needle:
 *
 * 1. **A real hit**, against the module's own silhouette where it has one — a
 *    radial grid's modules are ring sectors, and their bounding boxes overlap
 *    each other heavily, so testing boxes there would hand a drop to a
 *    neighbour the pointer was visibly nowhere near.
 * 2. **The nearest module centre**, for everything else. Most of a loose grid's
 *    surface is gutter and margin, and a drop into a gutter has exactly one
 *    sensible reading: the module you were aiming at. Refusing it instead would
 *    mean a drop that lands two pixels wide silently does nothing.
 *
 * The fallback is deliberately unbounded *within the grid* — the caller decides
 * whether the point is over the grid at all, which it must do anyway to pick
 * the grid. Returns `null` only for a grid with no modules.
 */
export function cellIndexAt(cells: readonly StyledCell[], p: Point): number | null {
  if (cells.length === 0) return null;

  for (const cell of cells) {
    if (cell.outline && cell.outline.length >= 3) {
      const local = { x: p.x - cell.x, y: p.y - cell.y };
      if (pointInPolygon(cell.outline, local)) return cell.index;
      continue;
    }
    if (
      p.x >= cell.x &&
      p.x <= cell.x + cell.width &&
      p.y >= cell.y &&
      p.y <= cell.y + cell.height
    ) {
      return cell.index;
    }
  }

  let best = cells[0];
  let bestDistance = Infinity;
  for (const cell of cells) {
    const dx = p.x - (cell.x + cell.width / 2);
    const dy = p.y - (cell.y + cell.height / 2);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best.index;
}

/** What a bulk insert decided. */
export interface SlotAssignment {
  /** One picture, and the module it is going into. */
  placed: { imageId: string; cell: number }[];
  /**
   * The pictures there was no room for.
   *
   * Returned rather than dropped so the caller can *say so*. Filling nine of
   * twelve modules and silently discarding three is the kind of quiet partial
   * success that gets discovered later, by which point nobody remembers which
   * three.
   */
  overflow: string[];
}

/**
 * Which picture goes in which module.
 *
 * Reading order, into the modules that are free. Reading order is the whole
 * point — `layoutGrid` numbers modules the way the grid is read, so a set of
 * photographs dropped on a 3x3 lands in the arrangement the file names were in,
 * which is the arrangement the person doing it has in their head.
 *
 * **Occupied modules are skipped, not overwritten.** Bulk insert onto a grid
 * that already holds pictures is far more often "fill in the rest" than "start
 * again", and starting again is unrecoverable in a way filling in is not.
 * Replacing one picture is a separate, deliberate gesture: drop onto it.
 *
 * `unavailable` carries both reasons a module cannot be used — it already holds
 * something, or it is too small to hold anything (`canHoldContent`). They are
 * one set rather than two arguments because the answer here is the same either
 * way: skip it and take the next.
 */
export function assignSlots(
  cellCount: number,
  imageIds: readonly string[],
  unavailable: ReadonlySet<number> = new Set()
): SlotAssignment {
  const placed: { imageId: string; cell: number }[] = [];
  const overflow: string[] = [];

  let cell = 0;
  for (const imageId of imageIds) {
    while (cell < cellCount && unavailable.has(cell)) cell += 1;
    if (cell >= cellCount) {
      overflow.push(imageId);
      continue;
    }
    placed.push({ imageId, cell });
    cell += 1;
  }

  return { placed, overflow };
}

/**
 * The free modules, in the order a fill should take them, starting somewhere.
 *
 * Reading order from the module that was aimed at, **wrapping round to the
 * start**. The wrap is the part that matters: dropping a folder of photographs
 * onto the middle of an empty grid should fill the grid, not just the half
 * below the pointer, and stopping at the end would silently discard the rest
 * while free modules sat visible above the drop.
 */
export function freeCellsFrom(
  cellCount: number,
  unavailable: ReadonlySet<number>,
  start: number
): number[] {
  const out: number[] = [];
  if (cellCount <= 0) return out;
  const from = Math.min(Math.max(0, Math.floor(start)), cellCount - 1);
  for (let step = 0; step < cellCount; step += 1) {
    const cell = (from + step) % cellCount;
    if (!unavailable.has(cell)) out.push(cell);
  }
  return out;
}

/**
 * A slot off the wire, made safe.
 *
 * Total, like every normalizer here. A slot naming a grid that has since been
 * deleted is *not* rejected at this boundary — this cannot see the document,
 * and a picture whose grid a collaborator removed must keep its box and stay on
 * the board rather than vanish. `gridReflow` is what notices the grid is gone
 * and releases the slot, because that is the layer that can tell the difference
 * between "deleted" and "not loaded yet".
 */
export function normalizeSlot(raw: unknown): GridSlot | undefined {
  const s = raw as Partial<GridSlot> | undefined | null;
  if (!s || typeof s.gridId !== 'string' || s.gridId.length === 0) return undefined;
  if (typeof s.cell !== 'number' || !Number.isFinite(s.cell) || s.cell < 0) return undefined;

  const slot: GridSlot = { gridId: s.gridId, cell: Math.floor(s.cell) };

  /**
   * The framing is written back only when it says something.
   *
   * A centred, unzoomed slot stores neither key, so the common case — every
   * picture that has never been adjusted — carries two fields fewer through
   * the CRDT, and "has this been framed by hand?" stays answerable by looking
   * rather than by comparing against 0.5.
   *
   * `coverCrop` clamps these again on the way out, so this is a tidying rather
   * than the safety barrier; the barrier is where the arithmetic is.
   */
  const focusX = unit(s.focus?.x, 0.5);
  const focusY = unit(s.focus?.y, 0.5);
  if (focusX !== 0.5 || focusY !== 0.5) slot.focus = { x: focusX, y: focusY };

  const zoom = clampZoom(s.zoom);
  if (zoom !== SLOT_MIN_ZOOM) slot.zoom = zoom;

  return slot;
}
