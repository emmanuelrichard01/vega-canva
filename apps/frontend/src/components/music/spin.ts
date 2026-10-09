/** 33⅓ rpm in degrees per second. */
export const RPM_33 = 200;

/**
 * Eases the record's speed toward its target: it winds up in about a third of
 * a second and coasts to rest a little slower, with no overshoot.
 */
export function spinSpeed(speed: number, dt: number, playing: boolean): number {
  const target = playing ? RPM_33 : 0;
  const rate = playing ? 9 : 5;
  const next = target + (speed - target) * Math.exp(-rate * Math.max(0, dt));
  return !playing && next < 2 ? 0 : next;
}
