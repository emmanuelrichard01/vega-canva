import { PHYSICS_PRIMERS } from './catalogue/physics';
import type { FalloffId, ForceId, LatchSeconds } from '../physics/forces';

/** The few setters a primer drives, so the rule can be tested without the store. */
export interface PrimerSinks {
  setLastForce: (id: ForceId) => void;
  setForceRadiusScale: (scale: number) => void;
  setForceFalloff: (id: FalloffId) => void;
  setForceLatch: (on: boolean) => void;
  setForceLatchSeconds: (seconds: LatchSeconds) => void;
  setGravityAngle: (degrees: number) => void;
}

/**
 * Prime the Forces bar for a physics board opened from the gallery: the force
 * the board is built for, its latch, radius, falloff and gravity direction.
 * A board with no primer leaves the bar as it was. Returns whether one applied.
 */
export function applyPhysicsPrimer(templateId: string, sinks: PrimerSinks): boolean {
  const primer = PHYSICS_PRIMERS[templateId];
  if (!primer) return false;
  sinks.setLastForce(primer.force);
  if (primer.radiusScale !== undefined) sinks.setForceRadiusScale(primer.radiusScale);
  if (primer.falloff) sinks.setForceFalloff(primer.falloff);
  // Latching is part of the setup either way: a hold-to-apply board turns it off.
  sinks.setForceLatch(primer.latchSeconds !== undefined);
  if (primer.latchSeconds !== undefined) sinks.setForceLatchSeconds(primer.latchSeconds);
  if (primer.gravityAngle !== undefined) sinks.setGravityAngle(primer.gravityAngle);
  return true;
}
