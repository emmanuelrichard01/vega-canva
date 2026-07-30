import { useSyncExternalStore } from 'react';
import { provider } from '../document';

export interface FlightPose {
  x: number;
  y: number;
  rotation?: number;
}

/**
 * Live positions of objects currently being simulated by *some* client.
 *
 * While an object is in flight the owning client broadcasts its pose over
 * awareness ~30x/second and every other client renders that instead of the
 * object's last committed position.
 *
 * The previous implementation had each `ObjectRenderer` loop over every peer's
 * awareness state on every render looking for its own id — O(objects x peers)
 * work per frame, on the render path, for a feature that is idle almost all of
 * the time. This keeps one subscription for the whole canvas and publishes an
 * id-keyed snapshot; an object with no entry does no work at all.
 */
class PhysicsFlightState {
  private poses: Record<string, FlightPose> = {};
  private listeners = new Set<() => void>();
  private installed = false;

  private handleAwarenessChange = () => {
    const states = provider.awareness?.getStates();
    if (!states) return;

    const localClientId = provider.awareness?.clientID;

    const next: Record<string, FlightPose> = {};
    states.forEach((state, clientId) => {
      // Skip our own broadcast. This is what made a throw judder on the screen
      // of the person who threw it: the physics loop writes the Konva node
      // every frame, but our own pose came back through awareness at 30Hz and
      // re-rendered the object at a position up to a frame and a half stale.
      // Two writers, alternating — which looks exactly like the object phasing
      // rapidly back and forth. The owner already sees its own motion applied
      // imperatively; this map is only for rendering *other* people's throws.
      if (clientId === localClientId) return;

      const throws = (state as { throws?: Record<string, FlightPose | null> } | undefined)?.throws;
      if (!throws) return;
      Object.entries(throws).forEach(([id, pose]) => {
        // A null entry is how the owner signals "landed, read the document".
        if (pose && typeof pose.x === 'number' && typeof pose.y === 'number') next[id] = pose;
      });
    });

    // Cheap identity check: skip notifying when nothing is (still) in flight.
    const prevKeys = Object.keys(this.poses);
    const nextKeys = Object.keys(next);
    if (prevKeys.length === 0 && nextKeys.length === 0) return;

    this.poses = next;
    this.listeners.forEach((l) => l());
  };

  private install() {
    if (this.installed) return;
    this.installed = true;
    provider.awareness?.on('change', this.handleAwarenessChange);
  }

  subscribe = (listener: () => void) => {
    this.install();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getPose = (id: string): FlightPose | undefined => this.poses[id];
}

export const physicsFlight = new PhysicsFlightState();

/**
 * Subscribe a component to one object's flight pose.
 *
 * A module-level function rather than a method on `PhysicsFlightState`: a hook
 * living on a class is invisible to `react-hooks/rules-of-hooks`, which can
 * only see "a hook called inside a class" and reports it as an error. The call
 * was always legal — `ObjectRenderer` invokes it unconditionally from its
 * function body — but keeping the hook where static analysis can verify that is
 * worth more than the syntactic nicety of `physicsFlight.useFlight(id)`.
 *
 * `subscribe` and `getPose` are bound arrow properties, so the references
 * handed to `useSyncExternalStore` are stable and it never resubscribes.
 */
export function useFlight(id: string): FlightPose | undefined {
  return useSyncExternalStore(
    physicsFlight.subscribe,
    () => physicsFlight.getPose(id),
    () => undefined
  );
}
