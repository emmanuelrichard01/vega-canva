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
  golden: 'Squares spiralling inward by the golden ratio. Each one is the short side of what is left.',
  radial: 'Concentric rings, evenly spaced and interlocked. For anything that orbits a centre.',
  diagonal: 'Rows cascading sideways, every cell whole. Motion, from nothing but an offset.',
};

/**
 * What each kind means by "rows" and "columns", and how loose it wants to be.
 *
 * ## Why picking a kind changes the numbers
 *
 * The same two fields mean different things to different systems. `columns` is
 * twelve tracks to a newspaper grid, twelve spokes to a dial, and five
 * subdivisions to a golden spiral -- and a 3x3 default, which is right for a
 * modular grid, gives the dial three spokes and the spiral three squares. Both
 * look broken, and neither is: they were asked for three of something that
 * needs a dozen.
 *
 * So switching kind brings its own numbers with it. That is a real cost --
 * settings a person chose get replaced -- and it is the right trade, because
 * the alternative is that eight of the ten kinds are first seen at their worst.
 * The controls are right there, and the first thing anyone does after switching
 * is look at the result.
 */
export const KIND_DEFAULTS: Record<
  GridKind,
  { rows: number; columns: number; variation: number; gutterX: number; gutterY: number }
> = {
  columns: { rows: 1, columns: 12, variation: 0, gutterX: 16, gutterY: 16 },
  modular: { rows: 3, columns: 3, variation: 0, gutterX: 16, gutterY: 16 },
  bento: { rows: 4, columns: 4, variation: 0.7, gutterX: 12, gutterY: 12 },
  masonry: { rows: 4, columns: 3, variation: 0.7, gutterX: 12, gutterY: 12 },
  hierarchical: { rows: 4, columns: 4, variation: 0.6, gutterX: 12, gutterY: 12 },
  manuscript: { rows: 1, columns: 1, variation: 0.3, gutterX: 0, gutterY: 0 },
  baseline: { rows: 5, columns: 1, variation: 0.6, gutterX: 0, gutterY: 12 },
  // Five squares is where the shrinking sequence becomes legible: three barely
  // shows one step, and past eight the smallest is a speck.
  golden: { rows: 1, columns: 5, variation: 0, gutterX: 8, gutterY: 8 },
  /**
   * A tighter gutter than a modular grid, and not a matter of taste.
   *
   * Blocks stepped around a ring are separated along a *diagonal*, and only
   * `1 / sqrt(2)` of that separation counts against an upright square's edge --
   * so a gutter costs a dial about 40% more than it costs a grid of rows and
   * columns. Sixteen here is what left the blocks as scattered dots.
   */
  radial: { rows: 3, columns: 12, variation: 0.3, gutterX: 6, gutterY: 6 },
  diagonal: { rows: 4, columns: 4, variation: 0.5, gutterX: 12, gutterY: 12 },
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

/**
 * Tracks that need not be equal.
 *
 * ## Why this exists
 *
 * `variation` was dead on the two kinds people reach for first. Columns and
 * modular ignored it, so the slider sat there doing nothing on the default
 * grid -- which teaches that the control is decorative before it has been
 * tried anywhere it works.
 *
 * An uneven column grid is not a broken one, either: a fluid or "ragged"
 * measure is a real editorial device, and it is the difference between a grid
 * that looks generated and one that looks set. The weights are drawn from the
 * seed and then **normalised**, so however uneven the tracks are they still add
 * up to the space available -- the same rule `masonry` follows, and for the
 * same reason: a track run that overflows its own box makes the box a lie.
 *
 * At zero variation every weight is 1 and this is exactly `tracks`.
 */
function jitteredTracks(
  total: number,
  count: number,
  gutter: number,
  variation: number,
  next: () => number
): { offset: number; size: number }[] {
  const n = Math.max(1, Math.floor(count));
  const usable = Math.max(1, total - gutter * (n - 1));
  // Two-thirds of the dial, because a track at a third of its neighbour's width
  // stops reading as the same kind of thing.
  const weights = Array.from({ length: n }, () =>
    variation > 0 ? 1 + (next() - 0.5) * 2 * variation * 0.66 : 1
  );
  const sum = weights.reduce((a, b) => a + b, 0);

  let at = 0;
  return weights.map((w) => {
    const size = Math.max(1, (usable * w) / sum);
    const track = { offset: at, size };
    at += size + gutter;
    return track;
  });
}

/**
 * What `variation` changes, per kind.
 *
 * The slider used to be labelled "Variation" everywhere, which says nothing:
 * it opens a hole in the dial, mixes the compartments in a bento box, sizes the
 * hero of a hierarchy and shears a cascade. Four different controls behind one
 * word, and the only way to learn which was to drag it and watch.
 */
export const VARIATION_LABELS: Partial<Record<GridKind, string>> = {
  columns: 'Uneven columns',
  modular: 'Uneven modules',
  bento: 'Compartment mix',
  masonry: 'Card variety',
  hierarchical: 'Hero size',
  manuscript: 'Air',
  baseline: 'Band contrast',
  radial: 'Centre hole',
  diagonal: 'Cascade',
};

/** Fill in `weight` from the areas produced, so no kind has to compute it. */
function weigh(cells: Omit<GridCell, 'weight'>[]): GridCell[] {
  const areas = cells.map((c) => c.width * c.height);
  const max = Math.max(1, ...areas);
  return cells.map((c, i) => ({ ...c, weight: areas[i] / max }));
}

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

/** The golden ratio. Named because  refers to it four times in six lines. */
const PHI = 1.618033988749895;

function columns(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  // Uneven at any variation above zero: a fluid measure is a real editorial
  // device, and the slider used to do nothing at all on this kind.
  const cols = jitteredTracks(box.width, spec.columns, spec.gutterX, spec.variation, rng(spec.seed));
  return cols.map((col, i) => ({
    x: box.x + col.offset,
    y: box.y,
    width: col.size,
    height: box.height,
    row: 0,
    col: i,
  }));
}

function modular(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  // One generator for both axes, so a given seed gives a given grid -- two
  // would make the columns depend on how many rows there happened to be.
  const next = rng(spec.seed);
  const cols = jitteredTracks(box.width, spec.columns, spec.gutterX, spec.variation, next);
  const rows = jitteredTracks(box.height, spec.rows, spec.gutterY, spec.variation, next);

  const out: Omit<GridCell, 'weight'>[] = [];
  rows.forEach((row, r) => {
    cols.forEach((col, c) => {
      out.push({
        x: box.x + col.offset,
        y: box.y + row.offset,
        width: col.size,
        height: row.size,
        row: r,
        col: c,
      });
    });
  });
  return out;
}

/**
 * The compartments a bento box is made of. Each is [cols, rows].
 *
 * Nothing larger than a 2x2 block or a 3x1 strip, and that ceiling is the whole
 * point rather than a limitation. A 3x2 tile in a 4x4 grid is a third of the
 * composition: it becomes the thing you look at, and the layout stops being a
 * bento box and becomes a hierarchy with an odd sense of humour. Strips are
 * long but thin, so they add variety without claiming rank.
 */
const BENTO_TILES: readonly [number, number][] = [[2, 2], [3, 1], [1, 3], [2, 1], [1, 2], [1, 1]];

/**
 * Bento: mixed compartments packed flush, none of them the main one.
 *
 * ## What separates this from `hierarchical`
 *
 * They were producing the same picture, because they were running the same
 * algorithm: plant a few big tiles, fill the rest. That is the right shape for
 * a hierarchy and the wrong one here, and the difference is not cosmetic --
 * the two kinds mean opposite things.
 *
 * A hierarchy **ranks**. One module dominates, a second tier supports it, and
 * the tail is uniform; the composition tells you where to look first, and that
 * is its job.
 *
 * A bento box **does not rank**. Compartments differ in size because the
 * contents do, not because one matters more, and no single one owns the frame.
 * What it promises is a *tight, varied, even* packing -- busy without being
 * random, with nothing left over and nothing shouting.
 *
 * So this is not a planting pass at all. It draws a **bag** of compartments
 * whose areas sum to the grid, shuffles it, and lays them out. Shuffling is
 * what spreads the sizes: the previous version scanned from the top left and
 * took the biggest tile that fitted, so every large tile landed in the first
 * few rows and the bottom silted up with 1x1 crumbs -- which reads exactly like
 * a hero with gravel after it, which is to say like a hierarchy.
 *
 * The scan that places them is still row-major, because that is what guarantees
 * the fill: it always finds the top-left-most hole, so none is left behind.
 */
function bento(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = Math.max(1, Math.floor(spec.rows));
  const cols = tracks(box.width, nCols, spec.gutterX);
  const rows = tracks(box.height, nRows, spec.gutterY);

  const taken = Array.from({ length: nRows }, () => new Array<boolean>(nCols).fill(false));
  const next = rng(spec.seed);
  const placed: { row: number; col: number; w: number; h: number }[] = [];

  const free = (r: number, c: number, w: number, h: number) => {
    if (r + h > nRows || c + w > nCols) return false;
    for (let i = r; i < r + h; i += 1) for (let j = c; j < c + w; j += 1) if (taken[i][j]) return false;
    return true;
  };

  /**
   * The bag: compartments totalling the grid's area, in a settled mix.
   *
   * Drawn before anything is placed so the *distribution* is decided
   * independently of where things land -- which is what keeps the mix even
   * across the whole box rather than front-loaded. At zero variation the bag is
   * all 1x1 and the result is a plain modular grid, which is the property that
   * makes `variation` a dial rather than a switch.
   */
  const usable = BENTO_TILES.filter(([w, h]) => w <= nCols && h <= nRows);
  const bag: [number, number][] = [];
  let remaining = nRows * nCols;
  while (remaining > 0) {
    const candidates = usable.filter(([w, h]) => w * h <= remaining);
    // Bigger compartments get likelier as variation rises; at zero only the
    // 1x1 survives the draw.
    const wanted = candidates.filter(([w, h]) => w * h === 1 || next() < spec.variation);
    const tile = (wanted.length > 0 ? wanted : [[1, 1] as [number, number]])[
      Math.floor(next() * Math.max(1, wanted.length))
    ] ?? [1, 1];
    bag.push(tile as [number, number]);
    remaining -= tile[0] * tile[1];
  }

  // Shuffled, so a 2x2 is as likely to be the last compartment placed as the
  // first. This one line is the difference between a bento box and a hierarchy.
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }

  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      if (taken[row][col]) continue;
      // First from the bag that fits this hole. A compartment that fits nowhere
      // is dropped rather than forced, and the 1x1 fallback keeps the fill
      // total -- a bento box with a gap in it is the one thing it must not be.
      let index = bag.findIndex(([w, h]) => free(row, col, w, h));
      if (index === -1) {
        bag.push([1, 1]);
        index = bag.length - 1;
      }
      const [w, h] = bag.splice(index, 1)[0];
      for (let i = row; i < row + h; i += 1) for (let j = col; j < col + w; j += 1) taken[i][j] = true;
      placed.push({ row, col, w, h });
    }
  }

  return placed.map(({ row, col, w, h }) => ({
    x: box.x + col * cols.step,
    y: box.y + row * rows.step,
    width: cols.size * w + spec.gutterX * (w - 1),
    height: rows.size * h + spec.gutterY * (h - 1),
    row,
    col,
  }));
}

/**
 * The proportions a masonry card comes in.
 *
 * A small set of real aspect ratios rather than a continuous random height,
 * because that is the difference between a card feed and a bar chart with the
 * labels missing. Repeating six familiar shapes is what lets the eye group
 * them; forty cards with forty different proportions is noise.
 *
 * The spread is deliberately wide -- a double-height card beside a squat one is
 * the whole look, and the first version's gentle jitter is exactly why it came
 * out resembling a modular grid with untidy rows.
 */
const MASONRY_RATIOS: readonly number[] = [2.4, 1.8, 1.35, 1, 0.74, 0.52];

/** A runaway column would hang the tab; no real feed has forty cards in one. */
const MASONRY_MAX_CARDS = 40;

/**
 * Masonry: columns of cards that do not line up.
 *
 * ## What made it look like a modular grid
 *
 * Not the heights -- those varied. It was the **count**. Each column was given
 * the same nominal number of cards, give or take one, and then its heights were
 * normalised to fill the column. Equal counts and similar mean heights put
 * every column's boundaries at roughly the same depth, so faint horizontal
 * bands ran across the whole thing: a modular grid with untidy rows, which is
 * the one thing masonry must not be.
 *
 * The defining property of masonry is that **rows are not rows**. That cannot
 * be had by varying heights within a fixed count; it needs the count itself to
 * differ, and to differ a lot. So the count is no longer a setting. Each column
 * draws cards until it is full, and a column that happens to draw two tall ones
 * fits four where its neighbour fits seven. Nothing lines up because nothing
 * was ever asked to.
 *
 * `rows` still means something: it sets the *base* card height, which is what
 * anyone is really choosing when they ask for more or fewer. It is a target
 * rather than a quota.
 *
 * ## Why the heights are still normalised
 *
 * Real feeds have ragged bottoms because they are infinite. A grid is not: its
 * bottom edge is a boundary other things align to, and a staircase there makes
 * the bounds a lie. Each column is scaled to land exactly on it -- which is
 * invisible, because the columns already disagree about everything else.
 */
function masonry(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = Math.max(1, Math.floor(spec.rows));
  const cols = tracks(box.width, nCols, spec.gutterX);
  const next = rng(spec.seed);
  const out: Omit<GridCell, 'weight'>[] = [];

  // The height a card of ratio 1 would have. `rows` sets this rather than a
  // quota, which is what anyone asking for more or fewer cards actually means.
  const baseHeight = tracks(box.height, nRows, spec.gutterY).size;

  for (let col = 0; col < nCols; col += 1) {
    /**
     * Each column runs at its own scale.
     *
     * Per-card randomness alone was not enough: with every column drawing from
     * one distribution they all landed on about the same count, and similar
     * counts over the same total height put the boundaries back at about the
     * same depths -- faint horizontal bands, which is the modular look this
     * kind must not have.
     *
     * A column-wide multiplier is what breaks that, because it shifts the whole
     * column rather than jittering inside it: one column runs tall-and-few
     * against a neighbour running short-and-many, and after the first card
     * nothing the two of them do can agree again.
     */
    const columnScale = 1 + (next() - 0.5) * 2 * spec.variation * 0.55;

    /**
     * Draw until the column is full. The count falls out of the draw.
     *
     * A column that draws two double-height cards fits four where its
     * neighbour fits seven, so no boundary in one lines up with a boundary in
     * the next.
     */
    const ratios: number[] = [];
    let filled = 0;
    while (filled + 0.5 < box.height && ratios.length < MASONRY_MAX_CARDS) {
      const drawn = MASONRY_RATIOS[Math.floor(next() * MASONRY_RATIOS.length)];
      // Blended toward 1 by `variation`, so the dial runs from a modular grid
      // to a full card wall rather than switching between them.
      const ratio = (1 + (drawn - 1) * spec.variation) * columnScale;
      ratios.push(ratio);
      filled += ratio * baseHeight + spec.gutterY;
    }

    const sum = ratios.reduce((a, b) => a + b, 0);
    const usable = box.height - spec.gutterY * (ratios.length - 1);

    let y = box.y;
    ratios.forEach((ratio, row) => {
      const h = Math.max(1, (ratio / sum) * usable);
      out.push({ x: box.x + col * cols.step, y, width: cols.size, height: h, row, col });
      y += h + spec.gutterY;
    });
  }
  return out;
}

/** Where a hero can sit. A corner, because a hero against two edges anchors the page. */
const HERO_CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

/**
 * Hierarchical: a dominant module, a secondary tier, and the rest.
 *
 * ## Why two tiers and not one
 *
 * The first version put one square hero in the top-left and made everything
 * else a 1x1. That is not a hierarchy, it is a hero with a crowd: there is a
 * first thing to look at and then twelve equal things, so the eye goes from the
 * hero to nowhere in particular. A hierarchy needs a *second* rank to move to,
 * which is why every editorial layout has a lead, two or three seconds, and a
 * tail.
 *
 * So a few 2x1 modules are planted after the hero and before the fill. They
 * cost nothing -- the same packer that lays the hero lays them -- and they are
 * the difference between a layout that ranks its content and one that merely
 * enlarges a corner of it.
 *
 * The hero's corner comes from the seed rather than always being top-left, so
 * re-rolling gives a genuinely different composition instead of the same one
 * with different crumbs. It is always a corner: a hero against two edges
 * anchors the page, and one floating in the middle reads as a mistake.
 */
function hierarchical(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(2, Math.floor(spec.columns));
  const nRows = Math.max(2, Math.floor(spec.rows));
  const cols = tracks(box.width, nCols, spec.gutterX);
  const rows = tracks(box.height, nRows, spec.gutterY);
  const next = rng(spec.seed);

  const taken = Array.from({ length: nRows }, () => new Array<boolean>(nCols).fill(false));
  const placed: { row: number; col: number; w: number; h: number }[] = [];

  const free = (r: number, c: number, w: number, h: number) => {
    if (r < 0 || c < 0 || r + h > nRows || c + w > nCols) return false;
    for (let i = r; i < r + h; i += 1) for (let j = c; j < c + w; j += 1) if (taken[i][j]) return false;
    return true;
  };
  const claim = (r: number, c: number, w: number, h: number) => {
    for (let i = r; i < r + h; i += 1) for (let j = c; j < c + w; j += 1) taken[i][j] = true;
    placed.push({ row: r, col: c, w, h });
  };

  // The hero grows with variation but never swallows the grid: leaving no
  // supporting modules would make this a manuscript layout by accident.
  const span = Math.max(1, Math.min(nCols - 1, nRows - 1, 1 + Math.round(spec.variation * 2)));
  const corner = HERO_CORNERS[Math.floor(next() * HERO_CORNERS.length)];
  const heroRow = corner === 'tl' || corner === 'tr' ? 0 : nRows - span;
  const heroCol = corner === 'tl' || corner === 'bl' ? 0 : nCols - span;
  claim(heroRow, heroCol, span, span);

  /**
   * The second rank: wide modules, not big ones.
   *
   * Half-width rather than half-area, because what a second tier has to do is
   * read as *a different rank*, and a slightly smaller square reads as a
   * slightly smaller version of the hero.
   */
  const seconds = Math.round(spec.variation * 2) + 1;
  for (let i = 0; i < seconds; i += 1) {
    const r = Math.floor(next() * nRows);
    const c = Math.floor(next() * nCols);
    if (free(r, c, 2, 1)) claim(r, c, 2, 1);
    else if (free(r, c, 1, 2)) claim(r, c, 1, 2);
  }

  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      if (!taken[row][col]) claim(row, col, 1, 1);
    }
  }

  return placed.map(({ row, col, w, h }) => ({
    x: box.x + col * cols.step,
    y: box.y + row * rows.step,
    width: cols.size * w + spec.gutterX * (w - 1),
    height: rows.size * h + spec.gutterY * (h - 1),
    row,
    col,
  }));
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

/**
 * Baseline: full-width bands, their depths varying with `variation`.
 *
 * The same normalised-track machinery every other run of tracks uses, rather
 * than its own copy of it -- which is what it had, and which drifted: this one
 * scaled its weights differently from `columns`, so the same variation setting
 * meant a different amount of unevenness depending on which kind you were in.
 */
function baseline(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const bands = jitteredTracks(box.height, spec.rows, spec.gutterY, spec.variation, rng(spec.seed));
  return bands.map((band, row) => ({
    x: box.x,
    y: box.y + band.offset,
    width: box.width,
    height: band.size,
    row,
    col: 0,
  }));
}

/**
 * Golden: squares spiralling inward, each one 1/phi of the last.
 *
 * ## Why it has to square a golden rectangle, not your box
 *
 * Taking squares off an arbitrary rectangle is the Euclidean algorithm, and it
 * terminates. A 3:2 box tiles into exactly three squares -- 400, 200, 200 --
 * and then there is nothing left, however many steps you ask for. That is
 * correct arithmetic and a useless layout: the whole point of the kind is the
 * shrinking sequence, and three blocks barely show one.
 *
 * The ratio only continues forever on a **golden** rectangle, which is the
 * property phi is named for: remove the square and what remains is another
 * golden rectangle. So this fits the largest phi:1 rectangle inside the box,
 * centres it, and spirals in that. Ten squares are as available as three, every
 * one is exactly 1/phi of the one before it, and the sequence is the real one
 * rather than whatever the box's proportions happened to allow.
 *
 * The cost is the strip of box left over on two sides. That is the honest
 * trade: a grid called Golden either honours the ratio or fills the rectangle,
 * and it cannot do both unless the rectangle is already golden.
 *
 * ## The spiral
 *
 * A square comes off the long axis each step, alternating which end of that
 * axis. On a golden rectangle the axis flips every step by itself -- that is
 * the recursion -- so the ends come out left, top, right, bottom without being
 * sequenced by hand. The first version kept the golden *share* as its cell
 * rather than a square, and always cut from the same two sides, so it drew a
 * staircase marching to the bottom right.
 */
function golden(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  // Its own control rather than `rows x columns`, which meant a 3x3 asked for
  // nine subdivisions -- far past the point where the smallest is a speck.
  const steps = Math.max(2, Math.min(10, Math.round(spec.columns)));
  if (box.width <= 0 || box.height <= 0) return [];

  // The largest golden rectangle the box will hold, in the box's own
  // orientation, centred so the leftover reads as margin rather than as drift.
  let w = box.width;
  let h = box.height;
  if (box.width >= box.height) {
    if (w / h > PHI) w = h * PHI;
    else h = w / PHI;
  } else if (h / w > PHI) {
    h = w * PHI;
  } else {
    w = h / PHI;
  }
  let x = box.x + (box.width - w) / 2;
  let y = box.y + (box.height - h) / 2;

  const out: Omit<GridCell, 'weight'>[] = [];
  // Which end of each axis the next square comes off. Flipped after use.
  let fromLeft = true;
  let fromTop = true;

  for (let i = 0; i < steps; i += 1) {
    if (w <= 1 || h <= 1) break;

    // The last square is the whole remainder: stopping mid-recursion would
    // leave a hole at the centre of the spiral, which is the one place the eye
    // is guaranteed to land.
    if (i === steps - 1) {
      out.push({ x, y, width: w, height: h, row: i, col: 0 });
      break;
    }

    const wide = w >= h;
    const size = Math.min(w, h);
    const gutter = wide ? spec.gutterX : spec.gutterY;
    // The gutter comes out *between* the square and the remainder. Splitting it
    // across both would leave a half-gutter against the outer edge.
    const cut = Math.max(1, size - gutter);

    if (wide) {
      out.push({ x: fromLeft ? x : x + w - cut, y, width: cut, height: h, row: i, col: 0 });
      if (fromLeft) x += size;
      w -= size;
      fromLeft = !fromLeft;
    } else {
      out.push({ x, y: fromTop ? y : y + h - cut, width: w, height: cut, row: i, col: 0 });
      if (fromTop) y += size;
      h -= size;
      fromTop = !fromTop;
    }
  }
  return out;
}

/** Half the diagonal of a square of side 1 -- how far its corner reaches from its centre. */
const HALF_DIAGONAL = Math.SQRT2 / 2;

/**
 * How far apart two upright squares of side 1 must be, centre to centre.
 *
 * Not 1. Two axis-aligned squares overlap unless their centres are at least a
 * side apart **in x or in y**, and a centre-to-centre distance of `d` on a
 * diagonal only buys `d / sqrt(2)` on each axis. Blocks stepped around a circle
 * sit at every angle, so the diagonal case is not a corner case here -- it is
 * most of them.
 */
const CLEARANCE = Math.SQRT2;

/**
 * Radial: upright blocks stepped evenly around concentric rings.
 *
 * ## What each attempt got wrong
 *
 * The first sized every block from the *outermost* radius and used that size on
 * every ring, so inner rings -- which have a fraction of the circumference --
 * piled their blocks on top of each other. It also varied the count per ring
 * and offset alternate rings by half a step, chasing even spacing. That was the
 * wrong instinct twice: unequal counts and staggered rings leave no spokes at
 * all, and a ring of beads with nothing lining up is a scatter that happens to
 * be round.
 *
 * The second made each cell an annular *sector* turned to face the middle. That
 * is a polar grid in the textbook sense and a poor container -- a grid tool's
 * cells are things you put content in, and a rotated wedge is not one.
 *
 * The third fixed both and then found a third fault: it solved **one** block
 * size for the whole grid, which means the innermost ring -- the tightest arc
 * on the board -- sets the size for every ring outside it. With a dozen spokes
 * that is a 10px block on a 400px circle, and thirty-six of them read as
 * scattered dots rather than as rings. The outer rings had four times the room
 * and were not allowed to use it.
 *
 * So each ring is sized against **its own** arc, capped by the depth of its
 * band. Blocks grow outward, which is both what the space allows and what
 * concentric rings actually look like; the spokes still line up, which is what
 * makes it a grid.
 */
function radial(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const rings = Math.max(1, Math.floor(spec.rows));
  // Three is the fewest that reads as a ring rather than as a pair.
  const spokes = Math.max(3, Math.floor(spec.columns));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const maxR = Math.min(box.width, box.height) / 2;
  if (maxR <= 0) return [];

  /**
   * Where the innermost ring sits, as a fraction of the radius.
   *
   * There has to be a hole: the arc available shrinks with the radius, so a
   * ring at the centre has no room and its blocks would collapse into a knot.
   * `variation` widens it -- a tight rosette at one end, a wide orbit at the
   * other -- which is the one control here that changes the character of the
   * arrangement rather than merely its density.
   */
  const hole = maxR * (0.16 + spec.variation * 0.44);
  // Bands share what is left. The outermost keeps half a band in hand so its
  // blocks -- which reach past their own edge at the corners -- stay inside.
  const band = (maxR - hole) / (rings + HALF_DIAGONAL);

  const out: Omit<GridCell, 'weight'>[] = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const r = hole + band * (ring + 0.5);

    /**
     * Two caps, and the smaller wins.
     *
     * The arc says how wide a block can be before it touches its neighbour
     * round the ring; the band says how deep it can be before it touches the
     * ring outside. Solving them per ring rather than once for the whole grid
     * is the fix: one global answer is the innermost ring's answer, imposed on
     * rings with four times the room.
     */
    /**
     * The gutter is the gap you *see*, so it is subtracted after the clearance
     * rather than before it.
     *
     * `chord / CLEARANCE` is how much of the centre-to-centre distance survives
     * as separation along an axis; taking the gutter out of the chord first
     * charged it at `sqrt(2)` times its face value, which is why sixteen pixels
     * of gutter opened a twenty-two pixel hole.
     */
    const byArc = (2 * r * Math.sin(Math.PI / spokes)) / CLEARANCE - spec.gutterX;
    const byBand = band - spec.gutterY;
    const size = Math.max(2, Math.min(byArc, byBand));

    for (let spoke = 0; spoke < spokes; spoke += 1) {
      // From twelve o'clock, because that is where anyone reading a dial starts
      // -- and where the kind's own icon puts its first block.
      const angle = (spoke / spokes) * Math.PI * 2 - Math.PI / 2;
      out.push({
        x: cx + Math.cos(angle) * r - size / 2,
        y: cy + Math.sin(angle) * r - size / 2,
        width: size,
        height: size,
        row: ring,
        col: spoke,
      });
    }
  }
  return out;
}

/**
 * Diagonal: a cascade, where every cell is whole.
 *
 * ## What was wrong with the first version
 *
 * It sheared each row sideways and **clipped whatever ran past the edge**. So
 * the right-hand column became a column of slivers, narrower on every row, and
 * the last row's often vanished entirely. Slivers read as a rendering fault
 * rather than as a composition -- and in a design tool they are worse than
 * that, because they are real objects a person then has to find and delete.
 *
 * The fix is to make room for the shear rather than to cut it off. The total
 * offset across all rows is known before anything is placed, so the cell width
 * is solved against it: `columns * width + gutters + totalShear = boxWidth`.
 * Every cell is then full size, every row is complete, nothing is clipped, and
 * the composition still ends flush against both edges.
 *
 * At zero variation the shear is zero and this is a modular grid, which is the
 * property that makes `variation` a dial rather than a switch.
 */
function diagonal(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = Math.max(1, Math.floor(spec.rows));
  const rows = tracks(box.height, nRows, spec.gutterY);

  // The whole cascade, edge to edge: at full variation the last row starts
  // where the first row's second column did.
  const naive = (box.width - spec.gutterX * (nCols - 1)) / nCols;
  const shear = nRows > 1 ? (naive * spec.variation) / (nRows - 1) : 0;
  const totalShear = shear * (nRows - 1);

  const size = Math.max(1, (box.width - totalShear - spec.gutterX * (nCols - 1)) / nCols);
  const step = size + spec.gutterX;

  const out: Omit<GridCell, 'weight'>[] = [];
  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      out.push({
        x: box.x + row * shear + col * step,
        y: box.y + row * rows.step,
        width: size,
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
  const kind: GridKind = 'modular';
  return {
    kind,
    ...box,
    // From the kind's own table, not written out again here. The two disagreed:
    // this said 0.5 while `KIND_DEFAULTS.modular` said 0, so the grid you got by
    // drawing one was uneven and the grid you got by picking Modular was not.
    ...KIND_DEFAULTS[kind],
    margin: 0,
    seed: 1,
  };
}
