import { describe, expect, it } from 'vitest';
import { isClosedLoop, loopPath } from './freehandLoop';
import type { Point } from './schema';

/**
 * A pencil stroke that comes back to where it started encloses an area.
 *
 * `perfect-freehand` emits a filled outline polygon rather than a line, so the
 * *outline* is always closed — that is not what this asks. It asks whether the
 * **centreline** loops, which is the only sense in which a pencil stroke has an
 * inside for a fill to land in.
 */

/** A circle, sampled — the ordinary closed stroke. */
const circle = (radius: number, samples = 40, gap = 0): Point[] => {
  const out: Point[] = [];
  const span = Math.PI * 2 - gap;
  for (let i = 0; i < samples; i += 1) {
    const t = (i / (samples - 1)) * span;
    out.push({ x: Math.cos(t) * radius, y: Math.sin(t) * radius });
  }
  return out;
};

/** A straight run out and back, which ends where it began and encloses nothing. */
const thereAndBack = (length: number, samples = 20): Point[] => {
  const out: Point[] = [];
  const half = samples / 2;
  for (let i = 0; i < half; i += 1) out.push({ x: (i / half) * length, y: 0 });
  for (let i = 0; i < half; i += 1) out.push({ x: length - (i / half) * length, y: 0 });
  return out;
};

describe('a loop is closed', () => {
  it('recognises a circle drawn back to its start', () => {
    expect(isClosedLoop(circle(100), 6)).toBe(true);
  });

  it('recognises a small one', () => {
    // The gap is measured against the nib and the distance travelled, not
    // against an absolute size, so a loop the size of a full stop closes too.
    expect(isClosedLoop(circle(12), 3)).toBe(true);
  });

  it('forgives a gap the pen itself would cover', () => {
    // A person calls that closed, because at that nib it looks closed.
    expect(isClosedLoop(circle(100, 40, 0.06), 6)).toBe(true);
  });
});

describe('what is not a loop', () => {
  it('refuses a stroke that stops well short of its start', () => {
    expect(isClosedLoop(circle(100, 40, 1.2), 6)).toBe(false);
  });

  it('refuses a line that went out and came back', () => {
    /**
     * The case the travel ratio exists for, and the one a plain "are the ends
     * close" test gets wrong every time: this ends *exactly* where it began
     * and encloses nothing at all. Its travel is only twice its own length,
     * where a real loop's is many times the gap it closes.
     */
    expect(isClosedLoop(thereAndBack(200), 6)).toBe(false);
  });

  it('refuses a tap', () => {
    expect(isClosedLoop([{ x: 0, y: 0 }, { x: 0, y: 0 }], 6)).toBe(false);
  });

  it('refuses a flick with too few points to have a shape', () => {
    expect(isClosedLoop(circle(100, 5), 6)).toBe(false);
  });

  it('refuses an empty stroke', () => {
    expect(isClosedLoop([], 6)).toBe(false);
  });
});

describe('the nib is part of the question', () => {
  it('lets a fat pen close a gap a fine one cannot', () => {
    // The same stroke, twice. A gap of about 12 units is covered by a 30-unit
    // nib and is a visible hole under a 1-unit one.
    const nearlyClosed = circle(100, 40, 0.12);
    expect(isClosedLoop(nearlyClosed, 30)).toBe(true);
    expect(isClosedLoop(nearlyClosed, 1)).toBe(false);
  });
});

describe('loopPath', () => {
  it('walks the centreline and closes it', () => {
    const d = loopPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(d).toBe('M0 0 L10 0 L10 10 Z');
  });

  it('answers nothing for a run with no area', () => {
    // Two points enclose no region, and asking the renderer to fill a line is
    // how a stray sliver appears on a board.
    expect(loopPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('');
    expect(loopPath([])).toBe('');
  });
});
