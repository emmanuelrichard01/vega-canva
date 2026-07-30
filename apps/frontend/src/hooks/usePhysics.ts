import { useCallback, useEffect, useRef } from 'react';
import { throttle } from 'lodash';
import Konva from 'konva';
import { doc, updateNode, provider } from '../engine/document';
import { PhysicsSimulation, type SimTransform } from '../engine/physics/simulation';
import { type ForceId } from '../engine/physics/forces';
import { useStore } from './useStore';

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

export function usePhysics(objects: Record<string, any>, stageRef: React.RefObject<Konva.Stage | null>) {
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
  const heldForce = useRef<{ mode: ForceId; x: number; y: number; dx: number; dy: number } | null>(null);
  const applyForceRef = useRef<(x: number, y: number, mode: ForceId, extra?: { dx?: number; dy?: number }) => void>(() => {});

  useEffect(() => {
    const sim = simRef.current!;
    let frameId = 0;
    let lastTime = performance.now();

    const throttledBroadcast = throttle((updates: Record<string, unknown>) => {
      const currentThrows = provider.awareness?.getLocalState()?.throws || {};
      provider.awareness?.setLocalStateField('throws', { ...currentThrows, ...updates });
    }, 33);

    const tick = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      const held = heldForce.current;
      if (held) {
        applyForceRef.current(held.x, held.y, held.mode, { dx: held.dx, dy: held.dy });
        // Wind reads cursor *movement*; once applied that delta is spent, so
        // holding still in a wind field does nothing.
        held.dx = 0;
        held.dy = 0;
      }

      const { moving, settled } = sim.advance(delta);

      // One broadcast per frame carrying both the live poses and the nulls that
      // retire finished ones. Sending them as two throttled calls let lodash
      // drop the second payload, which would strand peers rendering a flight
      // path that had already landed.
      const broadcast: Record<string, unknown> = {};

      // In-flight poses go straight to Konva. The node handle is cached because
      // `findOne('#id')` is a scene-graph search, and doing one per object per
      // frame is a tree walk 60 times a second for everything in the air.
      moving.forEach(({ id, x, y, rotation }) => {
        let node = konvaNodes.current.get(id);
        if (!node || !node.getStage()) {
          node = stageRef.current?.findOne('#' + id) as Konva.Node | undefined;
          if (node) konvaNodes.current.set(id, node);
        }
        if (node) {
          node.x(x);
          node.y(y);
          node.rotation(rotation);
        }
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

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
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
    (x: number, y: number, mode: ForceId, extra?: { dx?: number; dy?: number }) => {
      const sim = simRef.current;
      if (!sim) return;
      const woken = sim.applyForce(x, y, mode, {
        scale: useStore.getState().forceScale,
        skip: remoteOwnedIds(),
        dx: extra?.dx,
        dy: extra?.dy,
      });
      claimOwnershipAll(woken);
    },
    []
  );

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

    if (sim.launch(id, x, y, vx, vy)) claimOwnershipAll([id]);
  }, []);

  const beginHeldForce = useCallback((mode: ForceId, x: number, y: number) => {
    heldForce.current = { mode, x, y, dx: 0, dy: 0 };
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

  // Debug hatch, in the spirit of `window.objectsMap` in the document layer:
  // physics is frame-driven and largely invisible to the DOM.
  (window as unknown as Record<string, unknown>).__physics = simRef.current;

  return { handleThrow, applyGlobalForce, beginHeldForce, moveHeldForce, endHeldForce };
}
