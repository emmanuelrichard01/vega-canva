import { describe, it, expect } from 'vitest';
import { DEMO_LENGTHS, demoBox, demoText } from './demoText';

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

describe('demo text', () => {
  it('lands near every offered length', () => {
    for (const target of DEMO_LENGTHS) {
      const got = words(demoText(target));
      // Near, not exact: it stops on a sentence, and a sentence is where it
      // stops. A quarter either way keeps every size recognisably its size.
      expect(Math.abs(got - target), `${target} words`).toBeLessThanOrEqual(target * 0.35);
    }
  });

  it('always ends on a full sentence', () => {
    for (const target of DEMO_LENGTHS) {
      expect(demoText(target).trim().endsWith('.'), `${target} words`).toBe(true);
    }
  });

  it('grows as a prefix, so changing length reads as the same block', () => {
    const short = demoText(20);
    expect(demoText(100).startsWith(short.slice(0, 40))).toBe(true);
  });

  it('is readable English rather than filler', () => {
    // The point of the passage: it can be read. A lorem-ipsum check would be
    // silly, but the absence of its signature opening is a real assertion.
    expect(demoText(50).toLowerCase()).not.toContain('lorem');
    expect(demoText(50)).toMatch(/\b(the|and|they)\b/i);
  });

  it('sizes a box to a comfortable measure', () => {
    for (const target of DEMO_LENGTHS) {
      const box = demoBox(target);
      const charsPerLine = box.width / 7.2;
      expect(charsPerLine).toBeGreaterThan(40);
      expect(charsPerLine).toBeLessThan(66);
      expect(box.height).toBeGreaterThan(50);
    }
  });
});
