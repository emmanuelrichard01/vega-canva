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
  it('projects to the perimeter, keeping the free coordinate', () => {
    // 80% down the left edge, not a point floating inside the shape.
    expect(anchorPoint(BOX, { u: 0.05, v: 0.8 })).toEqual({ x: 100, y: 280 });
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
