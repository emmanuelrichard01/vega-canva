/**
 * Frames: the bounded regions on an unbounded canvas.
 *
 * `FrameNode` has been in the schema since the beginning. `ObjectRenderer`
 * draws one, `SVGExporter` serializes one, and `normalize.ts` even migrates a
 * legacy `artboard` type onto it — but **no tool has ever created one**, so a
 * frame could not exist in a real document. This module is the first half of
 * fixing that.
 *
 * Frames are the structural unlock for most of what is still missing:
 * sections, constraints, auto-layout, safe zones, per-frame export and the
 * whole of prototyping are all defined in terms of a bounded region.
 */

/**
 * Insets from a frame's four edges, in world units.
 *
 * Four numbers rather than one, because the case that most needs a safe area
 * is the one that is not symmetrical: a 1080x1920 story has the app's own
 * interface over roughly the top 250 and bottom 320 units, and nothing over
 * the sides. A single inset would either let a caption be swallowed by the
 * reply bar or waste 320 units of width to protect against nothing.
 */
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The glyph a preset is shown with; drawn by `FramePresetIcon`. */
export type FramePresetIcon =
  | 'desktop'
  | 'laptop'
  | 'tablet'
  | 'phone'
  | 'slide'
  | 'square'
  | 'portrait'
  | 'story'
  | 'video'
  | 'link'
  | 'page'
  | 'card';

export interface FramePreset {
  id: string;
  label: string;
  /** For grouping in the picker. */
  group: 'Screen' | 'Slides' | 'Social' | 'Print';
  icon: FramePresetIcon;
  width: number;
  height: number;
  /**
   * Where this size is known to eat content, if anywhere.
   *
   * Seeded onto the frame at creation and editable afterwards, rather than
   * looked up from the preset when drawing: a frame resized from 1080x1920 to
   * something else is no longer a story, and guides derived from a size match
   * would either vanish on a one-pixel nudge or keep claiming a safe area that
   * no longer means anything.
   */
  safeArea?: Inset;
}

/** All four edges the same, for the cases that are symmetrical. */
function evenInset(value: number): Inset {
  return { top: value, right: value, bottom: value, left: value };
}

/**
 * The sizes worth one click.
 *
 * Deliberately short. A picker with forty entries is a search problem, and the
 * custom drag covers everything not on this list — these are the ones common
 * enough that typing the numbers would be the annoying part.
 *
 * Print sizes are in **points at 72dpi**, which is what a PDF and an SVG both
 * use as their user unit, so an A4 frame exported at 1x is a real A4 page
 * rather than something that needs a scale factor explained to it.
 */
export const FRAME_PRESETS: FramePreset[] = [
  { id: 'desktop', label: 'Desktop', group: 'Screen', icon: 'desktop', width: 1440, height: 1024 },
  { id: 'desktop-hd', label: 'Desktop HD', group: 'Screen', icon: 'desktop', width: 1920, height: 1080 },
  { id: 'laptop', label: 'Laptop', group: 'Screen', icon: 'laptop', width: 1280, height: 800 },
  { id: 'tablet', label: 'Tablet', group: 'Screen', icon: 'tablet', width: 820, height: 1180 },
  { id: 'phone', label: 'Phone', group: 'Screen', icon: 'phone', width: 390, height: 844 },
  // A projector or a shared screen crops nothing, but a talk recorded for a
  // feed is cut to fit, so the margin keeps a title off the edge either way.
  { id: 'slide', label: 'Slide 16:9', group: 'Slides', icon: 'slide', width: 1920, height: 1080, safeArea: evenInset(64) },
  { id: 'slide-4-3', label: 'Slide 4:3', group: 'Slides', icon: 'slide', width: 1440, height: 1080, safeArea: evenInset(64) },
  // A square post is cropped to 4:5 or 1.91:1 depending on where it is shown,
  // and the grid thumbnail crops it again — 64 units in from every edge is
  // what survives all of that.
  { id: 'square', label: 'Square 1:1', group: 'Social', icon: 'square', width: 1080, height: 1080, safeArea: evenInset(64) },
  // 4:5 is the tallest a feed will show uncropped, which is why it is the
  // format anything meant to be *read* in a feed is made at.
  { id: 'portrait-post', label: 'Portrait 4:5', group: 'Social', icon: 'portrait', width: 1080, height: 1350, safeArea: evenInset(64) },
  // The story's own interface: the profile row and close button along the top,
  // the reply bar and share row along the bottom. The sides are clear.
  { id: 'story', label: 'Story 9:16', group: 'Social', icon: 'story', width: 1080, height: 1920, safeArea: { top: 250, right: 64, bottom: 320, left: 64 } },
  // A video thumbnail is shown at a dozen sizes down to about 120 units wide,
  // and the player's own duration chip sits over the bottom-right corner.
  { id: 'thumbnail', label: 'Video thumbnail', group: 'Social', icon: 'video', width: 1280, height: 720, safeArea: evenInset(48) },
  // The link preview every chat app and social network renders from a page's
  // Open Graph tags. Cropped to 1.91:1 by some and to 2:1 by others, so the
  // inset is what survives the tighter of the two.
  { id: 'og', label: 'Link preview', group: 'Social', icon: 'link', width: 1200, height: 630, safeArea: { top: 40, right: 60, bottom: 40, left: 60 } },
  // A quarter-inch at 72dpi: the margin a desktop printer cannot reach, so
  // anything outside it is not printed however the file is prepared.
  { id: 'a4', label: 'A4', group: 'Print', icon: 'page', width: 595, height: 842, safeArea: evenInset(18) },
  { id: 'a3', label: 'A3', group: 'Print', icon: 'page', width: 842, height: 1191, safeArea: evenInset(18) },
  { id: 'letter', label: 'US Letter', group: 'Print', icon: 'page', width: 612, height: 792, safeArea: evenInset(18) },
  { id: 'a5', label: 'A5', group: 'Print', icon: 'page', width: 420, height: 595, safeArea: evenInset(18) },
  // 3.5 x 2 inches at 72dpi. The inset is a full eighth of an inch, because a
  // card is guillotined rather than printed to its edge and the cut wanders.
  { id: 'card', label: 'Business card', group: 'Print', icon: 'card', width: 252, height: 144, safeArea: evenInset(9) },
];

/**
 * The same preset, turned.
 *
 * ## Why this rather than twice as many presets
 *
 * The list above is deliberately short — a picker with forty entries is a
 * search problem, and this module says so. But half the sizes people want are
 * a listed size on its side: a landscape phone, a portrait slide, an A4 turned
 * for a certificate. Listing both of every one would double the list to buy a
 * single bit of information, which is the trade a *control* makes far better
 * than a catalogue.
 *
 * So orientation is one toggle beside the picker, and nine entries become
 * eighteen sizes without a longer list to read.
 *
 * ## The safe area is transposed, not rotated
 *
 * A quarter turn was the first instinct and it is wrong for a **toggle**: two
 * quarter turns in the same direction is a half turn, so pressing the control
 * twice would leave a story's guide upside down rather than back where it
 * started. A toggle has to be its own inverse, and a test caught this
 * immediately.
 *
 * Transposing — swapping top with left and bottom with right — is the
 * operation that actually matches what the control does. Swapping width for
 * height *is* a transpose of the rectangle, so the insets get the same
 * treatment as the box they sit in, and doing it twice is doing nothing.
 *
 * Symmetrical insets, which is most of them, come out identical. The story's
 * 250/64/320/64 is the one that visibly moves, and that is correct too: a
 * landscape story is not a story, so a guide still claiming the app's
 * interface runs along the top would be the wrong kind of confident. It ends
 * up along the side, where it plainly does not belong, which is a better
 * signal than silence.
 */
export function turnPreset(preset: FramePreset): FramePreset {
  return {
    ...preset,
    width: preset.height,
    height: preset.width,
    safeArea: preset.safeArea
      ? {
          top: preset.safeArea.left,
          left: preset.safeArea.top,
          right: preset.safeArea.bottom,
          bottom: preset.safeArea.right,
        }
      : undefined,
  };
}

/** Which way up a preset is drawn. Square counts as neither, so it reads as its own. */
export function orientationOf(preset: Pick<FramePreset, 'width' | 'height'>): 'portrait' | 'landscape' | 'square' {
  if (preset.width === preset.height) return 'square';
  return preset.height > preset.width ? 'portrait' : 'landscape';
}

/**
 * The preset a frame's current size matches, if any.
 *
 * Either orientation counts, so a turned A4 still reads as A4 — which is what
 * lets the panel show a frame's size as a name rather than as two numbers, and
 * lets the orientation toggle know which way it is currently pointing.
 *
 * Exact rather than approximate. A frame one unit off a preset is not that
 * preset: it has been resized deliberately, and telling somebody their
 * 1439-wide frame is a Desktop would be worse than telling them nothing.
 */
export function presetMatching(width: number, height: number, hint?: string): FramePreset | undefined {
  const fits = (p: FramePreset) =>
    (p.width === width && p.height === height) || (p.height === width && p.width === height);
  // Two presets can share a size (Desktop HD and Slide 16:9 are both
  // 1920x1080); the one the frame was made from wins while it still fits.
  const hinted = hint ? FRAME_PRESETS.find((p) => p.id === hint) : undefined;
  if (hinted && fits(hinted)) return hinted;
  return FRAME_PRESETS.find(fits);
}

export const FRAME_PRESET_GROUPS: FramePreset['group'][] = ['Screen', 'Slides', 'Social', 'Print'];

export function framePreset(id: string | undefined): FramePreset | undefined {
  return FRAME_PRESETS.find((p) => p.id === id);
}

/**
 * The rectangle a frame's safe area occupies, in world units, or null.
 *
 * Null rather than the frame's own box when there is nothing to show, so the
 * renderer has one thing to check and cannot draw a guide sitting exactly on
 * the frame's edge — which reads as a border, not as a warning.
 *
 * Insets are clamped so opposing pairs can never cross: a safe area wider than
 * the frame is a mistake in the numbers, and an inside-out rectangle drawn
 * from it is a stranger thing to look at than a collapsed one. Negative insets
 * are dropped for the same reason — a "safe" area larger than the frame is not
 * a safe area, and bleed is a different feature with different export rules.
 */
export function safeAreaBox(frame: {
  x: number;
  y: number;
  width: number;
  height: number;
  safeArea?: Inset;
}): { x: number; y: number; width: number; height: number } | null {
  const inset = frame.safeArea;
  if (!inset) return null;

  const top = Math.max(0, inset.top || 0);
  const right = Math.max(0, inset.right || 0);
  const bottom = Math.max(0, inset.bottom || 0);
  const left = Math.max(0, inset.left || 0);
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return null;

  const width = frame.width - left - right;
  const height = frame.height - top - bottom;
  if (width <= 0 || height <= 0) return null;

  return { x: frame.x + left, y: frame.y + top, width, height };
}

// ---------------------------------------------------------------------------
// Background themes
// ---------------------------------------------------------------------------

export interface FrameTheme {
  id: string;
  label: string;
  /** Null is no background: the frame is an outline over the board. */
  fill: string | null;
}

/**
 * The backgrounds a frame is offered, as Notion offers page colours: white,
 * a few quiet tints that keep any content legible, a dark page for slides,
 * and none. A free colour is still one click away in the Fill section; these
 * are the ones worth a swatch.
 */
export const FRAME_THEMES: readonly FrameTheme[] = [
  { id: 'white', label: 'White', fill: '#FFFFFF' },
  { id: 'paper', label: 'Paper', fill: '#FAF7F2' },
  { id: 'grey', label: 'Grey', fill: '#F1F2F4' },
  { id: 'blue', label: 'Blue', fill: '#EDF3FE' },
  { id: 'green', label: 'Green', fill: '#ECF7EF' },
  { id: 'yellow', label: 'Yellow', fill: '#FDF6E3' },
  { id: 'rose', label: 'Rose', fill: '#FCEEF2' },
  { id: 'violet', label: 'Violet', fill: '#F3F0FD' },
  { id: 'night', label: 'Night', fill: '#1E2027' },
  { id: 'none', label: 'None', fill: null },
];

/** The theme a frame's background matches, or undefined for any other fill. */
export function frameThemeOf(fill: ReadonlyArray<{ type: string; color?: string; opacity?: number }> | undefined): FrameTheme | undefined {
  const visible = (fill ?? []).filter((f) => f.type !== 'solid' || (f.opacity ?? 1) > 0);
  if (visible.length === 0) return FRAME_THEMES.find((t) => t.fill === null);
  if (visible.length !== 1 || visible[0].type !== 'solid') return undefined;
  const color = (visible[0].color ?? '').toUpperCase();
  return FRAME_THEMES.find((t) => t.fill?.toUpperCase() === color);
}

/** The `appearance.fill` a theme writes. */
export function frameThemeFill(theme: FrameTheme): Array<{ type: 'solid'; color: string; opacity: number }> {
  return theme.fill ? [{ type: 'solid', color: theme.fill, opacity: 1 }] : [];
}

/** Size of a frame drawn by a click rather than a drag, with no preset armed. */
export const DEFAULT_FRAME: { width: number; height: number } = { width: 1440, height: 1024 };

/** Below this a drag is a click that happened to wobble. */
export const MIN_FRAME_DRAG = 6;

/** The smallest frame worth having; smaller ones cannot be grabbed or labelled. */
export const MIN_FRAME_SIZE = 24;

/**
 * The next default name, given what is already in the document.
 *
 * Frames are the one object type users refer to *by name* — "look at Phone 2",
 * "export Desktop" — so unlike every other node they are titled at creation
 * rather than labelled by their content. Numbering continues past the highest
 * existing number rather than filling gaps: deleting Frame 2 and having the
 * next frame silently take its name would make yesterday's note about "Frame
 * 2" point at something nobody recognises.
 */
export function nextFrameName(existingTitles: Iterable<string | undefined>): string {
  let highest = 0;
  for (const title of existingTitles) {
    if (typeof title !== 'string') continue;
    const match = /^Frame (\d+)$/.exec(title.trim());
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `Frame ${highest + 1}`;
}

/**
 * Normalize a drag into a frame box.
 *
 * Returns the preset (or default) size centred on the start point when the
 * drag was too small to be a deliberate size — the same rule `ShapeTool`
 * uses, so a click means "give me a sensible one here" everywhere on the
 * canvas rather than only for shapes.
 */
export function frameBoxFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  fallback: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (width <= MIN_FRAME_DRAG || height <= MIN_FRAME_DRAG) {
    return {
      x: start.x - fallback.width / 2,
      y: start.y - fallback.height / 2,
      width: fallback.width,
      height: fallback.height,
    };
  }

  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(MIN_FRAME_SIZE, width),
    height: Math.max(MIN_FRAME_SIZE, height),
  };
}

/**
 * Whether a node's box sits inside a frame's box.
 *
 * **Centre-based, not overlap-based.** An object half in and half out has to
 * belong somewhere, and "the frame its middle is over" is the rule people
 * predict correctly — it matches where the object looks like it is. Requiring
 * full containment instead means dragging something to a frame's edge leaves
 * it stubbornly outside while visibly overlapping, and using any overlap means
 * an object that merely brushes a frame gets captured by it.
 */
export function centreIsInside(
  node: { x: number; y: number; width: number; height: number },
  frame: { x: number; y: number; width: number; height: number }
): boolean {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
}

/**
 * Whether one box sits wholly inside another.
 *
 * The strict rule, used **only when the thing being placed is itself a frame**
 * — see `frameForNode` for why nesting a region cannot use the forgiving rule
 * that ordinary objects get.
 */
export function boxIsInside(
  node: { x: number; y: number; width: number; height: number },
  frame: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    node.x >= frame.x &&
    node.y >= frame.y &&
    node.x + node.width <= frame.x + frame.width &&
    node.y + node.height <= frame.y + frame.height
  );
}

/**
 * Which frame should own this node, given every frame on the board.
 *
 * The **smallest** containing frame wins, so a frame nested inside another
 * takes ownership of what is dropped into it rather than the outer one
 * silently keeping it. Ties break toward the frame drawn last, which is the
 * one on top and therefore the one being pointed at.
 *
 * ## Why a frame is placed by a different rule from everything else
 *
 * Ordinary objects use `centreIsInside`, which is forgiving on purpose: an
 * object half over an edge belongs to the frame its middle is over, because
 * that is where it looks like it is.
 *
 * Applied to a *frame*, that rule produced a **mutual cycle from an entirely
 * ordinary gesture**. Draw a small frame in the middle of a board-sized one and
 * both centres coincide, so each frame's centre is inside the other: the small
 * one is inside the big one (correct), and the big one is "inside" the small
 * one (nonsense, but the rule cannot tell). The document then holds
 * `small.frameId = big` and `big.frameId = small` at once.
 *
 * What that cost was not subtle. `descendantsOfFrame(small)` walks to `big` and
 * everything `big` owns — so **deleting the small frame deleted the outer frame
 * and its entire contents**, and dragging the small frame dragged the whole
 * board region with it. The delete path is cycle-*safe*, in that it terminates,
 * which is exactly why nothing caught this: it did not hang, it just took the
 * wrong things with it.
 *
 * The fix is structural rather than a guard. A frame is a *region*, and one
 * region nests inside another only if it genuinely fits inside it — so
 * frame-in-frame uses whole-box containment and requires the parent to be
 * strictly larger. Containment of that kind is a partial order, so a cycle
 * cannot be expressed at all, whatever order the two assignments happen in and
 * whichever client makes them.
 */
export function frameForNode(
  node: { id?: string; type?: string; x: number; y: number; width: number; height: number },
  frames: Array<{ id: string; x: number; y: number; width: number; height: number; zIndex: number }>
): string | null {
  const nodeIsFrame = node.type === 'frame';
  const nodeArea = node.width * node.height;

  let best: { id: string; area: number; zIndex: number } | null = null;
  for (const frame of frames) {
    // A frame cannot contain itself. Without this a frame dropped anywhere
    // becomes its own child, and every rule that walks a frame's contents
    // then has a cycle to fall into.
    if (node.id !== undefined && frame.id === node.id) continue;

    const area = frame.width * frame.height;

    if (nodeIsFrame) {
      // Whole-box containment, and strictly larger. Equal boxes are two frames
      // stacked, not one nested in the other — and calling them nested would
      // reintroduce the cycle by way of a tie.
      if (!boxIsInside(node, frame) || area <= nodeArea) continue;
    } else if (!centreIsInside(node, frame)) {
      continue;
    }

    if (!best || area < best.area || (area === best.area && frame.zIndex > best.zIndex)) {
      best = { id: frame.id, area, zIndex: frame.zIndex };
    }
  }
  return best?.id ?? null;
}

/**
 * Everything a frame owns, directly or through a nested frame.
 *
 * Used for the operations that treat a frame and its contents as one thing —
 * moving it, and deleting it.
 *
 * `frameForNode` cannot create a cycle, but two people resizing frames at
 * once can merge into `a.frameId = b` and `b.frameId = a`. Following that
 * cycle would make deleting the small frame delete the large one and all it
 * holds. So a node whose own membership chain loops back to itself is treated
 * as belonging to nothing here, and the walk never crosses into a cycle.
 * `repairFrameMembership` (engine/document/upkeep) corrects the stored ids;
 * this keeps the damage out of deletes and moves in the meantime.
 */
export function descendantsOfFrame(
  frameId: string,
  nodes: Array<{ id: string; frameId?: string }>
): string[] {
  const parentOf = new Map<string, string>();
  for (const node of nodes) if (node.frameId) parentOf.set(node.id, node.frameId);
  const inCycle = nodesInMembershipCycles(parentOf);

  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.frameId || inCycle.has(node.id)) continue;
    const siblings = childrenOf.get(node.frameId);
    if (siblings) siblings.push(node.id);
    else childrenOf.set(node.frameId, [node.id]);
  }

  const found: string[] = [];
  const seen = new Set<string>([frameId]);
  const queue = [frameId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }

  return found;
}

/** Ids whose `frameId` chain leads back to themselves. */
export function nodesInMembershipCycles(parentOf: ReadonlyMap<string, string>): Set<string> {
  const inCycle = new Set<string>();
  const settled = new Set<string>();
  for (const start of parentOf.keys()) {
    if (settled.has(start)) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined && !settled.has(current) && !onPath.has(current)) {
      onPath.set(current, path.length);
      path.push(current);
      current = parentOf.get(current);
    }
    if (current !== undefined && onPath.has(current)) {
      for (let i = onPath.get(current)!; i < path.length; i++) inCycle.add(path[i]);
    }
    path.forEach((id) => settled.add(id));
  }
  return inCycle;
}

// ---------------------------------------------------------------------------
// Resize to fit
// ---------------------------------------------------------------------------

/** Breathing room a fitted frame keeps around its contents, in world units. */
export const HUG_PADDING = 40;

/**
 * The frame box that just contains `contents`, plus `padding` on every side.
 *
 * Takes the contents' world bounds (rotation already accounted for) and
 * returns `null` when there is nothing to fit, so a caller never shrinks a
 * frame to a point. Whole units, because a frame's edges are things people
 * line other work up against.
 */
export function hugBox(
  contents: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  padding = HUG_PADDING
): { x: number; y: number; width: number; height: number } | null {
  if (contents.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of contents) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const x = Math.floor(minX - padding);
  const y = Math.floor(minY - padding);
  return {
    x,
    y,
    width: Math.max(MIN_FRAME_SIZE, Math.ceil(maxX + padding) - x),
    height: Math.max(MIN_FRAME_SIZE, Math.ceil(maxY + padding) - y),
  };
}

// ---------------------------------------------------------------------------
// Presenting
// ---------------------------------------------------------------------------

/**
 * Frames in the order a presentation walks them.
 *
 * Reading order by default: frames whose vertical extents overlap by at least
 * half the shorter one share a row; rows run top to bottom and each row left
 * to right. That is the order people lay slides out in on a board, so nobody
 * has to number them.
 *
 * Once somebody reorders the slides by hand, each frame carries a
 * `slideOrder` and those frames come first in that order; a frame added
 * afterwards has none and joins the end, in reading order, until it is placed.
 * Ties break by reading position and then id, so every client presents the
 * same sequence even when two people reorder at once.
 */
export function presentationOrder<
  T extends { id: string; x: number; y: number; width: number; height: number; slideOrder?: number },
>(frames: readonly T[]): T[] {
  const reading = readingOrder(frames);
  if (!frames.some((f) => typeof f.slideOrder === 'number')) return reading;
  const position = new Map(reading.map((f, i) => [f.id, i]));
  const rank = (f: T) => (typeof f.slideOrder === 'number' && Number.isFinite(f.slideOrder) ? f.slideOrder : Infinity);
  return [...frames].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return position.get(a.id)! - position.get(b.id)!;
  });
}

/**
 * The `slideOrder` writes that put `ids` in this order, numbering every slide
 * so the sequence is fully stated and a later frame cannot slip in between.
 * Frames already at their number are left out, so a move touches only what moved.
 */
export function slideOrderPatches(
  ids: readonly string[],
  current: ReadonlyMap<string, number | undefined>
): Array<{ id: string; changes: { slideOrder: number } }> {
  return ids
    .map((id, i) => ({ id, changes: { slideOrder: i } }))
    .filter(({ id, changes }) => current.get(id) !== changes.slideOrder);
}

/** `ids` with the item at `from` moved to `to`. */
export function moveSlide<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = [...ids];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

function readingOrder<
  T extends { id: string; x: number; y: number; width: number; height: number },
>(frames: readonly T[]): T[] {
  const byTop = [...frames].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const rows: { top: number; bottom: number; items: T[] }[] = [];

  for (const frame of byTop) {
    const top = frame.y;
    const bottom = frame.y + frame.height;
    const row = rows.find((r) => {
      const overlap = Math.min(r.bottom, bottom) - Math.max(r.top, top);
      const shorter = Math.min(r.bottom - r.top, frame.height);
      return overlap >= shorter / 2;
    });
    if (row) {
      row.items.push(frame);
      row.top = Math.min(row.top, top);
      row.bottom = Math.max(row.bottom, bottom);
    } else {
      rows.push({ top, bottom, items: [frame] });
    }
  }

  rows.sort((a, b) => a.top - b.top);
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

/**
 * The frames a presentation walks: visible top-level frames only.
 *
 * A frame nested inside another is part of that slide, not a slide of its own.
 */
export function presentableFrames<T extends { type: string; hidden?: boolean; frameId?: string }>(
  nodes: readonly T[]
): Array<T & { type: 'frame' }> {
  return nodes.filter((n): n is T & { type: 'frame' } => n.type === 'frame' && !n.hidden && !n.frameId);
}

/**
 * The camera pose that fits `box` in a stage of `stage` size with `padding`
 * on every side. `x`/`y` are stage-space offsets, the camera's own convention,
 * so the box lands centred in the stage.
 */
export function slidePose(
  box: { x: number; y: number; width: number; height: number },
  stage: { width: number; height: number },
  padding: number
): { x: number; y: number; zoom: number } {
  const zoom = Math.min(
    Math.max(1, stage.width - padding * 2) / Math.max(1, box.width),
    Math.max(1, stage.height - padding * 2) / Math.max(1, box.height)
  );
  return {
    zoom,
    x: stage.width / 2 - (box.x + box.width / 2) * zoom,
    y: stage.height / 2 - (box.y + box.height / 2) * zoom,
  };
}
