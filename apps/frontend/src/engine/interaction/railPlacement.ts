/**
 * Where the contextual rail goes, as arithmetic.
 *
 * ## The one rule
 *
 * **The rail may not cover the thing it edits.** Everything else — staying on
 * screen, sitting above by preference, centring on the selection — is a
 * courtesy that gives way to it. A rail that overlaps the viewport edge looks
 * untidy; a rail that overlaps the artwork hides the change you are making
 * while you are making it, which is the only job it has.
 *
 * The version this replaces stated that rule in a comment and then broke it in
 * the next two lines, twice — once per side:
 *
 *     if (side === 'top')  y = Math.max(y, topBound + RAIL_HEIGHT);
 *     else                 y = Math.min(y, bottomBound - RAIL_HEIGHT);
 *
 * Both clamps move the rail *towards* the selection, so an object that reached
 * past the free strip had the rail dragged back over its own edge. Here the
 * clamp cannot do that, because a side is only chosen once the rail is known to
 * fit beside the subject, and the fallback moves the rail as far away as the
 * viewport allows rather than as close as it needs.
 *
 * ## Why it is a module
 *
 * It used to be a hundred lines of arithmetic inside a `requestAnimationFrame`
 * loop in an 1,800-line component, which is why three separate positioning bugs
 * reached the canvas before anyone could see them: nothing there can be
 * asserted without a browser. This has no React and no Konva in it, so the
 * awkward cases — a rotated object, one taller than the screen, one straddling
 * the dock — are tests rather than things to go and try.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The free strip of screen the rail may occupy, in viewport pixels. */
export interface Bounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type RailSide = 'top' | 'bottom' | 'left' | 'right';

export interface RailPlacement {
  /**
   * The point the rail hangs from, and which of its own edges hangs there.
   *
   * Returned as an anchor rather than a top-left corner so the cross-axis
   * centring can stay in CSS. The rail's width is only known after it has
   * rendered, and a first frame positioned from a width of zero jumps by half a
   * rail the moment it measures.
   *
   * | side   | anchor is the rail's | CSS               |
   * |--------|----------------------|-------------------|
   * | top    | bottom centre        | `-50%, -100%`     |
   * | bottom | top centre           | `-50%, 0`         |
   * | left   | right centre         | `-100%, -50%`     |
   * | right  | left centre          | `0, -50%`         |
   */
  x: number;
  y: number;
  side: RailSide;
  /**
   * Whether the rail found room beside the subject rather than over it.
   *
   * False only when the selection leaves no gap on any side — an object larger
   * than the viewport, or one straddling the dock. The rail is then as far from
   * the subject as the screen allows, and says so, because a surface that has
   * had to sit on top of the work should stop competing with it until it is
   * reached for.
   */
  clear: boolean;
}

/** Anything with a box and an angle: the document's nodes qualify. */
interface Sized {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/**
 * The axis-aligned box a selection really occupies, turns included.
 *
 * The old loop measured `x, y, width, height` straight off the nodes, which is
 * the box *before* rotation. A square turned 45° reaches out past its own
 * corners by nearly half its width on every side, so the rail was positioned
 * against a rectangle the artwork had grown out of and sat inside the shape.
 *
 * Rotation is about the centre — that is where `ObjectRenderer` puts the group's
 * origin — so each corner swings about the box's middle and the hull is what
 * they span.
 */
export function selectionHull(nodes: readonly Sized[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const w = n.width || 0;
    const h = n.height || 0;
    const deg = n.rotation || 0;

    if (deg === 0) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
      continue;
    }

    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = n.x + w / 2;
    const cy = n.y + h / 2;
    for (const [dx, dy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
      const px = cx + dx * cos - dy * sin;
      const py = cy + dx * sin + dy * cos;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Grow a rect by the same amount on every side. */
export function inflate(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * Where to put the rail, given what is selected and how much screen there is.
 *
 * ## The order
 *
 * Above, then below, then right, then left. Above first because that is where
 * the eye already is — the selection's own handles draw it upward — and because
 * a rail below competes with the tool dock for the same strip of screen.
 * Sideways only when neither horizontal band has room, which happens for a tall
 * object on a short window and is exactly the case the old code handled by
 * covering the artwork.
 *
 * A side qualifies only if the whole rail plus its standoff fits in the gap
 * there. Half-fitting is not fitting: the rail is a solid surface, and the part
 * that does not fit is the part that lands on the object.
 *
 * ## Why it remembers where it was
 *
 * A side is chosen from a gap that changes continuously as the canvas pans, so
 * a selection drifting past the threshold has one frame where the preferred side
 * fits by a pixel and the next where it does not. Deciding afresh every frame
 * makes the rail flick between above and below sixty times a second while the
 * hand holding the canvas is perfectly steady. So the side it is already on
 * keeps its place until the preferred one has room to spare, not merely room.
 *
 * @param subject   the selection's screen rect, handles and all.
 * @param rail      how big the rail measures right now.
 * @param bounds    the free strip: inside the panels, under the top bar, above the dock.
 * @param standoff  clearance between the rail and the subject: one number, or
 *                  one per side when the rail is not equally thick all round.
 * @param previous  the side the rail is on, if it is already somewhere.
 */
export function placeRail(
  subject: Rect,
  rail: { width: number; height: number },
  bounds: Bounds,
  standoff: number | Record<RailSide, number>,
  previous?: RailSide
): RailPlacement {
  /**
   * The clearance is per side, because the rail is not equally thick all round.
   *
   * Its drop shadow falls *downward* — `0 12px 32px -12px`, and further in dark
   * mode — so a rail sitting above an object reaches about twenty pixels past
   * its own bottom edge, straight through the standoff and the handles and onto
   * the artwork. Measuring the gap to the rail's box was measuring to the wrong
   * edge: it is the shadow that lands on the object, and on a single line of
   * text there is not enough object for it to miss.
   */
  const clearance: Record<RailSide, number> =
    typeof standoff === 'number'
      ? { top: standoff, bottom: standoff, left: standoff, right: standoff }
      : standoff;

  /**
   * A rail taller than the object it describes needs more air than one beside a
   * poster.
   *
   * A fixed gap is not a fixed *impression*. Forty pixels of solid surface
   * fourteen pixels under a single line of text reads as attached to it — the
   * rail is nearly twice the height of the thing it is meant to be standing
   * clear of, so the eye groups them. The same fourteen pixels under a photograph
   * reads as a comfortable float, because the photograph dominates.
   *
   * So the gap grows as the subject shrinks, by half the difference: unchanged
   * for anything at least as thick as the rail, and half a rail's worth extra
   * for something with no thickness at all. It is the smallest rule that makes
   * the *look* constant rather than the number.
   */
  const air = (base: number, railExtent: number, subjectExtent: number) =>
    base + Math.max(0, railExtent - Math.max(0, subjectExtent)) / 2;

  const gapFor: Record<RailSide, number> = {
    top: air(clearance.top, rail.height, subject.height),
    bottom: air(clearance.bottom, rail.height, subject.height),
    left: air(clearance.left, rail.width, subject.width),
    right: air(clearance.right, rail.width, subject.width),
  };

  const needV = { top: rail.height + gapFor.top, bottom: rail.height + gapFor.bottom };
  const needH = { left: rail.width + gapFor.left, right: rail.width + gapFor.right };

  const gap: Record<RailSide, number> = {
    top: subject.y - bounds.top,
    bottom: bounds.bottom - (subject.y + subject.height),
    left: subject.x - bounds.left,
    right: bounds.right - (subject.x + subject.width),
  };

  /**
   * A rail that has not been measured yet cannot be judged sideways.
   *
   * `offsetWidth` is 0 for the frame between mounting and the first paint. The
   * vertical sides survive that, because they are decided on the rail's height,
   * which is known from the stylesheet -- but a width of zero fits beside
   * anything, so the rail would take a side on one frame and leave it on the
   * next, once it knew how wide it was. Better to stay in the vertical bands
   * until there is something real to compare.
   */
  const measured = rail.width > 0;

  const need: Record<RailSide, number> = {
    top: needV.top, bottom: needV.bottom, left: needH.left, right: needH.right,
  };

  const fits: Record<RailSide, boolean> = {
    top: gap.top >= need.top,
    bottom: gap.bottom >= need.bottom,
    left: measured && gap.left >= need.left,
    right: measured && gap.right >= need.right,
  };

  const order: RailSide[] = ['top', 'bottom', 'right', 'left'];
  const preferred = order.find((s) => fits[s]);

  /**
   * The width of the dead band, in pixels of gap.
   *
   * Wide enough that a hand-held pan cannot cross it twice in a frame, narrow
   * enough that deliberately making room above brings the rail straight back.
   */
  const HYSTERESIS = 24;

  const clearSide =
    preferred && previous && preferred !== previous && fits[previous]
      // The rail is somewhere that still works. Only move it once the side it
      // would rather be on is comfortably clear, not merely clear.
      && gap[preferred] < need[preferred] + HYSTERESIS
      ? previous
      : preferred;

  // The rail's centre along whichever axis it is free to slide on, kept inside
  // the bounds by its own half-width rather than its midpoint -- clamping the
  // centre let a 370px rail reach 185px past the panel it was being kept out of.
  const halfW = rail.width / 2;
  const halfH = rail.height / 2;
  const midX = clamp(subject.x + subject.width / 2, bounds.left + halfW, bounds.right - halfW);
  const midY = clamp(subject.y + subject.height / 2, bounds.top + halfH, bounds.bottom - halfH);

  if (clearSide) {
    switch (clearSide) {
      case 'top':
        return { x: midX, y: subject.y - gapFor.top, side: 'top', clear: true };
      case 'bottom':
        return { x: midX, y: subject.y + subject.height + gapFor.bottom, side: 'bottom', clear: true };
      case 'right':
        return { x: subject.x + subject.width + gapFor.right, y: midY, side: 'right', clear: true };
      default:
        return { x: subject.x - gapFor.left, y: midY, side: 'left', clear: true };
    }
  }

  /**
   * Nowhere is clear, so take the side with the most room and go to the wall.
   *
   * Flush against the viewport rather than standoff-from-the-subject: when the
   * rail has to sit over the artwork, every pixel it moves away is a pixel of
   * the artwork that comes back. The old code did the opposite, pulling the
   * rail towards the object until it fit on screen.
   */
  const candidates = measured ? order : (['top', 'bottom'] as RailSide[]);
  const widest = candidates.reduce((best, s) => (gap[s] > gap[best] ? s : best), candidates[0]);
  switch (widest) {
    case 'top':
      return { x: midX, y: bounds.top + rail.height, side: 'top', clear: false };
    case 'bottom':
      return { x: midX, y: bounds.bottom - rail.height, side: 'bottom', clear: false };
    case 'right':
      return { x: bounds.right - rail.width, y: midY, side: 'right', clear: false };
    default:
      return { x: bounds.left + rail.width, y: midY, side: 'left', clear: false };
  }
}

/**
 * Which way a popover hung off a rail button opens, and how tall it may grow.
 *
 * ## Why this is not "whichever side has more room"
 *
 * The room that matters is the room that does not cross the artwork. A rail
 * above an object has the whole window above it and a sliver between itself
 * and the object below; a popover that measured the window would happily open
 * downward across the thing being edited whenever the window was short.
 *
 * So each side is measured to the nearer of the window edge and the object, the
 * side away from the object is preferred, and when neither side can hold the
 * panel whole it *scrolls* on the side away from the object rather than spilling
 * onto it — provided that side has a usable amount of room. Only when there is
 * no clean room anywhere does it take the larger side of the window regardless.
 *
 * Pure, so the rule can be asserted; re-run whenever the panel changes size,
 * which is what lets a popover that grows — a disclosure opening, shading
 * options appearing — keep itself on screen instead of overflowing it.
 */
export function anchoredPopover(
  trigger: { top: number; bottom: number },
  subject: { top: number; bottom: number } | null,
  panelHeight: number,
  preferred: 'top' | 'bottom',
  viewportHeight: number,
  margin = 8,
  gap = 8
): { side: 'top' | 'bottom'; maxHeight?: number } {
  const fullAbove = trigger.top - gap - margin;
  const fullBelow = viewportHeight - trigger.bottom - gap - margin;
  const clean = {
    top: subject && subject.bottom <= trigger.top ? Math.min(fullAbove, trigger.top - subject.bottom - gap) : fullAbove,
    bottom: subject && subject.top >= trigger.bottom ? Math.min(fullBelow, subject.top - trigger.bottom - gap) : fullBelow,
  };
  const other = preferred === 'top' ? 'bottom' : 'top';

  if (clean[preferred] >= panelHeight) return { side: preferred };
  if (clean[other] >= panelHeight) return { side: other };

  const USABLE = 160;
  if (clean[preferred] >= USABLE) return { side: preferred, maxHeight: Math.floor(clean[preferred]) };
  if (clean[other] >= USABLE) return { side: other, maxHeight: Math.floor(clean[other]) };

  const side = fullAbove >= fullBelow ? 'top' : 'bottom';
  const room = side === 'top' ? fullAbove : fullBelow;
  return room < panelHeight ? { side, maxHeight: Math.max(0, Math.floor(room)) } : { side };
}
