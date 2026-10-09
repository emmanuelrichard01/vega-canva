import { describe, expect, it, vi } from 'vitest';
import { applyPhysicsPrimer, type PrimerSinks } from './applyPrimer';

const sinks = (): PrimerSinks => ({
  setLastForce: vi.fn(),
  setForceRadiusScale: vi.fn(),
  setForceFalloff: vi.fn(),
  setForceLatch: vi.fn(),
  setForceLatchSeconds: vi.fn(),
  setGravityAngle: vi.fn(),
});

describe('physics primers', () => {
  it('primes the marble run with latched gravity pointing down', () => {
    const s = sinks();
    expect(applyPhysicsPrimer('physics-marble-run', s)).toBe(true);
    expect(s.setLastForce).toHaveBeenCalledWith('gravity');
    expect(s.setForceRadiusScale).toHaveBeenCalledWith(3);
    expect(s.setForceFalloff).toHaveBeenCalledWith('constant');
    expect(s.setForceLatch).toHaveBeenCalledWith(true);
    expect(s.setForceLatchSeconds).toHaveBeenCalledWith(10);
    expect(s.setGravityAngle).toHaveBeenCalledWith(90);
  });

  it('turns latching off for a hold-to-apply board', () => {
    const s = sinks();
    applyPhysicsPrimer('physics-dominoes', s);
    expect(s.setLastForce).toHaveBeenCalledWith('shockwave');
    expect(s.setForceLatch).toHaveBeenCalledWith(false);
    expect(s.setGravityAngle).not.toHaveBeenCalled();
  });

  it('leaves the bar alone for a board with no primer', () => {
    const s = sinks();
    expect(applyPhysicsPrimer('product-q3-planning', s)).toBe(false);
    expect(s.setLastForce).not.toHaveBeenCalled();
  });
});
