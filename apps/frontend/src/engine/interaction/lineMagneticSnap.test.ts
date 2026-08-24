import { describe, it, expect } from 'vitest';
import { portNormal, snapLineEndpoint } from './lineMagneticSnap';
import type { BindCandidate } from '../model/connectorBinding';

describe('portNormal', () => {
  it('returns unrotated normal unit vectors', () => {
    expect(portNormal('top', 0)).toEqual({ x: 0, y: -1 });
    expect(portNormal('bottom', 0)).toEqual({ x: 0, y: 1 });
    expect(portNormal('left', 0)).toEqual({ x: -1, y: 0 });
    expect(portNormal('right', 0)).toEqual({ x: 1, y: 0 });
  });

  it('rotates normal vector with shape rotation', () => {
    const top90 = portNormal('top', 90);
    expect(top90.x).toBeCloseTo(1, 5);
    expect(top90.y).toBeCloseTo(0, 5);
  });
});

describe('snapLineEndpoint', () => {
  const boxCandidate: BindCandidate = {
    id: 'box-1',
    box: { x: 100, y: 100, width: 200, height: 100 },
    outline: [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ],
    rotation: 0,
  };

  it('snaps to top cardinal port when pointer is near top midpoint', () => {
    // Top midpoint is (200, 100)
    const raw = { x: 202, y: 104 };
    const res = snapLineEndpoint(raw, [boxCandidate], 1);
    expect(res.snapped).toBe(true);
    expect(res.targetId).toBe('box-1');
    expect(res.port).toBe('top');
    expect(res.point).toEqual({ x: 200, y: 100 });
  });

  it('snaps to right cardinal port when pointer is near right midpoint', () => {
    // Right midpoint is (300, 150)
    const raw = { x: 298, y: 152 };
    const res = snapLineEndpoint(raw, [boxCandidate], 1);
    expect(res.snapped).toBe(true);
    expect(res.port).toBe('right');
    expect(res.point).toEqual({ x: 300, y: 150 });
  });

  it('snaps to silhouette outline when near edge but away from cardinal ports', () => {
    // Top edge between (100, 100) and (200, 100), e.g. at x = 130
    const raw = { x: 130, y: 108 };
    const res = snapLineEndpoint(raw, [boxCandidate], 1);
    expect(res.snapped).toBe(true);
    expect(res.targetId).toBe('box-1');
    expect(res.port).toBeUndefined();
    expect(res.point.y).toBeCloseTo(100, 1);
    expect(res.point.x).toBeCloseTo(130, 1);
  });

  it('directionally prioritizes facing edge for oncoming arrow head', () => {
    // Stationary anchor is at (0, 150) to the left of the box.
    // Raw pointer is moving towards left port (100, 150).
    const anchor = { x: 0, y: 150 };
    const raw = { x: 96, y: 150 };
    const res = snapLineEndpoint(raw, [boxCandidate], 1, {
      anchor,
      endType: 'end',
      capKind: 'arrow',
    });
    expect(res.snapped).toBe(true);
    expect(res.port).toBe('left');
    expect(res.point).toEqual({ x: 100, y: 150 });
    expect(res.meta?.endType).toBe('end');
    expect(res.meta?.capKind).toBe('arrow');
  });

  it('pulls back endpoint by cap inset when endAlign is extend so projected tip lands flush', () => {
    // Left port is (100, 150), line approaches from (0, 150) along (+1, 0).
    // Arrow size = max(8, 2*3.2) = 8, inset = 8 * 0.7 = 5.6
    const anchor = { x: 0, y: 150 };
    const raw = { x: 98, y: 150 };
    const res = snapLineEndpoint(raw, [boxCandidate], 1, {
      anchor,
      endType: 'end',
      capKind: 'arrow',
      lineProfile: 'curved', // curved defaults to 'extend'
      strokeWidth: 2,
      endScale: 1,
    });
    expect(res.snapped).toBe(true);
    expect(res.indicator).toEqual({ x: 100, y: 150 });
    expect(res.point.x).toBeCloseTo(100 - 5.6, 2);
    expect(res.point.y).toBeCloseTo(150, 2);
  });

  it('ignores candidate when excluded by ID', () => {
    const raw = { x: 202, y: 104 };
    const res = snapLineEndpoint(raw, [boxCandidate], 1, undefined, 'box-1');
    expect(res.snapped).toBe(false);
    expect(res.point).toEqual(raw);
  });

  it('leaves freeform points untouched when far from any candidate', () => {
    const raw = { x: 600, y: 600 };
    const res = snapLineEndpoint(raw, [boxCandidate], 1);
    expect(res.snapped).toBe(false);
    expect(res.point).toEqual(raw);
  });
});
