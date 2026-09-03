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

export interface FramePreset {
  id: string;
  label: string;
  /** For grouping in the picker. */
  group: 'Screen' | 'Social' | 'Print';
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
  { id: 'desktop', label: 'Desktop', group: 'Screen', width: 1440, height: 1024 },
  { id: 'desktop-hd', label: 'Desktop HD', group: 'Screen', width: 1920, height: 1080 },
  { id: 'laptop', label: 'Laptop', group: 'Screen', width: 1280, height: 800 },
  { id: 'tablet', label: 'Tablet', group: 'Screen', width: 820, height: 1180 },
  { id: 'phone', label: 'Phone', group: 'Screen', width: 390, height: 844 },
  // A square post is cropped to 4:5 or 1.91:1 depending on where it is shown,
  // and the grid thumbnail crops it again — 64 units in from every edge is
  // what survives all of that.
  { id: 'square', label: 'Square post', group: 'Social', width: 1080, height: 1080, safeArea: evenInset(64) },
  // The story's own interface: the profile row and close button along the top,
  // the reply bar and share row along the bottom. The sides are clear.
  { id: 'story', label: 'Story', group: 'Social', width: 1080, height: 1920, safeArea: { top: 250, right: 64, bottom: 320, left: 64 } },
  // 4:5 is the tallest a feed will show uncropped, which is why it is the
  // format anything meant to be *read* in a feed is made at.
  { id: 'portrait-post', label: 'Portrait post', group: 'Social', width: 1080, height: 1350, safeArea: evenInset(64) },
  { id: 'slide', label: 'Slide', group: 'Social', width: 1920, height: 1080, safeArea: evenInset(64) },
  // A video thumbnail is shown at a dozen sizes down to about 120 units wide,
  // and the player's own duration chip sits over the bottom-right corner.
  { id: 'thumbnail', label: 'Video thumbnail', group: 'Social', width: 1280, height: 720, safeArea: evenInset(48) },
  // The link preview every chat app and social network renders from a page's
  // Open Graph tags. Cropped to 1.91:1 by some and to 2:1 by others, so the
  // inset is what survives the tighter of the two.
  { id: 'og', label: 'Link preview', group: 'Social', width: 1200, height: 630, safeArea: { top: 40, right: 60, bottom: 40, left: 60 } },
  // A quarter-inch at 72dpi: the margin a desktop printer cannot reach, so
  // anything outside it is not printed however the file is prepared.
  { id: 'a4', label: 'A4', group: 'Print', width: 595, height: 842, safeArea: evenInset(18) },
  { id: 'letter', label: 'US Letter', group: 'Print', width: 612, height: 792, safeArea: evenInset(18) },
  { id: 'a3', label: 'A3', group: 'Print', width: 842, height: 1191, safeArea: evenInset(18) },
  { id: 'a5', label: 'A5', group: 'Print', width: 420, height: 595, safeArea: evenInset(18) },
  // 3.5 x 2 inches at 72dpi. The inset is a full eighth of an inch, because a
  // card is guillotined rather than printed to its edge and the cut wanders.
  { id: 'card', label: 'Business card', group: 'Print', width: 252, height: 144, safeArea: evenInset(9) },
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
export function presetMatching(width: number, height: number): FramePreset | undefined {
  return FRAME_PRESETS.find(
    (p) =>
      (p.width === width && p.height === height) || (p.height === width && p.width === height),
  );
}

export const FRAME_PRESET_GROUPS: FramePreset['group'][] = ['Screen', 'Social', 'Print'];

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
 * moving it, and deleting it. Walks breadth-first from the frame and is
 * **cycle-safe**: `frameForNode` cannot create a cycle, but a hand-edited or
 * concurrently-merged document is not bound by that, and a cycle here would
 * hang the tab rather than misplace a rectangle.
 */
export function descendantsOfFrame(
  frameId: string,
  nodes: Array<{ id: string; frameId?: string }>
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.frameId) continue;
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
