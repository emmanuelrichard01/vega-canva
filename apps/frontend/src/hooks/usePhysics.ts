import { useEffect, useRef, useCallback } from 'react';
import Matter from 'matter-js';
import { updateNode, provider } from '../engine/document';
import { throttle } from 'lodash';
import Konva from 'konva';
import { getMaterialProfile } from '../utils/behaviorSystem';
import { useStore } from './useStore';

const VELOCITY_EPSILON = 0.1;
const SETTLE_FRAMES = 10;
const TIMEOUT_MS = 5000;

/**
 * Object types that must never be simulated.
 *
 * Comments are anchored annotations — a comment pin drifting away from the thing it
 * annotates is a correctness bug, not a fun interaction. Artboards are background
 * frames that objects sit on top of, so they must stay put. Both were previously
 * given full rigid bodies, which meant a passing cursor could fling them.
 */
const NON_PHYSICAL_TYPES = new Set(['comment', 'artboard', 'frame']);

const isPhysical = (type: string) => !NON_PHYSICAL_TYPES.has(type);

/**
 * Single-writer ownership for physics.
 *
 * Every client runs its own Matter world, so if two clients both simulate the same
 * object they will settle it at slightly different resting positions and then both
 * write that position to the CRDT doc — the two writes fight, and the object visibly
 * jitters between two spots. To prevent that, exactly one client "owns" an object
 * while it is in motion: the owner simulates and commits the final position, and
 * everyone else just renders the owner's broadcast flight path.
 */
const ownedByMe = new Set<string>();

const claimOwnership = (id: string) => {
  ownedByMe.add(id);
  provider.awareness?.setLocalStateField('physicsOwned', Array.from(ownedByMe));
};

const releaseOwnership = (id: string) => {
  ownedByMe.delete(id);
  provider.awareness?.setLocalStateField('physicsOwned', Array.from(ownedByMe));
};

/** True if any *other* client currently owns the simulation of this object. */
const isOwnedByRemote = (id: string): boolean => {
  const states = provider.awareness?.getStates();
  const myId = provider.awareness?.clientID;
  if (!states) return false;
  for (const [clientId, state] of states.entries()) {
    if (clientId === myId) continue;
    const owned = (state as any)?.physicsOwned;
    if (Array.isArray(owned) && owned.includes(id)) return true;
  }
  return false;
};

export function usePhysics(objects: Record<string, any>, stageRef: React.RefObject<Konva.Stage | null>) {
  const engineRef = useRef<Matter.Engine | null>(null);
  const bodyMap = useRef<Map<string, Matter.Body>>(new Map());
  const activeDynamic = useRef<Map<string, { framesSettled: number, startTime: number, width: number, height: number }>>(new Map());
  const attractRepelTarget = useRef<{ id: string, x: number, y: number, mode: 'attract' | 'repel' | null } | null>(null);

  // Initialize Engine & Loop
  useEffect(() => {
    const engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    engineRef.current = engine;
    
    let frameId: number;
    let lastTime = performance.now();

    const throttledBroadcast = throttle((updates: Record<string, any>) => {
      const currentThrows = provider.awareness?.getLocalState()?.throws || {};
      provider.awareness?.setLocalStateField('throws', { ...currentThrows, ...updates });
    }, 33);

    const updatePhysics = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      if (!useStore.getState().physicsEnabled) {
        // Turning physics off mid-motion should freeze everything cleanly in
        // place (committed to the doc), not leave bodies half-simulated in limbo.
        if (activeDynamic.current.size > 0) {
          activeDynamic.current.forEach((data, id) => {
            const body = bodyMap.current.get(id);
            if (!body) return;
            Matter.Body.setStatic(body, true);
            updateNode(id, {
              x: body.position.x - data.width / 2,
              y: body.position.y - data.height / 2,
              rotation: body.angle * (180 / Math.PI),
            });
            releaseOwnership(id);
          });
          activeDynamic.current.clear();
        }
        attractRepelTarget.current = null;
        frameId = requestAnimationFrame(updatePhysics);
        return;
      }

      const hasActiveDynamics = activeDynamic.current.size > 0;
      const hasAttractRepel = attractRepelTarget.current?.mode != null;
      const shouldUpdate = hasActiveDynamics || hasAttractRepel;

      if (!shouldUpdate) {
        frameId = requestAnimationFrame(updatePhysics);
        return;
      }

      // Apply continuous attract/repel forces. Only for an explicit magic-tool
      // drag (shift = attract, alt = repel) — mode is null for an ordinary
      // object move, and `mode === 'repel' ? repel : attract` used to treat
      // that null the same as attract, so simply dragging any object yanked
      // every nearby object toward your cursor for the duration of the drag.
      // That's the "physics messes with objects when I try to move them"
      // report: unrelated objects would go flying, then coast to a stop
      // wherever momentum happened to carry them once you let go.
      if (attractRepelTarget.current?.mode && engineRef.current) {
        const { id: draggedId, x: targetX, y: targetY, mode } = attractRepelTarget.current;
        const radius = 300;
        const forceStrength = 0.005;

        bodyMap.current.forEach((body, id) => {
          if (id === draggedId) return;
          const dx = body.position.x - targetX;
          const dy = body.position.y - targetY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < radius && dist > 0) {
            if (body.isStatic) {
              Matter.Body.setStatic(body, false);
              const width = body.plugin.width || 100;
              const height = body.plugin.height || 100;
              activeDynamic.current.set(id, { framesSettled: 0, startTime: now, width, height });
            }

            const force = (radius - dist) / radius * forceStrength;
            const dirX = dx / dist;
            const dirY = dy / dist;

            const forceVec = mode === 'repel' ? { x: dirX * force, y: dirY * force } : { x: -dirX * force, y: -dirY * force };
            Matter.Body.applyForce(body, body.position, forceVec);
          }
        });
      }

      // 1. User Presence Ripple — objects drift away from a passing cursor.
      //
      // Only *my own* cursor drives this, and only for objects I own. Previously every
      // client applied ripple forces from every remote cursor, so N clients each ran a
      // separate simulation of the same object and each committed its own resting
      // position to the CRDT doc — the writes fought and objects jittered. Now the
      // client whose cursor causes the ripple owns and commits it; everyone else
      // renders that client's broadcast flight path.
      const myCursor = provider.awareness?.getLocalState()?.cursor as any;
      if (myCursor) {
        const cx = myCursor.x;
        const cy = myCursor.y;

        bodyMap.current.forEach((body, id) => {
          if (isOwnedByRemote(id)) return;

          const dx = body.position.x - cx;
          const dy = body.position.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 120 && dist > 0) {
            if (body.isStatic) {
              Matter.Body.setStatic(body, false);
              const width = body.plugin.width || 100;
              const height = body.plugin.height || 100;
              activeDynamic.current.set(id, { framesSettled: 0, startTime: now, width, height });
              claimOwnership(id);
            }
            const force = (120 - dist) / 120 * 0.0005 * body.mass;
            Matter.Body.applyForce(body, body.position, { x: (dx / dist) * force, y: (dy / dist) * force });
          }
        });
      }

      if (activeDynamic.current.size > 0) {
        // 2. Emergent Magnetic Clustering (Stickies attract each other)
        const activeStickies: Matter.Body[] = [];
        activeDynamic.current.forEach((_, id) => {
          const body = bodyMap.current.get(id);
          if (body && body.label === 'sticky') activeStickies.push(body);
        });

        if (activeStickies.length > 0) {
          bodyMap.current.forEach((otherBody) => {
            if (otherBody.label !== 'sticky') return;
            for (const activeBody of activeStickies) {
              if (activeBody === otherBody) continue;
              const dx = otherBody.position.x - activeBody.position.x;
              const dy = otherBody.position.y - activeBody.position.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist > 80 && dist < 250) {
                const force = 0.00001 * activeBody.mass; // Gentle pull
                Matter.Body.applyForce(activeBody, activeBody.position, {
                  x: (dx / dist) * force,
                  y: (dy / dist) * force
                });
              }
            }
          });
        }

        Matter.Engine.update(engine, Math.min(delta, 33));
        
        const toRemove: string[] = [];
        const awarenessUpdates: Record<string, any> = {};

        activeDynamic.current.forEach((data, id) => {
          const body = bodyMap.current.get(id);
          if (!body) {
            toRemove.push(id);
            return;
          }

          const { width, height, startTime } = data;
          const speed = Matter.Body.getSpeed(body);
          
          if (speed < VELOCITY_EPSILON) {
            data.framesSettled++;
          } else {
            data.framesSettled = 0;
          }

          const timedOut = now - startTime > TIMEOUT_MS;
          const newX = body.position.x - width / 2;
          const newY = body.position.y - height / 2;
          
          if (data.framesSettled >= SETTLE_FRAMES || timedOut) {
            toRemove.push(id);
            Matter.Body.setStatic(body, true);
            // Persist rotation alongside position. Without this, an object that lands
            // rotated snaps back to its old angle as soon as anything else re-renders
            // it from the doc (or on reload), because only x/y were ever committed.
            updateNode(id, {
              x: newX,
              y: newY,
              rotation: body.angle * (180 / Math.PI),
            });
            awarenessUpdates[id] = null;
            releaseOwnership(id);
          } else {
            // High-performance update bypassing React
            if (stageRef.current) {
              const node = stageRef.current.findOne('#' + id);
              if (node) {
                node.x(newX);
                node.y(newY);
                node.rotation(body.angle * (180 / Math.PI));
              }
            }
            awarenessUpdates[id] = { x: newX, y: newY, rotation: body.angle * (180 / Math.PI) };
          }
        });

        if (Object.keys(awarenessUpdates).length > 0) {
          throttledBroadcast(awarenessUpdates);
        }

        toRemove.forEach(id => activeDynamic.current.delete(id));
      }

      frameId = requestAnimationFrame(updatePhysics);
    };

    frameId = requestAnimationFrame(updatePhysics);

    return () => {
      cancelAnimationFrame(frameId);
      Matter.Engine.clear(engine);
    };
  }, [stageRef]);

  // Sync CRDT objects to Matter.js bodies
  useEffect(() => {
    if (!engineRef.current) return;
    const engine = engineRef.current;
    const currentIds = new Set(Object.keys(objects));

    // Remove deleted
    bodyMap.current.forEach((body, id) => {
      if (!currentIds.has(id)) {
        Matter.Composite.remove(engine.world, body);
        bodyMap.current.delete(id);
        activeDynamic.current.delete(id);
      }
    });

    // Add or update
    Object.entries(objects).forEach(([id, obj]: [string, any]) => {
      // Comments and artboards are anchors, not props — never give them a body.
      if (!isPhysical(obj.type)) {
        const existing = bodyMap.current.get(id);
        if (existing) {
          Matter.Composite.remove(engine.world, existing);
          bodyMap.current.delete(id);
          activeDynamic.current.delete(id);
        }
        return;
      }
      // Size comes straight from the node — there is only one place it lives.
      const w = obj.width * Math.abs(obj.scaleX || 1);
      const h = obj.height * Math.abs(obj.scaleY || 1);
      const angle = (obj.rotation || 0) * (Math.PI / 180);
      const cx = obj.x + w / 2;
      const cy = obj.y + h / 2;

      let body = bodyMap.current.get(id);
      if (!body) {
        const profile = getMaterialProfile(obj.type);
        body = Matter.Bodies.rectangle(cx, cy, w, h, { 
          isStatic: true, 
          angle,
          frictionAir: profile.frictionAir,
          restitution: profile.restitution,
          density: profile.density,
          label: obj.type
        });
        body.plugin = { width: w, height: h, type: obj.type, id };
        Matter.Composite.add(engine.world, body);
        bodyMap.current.set(id, body);
      } else {
        if (body.isStatic) {
          Matter.Body.setPosition(body, { x: cx, y: cy });
          Matter.Body.setAngle(body, angle);
        }
      }
    });
  }, [objects]);

  const handleThrow = useCallback((id: string, x: number, y: number, vx: number, vy: number) => {
    const body = bodyMap.current.get(id);
    if (!body) return;

    if (!useStore.getState().physicsEnabled) {
      // Physics off: a flick just ends the drag at the release point, same
      // as any other object move, instead of launching a projectile.
      updateNode(id, { x: x - (body.plugin.width || 100) / 2, y: y - (body.plugin.height || 100) / 2 });
      return;
    }

    Matter.Body.setStatic(body, false);

    // Teleport the body to where the object was actually released before launching it.
    // The body position only tracks the CRDT doc while static, so after a drag it still
    // holds the pre-drag location — without this the object visibly snaps backwards and
    // then flies from the wrong origin.
    const w = body.plugin.width || 100;
    const h = body.plugin.height || 100;
    Matter.Body.setPosition(body, { x, y });
    body.plugin.width = w;
    body.plugin.height = h;

    Matter.Body.setVelocity(body, { x: vx, y: vy });

    activeDynamic.current.set(id, {
      framesSettled: 0,
      startTime: performance.now(),
      width: w,
      height: h,
    });

    // Claim ownership of this object's simulation so other clients render our
    // broadcast flight path instead of simulating their own divergent copy.
    claimOwnership(id);
  }, []);

  const applyAttractRepel = useCallback((draggedId: string, dragX: number, dragY: number, mode: 'attract' | 'repel' | null) => {
    attractRepelTarget.current = { id: draggedId, x: dragX, y: dragY, mode };
  }, []);

  const commitNudges = useCallback(() => {
    attractRepelTarget.current = null;
  }, []);

  const applyGlobalForce = useCallback((x: number, y: number, mode: 'magnet' | 'repel' | 'wind' | 'shockwave', extra?: any) => {
    if (!engineRef.current || !useStore.getState().physicsEnabled) return;
    const now = performance.now();

    bodyMap.current.forEach((body, id) => {
      // Don't fight another client that's already simulating this object.
      if (isOwnedByRemote(id)) return;
      if (body.isStatic) claimOwnership(id);

      const dx = body.position.x - x;
      const dy = body.position.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if ((mode === 'magnet' || mode === 'repel') && dist < 600 && dist > 10) {
        if (body.isStatic) {
          Matter.Body.setStatic(body, false);
          activeDynamic.current.set(id, { framesSettled: 0, startTime: now, width: body.plugin.width, height: body.plugin.height });
        }
        const force = (600 - dist) / 600 * 0.001 * body.mass; // push or pull
        const sign = mode === 'magnet' ? -1 : 1;
        Matter.Body.applyForce(body, body.position, { x: sign * (dx / dist) * force, y: sign * (dy / dist) * force });
      } 
      else if (mode === 'wind' && dist < 1000) {
        if (body.isStatic) {
          Matter.Body.setStatic(body, false);
          activeDynamic.current.set(id, { framesSettled: 0, startTime: now, width: body.plugin.width, height: body.plugin.height });
        }
        const force = 0.0005 * body.mass;
        Matter.Body.applyForce(body, body.position, { x: (extra?.dx || 0) * force, y: (extra?.dy || 0) * force });
      }
      else if (mode === 'shockwave' && dist < 800 && dist > 10) {
        if (body.isStatic) {
          Matter.Body.setStatic(body, false);
          activeDynamic.current.set(id, { framesSettled: 0, startTime: now, width: body.plugin.width, height: body.plugin.height });
        }
        const force = (800 - dist) / 800 * 0.15 * body.mass; // explosion
        Matter.Body.applyForce(body, body.position, { x: (dx / dist) * force, y: (dy / dist) * force });
      }
    });
  }, []);

  return { handleThrow, applyAttractRepel, commitNudges, applyGlobalForce };
}
