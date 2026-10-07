import { describe, it, expect } from 'vitest';
import { nextBehind, stackAt, stackAtPoint } from './pick';
import { spatialIndex } from '../SpatialIndex';
import { engineEvents } from '../EventBus';

const node = (id: string, x: number, y: number, w: number, h: number, zIndex: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'shape', x, y, width: w, height: h, zIndex, rotation: 0, scaleX: 1, scaleY: 1, locked: false, ...extra }) as any;

describe('stackAt', () => {
  const nodes = [
    node('bottom', 0, 0, 300, 300, 1),
    node('middle', 50, 50, 100, 100, 2),
    node('top', 60, 60, 20, 20, 3),
    node('elsewhere', 500, 500, 10, 10, 4),
    node('locked', 0, 0, 400, 400, 5, { locked: true }),
  ];

  it('lists what is under the point, topmost first, skipping locked objects', () => {
    expect(stackAt(nodes, 70, 70)).toEqual(['top', 'middle', 'bottom']);
    expect(stackAt(nodes, 10, 10)).toEqual(['bottom']);
    expect(stackAt(nodes, 1000, 1000)).toEqual([]);
  });

  it('breaks z ties by id, so every client walks the same pile', () => {
    const tied = [node('a', 0, 0, 10, 10, 1), node('b', 0, 0, 10, 10, 1)];
    expect(stackAt(tied, 5, 5)).toEqual(['b', 'a']);
    expect(stackAt([...tied].reverse(), 5, 5)).toEqual(['b', 'a']);
  });
});

describe('nextBehind', () => {
  const stack = ['top', 'middle', 'bottom'];

  it('starts behind the top object when nothing in the pile is selected', () => {
    expect(nextBehind(stack, [])).toBe('middle');
    expect(nextBehind(stack, ['unrelated'])).toBe('middle');
  });

  it('walks down from the current selection and wraps to the top', () => {
    expect(nextBehind(stack, ['top'])).toBe('middle');
    expect(nextBehind(stack, ['middle'])).toBe('bottom');
    expect(nextBehind(stack, ['bottom'])).toBe('top');
  });

  it('handles a pile of one or none', () => {
    expect(nextBehind(['only'], ['only'])).toBe('only');
    expect(nextBehind([], [])).toBeNull();
  });
});

describe('stackAtPoint', () => {
  it('asks the spatial index, so far-away objects are never tested', () => {
    spatialIndex.clear();
    const near = node('near', 0, 0, 100, 100, 1);
    near.geometry = { kind: 'rect' };
    const far = node('far', 5000, 5000, 100, 100, 2);
    far.geometry = { kind: 'rect' };
    engineEvents.emit('ObjectAdded', near);
    engineEvents.emit('ObjectAdded', far);
    expect(stackAtPoint(50, 50)).toEqual(['near']);
    expect(stackAtPoint(5050, 5050)).toEqual(['far']);
    expect(stackAtPoint(2000, 2000)).toEqual([]);
    spatialIndex.clear();
  });
});
