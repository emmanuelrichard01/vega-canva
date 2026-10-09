import { describe, expect, it } from 'vitest';
import { RPM_33, spinSpeed } from './spin';

describe('spinSpeed', () => {
  it('winds up toward 33⅓ rpm without overshooting', () => {
    let s = 0;
    for (let i = 0; i < 120; i++) {
      s = spinSpeed(s, 1 / 60, true);
      expect(s).toBeLessThanOrEqual(RPM_33);
    }
    expect(s).toBeGreaterThan(RPM_33 * 0.99);
  });
  it('coasts to a full stop when paused', () => {
    let s = RPM_33;
    for (let i = 0; i < 300; i++) s = spinSpeed(s, 1 / 60, false);
    expect(s).toBe(0);
  });
  it('slows monotonically', () => {
    const a = spinSpeed(RPM_33, 0.1, false);
    expect(a).toBeLessThan(RPM_33);
    expect(spinSpeed(a, 0.1, false)).toBeLessThan(a);
  });
});
