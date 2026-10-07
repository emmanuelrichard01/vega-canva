import { describe, expect, it } from 'vitest';
import { coachPlacement } from './coachAnchor';

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
