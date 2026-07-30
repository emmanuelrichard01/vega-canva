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
export type ForceId = 'magnet' | 'repel' | 'wind' | 'shockwave' | 'gravity';

export interface ForceSpec {
  id: ForceId;
  /** What it is called in the UI — plain verbs, not physics jargon. */
  label: string;
  /** One line explaining what pressing will do. */
  hint: string;
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
    label: 'Pull',
    hint: 'Hold to draw objects toward the cursor',
    radius: 600,
    strength: 0.001,
    continuous: true,
    colorToken: 'var(--force-pull)',
  },
  repel: {
    id: 'repel',
    label: 'Push',
    hint: 'Hold to push objects away from the cursor',
    radius: 600,
    strength: 0.001,
    continuous: true,
    colorToken: 'var(--force-push)',
  },
  wind: {
    id: 'wind',
    label: 'Wind',
    hint: 'Drag to blow objects in the direction you move',
    radius: 1000,
    strength: 0.0005,
    continuous: true,
    colorToken: 'var(--force-wind)',
  },
  shockwave: {
    id: 'shockwave',
    label: 'Shockwave',
    hint: 'Click to burst everything away from that point',
    radius: 800,
    strength: 0.15,
    continuous: false,
    colorToken: 'var(--force-shock)',
  },
  gravity: {
    id: 'gravity',
    label: 'Drop',
    hint: 'Hold to pull objects downward, like tipping the table',
    radius: 700,
    strength: 0.0006,
    continuous: true,
    colorToken: 'var(--force-drop)',
  },
};

export const FORCE_IDS: ForceId[] = ['magnet', 'repel', 'gravity', 'wind', 'shockwave'];

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
