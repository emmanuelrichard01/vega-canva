import type { Point } from './schema';

/**
 * The folded corner of a sticky note, as geometry.
 *
 * The bottom-right corner of every note is turned over. The paper is cut along
 * the crease, so the board shows through where the corner was, and the corner
 * itself lies on the sheet as a flap: the cut-off triangle reflected across the
 * crease. Drawing it that way, rather than painting a darker triangle on a
 * whole rectangle, is what makes it read as folded: the sheet's own shadow and
 * edge follow the cut.
 *
 * One module for the canvas, the sketched paper and the SVG export, so the
 * three cannot draw three different corners.
 *
 * ## The flap's frame
 *
 * The flap is described in its own frame: the origin at the middle of the
 * crease, `x` along the crease and `y` towards the tip. The flap is a right
 * isosceles triangle, so its half-width along the crease and its height are
 * both `fold / √2`. A renderer places that frame with `flapPlacement` and lifts
 * the corner by scaling `y`, which pulls the tip back towards the crease as a
 * corner peeling off the sheet would.
 */

/** The fold, as a share of the note's short side. */
export const FOLD_RATIO = 0.12;
/** World units: smaller than this and the fold reads as a chipped corner. */
export const FOLD_MIN = 14;
/** World units: larger than this and a big note looks dog-eared rather than turned. */
export const FOLD_MAX = 30;
/** Notes shorter than this on their short side are not folded at all. */
export const FOLD_NOTE_FLOOR = 56;
/** How far the flap pulls back towards the crease when the corner lifts. */
export const FOLD_LIFT_SCALE = 0.86;

/** How far the bottom-right corner is turned over, in world units, for a note this size. */
export function foldSize(width: number, height: number): number {
  const short = Math.min(width, height);
  if (!(short >= FOLD_NOTE_FLOOR)) return 0;
  const size = Math.min(FOLD_MAX, Math.max(FOLD_MIN, short * FOLD_RATIO));
  return Math.round(size * 10) / 10;
}

/** The sheet's outline as a ring, with the folded corner cut away. Clockwise from the top left. */
export function foldedRing(width: number, height: number, fold: number): Point[] {
  if (fold <= 0) {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
  }
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height - fold },
    { x: width - fold, y: height },
    { x: 0, y: height },
  ];
}

const r1 = (v: number) => Math.round(v * 100) / 100;

/**
 * The sheet as SVG path data: three rounded corners and the cut one.
 *
 * The cut is left sharp. The flap covers its inner edge, and a rounded crease
 * would read as a torn corner rather than a folded one.
 */
export function foldedPaperPath(width: number, height: number, radius: number, fold: number): string {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2, fold > 0 ? (h - fold) / 2 : h / 2, fold > 0 ? (w - fold) / 2 : w / 2));
  const arc = (x: number, y: number) => (r > 0 ? `A${r1(r)} ${r1(r)} 0 0 1 ${r1(x)} ${r1(y)}` : `L${r1(x)} ${r1(y)}`);
  const corner =
    fold > 0
      ? `V${r1(h - fold)}L${r1(w - fold)} ${r1(h)}`
      : `V${r1(h - r)}${arc(w - r, h)}`;
  return [
    `M${r1(r)} 0`,
    `H${r1(w - r)}`,
    arc(w, r),
    corner,
    `H${r1(r)}`,
    arc(0, h - r),
    `V${r1(r)}`,
    arc(r, 0),
    'Z',
  ].join('');
}

export interface FlapPlacement {
  /** The middle of the crease, in the note's own space. */
  x: number;
  y: number;
  /** Degrees: turns the flap frame's `y` axis towards the tip. */
  rotation: number;
  /** Half the crease's length, which is also the flap's height. */
  half: number;
}

/** Where the flap frame sits on a note of this size. */
export function flapPlacement(width: number, height: number, fold: number): FlapPlacement {
  return { x: width - fold / 2, y: height - fold / 2, rotation: 135, half: fold / Math.SQRT2 };
}

/**
 * The flap's outline in its own frame: crease along `y = 0`, tip at `(0, half)`.
 *
 * The two free edges bow outwards a little and the tip is softened, the way a
 * corner of thin paper curls when it is turned rather than creased flat.
 */
export function flapPath(half: number): string {
  if (!(half > 0)) return '';
  const c = half;
  const tip = { x: 0, y: c };
  const ease = 0.14;
  // Where each edge stops short of the tip, to round it.
  const p1 = { x: -c * ease, y: c * (1 - ease) };
  const p2 = { x: c * ease, y: c * (1 - ease) };
  const bow = c * 0.07;
  // The edge midpoints, pushed out along each edge's outward normal.
  const k1 = { x: -c / 2 - bow, y: c / 2 + bow };
  const k2 = { x: c / 2 + bow, y: c / 2 + bow };
  const p = (pt: Point) => `${r1(pt.x)} ${r1(pt.y)}`;
  return `M${p({ x: -c, y: 0 })}Q${p(k1)} ${p(p1)}Q${p(tip)} ${p(p2)}Q${p(k2)} ${p({ x: c, y: 0 })}Z`;
}

/** The flap as a plain triangle in the note's own space, for the sketched paper. */
export function flapRing(width: number, height: number, fold: number): Point[] {
  if (fold <= 0) return [];
  return [
    { x: width, y: height - fold },
    { x: width - fold, y: height - fold },
    { x: width - fold, y: height },
  ];
}

/**
 * A point in the flap's frame, mapped into the note's space.
 *
 * `lift` is the frame's `y` scale, 1 at rest. Exported for the tests, which
 * check the frame lands the flap where the cut was taken from.
 */
export function flapToNote(pt: Point, place: FlapPlacement, lift = 1): Point {
  const a = (place.rotation * Math.PI) / 180;
  const x = pt.x;
  const y = pt.y * lift;
  return {
    x: place.x + x * Math.cos(a) - y * Math.sin(a),
    y: place.y + x * Math.sin(a) + y * Math.cos(a),
  };
}
