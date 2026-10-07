import { describe, it, expect } from 'vitest';
import { selectSimilar, similarityValue } from './selectSimilar';

const shape = (id: string, kind: string, fill: string, stroke = '#000000', extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'shape',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    geometry: { kind },
    appearance: { fill: [{ type: 'solid', color: fill }], stroke: { color: stroke, width: 1 } },
    ...extra,
  }) as any;

const sticky = (id: string, theme: string) =>
  ({ id, type: 'sticky', theme, x: 0, y: 0, width: 10, height: 10 }) as any;

const nodes = [
  shape('a', 'rect', '#3B82F6'),
  shape('b', 'rect', '#3b82f6', '#ff0000'),
  shape('c', 'ellipse', '#3B82F6'),
  shape('d', 'rect', '#22C55E', '#ff0000'),
  shape('e', 'rect', '#3B82F6', '#000000', { locked: true }),
  sticky('s1', 'yellow'),
  sticky('s2', 'yellow'),
  sticky('s3', 'pink'),
];

describe('selectSimilar', () => {
  it('matches fills case-insensitively and skips locked objects', () => {
    expect(selectSimilar(nodes, ['a'], 'fill')).toEqual(['a', 'b', 'c']);
  });

  it('treats a shape kind as part of its type', () => {
    expect(selectSimilar(nodes, ['a'], 'type')).toEqual(['a', 'b', 'd']);
    expect(selectSimilar(nodes, ['c'], 'type')).toEqual(['c']);
  });

  it('matches any value the selection holds', () => {
    expect(selectSimilar(nodes, ['a', 'd'], 'fill')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('matches strokes, and a sticky by its theme', () => {
    expect(selectSimilar(nodes, ['b'], 'stroke')).toEqual(['b', 'd']);
    expect(selectSimilar(nodes, ['s1'], 'fill')).toEqual(['s1', 's2']);
  });

  it('keeps the selection when it has nothing to compare on', () => {
    expect(selectSimilar(nodes, ['s1'], 'font')).toEqual(['s1']);
    expect(similarityValue(nodes[0], 'font')).toBeNull();
  });
});
