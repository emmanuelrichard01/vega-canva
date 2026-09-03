import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_GUIDE,
  LAYOUT_GUIDE_PRESETS,
  columnBands,
  columnEdges,
  type LayoutGuide,
} from './layoutGuide';

/**
 * A measure you place things against, rather than a grid made of things.
 *
 * `engine/grid/` builds real objects; this draws nothing that exists. The
 * arithmetic is the whole of it, and it is the kind that looks obviously right
 * and is off by one gutter.
 */

const guide = (over: Partial<LayoutGuide> = {}): LayoutGuide => ({
  ...DEFAULT_LAYOUT_GUIDE,
  ...over,
});

describe('the columns divide what is left after the margins', () => {
  it('fits twelve columns into a 1200 frame', () => {
    /**
     * The arithmetic, written out: 1200 less two 48 margins is 1104; less
     * eleven 24 gutters is 840; over twelve is 70.
     */
    const bands = columnBands(1200, guide());
    expect(bands).toHaveLength(12);
    expect(bands[0]).toEqual({ x: 48, width: 70 });
    expect(bands[11].x + bands[11].width).toBeCloseTo(1152, 6);
  });

  it('puts a gutter between every pair and none at the ends', () => {
    // Eleven gaps for twelve columns is the off-by-one this is most likely to
    // get wrong, and it shows up as the last column overhanging the margin.
    const bands = columnBands(1200, guide());
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].x - (bands[i - 1].x + bands[i - 1].width)).toBeCloseTo(24, 6);
    }
  });

  it('gives one column the whole measure', () => {
    // No gutters at all, because there is nothing to put one between.
    expect(columnBands(500, guide({ columns: 1, margin: 50 }))).toEqual([
      { x: 50, width: 400 },
    ]);
  });

  it('handles a gutterless measure', () => {
    const bands = columnBands(400, guide({ columns: 4, gutter: 0, margin: 0 }));
    expect(bands.map((b) => b.width)).toEqual([100, 100, 100, 100]);
    expect(bands[3].x).toBe(300);
  });
});

describe('a measure that cannot be drawn is no measure', () => {
  it('answers nothing without a guide', () => {
    expect(columnBands(1200, undefined)).toEqual([]);
  });

  it('refuses zero or fewer columns', () => {
    expect(columnBands(1200, guide({ columns: 0 }))).toEqual([]);
    expect(columnBands(1200, guide({ columns: -3 }))).toEqual([]);
  });

  it('refuses margins that have eaten the frame', () => {
    // A negative width drawn as a rectangle is an inside-out band, which reads
    // as a rendering fault rather than as a measure that does not fit.
    expect(columnBands(600, guide({ margin: 400 }))).toEqual([]);
  });

  it('refuses gutters that have eaten what was left', () => {
    // Twelve columns at a 100-unit gutter needs 1100 units of gap before a
    // single column exists.
    expect(columnBands(1000, guide({ gutter: 100 }))).toEqual([]);
  });

  it('refuses a frame with no width', () => {
    expect(columnBands(0, guide())).toEqual([]);
  });
});

describe('the snap edges', () => {
  it('offers both sides of every column, in world coordinates', () => {
    const edges = columnEdges({ x: 1000, width: 1200 }, guide());
    expect(edges).toHaveLength(24);
    expect(edges[0]).toBe(1048);
    expect(edges[1]).toBe(1118);
  });

  it('includes the margins by construction, not separately', () => {
    /**
     * The first column starts at the left margin and the last ends at the
     * right one, so both are already here. Adding them again would put
     * duplicate candidates in the snap set and make a margin twice as sticky
     * as the columns beside it.
     */
    const edges = columnEdges({ x: 0, width: 1200 }, guide());
    expect(edges[0]).toBe(48);
    expect(edges[edges.length - 1]).toBeCloseTo(1152, 6);
    expect(new Set(edges).size).toBe(edges.length);
  });

  it('offers nothing when there is nothing to offer', () => {
    expect(columnEdges({ x: 0, width: 600 }, guide({ margin: 400 }))).toEqual([]);
    expect(columnEdges({ x: 0, width: 1200 }, undefined)).toEqual([]);
  });
});

describe('the presets', () => {
  it('all divide a common page', () => {
    // Every one has to produce its own column count on an ordinary frame, or
    // it is a preset that looks broken the moment it is chosen.
    for (const p of LAYOUT_GUIDE_PRESETS) {
      expect(columnBands(1440, p.guide), p.id).toHaveLength(p.guide.columns);
    }
  });

  it('has no duplicate ids', () => {
    const ids = LAYOUT_GUIDE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
