import { describe, expect, it } from 'vitest';
import { coachPlacement, coachPlacement2D } from './coachAnchor';

const card = { width: 400 };
const view = { width: 1200 };

describe('coachPlacement', () => {
  it('centres on the seat when there is room', () => {
    const p = coachPlacement({ left: 580, width: 40 }, card, view);
    expect(p.centre).toBe(600);
    expect(p.tail).toBe(200);
  });

  it('keeps the card inside the window and lets the tail reach the seat', () => {
    const p = coachPlacement({ left: 4, width: 40 }, card, view);
    expect(p.centre).toBe(16 + 200);
    // The seat is left of the card's own edge, so the tail rests at its inset.
    expect(p.tail).toBe(24);
    const right = coachPlacement({ left: 1170, width: 40 }, card, view);
    expect(right.centre).toBe(1200 - 16 - 200);
    expect(right.tail).toBe(400 - 24);
  });

  it('falls back to the middle when nothing raised it', () => {
    expect(coachPlacement(null, card, view)).toEqual({ centre: 600, tail: null });
  });

  it('does not try to fit a card wider than the window', () => {
    expect(coachPlacement({ left: 50, width: 40 }, { width: 500 }, { width: 420 })).toEqual({ centre: 210, tail: null });
  });
});

describe('coachPlacement2D', () => {
  const viewport = { width: 1280, height: 800 };
  // Header 56, panels 260 and 300 wide, dock top at 720.
  const free = { left: 276, right: 964, top: 72, bottom: 704 };
  const card = { width: 420, height: 160 };
  const inside = (p: { left: number; top: number }, w = card.width, h = card.height) =>
    p.left >= free.left - 0.01 && p.left + w <= free.right + 0.01 && p.top >= free.top - 0.01 && p.top + h <= free.bottom + 0.01;

  it('sits above a dock seat, inside the strip, with its tail on the seat', () => {
    const p = coachPlacement2D({ left: 600, top: 728, width: 40, height: 40 }, card, free, viewport);
    expect(inside(p)).toBe(true);
    expect(p.side).toBe('above');
    expect(p.left + (p.tail ?? 0)).toBeCloseTo(620);
  });

  it('never goes under a panel, even for a seat beneath one', () => {
    const p = coachPlacement2D({ left: 1200, top: 728, width: 40, height: 40 }, card, free, viewport);
    expect(inside(p)).toBe(true);
    // The seat is outside the card's span, so there is no tail to point with.
    expect(p.tail).toBeNull();
  });

  it('flips below a seat near the top', () => {
    const p = coachPlacement2D({ left: 600, top: 80, width: 40, height: 32 }, card, free, viewport);
    expect(p.side).toBe('below');
    expect(p.top).toBe(80 + 32 + 12);
    expect(inside(p)).toBe(true);
  });

  it('with no seat on screen, sits centred at the bottom of the strip', () => {
    const hidden = coachPlacement2D({ left: 0, top: 0, width: 0, height: 0 }, card, free, viewport);
    const offscreen = coachPlacement2D({ left: 1400, top: 900, width: 40, height: 40 }, card, free, viewport);
    for (const p of [hidden, offscreen]) {
      expect(inside(p)).toBe(true);
      expect(p.tail).toBeNull();
      expect(p.top + card.height).toBe(free.bottom);
      expect(p.left + card.width / 2).toBeCloseTo((free.left + free.right) / 2);
    }
  });

  it('caps its size to a strip smaller than the card instead of overflowing it', () => {
    const tight = { left: 276, right: 964, top: 72, bottom: 172 };
    const p = coachPlacement2D(null, card, tight, viewport);
    expect(p.maxHeight).toBe(100);
    expect(p.top).toBe(72);
  });

  it('overlaps a panel rather than leave the window when the strip is too narrow', () => {
    const narrow = { left: 300, right: 500, top: 72, bottom: 704 };
    const p = coachPlacement2D(null, card, narrow, viewport);
    expect(p.left).toBeGreaterThanOrEqual(16);
    expect(p.left + card.width).toBeLessThanOrEqual(viewport.width - 16);
  });
});
