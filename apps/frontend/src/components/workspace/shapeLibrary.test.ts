import { describe, expect, it } from 'vitest';
import {
  FAMILY_SECTIONS,
  LIBRARY_PRESETS,
  QUICK_SHAPES,
  clientToBoard,
  editDistance,
  enterAt,
  gridMove,
  libraryInsets,
  LIBRARY_GRID,
  LIBRARY_LAYOUT,
  librarySections,
  searchShapes,
  suggestShapes,
} from './shapeLibrary';
import { boxAt, placedSize } from './shapeCatalog';

describe('the library', () => {
  it('offers each shape once across the families, in the order the jump control names them', () => {
    expect(new Set(LIBRARY_PRESETS).size).toBe(LIBRARY_PRESETS.length);
    expect(FAMILY_SECTIONS.map((s) => s.id)).toEqual(['basic', 'flowchart', 'advanced', 'arrows', 'annotation']);
  });

  it('leads with eight common shapes, all of them on offer', () => {
    expect(QUICK_SHAPES).toHaveLength(8);
    for (const p of QUICK_SHAPES) expect(LIBRARY_PRESETS).toContain(p);
  });
});

describe('layout', () => {
  it("sits the grid as far from the panel's right edge as from its left, with any scrollbar", () => {
    // An overlay scrollbar, a thin one, a classic one, and the widest that fits.
    for (const scrollbar of [0, 8, 11, 13]) {
      const { left, right, fits } = libraryInsets(scrollbar);
      expect(fits, `${scrollbar}px scrollbar`).toBe(true);
      expect(left, `${scrollbar}px scrollbar`).toBeCloseTo(right, 6);
    }
  });

  it('is nine 40px tiles across, filling the md flyout exactly', () => {
    expect(LIBRARY_GRID).toBe(376);
    const panel = LIBRARY_LAYOUT.width + 2 * LIBRARY_LAYOUT.panelPad;
    expect(panel).toBe(408);
  });
});

describe('search', () => {
  it('finds a shape by an alias', () => {
    expect(searchShapes('db')[0]).toBe('database');
    expect(searchShapes('decision')[0]).toBe('diamond');
    expect(searchShapes('authentication key')[0]).toBe('key');
    expect(searchShapes('pill')[0]).toBe('capsule');
  });

  it('ranks the name over the description', () => {
    const hits = searchShapes('decision');
    // The sort symbol is described as a split decision: found, but after the diamond.
    expect(hits).toContain('sort');
    expect(hits.indexOf('diamond')).toBeLessThan(hits.indexOf('sort'));
  });

  it('forgives a typo and dropped letters', () => {
    expect(searchShapes('hexgaon')[0]).toBe('hexagon');
    expect(searchShapes('cylnder')[0]).toBe('cylinder');
    expect(searchShapes('rect')).toContain('rounded_rect');
  });

  it('needs every word to match', () => {
    expect(searchShapes('rounded rect')[0]).toBe('rounded_rect');
    expect(searchShapes('rounded zebra')).toEqual([]);
  });

  it('never lists a shape twice, even one filed in several families', () => {
    for (const q of ['diamond', 'cloud', 'storage', 'a', 'process']) {
      const hits = searchShapes(q);
      expect(new Set(hits).size, q).toBe(hits.length);
    }
  });

  it('suggests the nearest names when nothing matches', () => {
    expect(searchShapes('zzqx')).toEqual([]);
    expect(suggestShapes('dimond hexxagon')[0]).toBe('diamond');
    expect(suggestShapes('starr')).toContain('star');
    // Nothing like a shape: no near misses to offer.
    expect(suggestShapes('zzqx')).toEqual([]);
  });

  it('measures a swapped pair as one edit', () => {
    expect(editDistance('hexgaon', 'hexagon')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('recent and pinned', () => {
  it('shows pins, then recents that are neither pinned nor common, then the families', () => {
    const sections = librarySections(['key', 'rect', 'cloud', 'key', 'line'], ['cloud', 'gear', 'gear', 'nonsense']);
    const ids = sections.map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual(['quick', 'pinned', 'recent']);
    expect(sections[1].presets).toEqual(['cloud', 'gear']);
    // `rect` is in the quick row, `cloud` is pinned, `key` came twice and
    // `line` lives on its own seat: one recent left.
    expect(sections[2].presets).toEqual(['key']);
  });

  it('leaves out an empty pinned or recent row', () => {
    const ids = librarySections([], []).map((s) => s.id);
    expect(ids).toEqual(['quick', ...FAMILY_SECTIONS.map((s) => s.id)]);
  });
});

describe('grid keyboard', () => {
  // Eleven tiles, eight across: a full row and a row of three.
  it('moves a row at a time by the drawn column count', () => {
    expect(gridMove(2, 11, 8, 'ArrowDown')).toEqual({ to: 10 });
    expect(gridMove(9, 11, 8, 'ArrowUp')).toEqual({ to: 1 });
    expect(gridMove(4, 11, 8, 'ArrowRight')).toEqual({ to: 5 });
  });

  it('lands on the last tile when the row below is short', () => {
    expect(gridMove(6, 11, 8, 'ArrowDown')).toEqual({ to: 10 });
  });

  it('stops at the ends of the reading order', () => {
    expect(gridMove(0, 11, 8, 'ArrowLeft')).toEqual({ to: 0 });
    expect(gridMove(10, 11, 8, 'ArrowRight')).toEqual({ to: 10 });
    expect(gridMove(5, 11, 8, 'Home')).toEqual({ to: 0 });
    expect(gridMove(5, 11, 8, 'End')).toEqual({ to: 10 });
  });

  it('leaves the section from the top and bottom rows, saying from which column', () => {
    expect(gridMove(3, 11, 8, 'ArrowUp')).toEqual({ leave: 'up', column: 3 });
    expect(gridMove(9, 11, 8, 'ArrowDown')).toEqual({ leave: 'down', column: 1 });
  });

  it('enters the next section in the same column', () => {
    expect(enterAt(11, 8, 3, 'above')).toBe(3);
    expect(enterAt(2, 8, 5, 'above')).toBe(1);
    expect(enterAt(11, 8, 1, 'below')).toBe(9);
    expect(enterAt(11, 8, 6, 'below')).toBe(10);
  });
});

describe('dropping a tile on the board', () => {
  it('converts the pointer through the stage inset, the pan and the zoom', () => {
    const at = clientToBoard({ x: 500, y: 400 }, { left: 40, top: 60 }, { x: 100, y: -20, zoom: 2 });
    expect(at).toEqual({ x: 180, y: 180 });
  });

  it('centres the shape on the drop point at its natural size', () => {
    const box = boxAt('capsule', { x: 180, y: 180 });
    const size = placedSize('capsule');
    expect(box.width).toBe(size.width);
    expect(box.height).toBe(size.height);
    expect(box.x + box.width / 2).toBeCloseTo(180);
    expect(box.y + box.height / 2).toBeCloseTo(180);
  });
});
