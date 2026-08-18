/**
 * The force tools, described once.
 *
 * Radius and strength used to be numeric literals buried in `usePhysics` —
 * 600 here, 1000 there, 800 in a third branch — which meant nothing could show
 * the user what a tool was about to affect, because nothing else could find out.
 * A force field you cannot see is a force field you cannot aim, and that is most
 * of why these tools felt like a slot machine.
 *
 * Everything that needs to know about a force reads it from here: the
 * simulation applies it, the Forces bar labels it, and the canvas draws the
 * field ring at exactly the radius that will be used.
 */

/**
 * ## Why there is no world gravity
 *
 * A permanent downward field is the obvious thing to reach for and the wrong
 * thing for this medium. An infinite canvas has no floor, so "down" is not a
 * place — objects would fall out of the board forever. Gravity also never
 * stops, so nothing would ever settle, and since each settle commits to the
 * CRDT that is unbounded write traffic from every client at once. It would
 * quietly destroy authored layout, which is the one thing a board must not do.
 *
 * The honest physical metaphor for a whiteboard is a table seen from above,
 * not a wall seen from the side: gravity acts *into* the surface, where it
 * shows up as mass and friction rather than drift. That is what the material
 * profiles in `utils/behaviorSystem` encode, and it is why the world's planar
 * gravity is zero.
 *
 * `gravity` below is the wanted *feeling* made safe — a directional pull you
 * aim and hold, which stops the moment you let go.
 */
export type ForceId = 'magnet' | 'repel' | 'wind' | 'shockwave' | 'gravity' | 'swirl';

export interface ForceSpec {
  id: ForceId;
  /** What it is called in the UI — plain verbs, not physics jargon. */
  label: string;
  /** One line explaining what pressing will do. */
  hint: string;
  /**
   * The verb phrase, for the status line: "Hold to *pull objects in*".
   *
   * Written rather than derived from `label`, because the labels are nouns as
   * often as verbs — "Hold to wind" and "Hold to shockwave" are not English,
   * and Shockwave is not held at all.
   */
  short: string;
  /** World-space radius of effect. */
  radius: number;
  /** Base force coefficient, before the user's strength multiplier. */
  strength: number;
  /**
   * Held down and dragged (magnet/repel/wind) versus a single impulse per
   * press (shockwave). The bar uses this to say "hold" or "click".
   */
  continuous: boolean;
  /** Semantic token for the field ring, so light and dark both read. */
  colorToken: string;
}

export const FORCE_SPECS: Record<ForceId, ForceSpec> = {
  magnet: {
    id: 'magnet',
    short: 'pull objects in',
    label: 'Pull',
    hint: 'Hold to draw objects toward the cursor',
    radius: 600,
    strength: 0.001,
    continuous: true,
    colorToken: 'var(--force-pull)',
  },
  repel: {
    id: 'repel',
    short: 'push objects away',
    label: 'Push',
    hint: 'Hold to push objects away from the cursor',
    radius: 600,
    strength: 0.001,
    continuous: true,
    colorToken: 'var(--force-push)',
  },
  wind: {
    id: 'wind',
    short: 'blow objects along',
    label: 'Wind',
    hint: 'Drag to blow objects in the direction you move',
    radius: 1000,
    strength: 0.0005,
    continuous: true,
    colorToken: 'var(--force-wind)',
  },
  shockwave: {
    id: 'shockwave',
    short: 'burst objects outward',
    label: 'Shockwave',
    hint: 'Click to burst everything away from that point',
    radius: 800,
    strength: 0.15,
    continuous: false,
    colorToken: 'var(--force-shock)',
  },
  gravity: {
    id: 'gravity',
    short: 'pull objects downward',
    label: 'Drop',
    hint: 'Hold to pull objects downward, like tipping the table',
    radius: 700,
    strength: 0.0006,
    continuous: true,
    colorToken: 'var(--force-drop)',
  },
  /**
   * Tangential rather than radial: every object is pushed at a right angle to
   * the line joining it to the cursor, so the field turns instead of gathering
   * or scattering.
   *
   * Worth having because the other five all move things *along* that line —
   * toward, away, down, or downwind — and none of them can rearrange a cluster
   * without also dispersing it. Swirl is the one that reorders without
   * displacing, which is the useful thing to do to a group of notes you want
   * shuffled but kept together.
   */
  swirl: {
    id: 'swirl',
    short: 'turn objects around',
    label: 'Swirl',
    hint: 'Hold to turn objects around the cursor',
    radius: 550,
    strength: 0.0009,
    continuous: true,
    colorToken: 'var(--force-swirl)',
  },
};

export const FORCE_IDS: ForceId[] = ['magnet', 'repel', 'gravity', 'wind', 'swirl', 'shockwave'];

export const isForceTool = (toolId: string): toolId is ForceId =>
  (FORCE_IDS as string[]).includes(toolId);

/**
 * Strength multiplier bounds. Deliberately narrow: the useful range between
 * "nothing visibly happens" and "everything is flung off-screen" is small, and
 * a slider that spends most of its travel in the unusable part of that range is
 * a slider that always gets dragged to one end.
 */
export const MIN_FORCE_SCALE = 0.25;
export const MAX_FORCE_SCALE = 2;
export const DEFAULT_FORCE_SCALE = 1;

/**
 * The effect area, as a multiplier on each force's own radius.
 *
 * A multiplier rather than an absolute number of pixels, so the five forces
 * keep the different characters they were tuned with — wind reaches furthest,
 * swirl is the tightest — while still all responding to one control. Setting an
 * absolute radius would flatten them into the same tool with different maths.
 *
 * The range is wide because this is the control that changes what the tool is
 * *for*: at 0.35 a shockwave is a nudge that separates two overlapping notes,
 * and at 3 it clears a whole board.
 */
export const MIN_FORCE_RADIUS_SCALE = 0.35;
export const MAX_FORCE_RADIUS_SCALE = 3;
export const DEFAULT_FORCE_RADIUS_SCALE = 1;

/**
 * How the force fades from the centre of the field to its edge.
 *
 * This was hardwired to `(radius - dist) / radius` — a straight line — and it
 * is the single biggest lever on how a force *feels*, so it belongs to the
 * user rather than to the source.
 */
export type FalloffId = 'smooth' | 'linear' | 'constant';

export interface FalloffSpec {
  id: FalloffId;
  label: string;
  hint: string;
}

/**
 * Named for the **edge**, not for the curve.
 *
 * These were Smooth / Linear / Even, which are the names of the three
 * functions rather than of anything you can see. "Linear" and "Even" in
 * particular were close to synonyms in plain English while meaning opposite
 * things here — one falls off with distance and the other does not fall off
 * at all — so the row could not be read, only tried.
 *
 * What actually differs between them, and what you notice, is how abruptly
 * the field stops at the ring. So that is what they are called.
 */
export const FALLOFF_SPECS: Record<FalloffId, FalloffSpec> = {
  smooth: {
    id: 'smooth',
    label: 'Soft',
    hint: 'Strongest at the centre and fading to nothing — you never feel where the field ends',
  },
  linear: {
    id: 'linear',
    label: 'Even',
    hint: 'Weakens steadily with distance from the centre',
  },
  constant: {
    id: 'constant',
    label: 'Hard',
    hint: 'Full strength right up to the ring, then nothing — moves a whole cluster without stretching it',
  },
};

export const FALLOFF_IDS: FalloffId[] = ['smooth', 'linear', 'constant'];

/**
 * Latching: a field that keeps running after you let go.
 *
 * ## Why this is not world gravity
 *
 * The argument at the top of this file still holds — a permanent downward
 * field on an infinite canvas has nowhere to fall to, never settles, and
 * writes to the document forever. A latch is that feeling made safe in the
 * same way `gravity` was: it is **placed, bounded and cancellable**. It runs
 * at one point, for a fixed number of seconds, and stops.
 *
 * ## Why it is needed at all
 *
 * Every continuous force is aimed with the cursor, so anything taller or
 * wider than one field radius has to be *chased* — you cannot watch what you
 * are doing, because your hand is the thing doing it. A domino wall or a peg
 * field is exactly that shape. Latching is what makes "set it going and watch"
 * possible, which is the whole appeal of having physics on a board.
 *
 * Shockwave is excluded: it is a single impulse, so a latch would just be
 * repeat-fire, which is a different tool and not an obviously good one.
 */
export const LATCH_SECONDS = [3, 6, 10] as const;
export type LatchSeconds = (typeof LATCH_SECONDS)[number];
export const DEFAULT_LATCH_SECONDS: LatchSeconds = 6;

/** Whether a force can be latched at all. */
export const canLatch = (id: ForceId): boolean => FORCE_SPECS[id].continuous;

/**
 * The strength multiplier at `dist` from the centre of a field of `radius`.
 *
 * Returns 0 outside the field for every curve, so the caller needs no separate
 * range check to stay consistent with the ring being drawn.
 *
 * `smooth` is smoothstep, which reaches zero with zero *slope*. That is what
 * removes the edge you can feel on the linear curve, where an object just
 * inside the ring still gets a small kick and one just outside gets nothing —
 * a discontinuity that reads as the field having a hard rim.
 *
 * `constant` keeps the rim on purpose. It is the right curve for pushing a
 * whole cluster as a unit, because every object in it gets the same shove and
 * the group keeps its shape instead of stretching.
 */
export function falloffAt(id: FalloffId, dist: number, radius: number): number {
  if (!(radius > 0) || dist >= radius) return 0;
  const t = 1 - dist / radius;
  switch (id) {
    case 'constant':
      return 1;
    case 'linear':
      return t;
    case 'smooth':
    default:
      return t * t * (3 - 2 * t);
  }
}
