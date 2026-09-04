import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  LAYOUT_GUIDE_PRESETS,
  axisBands,
  guideDraws,
  guideEdges,
  type LayoutAxis,
} from './layoutGuide';

/**
 * A measure you place things against, rather than a grid made of things.
 *
 * `engine/grid/` builds real objects; this draws nothing that exists. The
 * arithmetic is the whole of it, and it is the kind that looks obviously right
 * and is off by one gutter.
 */

const axis = (over: Partial<LayoutAxis> = {}): LayoutAxis => ({ ...DEFAULT_COLUMNS, ...over });

describe('the tracks divide what is left after the margins', () => {
  it('fits twelve columns into a 1200 frame', () => {
    /**
     * The arithmetic, written out: 1200 less two 48 margins is 1104; less
     * eleven 24 gutters is 840; over twelve is 70.
     */
    const bands = axisBands(1200, axis());
    expect(bands).toHaveLength(12);
    expect(bands[0]).toEqual({ start: 48, size: 70 });
    expect(bands[11].start + bands[11].size).toBeCloseTo(1152, 6);
  });

  it('puts a gutter between every pair and none at the ends', () => {
    // Eleven gaps for twelve tracks is the off-by-one this is most likely to
    // get wrong, and it shows up as the last track overhanging the margin.
    const bands = axisBands(1200, axis());
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].start - (bands[i - 1].start + bands[i - 1].size)).toBeCloseTo(24, 6);
    }
  });

  it('divides a height exactly as it divides a width', () => {
    /**
     * The reason both axes have the same shape: the arithmetic is written once
     * and the caller says which way it is pointing. A separate row function
     * would be a second place for the off-by-one to live.
     */
    expect(axisBands(1200, axis())).toEqual(axisBands(1200, axis()));
    const rows = axisBands(800, axis({ count: 4, gutter: 20, margin: 40 }));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ start: 40, size: 165 });
  });

  it('gives one track the whole measure', () => {
    // No gutters at all, because there is nothing to put one between.
    expect(axisBands(500, axis({ count: 1, margin: 50 }))).toEqual([{ start: 50, size: 400 }]);
  });

  it('handles a gutterless measure', () => {
    const bands = axisBands(400, axis({ count: 4, gutter: 0, margin: 0 }));
    expect(bands.map((b) => b.size)).toEqual([100, 100, 100, 100]);
    expect(bands[3].start).toBe(300);
  });
});

describe('a measure that cannot be drawn is no measure', () => {
  it('answers nothing without an axis', () => {
    expect(axisBands(1200, undefined)).toEqual([]);
  });

  it('refuses zero or fewer tracks', () => {
    expect(axisBands(1200, axis({ count: 0 }))).toEqual([]);
    expect(axisBands(1200, axis({ count: -3 }))).toEqual([]);
  });

  it('refuses margins that have eaten the frame', () => {
    // A negative size drawn as a rectangle is an inside-out band, which reads
    // as a rendering fault rather than as a measure that does not fit.
    expect(axisBands(600, axis({ margin: 400 }))).toEqual([]);
  });

  it('refuses gutters that have eaten what was left', () => {
    // Twelve tracks at a 100-unit gutter needs 1100 units of gap before a
    // single track exists.
    expect(axisBands(1000, axis({ gutter: 100 }))).toEqual([]);
  });

  it('refuses a frame with no extent', () => {
    expect(axisBands(0, axis())).toEqual([]);
  });
});

describe('the snap edges', () => {
  const frame = { x: 1000, y: 500, width: 1200, height: 800 };

  it('offers both sides of every track, in world coordinates', () => {
    const edges = guideEdges(frame, { columns: DEFAULT_COLUMNS });
    expect(edges.x).toHaveLength(24);
    expect(edges.x[0]).toBe(1048);
    expect(edges.x[1]).toBe(1118);
  });

  it('keeps the two axes apart', () => {
    // A column edge is an x and a row edge is a y. Mixing them would snap a
    // block's left side to a horizontal band, which is nonsense that would
    // look like a bug in the snapper rather than in the guide.
    const edges = guideEdges(frame, { columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS });
    expect(edges.x.length).toBe(24);
    expect(edges.y.length).toBe(16);
    expect(edges.y[0]).toBe(500);
  });

  it('offers only the axis that exists', () => {
    expect(guideEdges(frame, { rows: DEFAULT_ROWS }).x).toEqual([]);
    expect(guideEdges(frame, { columns: DEFAULT_COLUMNS }).y).toEqual([]);
  });

  it('includes the margins by construction, not separately', () => {
    /**
     * The first track starts at the leading margin and the last ends at the
     * trailing one, so both are already here. Adding them again would put
     * duplicate candidates in the snap set and make a margin twice as sticky
     * as the tracks beside it.
     */
    const edges = guideEdges({ x: 0, y: 0, width: 1200, height: 800 }, { columns: DEFAULT_COLUMNS });
    expect(edges.x[0]).toBe(48);
    expect(edges.x[edges.x.length - 1]).toBeCloseTo(1152, 6);
    expect(new Set(edges.x).size).toBe(edges.x.length);
  });

  it('offers nothing when there is nothing to offer', () => {
    expect(guideEdges(frame, undefined)).toEqual({ x: [], y: [] });
    expect(guideEdges(frame, { columns: axis({ margin: 900 }) }).x).toEqual([]);
  });
});

describe('guideDraws', () => {
  const frame = { width: 1200, height: 800 };

  it('is true when either axis has tracks', () => {
    expect(guideDraws(frame, { columns: DEFAULT_COLUMNS })).toBe(true);
    expect(guideDraws(frame, { rows: DEFAULT_ROWS })).toBe(true);
  });

  it('is false for a guide that cannot draw', () => {
    // An empty object is a guide with neither axis, and a measure whose
    // margins have eaten the frame draws nothing either — the panel needs one
    // answer for both.
    expect(guideDraws(frame, {})).toBe(false);
    expect(guideDraws(frame, undefined)).toBe(false);
    expect(guideDraws({ width: 100, height: 100 }, { columns: DEFAULT_COLUMNS })).toBe(false);
  });
});

describe('the presets', () => {
  it('all draw on a common page', () => {
    for (const p of LAYOUT_GUIDE_PRESETS) {
      expect(guideDraws({ width: 1440, height: 1024 }, p.guide), p.id).toBe(true);
    }
  });

  it('has no duplicate ids', () => {
    const ids = LAYOUT_GUIDE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives rows no margin by default', () => {
    // A top and bottom inset is what the frame's safe area already says, and
    // repeating it here would draw two guides along the same two edges.
    expect(DEFAULT_ROWS.margin).toBe(0);
  });
});
