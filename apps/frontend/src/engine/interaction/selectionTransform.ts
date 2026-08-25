/**
 * Resizing and rotating a selection, as arithmetic.
 *
 * ## Why the transform stopped touching the objects
 *
 * Konva's `Transformer` resizes by putting a `scaleX`/`scaleY` on the node it is
 * attached to. That is a true scale: glyphs stretch, strokes thicken, corner
 * radii swell. Every editor people compare this to — Figma, Illustrator — works
 * the other way round, computing a **box** from the pointer and re-rendering the
 * object at that box, so there is no intermediate scaled state to distort.
 *
 * You cannot have both. Resetting the scale each frame to undo the distortion
 * fights the widget, because it derives the next frame *from* the scale it finds
 * on the node; leaving the scale alone is the stretch. That single choice is
 * where the stretching, the jarring, the lagging frame and (briefly) objects
 * flying off the screen all came from.
 *
 * So the widget is attached to an **invisible proxy** instead. The proxy is
 * allowed to scale as much as Konva likes, because nobody ever sees it — which
 * means the handles track the pointer exactly, with none of the correction that
 * made the gesture feel broken. Every frame, the proxy's box is read and each
 * real object's geometry is derived from it here. The objects are then rendered
 * at a **size**, never a scale.
 *
 * ## Why this is a module and not two branches in the component
 *
 * The live preview and the commit each used to work the answer out for
 * themselves, from a scale that one of them had already modified. They disagreed
 * constantly: a resize that previewed correctly committed the original width, a
 * rotation re-wrapped the paragraph it was turning. One function with two
 * callers cannot drift, and — being free of Konva and React — it can be tested
 * directly, which none of the previous versions could.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Anything with a box and an angle. The document's nodes qualify. */
interface Sized {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/**
 * The axis-aligned box a set of objects occupies.
 *
 * Deliberately *unrotated*: it is the frame the proxy starts in, and the proxy
 * carries any rotation itself. Measuring a rotated hull here would mean the
 * proxy started turned, and every angle afterwards would be relative to a
 * baseline nobody chose.
 */
export function selectionBox(nodes: readonly Sized[]): Box | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + (n.width || 0));
    maxY = Math.max(maxY, n.y + (n.height || 0));
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Turn `(x, y)` about `(cx, cy)` by `deg`. */
function rotateAbout(x: number, y: number, cx: number, cy: number, deg: number) {
  if (deg === 0) return { x, y };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Where one object lands, given what the gesture did to the selection.
 *
 * ## The mapping
 *
 * An object keeps its *proportional* place in the box. Its centre sits at some
 * fraction across and down the starting box; it sits at the same fraction of the
 * new one. Its size scales by the box's own ratio. Then, if the gesture turned
 * the box, the centre swings about the box's centre and the object's own angle
 * gains the same amount.
 *
 * That is the whole of it, and it is why a multi-object resize needs no special
 * case: one object at a fraction of `0` is the single-selection case, and the
 * arithmetic does not know the difference.
 *
 * @param start   the object as it was when the gesture began.
 * @param from    the selection's box when the gesture began, unrotated.
 * @param to      the selection's box now, unrotated — the proxy's own box.
 * @param spin    how far the gesture has turned the box, in degrees.
 */
export function placeInBox(start: Sized, from: Box, to: Box, spin: number): Placed {
  // A zero-width selection cannot be divided into. It happens: a hairline, a
  // connector whose ends coincide, an object mid-creation.
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;

  const width = Math.abs(start.width * sx);
  const height = Math.abs(start.height * sy);

  // The object's centre as a fraction of the starting box, then the same
  // fraction of the new one.
  const u = from.width > 0 ? (start.x + start.width / 2 - from.x) / from.width : 0.5;
  const v = from.height > 0 ? (start.y + start.height / 2 - from.y) / from.height : 0.5;

  const flat = {
    x: to.x + u * to.width,
    y: to.y + v * to.height,
  };

  // Then the turn, about the box's centre — so a selection rotates as one rigid
  // thing rather than each object spinning where it stands.
  const centre = rotateAbout(
    flat.x,
    flat.y,
    to.x + to.width / 2,
    to.y + to.height / 2,
    spin
  );

  return {
    x: centre.x - width / 2,
    y: centre.y - height / 2,
    width,
    height,
    rotation: (start.rotation ?? 0) + spin,
  };
}

/**
 * A paragraph placed by its top-left rather than by its centre.
 *
 * Text is the one type whose height is not what the drag asked for: it falls out
 * of the re-wrap, and a narrower measure means more lines. Placing it by the
 * centre — which is right for everything else — split those extra lines between
 * the top and the bottom, so a column grew upwards into whatever was above it.
 *
 * A paragraph grows downwards. The first line stays where it was put, because
 * the top of a column is a decision the person already made.
 *
 * @param laid  the height the re-wrap produced, and the width it wrapped at.
 */
export function placeParagraph(placed: Placed, laid: { width: number; height: number }): Placed {
  return {
    ...placed,
    // The box the gesture drew keeps its top-left; only the height is the
    // layout's to decide.
    x: placed.x,
    y: placed.y,
    width: laid.width,
    height: laid.height,
  };
}
