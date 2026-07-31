import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { collaboratorStore } from './collaboratorStore';
import type { Collaborator } from './collaborators';

/**
 * Everyone else in the room, re-rendering only when the *roster* changes.
 *
 * Positions are not a render input — read them in `usePresenceFrame`. See the
 * note on `rosterSignature` for why the two are kept apart.
 */
export function useCollaborators(): Collaborator[] {
  return useSyncExternalStore(
    collaboratorStore.subscribe,
    collaboratorStore.getSnapshot,
    collaboratorStore.getSnapshot
  );
}

/**
 * Run `callback` once per animation frame, after presence interpolation.
 *
 * The callback is held in a ref so a component can close over fresh props
 * without tearing the shared frame loop down and rebuilding it every render —
 * which, for a loop several surfaces share, would restart everyone's
 * interpolation clock.
 */
export function usePresenceFrame(callback: (dtMs: number) => void, enabled = true) {
  const ref = useRef(callback);
  ref.current = callback;

  const run = useCallback((dt: number) => ref.current(dt), []);

  useEffect(() => {
    if (!enabled) return;
    return collaboratorStore.onFrame(run);
  }, [run, enabled]);
}

/**
 * A stable `ref` callback per collaborator.
 *
 * Presence surfaces keep per-person DOM handles and per-person scratch state
 * (measured chip sizes, when someone last moved, whether a marker is
 * currently shown) in a `Map` populated from `ref` callbacks. Writing those
 * refs inline — `ref={(el) => register(id, el)}` — creates a **new function
 * every render**, which React treats as a different ref: it calls the old one
 * with `null` and the new one with the element, on every single render.
 *
 * That quietly destroys the scratch state. The bug it produced was an
 * off-screen marker that would not go away: the frame loop only wrote
 * `opacity: 0` when its record said the marker was currently visible, and that
 * record had just been reset to `false` by a re-render, so the marker sat
 * there at full opacity pointing at someone who was in plain sight.
 *
 * Memoising by client id keeps the identity stable, so React attaches once.
 */
export function useKeyedRef<T extends HTMLElement>(assign: (key: number, el: T | null) => void) {
  const cache = useRef(new Map<number, (el: T | null) => void>());
  return useCallback(
    (key: number) => {
      let fn = cache.current.get(key);
      if (!fn) {
        fn = (el: T | null) => assign(key, el);
        cache.current.set(key, fn);
      }
      return fn;
    },
    [assign]
  );
}

export type { Collaborator };
