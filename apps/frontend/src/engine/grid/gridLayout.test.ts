import { describe, expect, it } from 'vitest';
import {
  defaultSpec,
  GRID_HINTS,
  GRID_KINDS,
  GRID_LABELS,
  gridBounds,
  layoutGrid,
  rng,
  type GridCell,
  type GridSpec,
} from './gridLayout';

/**
 * Grid systems, as geometry.
 *
 * Two properties are asserted for *every* kind rather than one at a time,
 * because they are the ones that make a grid a grid rather than a scatter of
 * rectangles: nothing escapes the box, and the same spec always produces the
 * same result. A kind added later gets both checks for free.
 */

const spec = (over: Partial<GridSpec> = {}): GridSpec => ({
  ...defaultSpec({ x: 0, y: 0, width: 600, height: 400 }),
  ...over,
});

/** Within a pixel — every kind divides, and division does not land on integers. */
const SLOP = 1;

describe('every grid kind', () => {
  for (const kind of GRID_KINDS) {
    describe(kind, () => {
      it('produces at least one cell', () => {
        expect(layoutGrid(spec({ kind })).length).toBeGreaterThan(0);
      });

      it('keeps every cell inside the box', () => {
        // A grid whose cells run past its own bounds makes those bounds a lie,
        // and every alignment against them wrong.
        const s = spec({ kind, margin: 20 });
        for (const c of layoutGrid(s)) {
          expect(c.x).toBeGreaterThanOrEqual(s.x - SLOP);
          expect(c.y).toBeGreaterThanOrEqual(s.y - SLOP);
          expect(c.x + c.width).toBeLessThanOrEqual(s.x + s.width + SLOP);
          expect(c.y + c.height).toBeLessThanOrEqual(s.y + s.height + SLOP);
        }
      });

      it('gives every cell a positive size', () => {
        for (const c of layoutGrid(spec({ kind }))) {
          expect(c.width).toBeGreaterThan(0);
          expect(c.height).toBeGreaterThan(0);
        }
      });

      it('is reproducible from its seed', () => {
        // The whole reason randomness is seeded: find an arrangement you like,
        // change the gutter, and it is still there.
        const a = layoutGrid(spec({ kind, seed: 7 }));
        const b = layoutGrid(spec({ kind, seed: 7 }));
        expect(a).toEqual(b);
      });

      it('respects the margin', () => {
        const tight = gridBounds(layoutGrid(spec({ kind, margin: 0 })))!;
        const loose = gridBounds(layoutGrid(spec({ kind, margin: 40 })))!;
        expect(loose.width).toBeLessThanOrEqual(tight.width + SLOP);
      });

      it('survives a degenerate box', () => {
        // Half of every drag passes through zero, and the spec is live under one.
        expect(() => layoutGrid(spec({ kind, width: 0, height: 0 }))).not.toThrow();
        expect(() => layoutGrid(spec({ kind, rows: 0, columns: 0 }))).not.toThrow();
      });

      it('has a label and a hint', () => {
        // The picker renders both; a kind reaching it nameless is worse than a
        // kind that is not offered.
        expect(GRID_LABELS[kind]).toBeTruthy();
        expect(GRID_HINTS[kind]).toBeTruthy();
      });
    });
  }
});

describe('columns', () => {
  it('makes one cell per column, full height', () => {
    const cells = layoutGrid(spec({ kind: 'columns', columns: 4 }));
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((c) => Math.round(c.height))).size).toBe(1);
  });

  it('splits the width evenly once gutters are taken out', () => {
    const s = spec({ kind: 'columns', columns: 3, gutterX: 20, margin: 0 });
    const cells = layoutGrid(s);
    const expected = (600 - 20 * 2) / 3;
    for (const c of cells) expect(c.width).toBeCloseTo(expected, 5);
  });
});

describe('modular', () => {
  it('makes rows × columns identical modules', () => {
    const cells = layoutGrid(spec({ kind: 'modular', rows: 3, columns: 4 }));
    expect(cells).toHaveLength(12);
    expect(new Set(cells.map((c) => `${Math.round(c.width)}x${Math.round(c.height)}`)).size).toBe(1);
  });

  it('numbers its tracks so a row or column can be edited as one', () => {
    const cells = layoutGrid(spec({ kind: 'modular', rows: 2, columns: 3 }));
    expect(cells.filter((c) => c.row === 0)).toHaveLength(3);
    expect(cells.filter((c) => c.col === 2)).toHaveLength(2);
  });
});

describe('bento', () => {
  const covers = (cells: GridCell[], s: GridSpec) => {
    // Total cell area against the box, allowing for gutters: a packer that
    // leaves holes is the failure this kind exists to avoid.
    const area = cells.reduce((sum, c) => sum + c.width * c.height, 0);
    return area / (s.width * s.height);
  };

  it('leaves nothing over', () => {
    const s = spec({ kind: 'bento', rows: 4, columns: 4, gutterX: 0, gutterY: 0, variation: 0.8 });
    expect(covers(layoutGrid(s), s)).toBeCloseTo(1, 1);
  });

  it('is a plain modular grid at zero variation', () => {
    // The property that makes `variation` a dial rather than a switch.
    const s = spec({ kind: 'bento', rows: 3, columns: 3, variation: 0 });
    const cells = layoutGrid(s);
    expect(cells).toHaveLength(9);
    expect(new Set(cells.map((c) => Math.round(c.width))).size).toBe(1);
  });

  it('mixes module sizes as variation rises', () => {
    const cells = layoutGrid(spec({ kind: 'bento', rows: 5, columns: 5, variation: 1, seed: 3 }));
    expect(new Set(cells.map((c) => Math.round(c.width))).size).toBeGreaterThan(1);
  });

  it('never overlaps two modules', () => {
    const cells = layoutGrid(spec({ kind: 'bento', rows: 5, columns: 5, gutterX: 0, gutterY: 0, variation: 1, seed: 9 }));
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i];
        const b = cells[j];
        const apart =
          a.x + a.width <= b.x + SLOP || b.x + b.width <= a.x + SLOP ||
          a.y + a.height <= b.y + SLOP || b.y + b.height <= a.y + SLOP;
        expect(apart).toBe(true);
      }
    }
  });
});

describe('masonry', () => {
  it('fills each column exactly, rather than leaving ragged bottoms', () => {
    // Letting heights fall where they may is the obvious implementation and it
    // is wrong here: ragged column bottoms are a bug in a grid.
    const s = spec({ kind: 'masonry', rows: 4, columns: 3, margin: 0, variation: 1, seed: 5 });
    const cells = layoutGrid(s);
    for (let col = 0; col < 3; col += 1) {
      const inColumn = cells.filter((c) => c.col === col);
      const bottom = Math.max(...inColumn.map((c) => c.y + c.height));
      expect(bottom).toBeCloseTo(s.y + s.height, 0);
    }
  });

  it('gives its columns different cell counts', () => {
    const cells = layoutGrid(spec({ kind: 'masonry', rows: 4, columns: 4, variation: 1, seed: 11 }));
    const counts = new Set([0, 1, 2, 3].map((col) => cells.filter((c) => c.col === col).length));
    expect(counts.size).toBeGreaterThan(1);
  });
});

describe('hierarchical', () => {
  it('has one module clearly larger than the rest', () => {
    const cells = layoutGrid(spec({ kind: 'hierarchical', rows: 4, columns: 4, variation: 1 }));
    const sorted = [...cells].sort((a, b) => b.width * b.height - a.width * a.height);
    expect(sorted[0].width * sorted[0].height).toBeGreaterThan(sorted[1].width * sorted[1].height * 1.5);
  });

  it('always leaves supporting modules', () => {
    // A hero that swallowed the grid would be a manuscript layout by accident.
    for (const variation of [0, 0.5, 1]) {
      const cells = layoutGrid(spec({ kind: 'hierarchical', rows: 3, columns: 3, variation }));
      expect(cells.length).toBeGreaterThan(1);
    }
  });

  it('gives the hero the top weight, so a ramp finds it without being told', () => {
    const cells = layoutGrid(spec({ kind: 'hierarchical', rows: 4, columns: 4, variation: 1 }));
    expect(Math.max(...cells.map((c) => c.weight))).toBe(1);
    expect(cells[0].weight).toBe(1);
  });
});

describe('golden', () => {
  it('takes the golden share off the long side each step', () => {
    const cells = layoutGrid(spec({ kind: 'golden', rows: 2, columns: 3, gutterX: 0, gutterY: 0, margin: 0 }));
    expect(cells[0].width).toBeCloseTo(600 / 1.618033988749895, 0);
  });

  it('turns ninety degrees between steps', () => {
    // Cutting the same way twice is not a golden section, it is columns.
    const cells = layoutGrid(spec({ kind: 'golden', rows: 2, columns: 2, gutterX: 0, gutterY: 0, margin: 0 }));
    expect(cells[0].height).toBeCloseTo(400, 0);
    expect(cells[1].width).toBeLessThan(cells[0].width);
  });
});

describe('manuscript', () => {
  it('is one block', () => {
    expect(layoutGrid(spec({ kind: 'manuscript' }))).toHaveLength(1);
  });

  it('stands in more air as variation rises', () => {
    const tight = layoutGrid(spec({ kind: 'manuscript', variation: 0 }))[0];
    const airy = layoutGrid(spec({ kind: 'manuscript', variation: 1 }))[0];
    expect(airy.width).toBeLessThan(tight.width);
  });
});

describe('baseline', () => {
  it('makes full-width bands', () => {
    const s = spec({ kind: 'baseline', rows: 5, margin: 0 });
    const cells = layoutGrid(s);
    expect(cells).toHaveLength(5);
    for (const c of cells) expect(c.width).toBeCloseTo(600, 5);
  });

  it('varies their depth', () => {
    const cells = layoutGrid(spec({ kind: 'baseline', rows: 5, variation: 1, seed: 4 }));
    expect(new Set(cells.map((c) => Math.round(c.height))).size).toBeGreaterThan(1);
  });
});

describe('radial', () => {
  it('arranges cells around a centre', () => {
    const s = spec({ kind: 'radial', rows: 2, columns: 8 });
    const cells = layoutGrid(s);
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    // No cell sits on the centre; every one of them orbits it.
    for (const c of cells) {
      const d = Math.hypot(c.x + c.width / 2 - cx, c.y + c.height / 2 - cy);
      expect(d).toBeGreaterThan(0);
    }
  });

  it('puts fewer on the inner rings, so they do not crowd', () => {
    const cells = layoutGrid(spec({ kind: 'radial', rows: 3, columns: 12 }));
    const inner = cells.filter((c) => c.row === 0).length;
    const outer = cells.filter((c) => c.row === 2).length;
    expect(inner).toBeLessThan(outer);
  });
});

describe('diagonal', () => {
  it('offsets each row', () => {
    const cells = layoutGrid(spec({ kind: 'diagonal', rows: 3, columns: 3, variation: 1 }));
    const firstOfRow = (row: number) => cells.filter((c) => c.row === row)[0];
    expect(firstOfRow(1).x).not.toBeCloseTo(firstOfRow(0).x, 1);
  });

  it('clips the overhang rather than running off the edge', () => {
    const s = spec({ kind: 'diagonal', rows: 4, columns: 4, variation: 1, margin: 0 });
    for (const c of layoutGrid(s)) {
      expect(c.x + c.width).toBeLessThanOrEqual(s.x + s.width + SLOP);
    }
  });

  it('is a plain modular grid at zero variation', () => {
    const cells = layoutGrid(spec({ kind: 'diagonal', rows: 2, columns: 2, variation: 0 }));
    expect(cells.filter((c) => c.row === 0)[0].x).toBeCloseTo(cells.filter((c) => c.row === 1)[0].x, 5);
  });
});

describe('rng', () => {
  it('is deterministic and stays in range', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 50; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('gives different streams for different seeds', () => {
    expect(rng(1)()).not.toBe(rng(2)());
  });
});

describe('gridBounds', () => {
  it('is the box every cell fits inside', () => {
    expect(gridBounds([
      { x: 10, y: 20, width: 30, height: 40, row: 0, col: 0, weight: 1 },
      { x: 50, y: 0, width: 10, height: 10, row: 0, col: 1, weight: 1 },
    ])).toEqual({ x: 10, y: 0, width: 50, height: 60 });
  });

  it('is null for no cells', () => {
    expect(gridBounds([])).toBeNull();
  });
});
