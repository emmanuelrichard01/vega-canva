import { describe, expect, it } from 'vitest';
import { deckOf, moveMany, nextPlayable, placeSlide, playableIds } from './deck';
import type { AnyNode } from '../model/schema';

const frame = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'frame', x, y, width: 100, height: 60, hidden: false, zIndex: 0, ...extra }) as unknown as AnyNode;

describe('the deck', () => {
  it('reads top-level frames in reading order and ignores nested and hidden ones', () => {
    const deck = deckOf([
      frame('b', 200, 0),
      frame('a', 0, 0),
      frame('c', 0, 200),
      frame('nested', 10, 10, { frameId: 'a' }),
      frame('gone', 400, 0, { hidden: true }),
      { id: 's', type: 'shape', x: 0, y: 0, width: 1, height: 1 } as unknown as AnyNode,
    ]);
    expect(deck.map((s) => s.frame.id)).toEqual(['a', 'b', 'c']);
  });

  it('follows a hand order where one is set', () => {
    const deck = deckOf([frame('a', 0, 0, { slideOrder: 2 }), frame('b', 200, 0, { slideOrder: 0 }), frame('c', 400, 0, { slideOrder: 1 })]);
    expect(deck.map((s) => s.frame.id)).toEqual(['b', 'c', 'a']);
  });

  it('numbers only the slides that are played, and carries sections forward', () => {
    const deck = deckOf([
      frame('a', 0, 0, { slideSection: 'Intro' }),
      frame('b', 200, 0, { slideHidden: true }),
      frame('c', 400, 0),
      frame('d', 600, 0, { slideSection: 'Numbers' }),
    ]);
    expect(deck.map((s) => s.number)).toEqual([1, null, 2, 3]);
    expect(deck.map((s) => s.section)).toEqual(['Intro', 'Intro', 'Intro', 'Numbers']);
    expect(deck.map((s) => s.sectionStart)).toEqual(['Intro', undefined, undefined, 'Numbers']);
    expect(playableIds(deck)).toEqual(['a', 'c', 'd']);
    expect(nextPlayable(deck, 'a')?.frame.id).toBe('c');
    expect(nextPlayable(deck, 'd')).toBeNull();
  });
});

describe('moving slides', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('moves one slide to before the slide that was at the drop', () => {
    expect(moveMany(order, new Set(['a']), 3)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(moveMany(order, new Set(['e']), 1)).toEqual(['a', 'e', 'b', 'c', 'd']);
    expect(moveMany(order, new Set(['b']), 5)).toEqual(['a', 'c', 'd', 'e', 'b']);
  });

  it('moves a scattered selection as one block, keeping its own order', () => {
    expect(moveMany(order, new Set(['d', 'a']), 2)).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(moveMany(order, new Set(['b', 'd']), 5)).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(moveMany(order, new Set(['c', 'e']), 0)).toEqual(['c', 'e', 'a', 'b', 'd']);
  });

  it('is a no-op for nothing selected, or a drop onto itself', () => {
    expect(moveMany(order, new Set(), 2)).toEqual(order);
    expect(moveMany(order, new Set(['c']), 2)).toEqual(order);
    expect(moveMany(order, new Set(['c']), 3)).toEqual(order);
  });
});

describe('placing a new slide', () => {
  it('goes to the right of its neighbour, past anything already there', () => {
    const a = { x: 0, y: 0, width: 100, height: 60 };
    const b = { x: 140, y: 0, width: 100, height: 60 };
    expect(placeSlide(a, a, [a], 40)).toEqual({ x: 140, y: 0 });
    expect(placeSlide(a, a, [a, b], 40)).toEqual({ x: 280, y: 0 });
  });

  it('starts at the origin on an empty board, and after the last slide otherwise', () => {
    expect(placeSlide(null, { width: 10, height: 10 }, [])).toEqual({ x: 0, y: 0 });
    expect(placeSlide(null, { width: 10, height: 10 }, [{ x: 50, y: 30, width: 100, height: 60 }], 40)).toEqual({ x: 190, y: 30 });
  });
});
