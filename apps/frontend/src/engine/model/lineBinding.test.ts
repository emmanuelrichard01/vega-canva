import { describe, expect, it } from 'vitest';
import { connectorFromLine, isLineBindTarget, promotion } from './lineBinding';
import type { AnyNode } from './schema';

const node = (type: string, extra: Record<string, unknown> = {}) =>
  ({ id: type, type, x: 0, y: 0, width: 100, height: 60, ...extra }) as unknown as AnyNode;

const A = { nodeId: 'a', port: 'right' as const };
const B = { nodeId: 'b', port: 'left' as const };
const opts = { profile: undefined, vertexCount: 2, suppressed: false };

describe('promotion: what a line drawn between objects becomes', () => {
  it('becomes a connector when both ends land on two different objects', () => {
    expect(promotion(A, B, opts)).toBe('straight');
  });

  it('keeps the path it was drawn with', () => {
    expect(promotion(A, B, { ...opts, profile: 'elbow' })).toBe('orthogonal');
    expect(promotion(A, B, { ...opts, profile: 'curved' })).toBe('curved');
  });

  it('stays a line with only one end on an object', () => {
    expect(promotion(A, { x: 10, y: 10 }, opts)).toBeNull();
    expect(promotion(null, B, opts)).toBeNull();
  });

  it('stays a line from an object back to itself', () => {
    expect(promotion(A, { nodeId: 'a', port: 'auto' }, opts)).toBeNull();
  });

  it('stays a line when it was drawn corner by corner', () => {
    expect(promotion(A, B, { ...opts, vertexCount: 3 })).toBeNull();
  });

  it('stays a line with a decorative profile a connector cannot draw', () => {
    for (const profile of ['wavy', 'zigzag', 'coil'] as const) {
      expect(promotion(A, B, { ...opts, profile }), profile).toBeNull();
    }
  });

  it('stays a line when binding is suppressed', () => {
    expect(promotion(A, B, { ...opts, suppressed: true })).toBeNull();
  });
});

describe('isLineBindTarget', () => {
  it('attaches to ordinary objects', () => {
    expect(isLineBindTarget(node('shape', { geometry: { kind: 'rect' } }))).toBe(true);
    expect(isLineBindTarget(node('sticky'))).toBe(true);
  });

  it('does not attach to frames, other lines, connectors or hidden and locked things', () => {
    expect(isLineBindTarget(node('frame'))).toBe(false);
    expect(isLineBindTarget(node('shape', { geometry: { kind: 'line' } }))).toBe(false);
    expect(isLineBindTarget(node('shape', { geometry: { kind: 'arrow' } }))).toBe(false);
    expect(isLineBindTarget(node('connector'))).toBe(false);
    expect(isLineBindTarget(node('sticky', { locked: true }))).toBe(false);
    expect(isLineBindTarget(node('sticky', { hidden: true }))).toBe(false);
    expect(isLineBindTarget(undefined)).toBe(false);
  });
});

describe('connectorFromLine', () => {
  const base = {
    id: 'c1',
    from: A,
    to: B,
    a: { x: 200, y: 50 },
    b: { x: 40, y: 140 },
    endStart: 'none' as const,
    endEnd: 'arrow' as const,
    stroke: { color: '#111111', width: 2 },
  };

  it('carries the line’s ends, heads and weight across', () => {
    const c = connectorFromLine({ ...base, routing: 'straight', avoid: true });
    expect(c).toMatchObject({
      type: 'connector',
      x: 40,
      y: 50,
      width: 160,
      height: 90,
      from: A,
      to: B,
      endStart: 'none',
      endEnd: 'arrow',
      appearance: { stroke: { color: '#111111', width: 2, cap: 'round' } },
    });
  });

  it('keeps the dash and the label the line already had', () => {
    const c = connectorFromLine({
      ...base,
      routing: 'straight',
      avoid: false,
      stroke: { color: '#111111', width: 3, dash: [6, 4] },
      label: 'retry',
    });
    expect(c.label).toBe('retry');
    expect(c.appearance).toEqual({ stroke: { color: '#111111', width: 3, cap: 'round', dash: [6, 4] } });
    expect(connectorFromLine({ ...base, routing: 'straight', avoid: false, label: '  ' }).label).toBeUndefined();
  });

  it('only asks a bending route to avoid objects', () => {
    expect(connectorFromLine({ ...base, routing: 'straight', avoid: true }).avoid).toBeUndefined();
    expect(connectorFromLine({ ...base, routing: 'orthogonal', avoid: true }).avoid).toBe(true);
    expect(connectorFromLine({ ...base, routing: 'orthogonal', avoid: false }).avoid).toBeUndefined();
  });
});
