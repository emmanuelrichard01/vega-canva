import { describe, it, expect } from 'vitest';
import { applyMarquee, expandToUnits, marqueeHits, marqueeModeFor } from './marquee';

const node = (id: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'shape', x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1, locked: false, ...extra }) as any;

describe('marqueeHits', () => {
  it('picks up what the box touches and nothing else', () => {
    const hits = marqueeHits([node('a', 10, 10, 50, 50), node('b', 200, 200, 50, 50)], {
      minX: 0, minY: 0, maxX: 100, maxY: 100,
    });
    expect(hits).toEqual(['a']);
  });

  it('judges a rotated object by its outline as drawn', () => {
    // 200x20 centred on (100, 10), turned on end: x 90..110, y -90..110.
    const bar = node('bar', 0, 0, 200, 20, { rotation: 90 });
    expect(marqueeHits([bar], { minX: 95, minY: -80, maxX: 105, maxY: -60 })).toEqual(['bar']);
    // Where the right end of the flat bar would be — empty once it is turned.
    expect(marqueeHits([bar], { minX: 180, minY: 0, maxX: 199, maxY: 19 })).toEqual([]);
  });

  it('misses a diamond whose bounding-box corner is all the box reaches', () => {
    // A 100x100 square turned 45°: its AABB corner at (0, 0) is empty space.
    const diamond = node('d', 0, 0, 100, 100, { rotation: 45 });
    expect(marqueeHits([diamond], { minX: -30, minY: -30, maxX: 5, maxY: 5 })).toEqual([]);
    expect(marqueeHits([diamond], { minX: 45, minY: 45, maxX: 55, maxY: 55 })).toEqual(['d']);
  });

  it('skips locked and hidden objects', () => {
    const hits = marqueeHits(
      [node('l', 0, 0, 10, 10, { locked: true }), node('h', 0, 0, 10, 10, { hidden: true })],
      { minX: -5, minY: -5, maxX: 20, maxY: 20 }
    );
    expect(hits).toEqual([]);
  });
});

describe('marquee modes', () => {
  it('maps modifiers to a mode', () => {
    expect(marqueeModeFor({})).toBe('replace');
    expect(marqueeModeFor({ shiftKey: true })).toBe('add');
    expect(marqueeModeFor({ ctrlKey: true })).toBe('add');
    expect(marqueeModeFor({ metaKey: true })).toBe('add');
    expect(marqueeModeFor({ altKey: true })).toBe('subtract');
    expect(marqueeModeFor({ altKey: true, shiftKey: true })).toBe('intersect');
    expect(marqueeModeFor(null)).toBe('replace');
  });

  it('combines a catch with the selection by mode', () => {
    const prev = ['a', 'b', 'c'];
    const caught = ['b', 'c', 'd'];
    expect(applyMarquee(prev, caught, 'replace')).toEqual(['b', 'c', 'd']);
    expect(applyMarquee(prev, caught, 'add')).toEqual(['a', 'b', 'c', 'd']);
    expect(applyMarquee(prev, caught, 'subtract')).toEqual(['a']);
    expect(applyMarquee(prev, caught, 'intersect')).toEqual(['b', 'c']);
  });

  it('widens hits to whole units without duplicates', () => {
    const units: Record<string, string[]> = { a: ['a', 'b'], b: ['a', 'b'], c: ['c'] };
    expect(expandToUnits(['a', 'b', 'c'], (id) => units[id])).toEqual(['a', 'b', 'c']);
  });
});
