import { describe, expect, it } from 'vitest';
import { compareStacking, sortByStacking } from './stacking';

describe('stacking order', () => {
  it('breaks a zIndex tie by id, so every client draws the same order', () => {
    const a = { id: 'b', zIndex: 3 };
    const b = { id: 'a', zIndex: 3 };
    // Whatever order the nodes were integrated in, the result is the same.
    expect(sortByStacking([a, b]).map((n) => n.id)).toEqual(['a', 'b']);
    expect(sortByStacking([b, a]).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('orders by zIndex first, treating a missing one as 0', () => {
    expect(sortByStacking([{ id: 'x', zIndex: 2 }, { id: 'y' }, { id: 'z', zIndex: -1 }]).map((n) => n.id)).toEqual(['z', 'y', 'x']);
    expect(compareStacking({ id: 'a', zIndex: 1 }, { id: 'a', zIndex: 1 })).toBe(0);
  });
});
