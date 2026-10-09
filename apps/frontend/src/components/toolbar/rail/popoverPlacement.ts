import type { Bounds, RailSide, Rect } from '../../../engine/interaction/railPlacement';

/**
 * Where a rail popover opens, as arithmetic.
 *
 * ## The rule
 *
 * A popover may not cover what it edits. Figma and FigJam never do: the panel
 * opens on the far side of its bar from the selection, beside the selection
 * when that side is full, and over it only when the screen leaves no choice.
 *
 * 1. **Away.** The rail stands above the selection, so the panel opens upward;
 *    below it, downward.
 * 2. **Beside.** No room there, so it stands left or right of the selection,
 *    whichever has room, level with the rail.
 * 3. **Scrolling.** Nowhere holds it whole, so it takes a clear side with
 *    usable height and scrolls.
 * 4. **Least harm.** Nothing is clear, so each candidate is clamped into the
 *    free strip and the one covering the least of the selection wins.
 *
 * "The selection" is its screen box grown by a halo: the transformer handles
 * are already in the box, the halo adds the HUD pills (the align Key tag,
 * gap readouts) and air. A panel driving a live preview takes a wider one.
 *
 * Pure: no DOM, no React, so each of those cases is a test.
 */

export type PopoverSide = RailSide;

/** Clearance an ordinary rail popover keeps around the selection. */
export const POPOVER_HALO = 12;
/** Clearance for a panel whose controls draw on the board: ghosts, gap handles, the Key tag. */
export const LIVE_HALO = 24;
/** Between the rail and a panel hung off it: the 6px of air the rail's own popovers have always had. */
export const POPOVER_GAP = 6;
/** A side shorter than this is not worth scrolling in. */
export const USABLE_HEIGHT = 160;
/** Spare room, in pixels, a better side needs before an open panel moves to it. */
export const POPOVER_HYSTERESIS = 24;

export interface PopoverPlacementInput {
  /** The rail's box on screen. */
  rail: Rect;
  /** Which side of the selection the rail stands on. */
  railSide: RailSide;
  /** The vertical side to try first when the rail stands beside the selection. */
  prefer?: 'top' | 'bottom';
  /** The trigger's box, which `align` lines a hanging panel up with. */
  trigger: Rect;
  align: 'start' | 'center' | 'end';
  /** The panel's natural size. */
  panel: { width: number; height: number };
  /** The selection's screen box, handles included. Null off the rail. */
  subject: Rect | null;
  /** The free strip a popover may stand in. */
  bounds: Bounds;
  /** Other chrome to stay off, such as the board pills. */
  obstacles?: readonly Rect[];
  /** Clearance around the selection: `POPOVER_HALO`, or `LIVE_HALO` for a live preview. */
  halo?: number;
  gap?: number;
  /** The side the panel is on now, so a pan that grazes a threshold does not flip it. */
  previous?: PopoverSide;
}

export interface PopoverSpot {
  /** The panel's top-left corner, in viewport pixels. */
  x: number;
  y: number;
  side: PopoverSide;
  /** Set when the panel has to scroll to fit. */
  maxHeight?: number;
  /** Area of the haloed selection under the panel: 0 whenever any clear place existed. */
  covers: number;
}

/** The area two rects share, 0 when they only touch. */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

interface Candidate {
  side: PopoverSide;
  /** The rect as it would be drawn, height cut to the room. */
  rect: Rect;
  /** Spare room along the side's own axis; negative when the panel does not fit whole. */
  slack: number;
  /** 0 whole, 1 clear but scrolling, 2 covering something. */
  tier: 0 | 1 | 2;
  /** Lower is better, compared only within tier 2. */
  score: number;
  covers: number;
}

/**
 * Where the panel goes. See the module comment for the order.
 */
export function placeRailPopover(input: PopoverPlacementInput): PopoverSpot {
  const { rail, railSide, trigger, align, panel, subject, bounds } = input;
  const gap = input.gap ?? POPOVER_GAP;
  const halo = input.halo ?? POPOVER_HALO;
  const obstacles = input.obstacles ?? [];
  const { width: w, height: h } = panel;
  const stripW = bounds.right - bounds.left;
  const stripH = bounds.bottom - bounds.top;

  const avoid: Rect | null = subject
    ? { x: subject.x - halo, y: subject.y - halo, width: subject.width + halo * 2, height: subject.height + halo * 2 }
    : null;

  const coverOf = (r: Rect) => (avoid ? overlapArea(r, avoid) : 0);
  const chromeOf = (r: Rect) => obstacles.reduce((sum, o) => sum + overlapArea(r, o), 0);

  // A hanging panel's left edge, as `align` asks, slid back inside the strip.
  const hangX = clamp(
    align === 'start' ? trigger.x : align === 'end' ? trigger.x + trigger.width - w : trigger.x + trigger.width / 2 - w / 2,
    bounds.left,
    bounds.right - w
  );
  // A panel beside the selection is level with the rail: tops aligned when the
  // rail is above or beside, bottoms when it is below.
  const besideY = railSide === 'bottom' ? rail.y + rail.height - h : rail.y;

  const judge = (side: PopoverSide, rect: Rect, slack: number, whole: boolean, usable: boolean): Candidate => {
    const covers = coverOf(rect);
    const chrome = chromeOf(rect);
    // Its own rail weighs most: a panel over the rail hides the button that
    // opened it and the controls a person reaches for next.
    const onRail = overlapArea(rect, rail);
    const clear = covers === 0 && chrome === 0 && onRail === 0;
    const hidden = Math.max(0, h - rect.height) * rect.width;
    return {
      side,
      rect,
      slack,
      tier: clear && whole ? 0 : clear && usable ? 1 : 2,
      score: covers + chrome * 2 + onRail * 8 + hidden / 2,
      covers,
    };
  };

  /** A side as it stands: on its own axis it is not pushed back toward the selection. */
  const standing = (side: PopoverSide): Candidate | null => {
    if (side === 'top' || side === 'bottom') {
      const room = side === 'top' ? rail.y - gap - bounds.top : bounds.bottom - (rail.y + rail.height + gap);
      const drawn = Math.max(0, Math.min(h, room));
      const y = side === 'top' ? rail.y - gap - drawn : rail.y + rail.height + gap;
      const fitsAcross = w <= stripW;
      return judge(side, { x: hangX, y, width: w, height: drawn }, room - h, fitsAcross && room >= h, fitsAcross && room >= USABLE_HEIGHT);
    }
    if (!avoid) return null;
    // Past the selection's halo, and past the rail's end too: the panel is
    // level with the rail, and a rail wider than the selection reaches past it.
    const x =
      side === 'right'
        ? Math.max(avoid.x + avoid.width, rail.x + rail.width + gap)
        : Math.min(avoid.x, rail.x - gap) - w;
    const room = side === 'right' ? bounds.right - x : x + w - bounds.left;
    const drawn = Math.min(h, stripH);
    const y = clamp(besideY, bounds.top, bounds.bottom - drawn);
    const fitsAcross = room >= w;
    return judge(side, { x, y, width: w, height: drawn }, room - w, fitsAcross && h <= stripH, fitsAcross && drawn >= USABLE_HEIGHT);
  };

  /** The same side pushed wholly inside the strip, wherever that lands. */
  const clamped = (c: Candidate): Candidate => {
    const width = Math.min(w, stripW);
    const height = Math.min(h, stripH);
    const natural =
      c.side === 'top' || c.side === 'bottom'
        ? { x: hangX, y: c.side === 'top' ? rail.y - gap - height : rail.y + rail.height + gap }
        : { x: c.rect.x, y: besideY };
    const rect = {
      x: clamp(natural.x, bounds.left, bounds.right - width),
      y: clamp(natural.y, bounds.top, bounds.bottom - height),
      width,
      height,
    };
    return { ...judge(c.side, rect, c.slack, false, false), tier: 2 };
  };

  // Away first. Then beside, the roomier side first. Toward the selection last.
  const away: 'top' | 'bottom' =
    railSide === 'top' || railSide === 'bottom' ? railSide : input.prefer ?? 'bottom';
  const toward: 'top' | 'bottom' = away === 'top' ? 'bottom' : 'top';
  const besides = (['right', 'left'] as const)
    .map((s) => standing(s))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.slack - a.slack);
  const ordered: Candidate[] =
    railSide === 'top' || railSide === 'bottom'
      ? [standing(away)!, ...besides, standing(toward)!]
      : [standing(away)!, standing(toward)!, ...besides];

  const pickClear = (tier: 0 | 1) => ordered.find((c) => c.tier === tier) ?? null;
  let best = pickClear(0) ?? pickClear(1);
  let pool: Candidate[] = ordered;
  if (!best) {
    pool = ordered.map(clamped);
    best = pool.reduce((a, b) => (b.score < a.score ? b : a), pool[0]);
  }

  // Hysteresis: an open panel stays on a side that still works until the
  // better one has room to spare, so a steady pan near a threshold cannot
  // flick it between two places.
  const prev = input.previous ? pool.find((c) => c.side === input.previous) : undefined;
  if (prev && prev !== best && prev.tier <= best.tier) {
    const keep = best.tier < 2 ? best.slack < POPOVER_HYSTERESIS : best.score > prev.score - POPOVER_HYSTERESIS * w;
    if (keep) best = prev;
  }

  return {
    x: best.rect.x,
    y: best.rect.y,
    side: best.side,
    maxHeight: best.rect.height < h ? Math.max(0, Math.floor(best.rect.height)) : undefined,
    covers: best.covers,
  };
}
