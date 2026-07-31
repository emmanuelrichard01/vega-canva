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

export interface FramePreset {
  id: string;
  label: string;
  /** For grouping in the picker. */
  group: 'Screen' | 'Social' | 'Print';
  width: number;
  height: number;
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
  { id: 'laptop', label: 'Laptop', group: 'Screen', width: 1280, height: 800 },
  { id: 'tablet', label: 'Tablet', group: 'Screen', width: 820, height: 1180 },
  { id: 'phone', label: 'Phone', group: 'Screen', width: 390, height: 844 },
  { id: 'square', label: 'Square post', group: 'Social', width: 1080, height: 1080 },
  { id: 'story', label: 'Story', group: 'Social', width: 1080, height: 1920 },
  { id: 'slide', label: 'Slide', group: 'Social', width: 1920, height: 1080 },
  { id: 'a4', label: 'A4', group: 'Print', width: 595, height: 842 },
  { id: 'letter', label: 'US Letter', group: 'Print', width: 612, height: 792 },
];

export const FRAME_PRESET_GROUPS: FramePreset['group'][] = ['Screen', 'Social', 'Print'];

export function framePreset(id: string | undefined): FramePreset | undefined {
  return FRAME_PRESETS.find((p) => p.id === id);
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
 * Which frame should own this node, given every frame on the board.
 *
 * The **smallest** containing frame wins, so a frame nested inside another
 * takes ownership of what is dropped into it rather than the outer one
 * silently keeping it. Ties break toward the frame drawn last, which is the
 * one on top and therefore the one being pointed at.
 */
export function frameForNode(
  node: { id?: string; x: number; y: number; width: number; height: number },
  frames: Array<{ id: string; x: number; y: number; width: number; height: number; zIndex: number }>
): string | null {
  let best: { id: string; area: number; zIndex: number } | null = null;
  for (const frame of frames) {
    // A frame cannot contain itself. Without this a frame dropped anywhere
    // becomes its own child, and every rule that walks a frame's contents
    // then has a cycle to fall into.
    if (node.id !== undefined && frame.id === node.id) continue;
    if (!centreIsInside(node, frame)) continue;
    const area = frame.width * frame.height;
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
