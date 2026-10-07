import { useSyncExternalStore } from 'react';
import { storageGet, storageSet } from '../../utils/safeStorage';

/**
 * Physics settings that belong to the mode rather than to a document.
 *
 * Direction of Drop and whether frames may be moved. Kept here, not in the
 * shared store, so the physics feature owns everything it adds. Persisted per
 * browser: both are preferences, not board content.
 */
export interface PhysicsSettings {
  /** Direction of Drop in degrees. 0 is right, 90 is down. */
  gravityAngle: number;
  /** Whether objects inside frames may be moved. */
  includeFrames: boolean;
}

const KEY_ANGLE = 'vega_physics_gravity_angle';
const KEY_FRAMES = 'vega_physics_include_frames';

/** The eight compass directions Drop can face. */
export const GRAVITY_ANGLES = [270, 315, 0, 45, 90, 135, 180, 225] as const;

const normaliseAngle = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

function load(): PhysicsSettings {
  const rawAngle = Number(storageGet(KEY_ANGLE));
  return {
    gravityAngle: storageGet(KEY_ANGLE) !== null && Number.isFinite(rawAngle) ? normaliseAngle(rawAngle) : 90,
    includeFrames: storageGet(KEY_FRAMES) === '1',
  };
}

let state: PhysicsSettings = load();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const physicsSettings = {
  get: (): PhysicsSettings => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setGravityAngle(deg: number) {
    const next = normaliseAngle(deg);
    if (next === state.gravityAngle) return;
    state = { ...state, gravityAngle: next };
    storageSet(KEY_ANGLE, String(next));
    emit();
  },
  setIncludeFrames(on: boolean) {
    if (on === state.includeFrames) return;
    state = { ...state, includeFrames: on };
    storageSet(KEY_FRAMES, on ? '1' : '0');
    emit();
  },
};

export function usePhysicsSettings(): PhysicsSettings {
  return useSyncExternalStore(physicsSettings.subscribe, physicsSettings.get, physicsSettings.get);
}

/**
 * What the loop is doing right now, readable without subscribing.
 *
 * The HUD uses it to decide whether Escape means "freeze" (something is moving
 * or a field is running) or "leave" (nothing is). Written by the frame loop, so
 * it is a plain object rather than state: nothing re-renders from it.
 */
export const physicsRuntime = {
  moving: 0,
  latched: false,
  /** Direction the pointer last travelled while a force was held, in degrees. */
  windAngle: 0,
};
