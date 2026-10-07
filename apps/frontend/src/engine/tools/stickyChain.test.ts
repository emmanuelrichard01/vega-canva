import { describe, expect, it } from 'vitest';
import { CHAIN_GAP, nextChainSlot, type Box } from './stickyChain';

const note: Box = { x: 100, y: 200, width: 200, height: 200 };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('nextChainSlot', () => {
  it('goes one step right with the gap, or one step down', () => {
    expect(nextChainSlot(note, 'right', () => false)).toEqual({ x: 100 + 200 + CHAIN_GAP, y: 200 });
    expect(nextChainSlot(note, 'down', () => false)).toEqual({ x: 100, y: 200 + 200 + CHAIN_GAP });
  });

  it('skips past occupied slots in the same direction', () => {
    const blocker: Box = { x: 324, y: 200, width: 200, height: 200 };
    const slot = nextChainSlot(note, 'right', (b) => overlaps(b, blocker));
    expect(slot).toEqual({ x: 100 + 2 * (200 + CHAIN_GAP), y: 200 });
    expect(overlaps({ ...slot, width: 200, height: 200 }, blocker)).toBe(false);
  });

  it('wraps under the origin of the run', () => {
    expect(nextChainSlot(note, 'right', () => false, { originX: 0 })).toEqual({ x: 0, y: 200 + 200 + CHAIN_GAP });
  });

  it('falls back to the first slot when nothing is free', () => {
    expect(nextChainSlot(note, 'right', () => true)).toEqual({ x: 324, y: 200 });
  });
});
