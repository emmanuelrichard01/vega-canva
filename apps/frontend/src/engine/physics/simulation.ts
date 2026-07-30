import Matter from 'matter-js';
import { resolveMaterial } from '../../utils/behaviorSystem';
import { FORCE_SPECS, type ForceId } from './forces';

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
}

/** A pose in document space (top-left origin, degrees), as nodes are stored. */
export interface SimTransform {
  id: string;
  x: number;
  y: number;
  rotation: number;
}

export interface StepResult {
  /** Still in motion — render these, and broadcast them to peers. */
  moving: SimTransform[];
  /** Came to rest during this step — commit these to the document. */
  settled: SimTransform[];
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

  constructor() {
    // No world gravity: an infinite canvas has no floor, so a constant pull
    // would drag every object off the board forever and nothing would ever
    // settle. Weight is expressed through mass and drag instead — see
    // `engine/physics/forces` for the full reasoning.
    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  }

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

      let body = this.bodies.get(id);

      // Size and material are baked into a body at creation — Matter has no
      // setSize — so either changing means the body must be rebuilt. Without
      // this an object collided with the shape it used to be, and switching it
      // from Paper to Stone changed nothing until reload.
      if (body) {
        const sizeChanged =
          Math.abs((body.plugin?.width ?? 0) - w) > 0.5 || Math.abs((body.plugin?.height ?? 0) - h) > 0.5;
        const materialChanged = body.plugin?.materialId !== material.id;
        if (sizeChanged || materialChanged) {
          this.remove(id);
          body = undefined;
        }
      }

      if (!body) {
        if (!finite(cx) || !finite(cy) || w <= 0 || h <= 0) continue;
        // Built dynamic so Matter computes real mass and inertia from the
        // geometry, then parked static. Creating it static skips that entirely
        // and leaves the body at infinite mass for its whole life.
        body = Matter.Bodies.rectangle(cx, cy, w, h, {
          angle,
          frictionAir: material.frictionAir,
          restitution: material.restitution,
          density: material.density,
          label: node.type,
        });
        const massProps: MassProps = {
          mass: body.mass,
          inverseMass: body.inverseMass,
          inertia: body.inertia,
          inverseInertia: body.inverseInertia,
          density: body.density,
        };
        Matter.Body.setStatic(body, true);
        body.plugin = { width: w, height: h, type: node.type, id, massProps, materialId: material.id };
        Matter.Composite.add(this.engine.world, body);
        this.bodies.set(id, body);
        continue;
      }

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
  }

  private activate(id: string, body: Matter.Body): boolean {
    if (!body.isStatic) return false;
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
    options: { scale?: number; skip?: Set<string>; dx?: number; dy?: number } = {}
  ): string[] {
    const spec = FORCE_SPECS[mode];
    if (!spec) return [];
    const scale = options.scale ?? 1;
    const skip = options.skip;
    const radius = spec.radius;
    const woken: string[] = [];

    this.bodies.forEach((body, id) => {
      if (skip?.has(id)) return;

      const dx = body.position.x - x;
      const dy = body.position.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Out of range: untouched, and — unlike an earlier version — unclaimed.
      if (dist > radius) return;

      // Never scale by a non-finite mass; that is what produced NaN positions.
      const mass = finite(body.mass) ? body.mass : (body.plugin?.massProps?.mass ?? 1);

      if (mode === 'wind') {
        if (this.activate(id, body)) woken.push(id);
        const force = spec.strength * scale * mass;
        Matter.Body.applyForce(body, body.position, {
          x: (options.dx ?? 0) * force,
          y: (options.dy ?? 0) * force,
        });
        return;
      }

      if (mode === 'gravity') {
        if (this.activate(id, body)) woken.push(id);
        Matter.Body.applyForce(body, body.position, { x: 0, y: spec.strength * scale * mass });
        return;
      }

      // A body directly under the cursor has no direction to travel in, and
      // dividing by that distance is another route to NaN.
      if (dist <= 10) return;

      if (this.activate(id, body)) woken.push(id);
      const falloff = (radius - dist) / radius;
      const force = falloff * spec.strength * scale * mass;
      const sign = mode === 'magnet' ? -1 : 1;
      Matter.Body.applyForce(body, body.position, {
        x: sign * (dx / dist) * force,
        y: sign * (dy / dist) * force,
      });
    });

    return woken;
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

  /** Stop simulating everything, leaving bodies wherever they are. */
  freezeAll(): SimTransform[] {
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
    const x = body.position.x - entry.width / 2;
    const y = body.position.y - entry.height / 2;
    const rotation = body.angle * (180 / Math.PI);
    // A degenerate step must never escape the simulation. Downstream this
    // would reach the document, and Y.Map stores NaN happily — `toJSON()`
    // turns it into null, so the node loses its coordinates permanently.
    if (!finite(x) || !finite(y) || !finite(rotation)) return null;
    return { id, x, y, rotation };
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
    if (this.active.size === 0) return { moving, settled };

    this.accumulator = Math.min(this.accumulator + Math.max(deltaMs, 0), FIXED_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= FIXED_DT - STEP_EPSILON) {
      this.applyClustering();
      Matter.Engine.update(this.engine, FIXED_DT);
      this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
      this.clock += FIXED_DT;
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

    return { moving, settled };
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

      const timedOut = this.clock - entry.startedAt > TIMEOUT_MS;
      if (entry.framesSettled >= SETTLE_FRAMES || timedOut) {
        finished.push(id);
        Matter.Body.setStatic(body, true);
        const transform = this.toTransform(id, body, entry);
        if (transform) out.push(transform);
      }
    });

    finished.forEach((id) => this.active.delete(id));
  }

  /**
   * Stickies drift toward other stickies while one of them is moving.
   *
   * Kept as it was, but note it is the one behaviour here nobody asked for and
   * nothing documents — it quietly pulls deliberately-placed notes together.
   */
  private applyClustering(): void {
    const activeStickies: Matter.Body[] = [];
    this.active.forEach((_entry, id) => {
      const body = this.bodies.get(id);
      if (body && body.label === 'sticky') activeStickies.push(body);
    });
    if (activeStickies.length === 0) return;

    this.bodies.forEach((otherBody) => {
      if (otherBody.label !== 'sticky') return;
      for (const activeBody of activeStickies) {
        if (activeBody === otherBody) continue;
        const dx = otherBody.position.x - activeBody.position.x;
        const dy = otherBody.position.y - activeBody.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 80 && dist < 250) {
          const mass = finite(activeBody.mass) ? activeBody.mass : 1;
          const force = 0.00001 * mass;
          Matter.Body.applyForce(activeBody, activeBody.position, {
            x: (dx / dist) * force,
            y: (dy / dist) * force,
          });
        }
      }
    });
  }

  destroy(): void {
    Matter.Engine.clear(this.engine);
    this.bodies.clear();
    this.active.clear();
  }
}
