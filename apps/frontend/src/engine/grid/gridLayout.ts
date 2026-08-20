/**
 * Grid systems, as geometry.
 *
 * ## Why this is a layout engine and not a "make N rectangles" button
 *
 * A grid is not a convenience for placing shapes; it is the thing that decides
 * what a composition *is*. A twelve-column grid, a bento wall and a manuscript
 * block are three different arguments about where the eye should go, and an
 * editor that can only draw one rectangle at a time makes all three equally
 * laborious to try — which in practice means nobody tries the second and third.
 *
 * So the unit here is a **spec**, and every layout is a pure function from that
 * spec to a list of cells. Changing the kind is one field. Re-rolling a random
 * arrangement is one number. Nothing about a produced grid is hidden in the
 * objects it made, which is what lets the tool re-lay a grid you have already
 * placed rather than making you delete it and start again.
 *
 * ## Randomness is seeded, always
 *
 * Bento tiling, size variation and colour scattering all want randomness, and
 * unseeded randomness makes a tool that cannot be steered: you get an
 * arrangement you like, change the gutter, and it is gone. Every random draw
 * here comes from `seed`, so the same spec always produces the same grid, and
 * "give me another" is an increment rather than a shrug.
 *
 * Everything is in board coordinates with the origin at the spec's own `x, y`.
 */

export type GridKind =
  | 'columns'
  | 'modular'
  | 'bento'
  | 'masonry'
  | 'hierarchical'
  | 'manuscript'
  | 'baseline'
  | 'golden'
  | 'radial'
  | 'diagonal';

export interface GridSpec {
  kind: GridKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Tracks down the page. Ignored by the kinds that derive their own. */
  rows: number;
  /** Tracks across. */
  columns: number;
  /** Space between tracks. One value each way, because they are read separately. */
  gutterX: number;
  gutterY: number;
  /** Inset from the spec's own box, applied on all four sides. */
  margin: number;
  /**
   * How far the kind is allowed to depart from a uniform grid, 0 to 1.
   *
   * The single control that turns a modular grid into a lively one and a bento
   * wall into a chaotic one. Kinds that have no notion of variation ignore it
   * rather than inventing one.
   */
  variation: number;
  /** Every random draw comes from here, so a grid is reproducible. */
  seed: number;
}

export interface GridCell {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Track indices, for row- and column-wise bulk edits. */
  row: number;
  col: number;
  /**
   * How much of the composition this cell claims, roughly 0 to 1.
   *
   * Area relative to the largest cell. What a palette ramp reads to make the
   * hero of a hierarchical grid the strongest colour without anyone having to
   * say which cell is the hero.
   */
  weight: number;
}

export const GRID_KINDS: readonly GridKind[] = [
  'columns', 'modular', 'bento', 'masonry', 'hierarchical',
  'manuscript', 'baseline', 'golden', 'radial', 'diagonal',
];

export const GRID_LABELS: Record<GridKind, string> = {
  columns: 'Columns',
  modular: 'Modular',
  bento: 'Bento',
  masonry: 'Masonry',
  hierarchical: 'Hierarchical',
  manuscript: 'Manuscript',
  baseline: 'Baseline',
  golden: 'Golden',
  radial: 'Radial',
  diagonal: 'Diagonal',
};

/** One line each, for the picker. What the grid is *for*, not what it looks like. */
export const GRID_HINTS: Record<GridKind, string> = {
  columns: 'Even vertical tracks. The newspaper grid, and the one most layouts start from.',
  modular: 'Rows and columns of equal modules. Predictable, and the base every other kind departs from.',
  bento: 'Modules of mixed size packed flush. Busy without being random, because nothing is left over.',
  masonry: 'Columns of differing heights. What a feed of unequal cards settles into.',
  hierarchical: 'One dominant module and a supporting run. Says what to look at first.',
  manuscript: 'A single block inside generous margins. For one thing that deserves the page.',
  baseline: 'Full-width bands of varying depth. Horizontal rhythm rather than vertical.',
  golden: 'Recursive golden sections. Each step turns ninety degrees and takes the smaller share.',
  radial: 'Modules on concentric rings. For anything that orbits a centre.',
  diagonal: 'A modular grid with each row offset. Motion, from nothing but a shear.',
};

/**
 * A small, fast, seeded PRNG (mulberry32).
 *
 * Chosen over `Math.random` for the reason in the header, and written out
 * rather than pulled in because it is nine lines and a dependency for nine
 * lines is a dependency to keep updated forever.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The spec's box, less its margin. Every kind lays out inside this. */
function inner(spec: GridSpec) {
  const m = Math.max(0, spec.margin);
  return {
    x: spec.x + m,
    y: spec.y + m,
    width: Math.max(0, spec.width - m * 2),
    height: Math.max(0, spec.height - m * 2),
  };
}

/** Track sizes for `count` tracks across `total`, with `gutter` between them. */
function tracks(total: number, count: number, gutter: number): { size: number; step: number } {
  const n = Math.max(1, Math.floor(count));
  const size = Math.max(1, (total - gutter * (n - 1)) / n);
  return { size, step: size + gutter };
}

/** Fill in `weight` from the areas produced, so no kind has to compute it. */
function weigh(cells: Omit<GridCell, 'weight'>[]): GridCell[] {
  const areas = cells.map((c) => c.width * c.height);
  const max = Math.max(1, ...areas);
  return cells.map((c, i) => ({ ...c, weight: areas[i] / max }));
}

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

function columns(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const { size, step } = tracks(box.width, spec.columns, spec.gutterX);
  return Array.from({ length: Math.max(1, Math.floor(spec.columns)) }, (_, col) => ({
    x: box.x + col * step,
    y: box.y,
    width: size,
    height: box.height,
    row: 0,
    col,
  }));
}

function modular(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const cols = tracks(box.width, spec.columns, spec.gutterX);
  const rows = tracks(box.height, spec.rows, spec.gutterY);
  const out: Omit<GridCell, 'weight'>[] = [];
  for (let row = 0; row < Math.max(1, Math.floor(spec.rows)); row += 1) {
    for (let col = 0; col < Math.max(1, Math.floor(spec.columns)); col += 1) {
      out.push({
        x: box.x + col * cols.step,
        y: box.y + row * rows.step,
        width: cols.size,
        height: rows.size,
        row,
        col,
      });
    }
  }
  return out;
}

/**
 * Bento: modules of mixed size, packed flush with nothing left over.
 *
 * ## Why this is a packer and not random rectangles
 *
 * The look people mean by "bento" is *busy without being random*: every tile
 * lands on the same underlying grid, tiles differ in size, and no gaps are
 * left. Scattering random rectangles gives none of those — it gives overlaps
 * and holes, which reads as a mistake rather than as a composition.
 *
 * So this walks the underlying modular grid in order and claims the largest
 * tile that still fits at each free cell, with the size drawn from `variation`:
 * at 0 every tile is 1×1 and the result is a plain modular grid, at 1 large
 * tiles are common. Walking in order rather than at random is what guarantees
 * the fill — a scan always finds the top-left-most hole, so there is never one
 * left behind.
 */
function bento(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = Math.max(1, Math.floor(spec.rows));
  const cols = tracks(box.width, nCols, spec.gutterX);
  const rows = tracks(box.height, nRows, spec.gutterY);

  const taken = Array.from({ length: nRows }, () => new Array<boolean>(nCols).fill(false));
  const next = rng(spec.seed);
  const out: Omit<GridCell, 'weight'>[] = [];

  const free = (r: number, c: number, h: number, w: number) => {
    if (r + h > nRows || c + w > nCols) return false;
    for (let i = r; i < r + h; i += 1) for (let j = c; j < c + w; j += 1) if (taken[i][j]) return false;
    return true;
  };

  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      if (taken[row][col]) continue;

      // Bigger tiles get likelier as variation rises, and 2×2 needs two draws
      // to land — which keeps a wall of large tiles from being the common case.
      const roll = next();
      let w = 1;
      let h = 1;
      if (roll < spec.variation * 0.55 && free(row, col, 2, 2)) { w = 2; h = 2; }
      else if (roll < spec.variation * 0.75 && free(row, col, 1, 2)) { w = 2; }
      else if (roll < spec.variation * 0.95 && free(row, col, 2, 1)) { h = 2; }

      for (let i = row; i < row + h; i += 1) for (let j = col; j < col + w; j += 1) taken[i][j] = true;

      out.push({
        x: box.x + col * cols.step,
        y: box.y + row * rows.step,
        width: cols.size * w + spec.gutterX * (w - 1),
        height: rows.size * h + spec.gutterY * (h - 1),
        row,
        col,
      });
    }
  }
  return out;
}

/**
 * Masonry: columns of differing heights, each column filling exactly.
 *
 * The heights within a column are drawn from `variation` and then *normalised*
 * so the column still ends where the box does. Letting them fall where they may
 * is the obvious implementation and it produces ragged column bottoms, which is
 * a bug in a grid even though it is the correct behaviour for an infinite feed.
 */
function masonry(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = Math.max(1, Math.floor(spec.rows));
  const cols = tracks(box.width, nCols, spec.gutterX);
  const next = rng(spec.seed);
  const out: Omit<GridCell, 'weight'>[] = [];

  for (let col = 0; col < nCols; col += 1) {
    // One extra cell in some columns, so the columns are not merely different
    // heights but different *counts* — which is what masonry actually looks like.
    const count = Math.max(1, nRows + (next() < spec.variation * 0.5 ? 1 : next() < spec.variation * 0.25 ? -1 : 0));
    const raw = Array.from({ length: count }, () => 1 + next() * spec.variation * 1.6);
    const sum = raw.reduce((a, b) => a + b, 0);
    const usable = box.height - spec.gutterY * (count - 1);

    let y = box.y;
    for (let row = 0; row < count; row += 1) {
      const h = (raw[row] / sum) * usable;
      out.push({ x: box.x + col * cols.step, y, width: cols.size, height: h, row, col });
      y += h + spec.gutterY;
    }
  }
  return out;
}

/**
 * Hierarchical: one dominant module and a supporting run around it.
 *
 * The hero takes a square block of the grid; everything else fills what is
 * left, walking the same modular lattice so the supporting cells still line up
 * with the hero's edges. That alignment is the whole point — a big rectangle
 * with small ones scattered near it is not a hierarchy, it is a big rectangle.
 */
function hierarchical(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(2, Math.floor(spec.columns));
  const nRows = Math.max(2, Math.floor(spec.rows));
  const cols = tracks(box.width, nCols, spec.gutterX);
  const rows = tracks(box.height, nRows, spec.gutterY);

  // The hero grows with variation, but never swallows the grid: leaving no
  // supporting cells at all would make this a manuscript layout by accident.
  const span = Math.max(1, Math.min(nCols - 1, nRows - 1, Math.round(1 + spec.variation * 2)));
  const taken = Array.from({ length: nRows }, () => new Array<boolean>(nCols).fill(false));
  const out: Omit<GridCell, 'weight'>[] = [];

  for (let i = 0; i < span; i += 1) for (let j = 0; j < span; j += 1) taken[i][j] = true;
  out.push({
    x: box.x,
    y: box.y,
    width: cols.size * span + spec.gutterX * (span - 1),
    height: rows.size * span + spec.gutterY * (span - 1),
    row: 0,
    col: 0,
  });

  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      if (taken[row][col]) continue;
      out.push({
        x: box.x + col * cols.step,
        y: box.y + row * rows.step,
        width: cols.size,
        height: rows.size,
        row,
        col,
      });
    }
  }
  return out;
}

/**
 * Manuscript: one block inside generous margins.
 *
 * The simplest grid there is and the one most often needed — a single thing
 * that deserves the page. `variation` widens the margin rather than doing
 * nothing, because a manuscript block's only real parameter is how much air it
 * stands in.
 */
function manuscript(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const air = Math.min(box.width, box.height) * 0.12 * spec.variation;
  return [{
    x: box.x + air,
    y: box.y + air,
    width: Math.max(1, box.width - air * 2),
    height: Math.max(1, box.height - air * 2),
    row: 0,
    col: 0,
  }];
}

/** Baseline: full-width bands, their depths varying with `variation`. */
function baseline(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const n = Math.max(1, Math.floor(spec.rows));
  const next = rng(spec.seed);
  const raw = Array.from({ length: n }, () => 1 + next() * spec.variation * 2);
  const sum = raw.reduce((a, b) => a + b, 0);
  const usable = box.height - spec.gutterY * (n - 1);

  let y = box.y;
  return raw.map((r, row) => {
    const h = (r / sum) * usable;
    const cell = { x: box.x, y, width: box.width, height: h, row, col: 0 };
    y += h + spec.gutterY;
    return cell;
  });
}

const PHI_SHARE = 1 / 1.618033988749895;

/**
 * Golden: recursive golden sections, turning ninety degrees each step.
 *
 * Take the golden share off the long side, keep it as a cell, and recurse into
 * the remainder rotated a quarter turn. That is the actual construction of the
 * golden spiral's bounding squares, and it produces the one arrangement in this
 * file that nobody could lay out by hand in reasonable time.
 */
function golden(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const steps = Math.max(1, Math.min(12, Math.floor(spec.rows * spec.columns) || 5));
  const out: Omit<GridCell, 'weight'>[] = [];

  let { x, y, width, height } = box;
  let horizontal = width >= height;

  for (let i = 0; i < steps; i += 1) {
    if (width <= spec.gutterX || height <= spec.gutterY) break;
    if (i === steps - 1) {
      out.push({ x, y, width, height, row: i, col: 0 });
      break;
    }

    if (horizontal) {
      const cut = width * PHI_SHARE;
      out.push({ x, y, width: cut - spec.gutterX / 2, height, row: i, col: 0 });
      x += cut + spec.gutterX / 2;
      width -= cut + spec.gutterX / 2;
    } else {
      const cut = height * PHI_SHARE;
      out.push({ x, y, width, height: cut - spec.gutterY / 2, row: i, col: 0 });
      y += cut + spec.gutterY / 2;
      height -= cut + spec.gutterY / 2;
    }
    horizontal = !horizontal;
  }
  return out;
}

/**
 * Radial: modules on concentric rings.
 *
 * Cells are still axis-aligned boxes — rotating them would mean every produced
 * object carried a rotation, and a grid you cannot then edit as a grid is a
 * one-shot generator rather than a system. What orbits is their *placement*,
 * which is enough: a ring of eight boxes reads as a ring.
 */
function radial(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const ringCount = Math.max(1, Math.floor(spec.rows));
  const perRing = Math.max(1, Math.floor(spec.columns));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const maxR = Math.min(box.width, box.height) / 2;

  // Sized so a full ring's cells sit shoulder to shoulder without overlapping,
  // which is the constraint that makes the arrangement read as a ring at all.
  const cellW = Math.max(8, (2 * Math.PI * maxR) / Math.max(perRing, 6) - spec.gutterX);
  const out: Omit<GridCell, 'weight'>[] = [];

  for (let ring = 0; ring < ringCount; ring += 1) {
    const r = maxR * ((ring + 1) / ringCount) - cellW / 2;
    if (r <= 0) continue;
    // Inner rings hold fewer, or they crowd. Proportional to circumference.
    const count = Math.max(1, Math.round(perRing * ((ring + 1) / ringCount)));
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const w = cellW * (1 - spec.variation * 0.3 * (ring / ringCount));
      out.push({
        x: cx + Math.cos(angle) * r - w / 2,
        y: cy + Math.sin(angle) * r - w / 2,
        width: w,
        height: w,
        row: ring,
        col: i,
      });
    }
  }
  return out;
}

/**
 * Diagonal: a modular grid with each row offset, and the overhang clipped.
 *
 * The shear is what gives it motion, and clipping to the box is what keeps it a
 * grid: cells that ran off the edge would make the composition's own bounds a
 * lie, and every alignment against them wrong.
 */
function diagonal(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = Math.max(1, Math.floor(spec.rows));
  const cols = tracks(box.width, nCols, spec.gutterX);
  const rows = tracks(box.height, nRows, spec.gutterY);
  const shear = cols.step * 0.5 * spec.variation;

  const out: Omit<GridCell, 'weight'>[] = [];
  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      const left = box.x + col * cols.step + row * shear;
      const right = left + cols.size;
      const clippedLeft = Math.max(box.x, left);
      const clippedRight = Math.min(box.x + box.width, right);
      if (clippedRight - clippedLeft < 1) continue;
      out.push({
        x: clippedLeft,
        y: box.y + row * rows.step,
        width: clippedRight - clippedLeft,
        height: rows.size,
        row,
        col,
      });
    }
  }
  return out;
}

const LAYOUTS: Record<GridKind, (spec: GridSpec) => Omit<GridCell, 'weight'>[]> = {
  columns, modular, bento, masonry, hierarchical, manuscript, baseline, golden, radial, diagonal,
};

/**
 * The cells a spec describes.
 *
 * Total and pure: any spec produces some grid, including degenerate ones. A box
 * of zero width returns cells of minimum size rather than `NaN`, because the
 * spec is live under a drag and half of every drag passes through zero.
 */
export function layoutGrid(spec: GridSpec): GridCell[] {
  if (!Number.isFinite(spec.width) || !Number.isFinite(spec.height)) return [];
  const build = LAYOUTS[spec.kind] ?? modular;
  return weigh(build(spec).filter((c) => c.width > 0 && c.height > 0));
}

/** The box every cell of a laid-out grid fits inside. */
export function gridBounds(cells: readonly GridCell[]): { x: number; y: number; width: number; height: number } | null {
  if (cells.length === 0) return null;
  const x = Math.min(...cells.map((c) => c.x));
  const y = Math.min(...cells.map((c) => c.y));
  const right = Math.max(...cells.map((c) => c.x + c.width));
  const bottom = Math.max(...cells.map((c) => c.y + c.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * A spec with everything filled in, for a box.
 *
 * Defaults chosen to look deliberate rather than neutral: three columns is the
 * arrangement people reach for most, and a gutter of 16 is close enough to
 * every design system's base spacing to read as intentional.
 */
export function defaultSpec(box: { x: number; y: number; width: number; height: number }): GridSpec {
  return {
    kind: 'modular',
    ...box,
    rows: 3,
    columns: 3,
    gutterX: 16,
    gutterY: 16,
    margin: 0,
    variation: 0.5,
    seed: 1,
  };
}
