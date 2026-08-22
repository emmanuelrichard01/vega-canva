import Matter from 'matter-js';
import { resolveMaterial } from '../../utils/behaviorSystem';
import { FORCE_SPECS, falloffAt, type FalloffId, type ForceId } from './forces';

/**
 * The physics simulation, with nothing else attached to it.
 *
 * ## Why this is its own module
 *
 * The simulation used to live inside `usePhysics`, tangled with React refs,
 * Yjs writes, awareness broadcasts and Konva node lookups. That made it
 * unobservable: the only way to find out whether a force actually moved
 * anything was to open a browser and look. Every physics bug in this codebase
 * so far — bodies stuck at infinite mass so every position became NaN, held
 * forces that only applied while the mouse was moving, a dirty-set that
 * dropped objects when React batched, objects juddering because two writers
 * fought over one position — was found by hand, after someone noticed.
 *
 * All of those are ordinary assertions against this module. It takes plain
 * node data and returns plain transforms, so it runs in Node with no canvas
 * and no document. The React hook above it is now only an adapter: it decides
 * *when* to step, and what to do with what comes back.
 *
 * The rule that keeps it that way: nothing in here may import React, Konva,
 * the Yjs document, or awareness.
 */

/**
 * Collision categories, for the "just my selection" scope. See `applyScope`.
 */
const CAT_DEFAULT = 0x0001;
const CAT_OUT_OF_SCOPE = 0x0002;
const CAT_ALL = 0xFFFFFFFF;

const VELOCITY_EPSILON = 0.1;
const SETTLE_FRAMES = 10;
const TIMEOUT_MS = 5000;

/** Physics advances in constant 60Hz steps regardless of frame pacing. */
export const FIXED_DT = 1000 / 60;
/** Ceiling on catch-up steps, so a stalled tab replays a few, not hundreds. */
const MAX_STEPS_PER_FRAME = 5;
/**
 * Slack in the step comparison, because `FIXED_DT` is not representable exactly.
 *
 * Four frames' worth of time subtracted four times lands a few femtoseconds
 * *below* `FIXED_DT`, so a strict `>=` silently drops the last step. That made
 * the number of steps depend on how the caller chunked its time: a client
 * handing over one big delta ran fewer steps than one handing over several
 * small ones, so physics ran slow exactly when the machine was already
 * struggling.
 */
const STEP_EPSILON = 1e-9;

/**
 * Types that are never simulated.
 *
 * Comments are anchored annotations — a pin drifting away from what it
 * annotates is a correctness bug, not a fun interaction. Frames are the
 * background objects sit on top of.
 */
const NON_PHYSICAL_TYPES = new Set(['comment', 'artboard', 'frame']);
export const isPhysicalType = (type: string) => !NON_PHYSICAL_TYPES.has(type);

/** The subset of a node the simulation cares about. */
export interface SimNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  material?: string;
  /**
   * What shape it is, so round things can collide as round things.
   *
   * The simulation read no geometry at all and built every body as a
   * rectangle, so a circle on the board was a square in the physics. That is
   * invisible on a loose scatter and fatal on anything that is supposed to
   * *roll*: a square ball dropped onto a square peg lands flat on its top and
   * balances there, which is why the Pachinko board jammed instead of
   * cascading.
   */
  geometry?: { kind?: string };
  /**
   * Immovable. Still collided against, never set in motion.
   *
   * The simulation used not to know about this at all, so the product's one
   * "do not move this" control was invisible to the only system that moves
   * things.
   */
  locked?: boolean;
}

/**
 * A pose, carrying both coordinate spaces the canvas uses.
 *
 * These differ, and conflating them is a bug that has already shipped once.
 * Nodes store their **top-left corner**, so that is what gets committed to the
 * document. Konva groups are positioned by their **centre** (they sit at the
 * centre with their contents offset back, so rotation and scale happen about
 * the middle), so that is what the renderer needs. Writing `x`/`y` to a Konva
 * node draws the object half its own size off — invisible during flight
 * because the offset is constant, then a visible jump the moment React takes
 * the position back over on landing.
 */
export interface SimTransform {
  id: string;
  /** Document space: the node's top-left corner. Commit this. */
  x: number;
  y: number;
  /** Screen graph space: the Konva group's origin. Render this. */
  centerX: number;
  centerY: number;
  rotation: number;
}

export interface StepResult {
  /** Still in motion — render these, and broadcast them to peers. */
  moving: SimTransform[];
  /** Came to rest during this step — commit these to the document. */
  settled: SimTransform[];
  /**
   * Set in motion *during* this step, by being hit rather than by a force.
   * The caller must claim ownership of these the same way it does for a force.
   */
  woken: string[];
}

interface ActiveEntry {
  framesSettled: number;
  startedAt: number;
  width: number;
  height: number;
}

interface MassProps {
  mass: number;
  inverseMass: number;
  inertia: number;
  inverseInertia: number;
  density: number;
}

/**
 * Restore the mass a body was built with.
 *
 * Matter parks a static body's real mass in `_original` and substitutes
 * `Infinity`; waking is meant to put it back. In practice these bodies wake
 * with `mass`, `density` and `inertia` still infinite and `_original` already
 * cleared. Since force is scaled by mass, that produced an infinite force,
 * which Matter multiplied by an inverse mass of zero — and every position
 * became NaN on the first step. So we capture the real values at creation,
 * while the body is still dynamic, and restore them ourselves.
 */
function wakeBody(body: Matter.Body): void {
  if (!body.isStatic) return;
  Matter.Body.setStatic(body, false);

  const original = body.plugin?.massProps as MassProps | undefined;
  if (!original) return;
  if (Number.isFinite(body.mass) && Number.isFinite(body.inertia)) return;

  body.density = original.density;
  body.mass = original.mass;
  body.inverseMass = original.inverseMass;
  body.inertia = original.inertia;
  body.inverseInertia = original.inverseInertia;
}

const finite = (v: number) => Number.isFinite(v);

export class PhysicsSimulation {
  private engine: Matter.Engine;
  private bodies = new Map<string, Matter.Body>();
  private active = new Map<string, ActiveEntry>();
  private accumulator = 0;
  /** Simulated clock, so settle timeouts do not depend on wall time. */
  private clock = 0;

  /** Ids hit by a moving object, to be woken between steps. */
  private pendingWake = new Set<string>();

  constructor() {
    // No world gravity: an infinite canvas has no floor, so a constant pull
    // would drag every object off the board forever and nothing would ever
    // settle. Weight is expressed through mass and drag instead — see
    // `engine/physics/forces` for the full reasoning.
    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    Matter.Events.on(this.engine, 'collisionStart', this.handleCollision);
  }

  /**
   * Wake whatever gets hit.
   *
   * Objects rest as static bodies, and a static body in Matter has infinite
   * mass — so a thrown object *did* collide with the things it hit, but they
   * behaved like walls: all the momentum bounced back and nothing was knocked
   * out of the way. Objects only push each other around once the one being hit
   * is dynamic too, so contact has to promote it.
   *
   * Recorded here and applied between steps rather than during one, because
   * changing a body's mass in the middle of collision resolution is asking for
   * trouble.
   */
  /**
   * When a force was last applied, on the simulation's own clock.
   *
   * The settle timeout counts from this rather than from when a body woke, so
   * a field that is still being driven cannot be overruled by the clock.
   */
  private lastForceAt = -Infinity;

  /**
   * Which press we are in, and who has already come to rest during it.
   *
   * A held force re-applies every frame, and `activate` happily wakes any
   * static body inside the ring — including one that just settled *under that
   * same force*. So holding Drop over a pile that had come to rest woke it,
   * settled it, woke it again, about five times a second, committing a
   * transform to the document each time. Measured at eighty-three settles per
   * body over fifteen seconds of held force; it is three now, and those three
   * are real impacts.
   *
   * Scoping rest to the gesture is also the behaviour a person expects, since
   * holding a force against something already pinned visibly does nothing.
   */
  private gestureSeq = 0;
  private currentGesture = 0;
  private settledInGesture = new Map<string, number>();

  /**
   * Whether the world is currently split into "in scope" and "everything
   * else", so the split can be undone exactly once when it stops.
   */
  private scoped = false;

  private handleCollision = (event: { pairs: { bodyA: Matter.Body; bodyB: Matter.Body }[] }) => {
    event.pairs.forEach(({ bodyA, bodyB }) => {
      // Exactly one side moving: the other is the one that needs waking. Two
      // moving bodies already resolve properly, and two resting ones are not a
      // collision anyone can see.
      if (bodyA.isStatic === bodyB.isStatic) return;
      const sleeper = bodyA.isStatic ? bodyA : bodyB;
      const id = sleeper.plugin?.id;
      if (typeof id === 'string') this.pendingWake.add(id);
    });
  };

  /** Bodies currently being simulated. */
  get activeCount(): number {
    return this.active.size;
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  /** Escape hatch for tests and the debug overlay. */
  getBody(id: string): Matter.Body | undefined {
    return this.bodies.get(id);
  }

  /** Ids the simulation currently holds a body for. */
  bodyIds(): string[] {
    return Array.from(this.bodies.keys());
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  /**
   * Bring the body set in line with the document.
   *
   * `changedIds` is a dirty set, not the whole document — a full walk on every
   * change is what made this O(n) per remote drag frame.
   */
  sync(nodes: Record<string, SimNode>, changedIds: Iterable<string>, removedIds: Iterable<string>): void {
    for (const id of removedIds) this.remove(id);

    for (const id of changedIds) {
      const node = nodes[id];
      if (!node) continue;

      if (!isPhysicalType(node.type)) {
        this.remove(id);
        continue;
      }

      const w = node.width * Math.abs(node.scaleX || 1);
      const h = node.height * Math.abs(node.scaleY || 1);
      const angle = (node.rotation || 0) * (Math.PI / 180);
      const cx = node.x + w / 2;
      const cy = node.y + h / 2;
      const material = resolveMaterial(node);
      /**
       * Round only when it is actually round.
       *
       * Matter's circle takes a single radius, so an elongated ellipse cannot
       * be one — squashing it to an average would collide as a shape that is
       * on the board nowhere. Anything meaningfully off-square keeps the
       * rectangle it had, which is still the better approximation of a long
       * thin petal than a circle would be.
       */
      const isRound =
        node.geometry?.kind === 'ellipse' && Math.abs(w - h) <= Math.max(w, h) * 0.2;

      let body = this.bodies.get(id);

      // Size and material are baked into a body at creation — Matter has no
      // setSize — so either changing means the body must be rebuilt. Without
      // this an object collided with the shape it used to be, and switching it
      // from Paper to Stone changed nothing until reload.
      if (body) {
        const sizeChanged =
          Math.abs((body.plugin?.width ?? 0) - w) > 0.5 || Math.abs((body.plugin?.height ?? 0) - h) > 0.5;
        const materialChanged = body.plugin?.materialId !== material.id;
        // Shape is baked in at creation exactly like size and material, so
        // switching a rectangle to an ellipse has to rebuild too.
        const shapeChanged = (body.plugin?.round ?? false) !== isRound;
        if (sizeChanged || materialChanged || shapeChanged) {
          this.remove(id);
          body = undefined;
        }
      }

      if (!body) {
        if (!finite(cx) || !finite(cy) || w <= 0 || h <= 0) continue;
        // Built dynamic so Matter computes real mass and inertia from the
        // geometry, then parked static. Creating it static skips that entirely
        // and leaves the body at infinite mass for its whole life.
        const shapeOptions = {
          angle,
          frictionAir: material.frictionAir,
          restitution: material.restitution,
          density: material.density,
          label: node.type,
        };
        body = isRound
          ? Matter.Bodies.circle(cx, cy, (w + h) / 4, shapeOptions)
          : Matter.Bodies.rectangle(cx, cy, w, h, shapeOptions);
        const massProps: MassProps = {
          mass: body.mass,
          inverseMass: body.inverseMass,
          inertia: body.inertia,
          inverseInertia: body.inverseInertia,
          density: body.density,
        };
        Matter.Body.setStatic(body, true);
        body.plugin = {
          width: w, height: h, type: node.type, id, massProps,
          materialId: material.id,
          locked: node.locked === true || (node as any).pinned === true,
          round: isRound,
        };
        Matter.Composite.add(this.engine.world, body);
        this.bodies.set(id, body);
        continue;
      }

      /**
       * Lockedness is re-read every pass, not baked in at creation.
       *
       * Unlike size and material it does not change the body's shape or mass,
       * so it must not force a rebuild — but it does have to be current, or
       * locking something mid-cascade would not take effect until reload.
       */
      if (body.plugin) body.plugin.locked = node.locked === true || (node as any).pinned === true;

      // A resting body tracks the document; a moving one owns its own position.
      if (body.isStatic && finite(cx) && finite(cy)) {
        Matter.Body.setPosition(body, { x: cx, y: cy });
        Matter.Body.setAngle(body, angle);
      }
    }
  }

  private remove(id: string): void {
    const body = this.bodies.get(id);
    if (!body) return;
    Matter.Composite.remove(this.engine.world, body);
    this.bodies.delete(id);
    this.active.delete(id);
    this.settledInGesture.delete(id);
  }

  private activate(id: string, body: Matter.Body): boolean {
    if (!body.isStatic) return false;

    /**
     * A locked object is immovable, including by force.
     *
     * `isStatic` was carrying two unrelated meanings — "asleep, wake me when
     * something hits me" and nothing else — so there was no way to say
     * "immovable". The simulation never read `locked` at all, which meant the
     * one control in the product whose entire promise is *do not move this*
     * was ignored by the only system that moves things: a shockwave scattered
     * locked objects exactly like free ones.
     *
     * Locked bodies stay in the world and are still collided *against*, which
     * is the difference between this and removing them. That is what makes a
     * fixed obstacle possible — a peg, a wall, a backboard — and it is what
     * the Pachinko board needs to be a Pachinko board rather than a pile of
     * loose circles.
     */
    if (body.plugin?.locked === true) return false;

    wakeBody(body);
    this.active.set(id, {
      framesSettled: 0,
      startedAt: this.clock,
      width: body.plugin?.width ?? 100,
      height: body.plugin?.height ?? 100,
    });
    return true;
  }

  /**
   * Apply a force tool at a point in world space.
   *
   * Returns the ids newly set in motion, so the caller can claim ownership of
   * exactly those — in one broadcast rather than one per object.
   */
  applyForce(
    x: number,
    y: number,
    mode: ForceId,
    options: {
      scale?: number;
      skip?: Set<string>;
      dx?: number;
      dy?: number;
      /** Multiplier on the force's own radius — the "effect area" control. */
      radiusScale?: number;
      /** How strength fades from centre to edge. */
      falloff?: FalloffId;
      /**
       * When set, only these objects are affected.
       *
       * What makes force usable on a board that already has work on it: without
       * it, every force is all-or-nothing over everything within reach, so
       * there is no way to tidy one cluster without disturbing its neighbours.
       */
      only?: Set<string>;
      /**
       * Identity of the press this belongs to.
       *
       * Held forces pass a stable id for the whole press. Omitting it gets a
       * fresh one, which is right for a one-shot like Shockwave: every click
       * is a new gesture and may always re-wake what the last one settled.
       */
      gesture?: number;
    } = {}
  ): string[] {
    const spec = FORCE_SPECS[mode];
    if (!spec) return [];
    this.currentGesture = options.gesture ?? ++this.gestureSeq;
    const scale = options.scale ?? 1;
    const skip = options.skip;
    const only = options.only;
    const curve = options.falloff ?? 'linear';
    const radius = spec.radius * (options.radiusScale ?? 1);
    const woken: string[] = [];

    // Holds the settle timeout off for as long as a field is being driven.
    this.lastForceAt = this.clock;

    /**
     * Scope is a *collision* boundary, not just a force filter.
     *
     * Skipping the force for unselected bodies is not enough to deliver what
     * "just my selection" promises. Those bodies are asleep, and an asleep
     * body is a static one — an immovable wall. So scoping did not isolate a
     * cluster, it imprisoned it: a selected note pinned against an unselected
     * neighbour simply could not move, and on a dense board the force did
     * nothing at all. Measured: unscoped, a shockwave carried the object 450
     * units; scoped, it travelled four.
     *
     * Putting the two sets in non-colliding categories gives the behaviour
     * the label describes — the selection can be gathered, thrown or tidied
     * straight through its neighbours, and the neighbours neither move nor
     * get in the way.
     */
    this.applyScope(only);

    this.bodies.forEach((body, id) => {
      if (skip?.has(id)) return;
      if (only && !only.has(id)) return;
      // Already came to rest during this same press: leave it alone.
      if (this.settledInGesture.get(id) === this.currentGesture) return;

      const dx = body.position.x - x;
      const dy = body.position.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Out of range: untouched, and — unlike an earlier version — unclaimed.
      if (dist > radius) return;

      // Never scale by a non-finite mass; that is what produced NaN positions.
      const mass = finite(body.mass) ? body.mass : (body.plugin?.massProps?.mass ?? 1);

      /**
       * Directional fields fade with distance too.
       *
       * Wind and Drop used to apply their full strength anywhere inside the
       * radius, whatever the falloff, so both had a hard rim you could feel:
       * an object just inside the ring got the full push and one a pixel
       * outside got none. They are fields like the others and behave like them.
       */
      const fade = falloffAt(curve, dist, radius);
      if (fade <= 0) return;

      if (mode === 'wind') {
        if (this.activate(id, body)) woken.push(id);
        const force = fade * spec.strength * scale * mass;
        Matter.Body.applyForce(body, body.position, {
          x: (options.dx ?? 0) * force,
          y: (options.dy ?? 0) * force,
        });
        return;
      }

      if (mode === 'gravity') {
        if (this.activate(id, body)) woken.push(id);
        Matter.Body.applyForce(body, body.position, {
          x: 0,
          y: fade * spec.strength * scale * mass,
        });
        return;
      }

      // A body directly under the cursor has no direction to travel in, and
      // dividing by that distance is another route to NaN.
      if (dist <= 10) return;

      if (this.activate(id, body)) woken.push(id);
      const force = fade * spec.strength * scale * mass;

      if (mode === 'swirl') {
        /**
         * The radial direction turned through 90°: `(-dy, dx)` normalised.
         *
         * Purely tangential, with no inward component at all, so objects orbit
         * rather than spiral in. Matter's own drag is what eventually settles
         * them; adding a pull here as well would make Swirl a slower Pull.
         */
        Matter.Body.applyForce(body, body.position, {
          x: (-dy / dist) * force,
          y: (dx / dist) * force,
        });
        return;
      }

      const sign = mode === 'magnet' ? -1 : 1;
      Matter.Body.applyForce(body, body.position, {
        x: sign * (dx / dist) * force,
        y: sign * (dy / dist) * force,
      });
    });

    return woken;
  }

  /**
   * Split the world into "in scope" and "everything else", or put it back.
   *
   * Matter collides A and B only when `(A.category & B.mask)` and
   * `(B.category & A.mask)` are both non-zero, so giving the two sets
   * categories that are missing from each other's masks makes them pass
   * through one another while each still collides internally.
   */
  private applyScope(only?: Set<string>): void {
    if (!only) {
      if (!this.scoped) return;
      this.bodies.forEach((body) => {
        body.collisionFilter.category = CAT_DEFAULT;
        body.collisionFilter.mask = CAT_ALL;
      });
      this.scoped = false;
      return;
    }

    this.bodies.forEach((body, id) => {
      if (only.has(id)) {
        body.collisionFilter.category = CAT_DEFAULT;
        // Sees other scoped bodies, and nothing outside the scope.
        body.collisionFilter.mask = CAT_DEFAULT;
      } else {
        body.collisionFilter.category = CAT_OUT_OF_SCOPE;
        body.collisionFilter.mask = CAT_ALL;
      }
    });
    this.scoped = true;
  }

  /**
   * Launch an object from a release point. Returns false if it has no body.
   *
   * `x`/`y` are the body *centre*, which is what a drag reports, and the
   * velocity is in Matter's units.
   */
  launch(id: string, x: number, y: number, vx: number, vy: number): boolean {
    const body = this.bodies.get(id);
    if (!body || !finite(x) || !finite(y)) return false;

    wakeBody(body);
    // The body only tracks the document while static, so after a drag it still
    // holds the pre-drag location. Without this the object visibly snaps back
    // and then flies from the wrong place.
    Matter.Body.setPosition(body, { x, y });
    Matter.Body.setVelocity(body, { x: vx, y: vy });
    this.activate(id, body);
    // activate() no-ops once the body is already dynamic, so make sure the
    // entry exists with a fresh start time for the settle timeout.
    this.active.set(id, {
      framesSettled: 0,
      startedAt: this.clock,
      width: body.plugin?.width ?? 100,
      height: body.plugin?.height ?? 100,
    });
    return true;
  }

  /**
   * Stop simulating everything, leaving bodies wherever they are.
   *
   * Also drops the scope split, so a Freeze while "just my selection" is on
   * does not leave half the board unable to collide with the other half.
   */
  freezeAll(): SimTransform[] {
    this.applyScope(undefined);
    const frozen: SimTransform[] = [];
    this.active.forEach((entry, id) => {
      const body = this.bodies.get(id);
      if (!body) return;
      Matter.Body.setStatic(body, true);
      const t = this.toTransform(id, body, entry);
      if (t) frozen.push(t);
    });
    this.active.clear();
    return frozen;
  }

  private toTransform(id: string, body: Matter.Body, entry: ActiveEntry): SimTransform | null {
    // Matter positions bodies by their centre of mass, which is exactly what a
    // Konva group wants; the document wants the top-left corner. Both are
    // returned so neither consumer has to remember to convert.
    const centerX = body.position.x;
    const centerY = body.position.y;
    const x = centerX - entry.width / 2;
    const y = centerY - entry.height / 2;
    const rotation = body.angle * (180 / Math.PI);
    // A degenerate step must never escape the simulation. Downstream this
    // would reach the document, and Y.Map stores NaN happily — `toJSON()`
    // turns it into null, so the node loses its coordinates permanently.
    if (!finite(x) || !finite(y) || !finite(rotation)) return null;
    return { id, x, y, centerX, centerY, rotation };
  }

  /**
   * Advance by a real elapsed time, in fixed steps.
   *
   * Matter integrates with whatever delta it is handed, so feeding it raw
   * frame times makes the same throw travel different distances depending on
   * what else the browser was doing — which reads as juddering. Stepping at a
   * constant rate and carrying the remainder decouples the simulation from
   * frame pacing.
   */
  advance(deltaMs: number): StepResult {
    const moving: SimTransform[] = [];
    const settled: SimTransform[] = [];
    const woken: string[] = [];
    if (this.active.size === 0) return { moving, settled, woken };

    this.accumulator = Math.min(this.accumulator + Math.max(deltaMs, 0), FIXED_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= FIXED_DT - STEP_EPSILON) {
      Matter.Engine.update(this.engine, FIXED_DT);
      this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
      this.clock += FIXED_DT;

      // Promote anything that was struck, so momentum carries into it instead
      // of bouncing off an immovable wall.
      if (this.pendingWake.size > 0) {
        this.pendingWake.forEach((id) => {
          const body = this.bodies.get(id);
          if (!body) return;
          // Being struck always overrides "already rested this press" — the
          // rule is about a force failing to move something, not about a body
          // becoming permanently immovable for the rest of the gesture.
          this.settledInGesture.delete(id);
          if (this.activate(id, body)) woken.push(id);
        });
        this.pendingWake.clear();
      }

      // Settling is evaluated per physics step, not per call. Counting calls
      // made "at rest for 10 frames" mean something different depending on how
      // the caller chunked its time, so a laggy client settled objects later —
      // and in a different place — than a smooth one.
      this.collectSettled(settled);
    }

    // Whatever is still active is still in flight.
    this.active.forEach((entry, id) => {
      const body = this.bodies.get(id);
      if (!body) return;
      const transform = this.toTransform(id, body, entry);
      if (transform) moving.push(transform);
    });

    return { moving, settled, woken };
  }

  /** Retire anything that has come to rest, appending its final transform. */
  private collectSettled(out: SimTransform[]): void {
    const finished: string[] = [];

    this.active.forEach((entry, id) => {
      const body = this.bodies.get(id);
      if (!body) {
        finished.push(id);
        return;
      }

      const speed = Matter.Body.getSpeed(body);

      if (finite(speed) && speed < VELOCITY_EPSILON) entry.framesSettled++;
      else entry.framesSettled = 0;

      /**
       * The timeout counts from the last time a force was applied, not from
       * when the body first woke.
       *
       * Five seconds from waking meant a held or latched field could not run
       * for longer than five seconds before everything under it froze solid
       * while still being pushed — the simulation overruling the person
       * driving it. Counting from the last push suspends the clock for as
       * long as a field is live and resumes it the moment the field stops.
       */
      const since = Math.max(entry.startedAt, this.lastForceAt);
      const timedOut = this.clock - since > TIMEOUT_MS;
      if (entry.framesSettled >= SETTLE_FRAMES || timedOut) {
        finished.push(id);
        Matter.Body.setStatic(body, true);
        this.settledInGesture.set(id, this.currentGesture);
        const transform = this.toTransform(id, body, entry);
        if (transform) out.push(transform);
      }
    });

    finished.forEach((id) => this.active.delete(id));
  }

  // "Emergent magnetic clustering" used to run here: every moving sticky
  // quietly pulled every other sticky within 80–250px toward it. It is gone.
  // Nothing documented it, nobody asked for it, and it silently dragged
  // deliberately-placed notes together on a surface whose entire job is
  // deliberate placement — the same objection that retired the cursor ripple.
  // It also cost an O(active x bodies) pass every single step. Objects now
  // affect each other only by actually colliding, which is a rule you can see.

  destroy(): void {
    Matter.Events.off(this.engine, 'collisionStart', this.handleCollision);
    Matter.Engine.clear(this.engine);
    this.bodies.clear();
    this.active.clear();
    this.pendingWake.clear();
  }
}
