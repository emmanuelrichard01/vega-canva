import { describe, it, expect } from 'vitest';
import {
  anchorFromPoint,
  anchorPoint,
  anchorPort,
  isCentreAnchor,
  normalizeAnchor,
  PORT_ANCHORS,
} from './connectorAnchor';
import { portPoint, type Box } from './connector';

const BOX: Box = { x: 100, y: 200, width: 400, height: 100 };

describe('anchorPort', () => {
  it('picks the edge the anchor is nearest in the box own proportions', () => {
    expect(anchorPort({ u: 0.02, v: 0.5 })).toBe('left');
    expect(anchorPort({ u: 0.98, v: 0.5 })).toBe('right');
    expect(anchorPort({ u: 0.5, v: 0.02 })).toBe('top');
    expect(anchorPort({ u: 0.5, v: 0.98 })).toBe('bottom');
  });

  it('compares normalized offsets, not pixels', () => {
    // On this 400x100 box the point (240, 210) is 60px left of centre and
    // 40px above it, so a comparison in raw pixels says `left`. But 60px is
    // less than a third of the way to the left edge while 40px is four fifths
    // of the way to the top, and the top is the edge it is genuinely near.
    // This is the same reasoning `portFacing` uses, and getting it wrong puts
    // an arrow on the long side of every wide node.
    expect(anchorPort(anchorFromPoint(BOX, { x: 240, y: 210 }))).toBe('top');
  });
});

describe('anchorPoint', () => {
  it('projects to the perimeter, not to a point floating inside the shape', () => {
    const p = anchorPoint(BOX, { u: 0.05, v: 0.8 });
    expect(p.x).toBe(100);                       // on the left edge
    expect(p.y).toBeGreaterThan(BOX.y + BOX.height / 2);  // below the middle
  });

  it('moves smoothly across a corner instead of jumping', () => {
    // The defect this replaced: the edge was chosen by comparing |du| with
    // |dv| and the point was then snapped to that edge, which is
    // discontinuous at every corner. Sliding along the top-right diagonal of a
    // 100x100 box gave (100, 9) and then (92, 0) — a twelve-unit leap — and
    // near the diagonal the comparison *oscillated*, so the endpoint flickered
    // back and forth across the corner while the cursor moved smoothly.
    const square: Box = { x: 0, y: 0, width: 100, height: 100 };
    let previous = anchorPoint(square, { u: 0.5, v: 0 });
    let worst = 0;
    // A full lap of the perimeter in small steps.
    for (let i = 1; i <= 720; i += 1) {
      const angle = (i / 720) * Math.PI * 2 - Math.PI / 2;
      const p = anchorPoint(square, {
        u: 0.5 + Math.cos(angle) * 0.5,
        v: 0.5 + Math.sin(angle) * 0.5,
      });
      worst = Math.max(worst, Math.hypot(p.x - previous.x, p.y - previous.y));
      previous = p;
    }
    // Each step is under a degree of arc; no step may leap a corner.
    expect(worst).toBeLessThan(2);
  });

  it('lands exactly on the corner from both approaches', () => {
    const square: Box = { x: 0, y: 0, width: 100, height: 100 };
    const fromTheSide = anchorPoint(square, { u: 1, v: 0.001 });
    const fromTheTop = anchorPoint(square, { u: 0.999, v: 0 });
    expect(Math.hypot(fromTheSide.x - fromTheTop.x, fromTheSide.y - fromTheTop.y)).toBeLessThan(1);
  });

  it('slides along one edge as the free coordinate changes', () => {
    const a = anchorPoint(BOX, { u: 1, v: 0.25 });
    const b = anchorPoint(BOX, { u: 1, v: 0.75 });
    expect(a.x).toBe(b.x);            // same edge
    expect(b.y - a.y).toBe(50);       // moved along it
  });

  it('agrees with portPoint for every named port', () => {
    // The two systems have to be one system, or a connector drawn by clicking
    // a ring and one dragged to the same place would sit in different spots.
    for (const port of ['top', 'right', 'bottom', 'left'] as const) {
      expect(anchorPoint(BOX, PORT_ANCHORS[port])).toEqual(portPoint(BOX, port));
    }
  });

  it('clamps a ratio that came from outside the box', () => {
    expect(anchorPoint(BOX, { u: -3, v: 0.5 })).toEqual({ x: 100, y: 250 });
    expect(anchorPoint(BOX, { u: 4, v: 0.5 })).toEqual({ x: 500, y: 250 });
  });

  it('survives a zero-extent box without producing NaN', () => {
    const flat: Box = { x: 10, y: 20, width: 0, height: 0 };
    const p = anchorPoint(flat, { u: 0.3, v: 0.9 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe('anchorFromPoint', () => {
  it('round-trips a point on an edge', () => {
    const p = { x: 100, y: 280 };
    expect(anchorPoint(BOX, anchorFromPoint(BOX, p))).toEqual(p);
  });

  it('does not divide by a zero extent', () => {
    const flat: Box = { x: 10, y: 20, width: 0, height: 50 };
    expect(anchorFromPoint(flat, { x: 10, y: 45 })).toEqual({ u: 0.5, v: 0.5 });
  });
});

describe('isCentreAnchor', () => {
  it('is true near the middle, where the user means the object and not a spot', () => {
    expect(isCentreAnchor({ u: 0.5, v: 0.5 })).toBe(true);
    expect(isCentreAnchor({ u: 0.6, v: 0.45 })).toBe(true);
  });

  it('is false anywhere near an edge', () => {
    expect(isCentreAnchor({ u: 0.02, v: 0.5 })).toBe(false);
    expect(isCentreAnchor({ u: 0.5, v: 0.95 })).toBe(false);
  });

  it('excludes every named port, so clicking a ring never means auto', () => {
    for (const port of ['top', 'right', 'bottom', 'left'] as const) {
      expect(isCentreAnchor(PORT_ANCHORS[port])).toBe(false);
    }
  });
});

describe('normalizeAnchor', () => {
  it('brings both ratios into range and leaves valid ones alone', () => {
    expect(normalizeAnchor({ u: -1, v: 2 })).toEqual({ u: 0, v: 1 });
    expect(normalizeAnchor({ u: 0.3, v: 0.7 })).toEqual({ u: 0.3, v: 0.7 });
  });
});
