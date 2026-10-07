import { describe, expect, it } from 'vitest';
import { layoutDroppedImages } from './dropLayout';

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('layoutDroppedImages', () => {
  it('centres a single image on the drop point at its own size', () => {
    expect(layoutDroppedImages([{ width: 400, height: 300 }], { x: 100, y: 100 })).toEqual([
      { x: -100, y: -50, width: 400, height: 300 },
    ]);
  });

  it('returns nothing for nothing', () => {
    expect(layoutDroppedImages([], { x: 0, y: 0 })).toEqual([]);
  });

  const sizes = [
    { width: 1600, height: 900 },
    { width: 900, height: 1200 },
    { width: 1000, height: 1000 },
    { width: 3000, height: 1000 },
    { width: 800, height: 600 },
    { width: 600, height: 800 },
    { width: 1200, height: 800 },
  ];

  it('keeps every aspect ratio and never overlaps', () => {
    const rects = layoutDroppedImages(sizes, { x: 0, y: 0 });
    expect(rects).toHaveLength(sizes.length);
    rects.forEach((r, i) => {
      const expected = Math.min(4, Math.max(0.25, sizes[i].width / sizes[i].height));
      expect(Math.abs(r.width / r.height - expected)).toBeLessThan(0.05);
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    }
  });

  it('fills every full row to the same width, and centres the sheet', () => {
    const rects = layoutDroppedImages(sizes, { x: 500, y: 500 }, { rowWidth: 900, gap: 16 });
    const rows = new Map<number, typeof rects>();
    for (const r of rects) rows.set(r.y, [...(rows.get(r.y) ?? []), r]);
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    expect(ordered.length).toBeGreaterThan(1);
    for (const row of ordered.slice(0, -1)) {
      const left = Math.min(...row.map((r) => r.x));
      const right = Math.max(...row.map((r) => r.x + r.width));
      expect(Math.abs(right - left - 900)).toBeLessThanOrEqual(row.length + 1);
    }
    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    expect(Math.abs((minX + maxX) / 2 - 500)).toBeLessThanOrEqual(1);
  });

  it('does not enlarge a lone last picture past the row height', () => {
    const rects = layoutDroppedImages(
      [
        { width: 1000, height: 1000 },
        { width: 1000, height: 1000 },
        { width: 1000, height: 1000 },
      ],
      { x: 0, y: 0 },
      { rowWidth: 512, rowHeight: 240, gap: 16 }
    );
    const last = rects[rects.length - 1];
    expect(last.height).toBeLessThanOrEqual(240);
  });
});
