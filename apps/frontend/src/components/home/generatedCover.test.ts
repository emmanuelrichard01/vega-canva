import { describe, it, expect } from 'vitest';
import { GEN_H, GEN_W, generateCover, hashSeed, prng } from './generatedCover';

describe('generateCover', () => {
  it('draws the same picture for the same board, every time', () => {
    expect(generateCover('r8Kd02xYqz', 'Roadmap')).toEqual(generateCover('r8Kd02xYqz', 'Roadmap'));
  });

  it('tells boards apart', () => {
    const pictures = new Set(
      Array.from({ length: 40 }, (_, i) => JSON.stringify(generateCover(`room-${i}`, 'Untitled board')))
    );
    expect(pictures.size).toBe(40);
  });

  it('uses every arrangement across a library', () => {
    const layouts = new Set(Array.from({ length: 60 }, (_, i) => generateCover(`b${i}`, `Board ${i}`).layout));
    expect([...layouts].sort()).toEqual(['cluster', 'flow', 'frames', 'map']);
  });

  it('keeps notes, frames and shapes on the cover', () => {
    for (let i = 0; i < 200; i++) {
      for (const el of generateCover(`id-${i}`, `n${i}`).elements) {
        if (el.k === 'link') {
          expect(el.d.startsWith('M')).toBe(true);
          continue;
        }
        expect(el.x).toBeGreaterThanOrEqual(0);
        expect(el.y).toBeGreaterThanOrEqual(0);
        expect(el.x + el.w).toBeLessThanOrEqual(GEN_W);
        expect(el.y + el.h).toBeLessThanOrEqual(GEN_H);
      }
    }
  });

  it('has a stable seed and generator', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    const a = prng(7);
    const b = prng(7);
    const run = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(run);
    for (const v of run) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
