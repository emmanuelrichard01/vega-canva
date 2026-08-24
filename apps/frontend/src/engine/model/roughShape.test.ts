import { describe, it, expect } from 'vitest';
import { roughShape } from './roughShape';
import type { ShapeNode } from './schema';

const node = (kind: string, radius: number, extra: Record<string, unknown> = {}): ShapeNode =>
  ({ id: 'n', type: 'shape', x: 0, y: 0, width: 200, height: 140,
     geometry: { kind, points: 6 },
     appearance: { sketch: 'medium', cornerRadius: radius || undefined, fill: [{ type: 'solid', color: '#fff' }] },
     ...extra } as unknown as ShapeNode);

describe('sketch honours the corner radius', () => {
  for (const kind of ['rect', 'polygon', 'star', 'heart']) {
    it(`differs with and without a radius: ${kind}`, () => {
      const sharp = roughShape(node(kind, 0), true);
      const round = roughShape(node(kind, 30), true);
      expect(sharp.outline.length).toBeGreaterThan(0);
      expect(round.outline.length).toBeGreaterThan(0);
      expect(round.outline).not.toBe(sharp.outline);
      expect(round.outline).not.toEqual(sharp.outline);
    });
  }
});

describe('extended shading styles', () => {
  it('generates continuous zigzag / scribble shading path', () => {
    const n = {
      ...node('rect', 0),
      appearance: { sketch: 'medium' as const, fillStyle: 'zigzag' as const, fill: [{ type: 'solid' as const, color: '#ff0000' }] },
    };
    const res = roughShape(n, true);
    expect(res.fill.length).toBeGreaterThan(0);
    expect(res.fill).toContain('M ');
    expect(res.fill).toContain('C ');
  });

  it('generates stippled dots shading path', () => {
    const n = {
      ...node('ellipse', 0),
      appearance: { sketch: 'medium' as const, fillStyle: 'dots' as const, fill: [{ type: 'solid' as const, color: '#00ff00' }] },
    };
    const res = roughShape(n, true);
    expect(res.fill.length).toBeGreaterThan(0);
    expect(res.fill).toContain('M ');
    expect(res.fill).toContain(' l ');
  });
});
