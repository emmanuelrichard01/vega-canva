import { describe, expect, it } from 'vitest';
import {
  LABEL_END_MARGIN,
  fractionNearest,
  labelFraction,
  lineLabelWorld,
  lineStrokeEnds,
  pointAlongRun,
} from './lineLabel';

// An L: 300 across, then 100 down. Its middle is on the long leg.
const L = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  { x: 300, y: 100 },
];

describe('pointAlongRun', () => {
  it('measures by distance, not by index', () => {
    // Halfway through the point list is the corner; halfway along is x = 200.
    expect(pointAlongRun(L, 0.5)).toEqual({ x: 200, y: 0 });
    expect(pointAlongRun(L, 0.875)).toEqual({ x: 300, y: 50 });
  });

  it('pins to the ends and survives degenerate runs', () => {
    expect(pointAlongRun(L, -1)).toEqual({ x: 0, y: 0 });
    expect(pointAlongRun(L, 2)).toEqual({ x: 300, y: 100 });
    expect(pointAlongRun([{ x: 4, y: 4 }, { x: 4, y: 4 }], 0.5)).toEqual({ x: 4, y: 4 });
    expect(pointAlongRun([], 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe('fractionNearest', () => {
  it('is the inverse of pointAlongRun for a point on the run', () => {
    for (const t of [0.1, 0.5, 0.8, 0.95]) {
      expect(fractionNearest(L, pointAlongRun(L, t))).toBeCloseTo(t, 9);
    }
  });

  it('projects a point off the run to the nearest place on it', () => {
    expect(fractionNearest(L, { x: 150, y: -40 })).toBeCloseTo(0.375, 9);
    expect(fractionNearest(L, { x: 360, y: 100 })).toBeCloseTo(1, 9);
  });
});

describe('labelFraction', () => {
  it('is the middle when unset or unreadable', () => {
    expect(labelFraction(undefined)).toBe(0.5);
    expect(labelFraction({})).toBe(0.5);
    expect(labelFraction({ labelT: Number.NaN })).toBe(0.5);
  });

  it('stays clear of both heads', () => {
    expect(labelFraction({ labelT: 0 })).toBe(LABEL_END_MARGIN);
    expect(labelFraction({ labelT: 1 })).toBe(1 - LABEL_END_MARGIN);
    expect(labelFraction({ labelT: 0.3 })).toBe(0.3);
  });
});

describe('lineLabelWorld', () => {
  it('rides the run of a multi-point line, not the centre of its box', () => {
    const node = {
      x: 1000,
      y: 500,
      width: 300,
      height: 100,
      geometry: { kind: 'line' as const, vertices: L, labelT: 0.5 },
    };
    expect(lineLabelWorld(node)).toEqual({ x: 1200, y: 500 });
  });
});

describe('lineStrokeEnds', () => {
  it('draws a dotted pattern with round caps whatever is stored', () => {
    expect(lineStrokeEnds({ stroke: { color: '#000', width: 2, dash: [0, 6], cap: 'butt' } }, undefined).cap).toBe('round');
  });

  it('rounds a sampled profile and leaves a zigzag its corners', () => {
    expect(lineStrokeEnds({ stroke: { color: '#000', width: 2 } }, 'wavy')).toEqual({ cap: 'round', join: 'round' });
    expect(lineStrokeEnds({ stroke: { color: '#000', width: 2 } }, 'elbow')).toEqual({ cap: 'round', join: 'round' });
    expect(lineStrokeEnds({ stroke: { color: '#000', width: 2 } }, 'zigzag')).toEqual({ cap: 'butt', join: 'miter' });
  });

  it('otherwise draws what is stored, absent meaning the SVG defaults', () => {
    expect(lineStrokeEnds({ stroke: { color: '#000', width: 2, cap: 'round' } }, undefined).cap).toBe('round');
    expect(lineStrokeEnds(undefined, undefined)).toEqual({ cap: 'butt', join: 'miter' });
  });
});
