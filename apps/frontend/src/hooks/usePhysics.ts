import { useCallback, useEffect, useRef } from 'react';
import { throttle } from 'lodash';
import Konva from 'konva';
import { doc, updateNode, provider } from '../engine/document';
import { PhysicsSimulation, type SimTransform } from '../engine/physics/simulation';
import { type ForceId } from '../engine/physics/forces';
import { useStore } from './useStore';
import { engineEvents } from '../engine/EventBus';

/**
 * Adapter between the canvas and the physics simulation.
 *
 * The simulation itself lives in `engine/physics/simulation` and knows nothing
 * about React, Konva, Yjs or awareness — which is what makes it testable
 * without a browser. This hook owns only the wiring around it: when to step,
 * where the results go, and who is allowed to simulate what.
 *
 * Four responsibilities, and deliberately no physics:
 *  - drive the simulation from rAF
 *  - write in-flight poses straight to Konva, bypassing React
 *  - commit settled poses to the CRDT, batched into one transaction
 *  - arbitrate ownership so two clients never simulate the same object
 */

/**
 * Single-writer ownership.
 *
 * Every client runs its own world, so two clients simulating the same object
 * settle it in slightly different places and then fight over the write. Exactly
 * one client owns an object while it moves; everyone else renders the owner's
 * broadcast pose.
 */
const ownedByMe = new Set<string>();

const publishOwnership = () => {
  provider.awareness?.setLocalStateField('physicsOwned', Array.from(ownedByMe));
};

/**
 * Claim several objects with a single awareness broadcast.
 *
 * Ownership used to be published per object, from inside a loop that ran every
 * frame across every body in the document — thousands of serialised awareness
 * writes a second on a busy board. That, rather than the simulation, was the
 * lag.
 */
const claimOwnershipAll = (ids: Iterable<string>) => {
  let added = false;
  for (const id of ids) {
    if (ownedByMe.has(id)) continue;
    ownedByMe.add(id);
    added = true;
  }
  if (added) publishOwnership();
};

const releaseOwnershipAll = (ids: Iterable<string>) => {
  let removed = false;
  for (const id of ids) {
    if (ownedByMe.delete(id)) removed = true;
  }
  if (removed) publishOwnership();
};

/** Everything currently owned by some other client. Gathered once per call. */
const remoteOwnedIds = (): Set<string> => {
  const out = new Set<string>();
  const states = provider.awareness?.getStates();
  const myId = provider.awareness?.clientID;
  if (!states) return out;
  states.forEach((state, clientId) => {
    if (clientId === myId) return;
    const owned = (state as { physicsOwned?: unknown })?.physicsOwned;
    if (Array.isArray(owned)) owned.forEach((id) => out.add(String(id)));
  });
  return out;
};

/**
 * Commit settled transforms in one transaction.
 *
 * A shockwave settles dozens of objects within a few frames; committing them
 * separately produced a burst of CRDT updates, each triggering its own store
 * update, React render and body resync — and the same burst on every peer.
 * Yjs merges nested transactions, so each write still goes through the
 * canonical `updateNode` path.
 */
const commitSettled = (settled: SimTransform[]) => {
  if (settled.length === 0) return;
  doc.transact(() => {
    settled.forEach(({ id, x, y, rotation }) => {
      updateNode(id, { x, y, rotation });
    });
  });
};

export function usePhysics(
  objects: Record<string, any>,
  stageRef: React.RefObject<Konva.Stage | null>,
  /**
   * Live selection, read imperatively.
   *
   * Selection is React state up in `Room`, not store state, and this is
   * consulted once per frame while a force is held — so it arrives as the
   * stable ref `Canvas` already keeps for the same reason on drags, rather
   * than as a value that would re-create the callback on every selection
   * change.
   */
  selectedIdsRef?: React.RefObject<string[]>
) {
  const simRef = useRef<PhysicsSimulation | null>(null);
  if (!simRef.current) simRef.current = new PhysicsSimulation();

  /** Cached Konva nodes for in-flight objects, so the loop never re-queries. */
  const konvaNodes = useRef<Map<string, Konva.Node>>(new Map());
  /**
   * The force being held down, applied once per frame.
   *
   * Continuous forces were previously applied from the mousemove handler, so
   * pressing and holding — what the tool's own hint tells you to do — did
   * nothing unless the mouse was moving.
   */
  const heldForce = useRef<{ mode: ForceId; x: number; y: number; dx: number; dy: number; gesture: number } | null>(null);
  const applyForceRef = useRef<(x: number, y: number, mode: ForceId, extra?: { dx?: number; dy?: number; gesture?: number }) => void>(() => {});

  /**
   * Start the frame loop, if it is not already running.
   *
   * Assigned by the effect below and called by every entry point that creates
   * work — a throw, a held press, a latched field. Held in a ref because those
   * callbacks are defined outside the effect that owns the loop.
   */
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const sim = simRef.current!;
    let frameId = 0;
    let running = false;
    let lastTime = performance.now();

    const throttledBroadcast = throttle((updates: Record<string, unknown>) => {
      const currentThrows = provider.awareness?.getLocalState()?.throws || {};
      provider.awareness?.setLocalStateField('throws', { ...currentThrows, ...updates });
    }, 33);

    const tick = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      /**
       * The latched field runs first, and a held press supersedes it.
       *
       * Grabbing the tool again while a field is running is an unambiguous
       * "I want to steer this myself", and having both apply at once would
       * double the force at the cursor for reasons nobody could see.
       */
      const live = latched.current;
      if (live && !heldForce.current) {
        applyForceRef.current(live.x, live.y, live.mode, { gesture: live.gesture });
        live.remainingMs -= delta;
        if (live.remainingMs <= 0) {
          latched.current = null;
          engineEvents.emit('ForceLatchChanged', null);
        } else {
          engineEvents.emit('ForceLatchChanged', {
            x: live.x, y: live.y, mode: live.mode, remainingMs: live.remainingMs,
          });
        }
      }

      const held = heldForce.current;
      if (held) {
        applyForceRef.current(held.x, held.y, held.mode, {
          dx: held.dx,
          dy: held.dy,
          gesture: held.gesture,
        });
        // Wind reads cursor *movement*; once applied that delta is spent, so
        // holding still in a wind field does nothing.
        held.dx = 0;
        held.dy = 0;
      }

      const { moving, settled, woken } = sim.advance(delta);

      // Objects set moving by being hit need owning too, or a peer could start
      // simulating the same collision and the two results would fight.
      if (woken.length > 0) claimOwnershipAll(woken);

      // One broadcast per frame carrying both the live poses and the nulls that
      // retire finished ones. Sending them as two throttled calls let lodash
      // drop the second payload, which would strand peers rendering a flight
      // path that had already landed.
      const broadcast: Record<string, unknown> = {};

      // In-flight poses go straight to Konva. The node handle is cached because
      // `findOne('#id')` is a scene-graph search, and doing one per object per
      // frame is a tree walk 60 times a second for everything in the air.
      moving.forEach(({ id, x, y, centerX, centerY, rotation }) => {
        let node = konvaNodes.current.get(id);
        if (!node || !node.getStage()) {
          node = stageRef.current?.findOne('#' + id) as Konva.Node | undefined;
          if (node) konvaNodes.current.set(id, node);
        }
        if (node) {
          // Konva groups are positioned by their centre — writing the node's
          // top-left here drew every flying object half its own size off, which
          // was invisible mid-flight and a visible jump the moment it landed
          // and React took the position back over.
          node.x(centerX);
          node.y(centerY);
          node.rotation(rotation);
        }
        // Peers receive document space: their renderer adds the centre offset
        // itself, exactly as it does for a committed position.
        broadcast[id] = { x, y, rotation };
      });

      if (settled.length > 0) {
        commitSettled(settled);
        releaseOwnershipAll(settled.map((s) => s.id));
        // A null tells peers to stop rendering the flight path and read the
        // document, which now holds the committed resting place.
        settled.forEach(({ id }) => {
          broadcast[id] = null;
          konvaNodes.current.delete(id);
        });
      }

      if (Object.keys(broadcast).length > 0) throttledBroadcast(broadcast);

      /**
       * Stop when there is nothing left to simulate.
       *
       * This loop used to reschedule unconditionally, so it ran sixty times a
       * second for the entire life of the room whether or not anything was
       * moving — on a board where nobody ever throws anything, which is most
       * boards most of the time. Each idle frame still read the clock, called
       * `advance`, allocated its three result arrays and a broadcast object,
       * and asked `Object.keys` about it: a few hundred short-lived allocations
       * a second, plus a permanently live rAF keeping the compositor awake, for
       * a feature nobody was using.
       *
       * The three things that constitute work are a body still in motion, a
       * finger held down, and a latched field counting itself out. When none of
       * them holds, the loop parks and `wake()` restarts it.
       */
      if (sim.activeCount > 0 || heldForce.current || latched.current) {
        frameId = requestAnimationFrame(tick);
      } else {
        running = false;
        /**
         * Flush before parking.
         *
         * The final payload of a throw is the one carrying the `null` that
         * tells peers to stop drawing the flight path and read the document.
         * Throttled, it may still be pending — and parking the loop with it
         * pending would strand every other client rendering an object at a
         * position it left seconds ago.
         */
        throttledBroadcast.flush();
      }
    };

    /**
     * Restart the loop, resetting the clock.
     *
     * `lastTime` has to be reset or the first frame after an idle period hands
     * `advance` the entire idle duration as its delta — which the accumulator
     * clamps to five steps, so a throw would begin with a visible lurch.
     */
    const start = () => {
      if (running) return;
      running = true;
      lastTime = performance.now();
      frameId = requestAnimationFrame(tick);
    };

    wake.current = start;
    // Bodies may already be mid-flight if this remounted; otherwise `start`
    // is a no-op until something asks for it.
    if (sim.activeCount > 0) start();

    return () => {
      cancelAnimationFrame(frameId);
      running = false;
      wake.current = () => {};
      throttledBroadcast.cancel();
    };
  }, [stageRef]);

  /**
   * Keep the simulation's bodies in step with the document.
   *
   * Driven by the store's dirty set: `objects` gets a new identity on every
   * change — including every frame of a remote drag — so walking the whole map
   * each time meant O(n) work dozens of times a second.
   */
  const version = useStore((state) => state.version);
  const syncedVersion = useRef(-1);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const state = useStore.getState();

    const isFirstPass = syncedVersion.current === -1;
    // React batches, and `lastChangedIds` only describes the most recent
    // change — so every earlier id in a batch would be skipped. A version gap
    // means the dirty set cannot be trusted, so fall back to a full pass.
    const skippedVersions = !isFirstPass && state.version - syncedVersion.current > 1;
    const fullPass = isFirstPass || skippedVersions;
    syncedVersion.current = state.version;

    const changedIds = fullPass ? Object.keys(objects) : state.lastChangedIds;
    // On a full pass, "removed" is whatever the simulation still holds a body
    // for that the document no longer has.
    const removedIds = fullPass
      ? sim.bodyIds().filter((id) => !objects[id])
      : state.lastRemovedIds;

    sim.sync(objects, changedIds, removedIds);
    removedIds.forEach((id) => konvaNodes.current.delete(id));
  }, [version, objects]);

  const applyGlobalForce = useCallback(
    (x: number, y: number, mode: ForceId, extra?: { dx?: number; dy?: number; gesture?: number }) => {
      const sim = simRef.current;
      if (!sim) return;
      const state = useStore.getState();
      const selected = selectedIdsRef?.current ?? [];
      const woken = sim.applyForce(x, y, mode, {
        scale: state.forceScale,
        radiusScale: state.forceRadiusScale,
        falloff: state.forceFalloff,
        // Read fresh each frame rather than captured, so toggling the switch
        // mid-press takes effect on the next frame instead of the next press.
        only: state.forceSelectionOnly && selected.length > 0 ? new Set(selected) : undefined,
        skip: remoteOwnedIds(),
        dx: extra?.dx,
        dy: extra?.dy,
        // Absent for a one-shot like Shockwave, which is right: every click is
        // a new gesture and may re-wake whatever the last one settled.
        gesture: extra?.gesture,
      });
      claimOwnershipAll(woken);
      /**
       * A one-shot force has to start the loop itself.
       *
       * Held and latched forces reach this from inside the loop, where waking
       * is a no-op — but Shockwave is a single click that wakes bodies and then
       * returns, and with the loop parked nothing would ever step them. They
       * would sit still, having been given velocity, until the next unrelated
       * throw happened to start the loop again.
       */
      if (woken.length > 0) wake.current();
    },
    [selectedIdsRef]
  );

  /**
   * Stop everything where it is.
   *
   * The counterpart to Restore, and a different thing: Restore puts the board
   * back the way it was before you started, which throws away the arrangement
   * you just made. Calm keeps the arrangement and only takes the motion out of
   * it — which is what you want when a shockwave has landed things well but
   * they are still drifting past where you wanted them.
   *
   * Committed through the same path a natural settle uses, so it is one
   * transaction, one undo step, and one broadcast.
   */
  const calmAll = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;

    /**
     * A running field has to stop first.
     *
     * Freeze parks every moving body, and a latched field then re-applied on
     * the very next frame and set them all going again — so on the one board
     * where you would most want to stop everything, the button did nothing
     * you could see. `calmAll` predates latching, which is how it came to
     * miss it.
     */
    latched.current = null;
    engineEvents.emit('ForceLatchChanged', null);

    const frozen = sim.freezeAll();
    if (frozen.length === 0) return;
    commitSettled(frozen);
    releaseOwnershipAll(frozen.map((f) => f.id));
    konvaNodes.current.clear();
    // Peers are still drawing the flight path from the last broadcast; a null
    // per object is what retires it and hands them back to the document.
    const retire: Record<string, unknown> = {};
    frozen.forEach(({ id }) => { retire[id] = null; });
    const current = provider.awareness?.getLocalState()?.throws || {};
    provider.awareness?.setLocalStateField('throws', { ...current, ...retire });
  }, []);

  applyForceRef.current = applyGlobalForce;

  const handleThrow = useCallback((id: string, x: number, y: number, vx: number, vy: number) => {
    const sim = simRef.current;
    if (!sim) return;

    if (!useStore.getState().physicsEnabled) {
      // Throws off: a flick ends the drag at the release point, like any other
      // move, rather than launching a projectile.
      const body = sim.getBody(id);
      const w = (body?.plugin?.width as number) || 100;
      const h = (body?.plugin?.height as number) || 100;
      updateNode(id, { x: x - w / 2, y: y - h / 2 });
      return;
    }

    if (sim.launch(id, x, y, vx, vy)) {
      claimOwnershipAll([id]);
      // The loop parks when nothing is in flight, so a throw has to start it.
      wake.current();
    }
  }, []);

  /**
   * One id per press, so the simulation can tell "still holding" from
   * "pressed again".
   *
   * Without it a held force re-wakes anything that came to rest under it, on
   * every frame — which was five document writes a second per object for a
   * pile that had already stopped moving. See `settledInGesture` in the
   * simulation.
   */
  const gestureSeq = useRef(0);

  /**
   * A field that keeps running after the pointer has gone.
   *
   * `remainingMs` is counted down by the frame loop rather than by a timer, so
   * it advances with the simulation: a stalled or backgrounded tab does not
   * silently burn the field's life while nothing is being stepped.
   *
   * It carries one gesture id for its whole life, exactly like a held press —
   * so a body that comes to rest under a latched field stays at rest instead
   * of being re-woken sixty times a second.
   */
  const latched = useRef<
    { mode: ForceId; x: number; y: number; remainingMs: number; gesture: number } | null
  >(null);

  const beginHeldForce = useCallback((mode: ForceId, x: number, y: number) => {
    gestureSeq.current += 1;
    heldForce.current = { mode, x, y, dx: 0, dy: 0, gesture: gestureSeq.current };
    // A held press is work even before it moves anything, because the force is
    // applied per frame rather than per mousemove.
    wake.current();
  }, []);

  const moveHeldForce = useCallback((x: number, y: number, dx = 0, dy = 0) => {
    const held = heldForce.current;
    if (!held) return;
    held.x = x;
    held.y = y;
    held.dx += dx;
    held.dy += dy;
  }, []);

  const endHeldForce = useCallback(() => {
    heldForce.current = null;
  }, []);

  /**
   * Drop a field at a point and let it run.
   *
   * Latching the same tool again moves the field rather than stacking a second
   * one: two invisible fields with separate countdowns is a state nobody can
   * reason about, and there is no way to tell which one Escape would cancel.
   */
  const latchField = useCallback((mode: ForceId, x: number, y: number, seconds: number) => {
    gestureSeq.current += 1;
    latched.current = {
      mode, x, y,
      remainingMs: seconds * 1000,
      gesture: gestureSeq.current,
    };
    engineEvents.emit('ForceLatchChanged', { x, y, mode, remainingMs: seconds * 1000 });
    // The field counts itself down in the loop, so the loop has to be running
    // for it to ever expire.
    wake.current();
  }, []);

  const releaseLatch = useCallback(() => {
    if (!latched.current) return false;
    latched.current = null;
    engineEvents.emit('ForceLatchChanged', null);
    return true;
  }, []);

  // Debug hatch, in the spirit of `window.objectsMap` in the document layer:
  // physics is frame-driven and largely invisible to the DOM.
  (window as unknown as Record<string, unknown>).__physics = simRef.current;

  return {
    handleThrow, applyGlobalForce,
    beginHeldForce, moveHeldForce, endHeldForce,
    latchField, releaseLatch,
    calmAll,
  };
}
