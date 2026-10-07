import { describe, it, expect } from 'vitest';
import { fieldArt } from './fieldArt';
import { FORCE_IDS } from './forces';

const base = { radius: 400, falloff: 'linear' as const, heading: 90, phase: 0.3 };

describe('field art', () => {
  it.each(FORCE_IDS)('%s never draws outside its ring', (mode) => {
    for (let p = 0; p < 1; p += 0.07) {
      const art = fieldArt({ ...base, mode, phase: p });
      for (const s of art.segments) {
        expect(Math.hypot(s.x1, s.y1)).toBeLessThanOrEqual(400 + 1e-6);
        expect(Math.hypot(s.x2, s.y2)).toBeLessThanOrEqual(400 + 1e-6);
        expect(s.alpha).toBeGreaterThanOrEqual(0);
        expect(s.alpha).toBeLessThanOrEqual(1);
      }
      for (const r of art.rings) expect(r.radius).toBeLessThanOrEqual(400);
    }
  });

  it('is deterministic for a given phase', () => {
    expect(fieldArt({ ...base, mode: 'magnet' })).toEqual(fieldArt({ ...base, mode: 'magnet' }));
  });

  it('streams pull inward and push outward as the phase advances', () => {
    const rOf = (mode: 'magnet' | 'repel', phase: number) => {
      const s = fieldArt({ ...base, mode, phase }).segments[0];
      return Math.hypot(s.x1, s.y1);
    };
    expect(rOf('magnet', 0.5)).toBeLessThan(rOf('magnet', 0.2));
    expect(rOf('repel', 0.5)).toBeGreaterThan(rOf('repel', 0.2));
  });

  it('runs drop and wind along the heading', () => {
    const art = fieldArt({ ...base, mode: 'gravity', heading: 0 });
    // Heading 0 is right: every streak is horizontal.
    for (const s of art.segments) expect(Math.abs(s.y2 - s.y1)).toBeLessThan(1e-6);
    expect(art.segments.some((s) => s.x2 > s.x1)).toBe(true);
  });

  it('draws shockwave as rings, not streaks', () => {
    const art = fieldArt({ ...base, mode: 'shockwave' });
    expect(art.segments).toHaveLength(0);
    expect(art.rings).toHaveLength(2);
  });

  it('draws nothing for an empty field', () => {
    expect(fieldArt({ ...base, mode: 'magnet', radius: 0 }).segments).toHaveLength(0);
  });
});
