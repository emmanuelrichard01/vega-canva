import { describe, expect, it } from 'vitest';
import {
  defaultSpec,
  GRID_HINTS,
  GRID_KINDS,
  GRID_LABELS,
  gridBounds,
  layoutGrid,
  VARIATION_LABELS,
  KIND_DEFAULTS,
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

/** Within a pixel -- every kind divides, and division does not land on integers. */
const SLOP = 1;

/**
 * A cell's four corners, turned about its own centre.
 *
 * `radial` rotates its cells, and an unrotated box check would pass a cell
 * whose corner is well outside the grid -- or fail one that is comfortably
 * inside. The renderer rotates about the centre, so this does too.
 */
function corners(c: GridCell): { x: number; y: number }[] {
  const cx = c.x + c.width / 2;
  const cy = c.y + c.height / 2;
  const a = 0;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = (sx * c.width) / 2;
    const dy = (sy * c.height) / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

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
          for (const p of corners(c)) {
            expect(p.x).toBeGreaterThanOrEqual(s.x - SLOP);
            expect(p.y).toBeGreaterThanOrEqual(s.y - SLOP);
            expect(p.x).toBeLessThanOrEqual(s.x + s.width + SLOP);
            expect(p.y).toBeLessThanOrEqual(s.y + s.height + SLOP);
          }
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
    const s = spec({ kind: 'columns', columns: 3, gutterX: 20, margin: 0, variation: 0 });
    const cells = layoutGrid(s);
    const expected = (600 - 20 * 2) / 3;
    for (const c of cells) expect(c.width).toBeCloseTo(expected, 5);
  });

  it('sets an uneven measure as variation rises', () => {
    /**
     * `variation` used to be dead on the two kinds people reach for first, so
     * the slider sat there doing nothing on the default grid -- which teaches
     * that the control is decorative before it has been tried anywhere it
     * works. An uneven column grid is a real editorial device, not a broken one.
     */
    const cells = layoutGrid(spec({ kind: 'columns', columns: 5, variation: 1, seed: 4 }));
    expect(new Set(cells.map((c) => Math.round(c.width))).size).toBeGreaterThan(1);
  });

  it('still fills the width exactly, however uneven', () => {
    // Weights are normalised: a track run that overflowed its own box would
    // make the box a lie, and every alignment against it wrong.
    const s = spec({ kind: 'columns', columns: 5, gutterX: 12, margin: 0, variation: 1, seed: 9 });
    const cells = layoutGrid(s);
    const right = Math.max(...cells.map((c) => c.x + c.width));
    expect(right).toBeCloseTo(s.x + s.width, 4);
  });
});

describe('modular', () => {
  it('makes rows × columns identical modules', () => {
    const cells = layoutGrid(spec({ kind: 'modular', rows: 3, columns: 4, variation: 0 }));
    expect(cells).toHaveLength(12);
    expect(new Set(cells.map((c) => `${Math.round(c.width)}x${Math.round(c.height)}`)).size).toBe(1);
  });

  it('numbers its tracks so a row or column can be edited as one', () => {
    const cells = layoutGrid(spec({ kind: 'modular', rows: 2, columns: 3 }));
    expect(cells.filter((c) => c.row === 0)).toHaveLength(3);
    expect(cells.filter((c) => c.col === 2)).toHaveLength(2);
  });

  it('ragged-sets both axes as variation rises', () => {
    const cells = layoutGrid(spec({ kind: 'modular', rows: 4, columns: 4, variation: 1, seed: 6 }));
    expect(new Set(cells.map((c) => Math.round(c.width))).size).toBeGreaterThan(1);
    expect(new Set(cells.map((c) => Math.round(c.height))).size).toBeGreaterThan(1);
  });

  it('keeps its rows and columns straight even when uneven', () => {
    // Ragged tracks, not ragged cells: everything in a column still shares an
    // edge, which is the whole difference between a set grid and a scatter.
    const cells = layoutGrid(spec({ kind: 'modular', rows: 3, columns: 3, variation: 1, seed: 2 }));
    for (const col of [0, 1, 2]) {
      const xs = cells.filter((c) => c.col === col).map((c) => Math.round(c.x * 100));
      expect(new Set(xs).size).toBe(1);
    }
  });

  it('still fills the box exactly', () => {
    const s = spec({ kind: 'modular', rows: 4, columns: 4, margin: 0, variation: 1, seed: 5 });
    const cells = layoutGrid(s);
    expect(Math.max(...cells.map((c) => c.x + c.width))).toBeCloseTo(s.x + s.width, 4);
    expect(Math.max(...cells.map((c) => c.y + c.height))).toBeCloseTo(s.y + s.height, 4);
  });
});

/**
 * The dial is live on every kind that offers it.
 *
 * Two kinds ignored `variation` entirely, and a control that does nothing on
 * the grid you are looking at is a control you stop trusting on the ones where
 * it works.
 */
describe('variation', () => {
  const varies = (kind: GridSpec['kind']) => {
    const at = (variation: number) =>
      JSON.stringify(layoutGrid(spec({ kind, rows: 4, columns: 4, variation, seed: 3 })));
    return at(0) !== at(1);
  };

  for (const kind of GRID_KINDS) {
    if (kind === 'golden') continue; // no notion of variation; the panel hides it
    it(`changes ${kind}`, () => {
      expect(varies(kind)).toBe(true);
    });
  }

  it('is named for what it actually does on each kind', () => {
    // "Variation" alone says nothing: it opens a hole in the dial, mixes the
    // compartments in a bento box and shears a cascade.
    for (const kind of GRID_KINDS) {
      if (kind === 'golden') continue;
      expect(VARIATION_LABELS[kind], kind).toBeTruthy();
    }
  });
});

describe('bento', () => {
  const bento = (over: Partial<GridSpec> = {}) =>
    layoutGrid(spec({ kind: 'bento', rows: 5, columns: 5, gutterX: 0, gutterY: 0, variation: 0.8, ...over }));

  it('leaves nothing over', () => {
    // A packer that leaves holes is the failure this kind exists to avoid.
    const s = spec({ kind: 'bento', rows: 4, columns: 4, gutterX: 0, gutterY: 0, variation: 0.8 });
    const area = layoutGrid(s).reduce((sum, c) => sum + c.width * c.height, 0);
    expect(area / (s.width * s.height)).toBeCloseTo(1, 1);
  });

  it('is a plain modular grid at zero variation', () => {
    // The property that makes `variation` a dial rather than a switch.
    const cells = bento({ rows: 3, columns: 3, variation: 0 });
    expect(cells).toHaveLength(9);
    expect(new Set(cells.map((c) => Math.round(c.width))).size).toBe(1);
  });

  it('mixes compartment sizes as variation rises', () => {
    expect(new Set(bento({ seed: 3 }).map((c) => Math.round(c.width))).size).toBeGreaterThan(1);
  });

  /**
   * The distinction from `hierarchical`, stated as a test.
   *
   * Both kinds used to run the same algorithm and produce the same picture. A
   * bento box **does not rank**: compartments differ because the contents do,
   * and no single one owns the frame. A hierarchy is the opposite, and its own
   * test below asserts the opposite.
   */
  it('has no compartment that dominates the composition', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const cells = bento({ seed });
      const total = cells.reduce((sum, c) => sum + c.width * c.height, 0);
      const biggest = Math.max(...cells.map((c) => c.width * c.height));
      expect(biggest / total).toBeLessThan(0.2);
    }
  });

  it('spreads its large compartments through the box, not into one corner', () => {
    /**
     * The previous version scanned from the top left taking the biggest tile
     * that fitted, so every large tile landed in the first rows and the bottom
     * silted up with crumbs -- a hero with gravel after it, which is to say a
     * hierarchy.
     */
    const cells = bento({ rows: 6, columns: 6, seed: 7 });
    const large = cells.filter((c) => c.width * c.height > (cells[0].width * cells[0].height) * 1.5);
    const half = spec({ kind: 'bento' }).y + spec({ kind: 'bento' }).height / 2;
    expect(large.some((c) => c.y >= half)).toBe(true);
    expect(large.some((c) => c.y < half)).toBe(true);
  });

  it('never overlaps two compartments', () => {
    const cells = bento({ seed: 9 });
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
  const masonry = (over: Partial<GridSpec> = {}) =>
    layoutGrid(spec({ kind: 'masonry', rows: 4, columns: 4, margin: 0, variation: 0.8, ...over }));

  it('fills each column exactly, rather than leaving ragged bottoms', () => {
    /**
     * Real feeds have ragged bottoms because they are infinite. A grid is not:
     * its bottom edge is a boundary other things align to, and a staircase
     * there makes the bounds a lie.
     */
    const s = spec({ kind: 'masonry', rows: 4, columns: 3, margin: 0, variation: 1, seed: 5 });
    const cells = layoutGrid(s);
    for (let col = 0; col < 3; col += 1) {
      const inColumn = cells.filter((c) => c.col === col);
      expect(Math.max(...inColumn.map((c) => c.y + c.height))).toBeCloseTo(s.y + s.height, 0);
    }
  });

  /**
   * The property that separates masonry from a modular grid, and the one the
   * first version did not have.
   *
   * It varied heights within a fixed count, so every column's boundaries sat at
   * roughly the same depth and faint horizontal bands ran across the whole
   * thing. Rows are not rows in masonry; nothing may line up.
   */
  it('does not line its cards up across columns', () => {
    const cells = masonry({ columns: 4, seed: 21 });
    const edgesIn = (col: number) =>
      cells.filter((c) => c.col === col).map((c) => Math.round(c.y));
    const first = new Set(edgesIn(0));
    // Beyond the shared top edge, no boundary in column 1 may match column 0.
    const shared = edgesIn(1).filter((y) => y > 1 && first.has(y));
    expect(shared).toHaveLength(0);
  });

  it('keeps its columns out of step across many seeds', () => {
    /**
     * One seed proves nothing about a random layout. Per-card randomness alone
     * used to pass a single case and still produce faint horizontal bands,
     * because every column drew from the same distribution and landed on about
     * the same count.
     */
    for (const seed of [1, 5, 12, 30, 77]) {
      const cells = masonry({ columns: 4, rows: 5, seed });
      const edges = (col: number) =>
        cells.filter((c) => c.col === col).map((c) => Math.round(c.y / 6));
      const a = new Set(edges(0));
      const overlap = edges(2).filter((y) => y > 0 && a.has(y)).length;
      const total = edges(2).filter((y) => y > 0).length;
      expect(overlap / Math.max(1, total), `seed ${seed}`).toBeLessThan(0.5);
    }
  });

  it('gives its columns different card counts', () => {
    // The count is a consequence of the heights drawn rather than a quota, so
    // columns disagree about how many cards they hold.
    const counts = [0, 1, 2, 3].map((col) => masonry({ seed: 13 }).filter((c) => c.col === col).length);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('spreads those counts further the taller the column', () => {
    // Four nominal cards leaves little room to differ; the variance is real
    // and it needs cards to accumulate in.
    const counts = [0, 1, 2, 3].map(
      (col) => masonry({ rows: 9, seed: 13 }).filter((c) => c.col === col).length
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeGreaterThan(1);
  });

  it('mixes card proportions widely', () => {
    const heights = masonry({ seed: 8 }).map((c) => c.height);
    expect(Math.max(...heights) / Math.min(...heights)).toBeGreaterThan(1.8);
  });

  it('is a plain modular grid at zero variation', () => {
    // The property that makes `variation` a dial rather than a switch.
    const cells = masonry({ rows: 4, columns: 3, variation: 0 });
    expect(cells).toHaveLength(12);
    expect(new Set(cells.map((c) => Math.round(c.height))).size).toBe(1);
  });

  it('never runs a column away', () => {
    // A degenerate draw must not hang the tab.
    expect(masonry({ rows: 40, columns: 2, variation: 1 }).length).toBeLessThan(200);
  });
});

describe('hierarchical', () => {
  it('has one module clearly larger than the rest', () => {
    const cells = layoutGrid(spec({ kind: 'hierarchical', rows: 4, columns: 4, variation: 1 }));
    const sorted = [...cells].sort((a, b) => b.width * b.height - a.width * a.height);
    expect(sorted[0].width * sorted[0].height).toBeGreaterThan(sorted[1].width * sorted[1].height * 1.5);
  });

  /** The mirror of bento's "no compartment dominates". A hierarchy ranks. */
  it('lets its hero own a real share of the composition', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const cells = layoutGrid(spec({ kind: 'hierarchical', rows: 4, columns: 4, variation: 1, seed }));
      const total = cells.reduce((sum, c) => sum + c.width * c.height, 0);
      const biggest = Math.max(...cells.map((c) => c.width * c.height));
      expect(biggest / total).toBeGreaterThan(0.25);
    }
  });

  it('moves its hero about, so a re-roll is a different composition', () => {
    // Always the top-left corner made every re-roll the same layout with
    // different crumbs.
    const corners = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const cells = layoutGrid(spec({ kind: 'hierarchical', rows: 4, columns: 4, variation: 1, seed }));
        const hero = [...cells].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return `${hero.x > 0 ? 'r' : 'l'}${hero.y > 0 ? 'b' : 't'}`;
      })
    );
    expect(corners.size).toBeGreaterThan(1);
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
  const PHI = 1.618033988749895;
  const box = { x: 0, y: 0, width: 600, height: 400 };
  const golden = (over: Partial<GridSpec> = {}) =>
    layoutGrid(spec({ ...box, kind: 'golden', gutterX: 0, gutterY: 0, margin: 0, ...over }));

  it('gives you as many squares as you ask for', () => {
    /**
     * The reason this squares a golden rectangle rather than the box.
     *
     * Taking squares off an arbitrary rectangle is the Euclidean algorithm and
     * it terminates: a 3:2 box tiles into exactly three squares and then there
     * is nothing left, however many steps are asked for. Five blocks out of a
     * 3:2 box is only possible on a rectangle where the ratio continues, which
     * is what phi is named for.
     */
    expect(golden({ columns: 5 })).toHaveLength(5);
    expect(golden({ columns: 8 })).toHaveLength(8);
  });

  it('shrinks each square by the golden ratio', () => {
    // The one property the kind is named for, now true of any box rather than
    // only of a box that happened to be golden already.
    const cells = golden({ columns: 6 });
    for (let i = 1; i < cells.length - 1; i += 1) {
      expect(cells[i].width / cells[i - 1].width).toBeCloseTo(1 / PHI, 2);
    }
  });

  it('takes a square off the long side, not a golden rectangle', () => {
    // The construction removes a **square**; the remainder is then a smaller
    // golden rectangle, which is what makes the sequence recurse. The first
    // version kept the golden share itself, so its cells were rectangles.
    const cells = golden({ columns: 5 });
    expect(cells[0].width).toBeCloseTo(cells[0].height, 0);
  });

  it('spirals rather than marching off to one corner', () => {
    // The first version always cut from the same two sides, so every cell
    // landed further right and further down: a staircase, not a spiral.
    const cells = golden({ columns: 6 });
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    const alwaysRight = xs.every((x, i) => i === 0 || x >= xs[i - 1]);
    const alwaysDown = ys.every((y, i) => i === 0 || y >= ys[i - 1]);
    expect(alwaysRight && alwaysDown).toBe(false);
  });

  it('tiles its golden rectangle exactly, with no hole in the middle', () => {
    // The last square takes the whole remainder. Stopping mid-recursion would
    // leave a gap at the centre of the spiral, which is the one place the eye
    // is guaranteed to land.
    const cells = golden({ columns: 6 });
    const area = cells.reduce((sum, c) => sum + c.width * c.height, 0);
    // 600 wide is the limit; the golden height that fits inside 400 is 600/phi.
    expect(area).toBeCloseTo(600 * (600 / PHI), -1);
  });

  it('centres the leftover, so it reads as margin rather than drift', () => {
    const cells = golden({ columns: 5 });
    const top = Math.min(...cells.map((c) => c.y));
    const bottom = Math.max(...cells.map((c) => c.y + c.height));
    expect(top - box.y).toBeCloseTo(box.y + box.height - bottom, 3);
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
  const s = () => spec({ kind: 'radial', rows: 3, columns: 12, gutterX: 4, gutterY: 6, margin: 0 });
  const centre = (box: GridSpec) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const radiusOf = (c: GridCell, o: { x: number; y: number }) =>
    Math.hypot(c.x + c.width / 2 - o.x, c.y + c.height / 2 - o.y);

  it('makes every block on a ring the same size, and square', () => {
    const cells = layoutGrid(s());
    for (const ring of [0, 1, 2]) {
      const sizes = cells.filter((c) => c.row === ring).map((c) => Math.round(c.width * 100));
      expect(new Set(sizes).size).toBe(1);
    }
    expect(cells[0].width).toBeCloseTo(cells[0].height, 6);
  });

  it('lets the outer rings use the room they have', () => {
    /**
     * One block size for the whole grid means the innermost ring -- the
     * tightest arc on the board -- sets the size for every ring outside it.
     * With a dozen spokes that is a 10px block on a 400px circle, and
     * thirty-six of them read as scattered dots rather than as rings.
     */
    const cells = layoutGrid(s());
    const sizeOf = (ring: number) => cells.find((c) => c.row === ring)!.width;
    expect(sizeOf(2)).toBeGreaterThan(sizeOf(0));
  });

  it('gives its blocks a usable size at the default settings', () => {
    // The failure was not subtle: the arrangement was correct and the blocks
    // were dots, which is the same thing as being wrong.
    const box = spec({ kind: 'radial', ...KIND_DEFAULTS.radial, width: 480, height: 360, margin: 0 });
    const cells = layoutGrid(box);
    const smallest = Math.min(...cells.map((c) => c.width));
    expect(smallest).toBeGreaterThan(Math.min(box.width, box.height) * 0.04);
  });

  it('leaves every block upright', () => {
    // A second attempt made each cell an annular sector turned to face the
    // middle. That is a polar grid in the textbook sense and a poor container:
    // a grid tool's cells are things you put content in.
    expect(layoutGrid(s()).every((c) => !('rotation' in c))).toBe(true);
  });

  it('divides every ring the same way, so the spokes line up', () => {
    // The property that makes this a grid rather than a scatter, and the one
    // the first version gave away by varying the count per ring.
    const cells = layoutGrid(s());
    const perRing = [0, 1, 2].map((ring) => cells.filter((c) => c.row === ring).length);
    expect(new Set(perRing).size).toBe(1);
    expect(perRing[0]).toBe(12);
  });

  it('puts blocks on the same spoke at the same angle', () => {
    const box = s();
    const o = centre(box);
    const angleOf = (c: GridCell) => Math.atan2(c.y + c.height / 2 - o.y, c.x + c.width / 2 - o.x);
    const cells = layoutGrid(box);
    for (const spoke of [0, 3, 7]) {
      const onSpoke = cells.filter((c) => c.col === spoke);
      const first = angleOf(onSpoke[0]);
      for (const c of onSpoke) expect(angleOf(c)).toBeCloseTo(first, 4);
    }
  });

  it('steps its blocks evenly around each ring', () => {
    const box = s();
    const o = centre(box);
    const cells = layoutGrid(box).filter((c) => c.row === 2);
    const gaps = cells.map((c, i) => {
      const a = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
      const n = cells[(i + 1) % cells.length];
      const b = { x: n.x + n.width / 2, y: n.y + n.height / 2 };
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    for (const g of gaps) expect(g).toBeCloseTo(mean, 4);
    expect(radiusOf(cells[0], o)).toBeGreaterThan(0);
  });

  it('never lets two blocks touch', () => {
    // Upright squares, so an axis-aligned overlap test is exact.
    const cells = layoutGrid(s());
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i];
        const b = cells[j];
        const apart =
          a.x + a.width <= b.x + 0.01 || b.x + b.width <= a.x + 0.01 ||
          a.y + a.height <= b.y + 0.01 || b.y + b.height <= a.y + 0.01;
        expect(apart).toBe(true);
      }
    }
  });

  it('keeps the outermost corners inside the circle', () => {
    // A square's corner reaches further than its edge -- the term the first
    // version forgot, and why its outer blocks hung over the boundary.
    const box = s();
    const o = centre(box);
    const maxR = Math.min(box.width, box.height) / 2;
    for (const c of layoutGrid(box)) {
      const far = radiusOf(c, o) + (c.width * Math.SQRT2) / 2;
      expect(far).toBeLessThanOrEqual(maxR + 1);
    }
  });

  it('leaves the middle open, and opens it further as variation rises', () => {
    const nearest = (variation: number) => {
      const box = spec({ kind: 'radial', rows: 3, columns: 12, margin: 0, variation });
      const o = centre(box);
      return Math.min(...layoutGrid(box).map((c) => radiusOf(c, o)));
    };
    expect(nearest(0)).toBeGreaterThan(0);
    expect(nearest(1)).toBeGreaterThan(nearest(0));
  });

  it('grows its rings outward', () => {
    const box = s();
    const o = centre(box);
    const cells = layoutGrid(box);
    const ringR = (ring: number) => radiusOf(cells.find((c) => c.row === ring)!, o);
    expect(ringR(0)).toBeLessThan(ringR(1));
    expect(ringR(1)).toBeLessThan(ringR(2));
  });
});

describe('diagonal', () => {
  it('offsets each row', () => {
    const cells = layoutGrid(spec({ kind: 'diagonal', rows: 3, columns: 3, variation: 1 }));
    const firstOfRow = (row: number) => cells.filter((c) => c.row === row)[0];
    expect(firstOfRow(1).x).toBeGreaterThan(firstOfRow(0).x);
  });

  it('makes every cell the same size, with none clipped', () => {
    /**
     * The first version sheared the rows and cut off whatever ran past the
     * edge, so the right-hand column became a run of slivers that got narrower
     * on every row -- real objects, that a person then has to find and delete.
     *
     * Making room for the shear instead means the cell width is solved against
     * it, and every cell comes out whole.
     */
    const cells = layoutGrid(spec({ kind: 'diagonal', rows: 5, columns: 4, variation: 1, margin: 0 }));
    expect(cells).toHaveLength(20);
    const widths = new Set(cells.map((c) => Math.round(c.width * 100)));
    expect(widths.size).toBe(1);
  });

  it('still ends flush against both edges', () => {
    const s = spec({ kind: 'diagonal', rows: 4, columns: 4, variation: 1, margin: 0 });
    const cells = layoutGrid(s);
    expect(Math.min(...cells.map((c) => c.x))).toBeCloseTo(s.x, 4);
    const right = Math.max(...cells.map((c) => c.x + c.width));
    expect(right).toBeCloseTo(s.x + s.width, 4);
  });

  it('is a plain modular grid at zero variation', () => {
    // The property that makes `variation` a dial rather than a switch.
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
