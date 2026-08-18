import { describe, it, expect } from 'vitest';
import { buildPreview } from './boardPreview';
import type { AnyNode } from './schema';

const node = (over: Record<string, unknown>): AnyNode => ({
  id: 'n', type: 'shape', x: 0, y: 0, width: 200, height: 200,
  rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0, hidden: false,
  appearance: { fill: [{ type: 'solid', color: '#F3A024' }] },
  ...over,
} as unknown as AnyNode);

/**
 * The cover drew anything it did not recognise as a filled rectangle, so a
 * board holding one star had a thumbnail that was a solid block of the star's
 * colour — a picture of nothing. The summary has to carry enough for the
 * renderer to draw the actual silhouette.
 */
describe('board preview — shapes that are not boxes', () => {
  it('carries a star with its point count and waist', () => {
    const p = buildPreview([node({ geometry: { kind: 'star', points: 5, innerRatio: 0.45 } })], () => '#F3A024')!;
    expect(p.items[0].s).toBe('star');
    expect(p.items[0].p).toBe(5);
    expect(p.items[0].ir).toBe(0.45);
  });

  it('carries a polygon with its side count', () => {
    const p = buildPreview([node({ geometry: { kind: 'polygon', points: 6 } })], () => '#000')!;
    expect(p.items[0].s).toBe('polygon');
    expect(p.items[0].p).toBe(6);
  });

  it('marks an open shape so it is stroked rather than filled', () => {
    // A line drawn as a filled box becomes the one thing it can never be.
    for (const kind of ['line', 'arrow']) {
      const p = buildPreview([node({ geometry: { kind } })], () => '#000')!;
      expect(p.items[0].s).toBe('line');
    }
  });

  it('leaves a rectangle and an ellipse alone', () => {
    const rect = buildPreview([node({ geometry: { kind: 'rect' } })], () => '#000')!;
    expect(rect.items[0].s).toBeUndefined();
    const ell = buildPreview([node({ geometry: { kind: 'ellipse' } })], () => '#000')!;
    expect(ell.items[0].o).toBe(1);
    expect(ell.items[0].s).toBeUndefined();
  });
});
