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

import type { Point } from '../model/schema';

export type GridKind =
  | 'columns'
  | 'modular'
  | 'bento'
  | 'masonry'
  | 'hierarchical'
  | 'manuscript'
  | 'baseline'
  | 'golden'
  /**
   * Modules stepped around concentric rings, each one an upright shape.
   *
   * Called `radial` until the arrangement it draws and the name it carried were
   * separated: this one *orbits* a centre, while `radial` proper radiates from
   * it -- wedges whose edges point at the middle. Two genuinely different
   * arrangements were sharing one word, and the icon could only ever be honest
   * about one of them.
   */
  | 'orbit'
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
  /**
   * How far each ring is turned relative to the one inside it, in steps.
   *
   * Zero leaves every ring's divisions on the same spokes, which is a wheel:
   * correct, symmetrical, and completely static. Half a step drops the next
   * ring's joins into the middle of this one's modules -- brickwork, wrapped
   * round a circle -- and the arrangement stops reading as one wheel and starts
   * reading as several. Anything in between is the deliberate near-miss that
   * makes a dial look drawn rather than generated.
   *
   * Measured in the ring's **own** step rather than in degrees, so the effect
   * survives a change of spoke count: half a step is half a module whether
   * there are six of them or twenty.
   *
   * Read by `radial` and `orbit`, the two kinds that have rings to turn.
   * Absent is zero.
   */
  stagger?: number;
  /**
   * Fuse a ring's sectors into one unbroken band. `radial` only.
   *
   * The Apple Park move: the same division of the circle, drawn as a single
   * closed ring rather than as nine pieces with daylight between them. It is a
   * genuinely different object -- one module per ring instead of `columns` of
   * them -- so it belongs to the layout rather than to the styling, and every
   * count, colour and radius control downstream reads it as such.
   *
   * Absent is off, so nothing already on a board changes shape.
   */
  merged?: boolean;
}

export interface GridCell {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The cell's real silhouette, when a box does not describe it.
   *
   * Points in the cell's **own** coordinates -- `(0, 0)` is its top-left corner
   * -- so a cell carrying one is still positioned, measured, culled and
   * bounded exactly like every other. Absent on every kind but `radial`, which
   * is the one whose modules are ring sectors rather than upright shapes.
   *
   * A polyline rather than a curve on purpose. The arcs are sampled finely
   * enough that no zoom this canvas supports reveals a facet, and a polyline
   * costs one branch in the four places a cell is drawn -- the renderer, the
   * SVG exporter, the panel swatches and break-apart -- where a curve type
   * would cost a conversion in each.
   */
  outline?: readonly Point[];
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
  'manuscript', 'baseline', 'golden', 'orbit', 'radial', 'diagonal',
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
  orbit: 'Orbit',
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
  orbit: 'Modules stepped around concentric rings. For anything that circles a centre.',
  radial: 'Wedges radiating from the middle, cut from a ring. For cycles, phases and stages.',
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
  // Four, not twelve. A twelve-column grid is a *measure* you place things
  // against, and this tool draws the tracks as objects -- so twelve of them is
  // twelve tall slivers rather than the four broad columns anyone picturing a
  // column layout has in mind.
  columns: { rows: 1, columns: 4, variation: 0, gutterX: 16, gutterY: 16 },
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
  orbit: { rows: 3, columns: 12, variation: 0.3, gutterX: 6, gutterY: 6 },
  /**
   * One ring of nine, which is what a segmented ring wants to be.
   *
   * Sectors tile the circle exactly, so unlike every other kind here the
   * spoke count is a *statement* rather than a density: nine reads as a
   * deliberate division, twelve as a clock face, four as a pie chart. Two rings
   * is a sunburst and worth reaching for; three is a diagram nobody can read,
   * so the default stays at one.
   */
  radial: { rows: 1, columns: 9, variation: 0.45, gutterX: 8, gutterY: 8 },
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
  orbit: 'Centre hole',
  // The dial's one real decision: a fat ring at the low end, a thin band at the
  // high one. Nothing else about a sector is a matter of degree.
  radial: 'Ring width',
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
const MASONRY_RATIOS: readonly number[] = [2.6, 1.9, 1.4, 1, 0.7, 0.48];

/**
 * How far past the ratios above the dial is allowed to push.
 *
 * The blend used to stop at the drawn ratio: at full variation a 2.4x card was
 * 2.4x, and the whole interesting half of the range sat above 0.6 -- below
 * that it read as a modular grid with untidy rows, which is most of the dial
 * spent saying nothing.
 *
 * Extrapolating rather than interpolating fixes both ends at once. Sixty per
 * cent now lands where the old maximum did, and the maximum goes half again
 * beyond it: a 2.6x card becomes 3.7x, a 0.48x card becomes 0.12x, and a wall
 * at the top of the dial is genuinely wild rather than merely uneven.
 */
const MASONRY_SPREAD = 1.7;

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
  // Below this a trimmed card stops reading as a card and starts reading as a
  // mistake, so the column gives its remainder to the one before instead.
  const minCard = baseHeight * 0.35;

  for (let col = 0; col < nCols; col += 1) {
    /**
     * Each column runs at its own scale.
     *
     * Per-card randomness alone was not enough: every column drawing from one
     * distribution landed on about the same count, and similar counts over the
     * same height put the boundaries back at about the same depths.
     */
    const spread = spec.variation * MASONRY_SPREAD;
    const columnScale = 1 + (next() - 0.5) * 2 * spread * 0.4;

    /**
     * Cards at their drawn heights, stacked from the top until the column is
     * full. The count falls out of the draw.
     */
    const cards: number[] = [];
    const extent = () =>
      cards.reduce((a, b) => a + b, 0) + spec.gutterY * Math.max(0, cards.length - 1);

    while (extent() < box.height - 0.5 && cards.length < MASONRY_MAX_CARDS) {
      const drawn = MASONRY_RATIOS[Math.floor(next() * MASONRY_RATIOS.length)];
      // Blended toward 1 by `variation`, so the dial runs from a modular grid
      // to a full card wall rather than switching between them.
      // Floored, not clamped to the drawn set: extrapolation past 1 can take a
      // short card below a tenth of the base, and a card you cannot see is not
      // a bolder layout, it is a gap.
      const ratio = Math.max(0.26, 1 + (drawn - 1) * spread) * columnScale;
      cards.push(Math.max(1, ratio * baseHeight));
    }

    /**
     * Only the **last** card is adjusted to meet the bottom edge.
     *
     * This is the whole difference between masonry and a modular grid with
     * untidy rows, and the previous version had it backwards: it normalised
     * every card in the column so they summed to the height exactly. Scaling a
     * whole column by a constant leaves the *proportions* untouched -- which
     * divided the column's own scale straight back out, so the one lever that
     * was supposed to set columns against each other reached the drawing as
     * nothing but a different card count.
     *
     * Keeping the drawn heights and trimming one card is what real feeds do,
     * and it means a card at 2.4x is genuinely 2.4x its neighbour rather than
     * 2.4x within a column that was then squashed to match.
     */
    const over = extent() - box.height;
    if (over > 0 && cards.length > 0) {
      const last = cards.length - 1;
      cards[last] -= over;
      if (cards[last] < minCard && cards.length > 1) {
        // Too short to be a card: fold it into the one before rather than
        // leaving a sliver against the bottom edge.
        cards.pop();
        const rest = cards.slice(0, -1).reduce((a, b) => a + b, 0);
        cards[cards.length - 1] = Math.max(
          1,
          box.height - rest - spec.gutterY * (cards.length - 1)
        );
      }
    }

    let y = box.y;
    cards.forEach((h, row) => {
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
function orbit(spec: GridSpec): Omit<GridCell, 'weight'>[] {
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

    // Each ring turned a little further than the one inside it -- see
    // `stagger`. Zero keeps the blocks on shared spokes, which is a wheel; a
    // half step interleaves them, which is a nest.
    const twist = ((Math.PI * 2) / spokes) * (spec.stagger ?? 0) * ring;

    for (let spoke = 0; spoke < spokes; spoke += 1) {
      // From twelve o'clock, because that is where anyone reading a dial starts
      // -- and where the kind's own icon puts its first block.
      const angle = (spoke / spokes) * Math.PI * 2 - Math.PI / 2 + twist;
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
 * Round a polygon's corners, in place of the corners.
 *
 * ## Why a general rounder and not a sector-shaped one
 *
 * The four corners of a ring sector are not alike: two sit on arcs, two on
 * straight radial edges, and the angle between them changes with the ring, the
 * spoke count and the gutter. Special-casing them meant four fillet formulas
 * and four ways to be subtly wrong at the extremes -- a two-spoke "ring" whose
 * sector is a half-disc, a hole so small the inner arc is nearly a point.
 *
 * Rounding by *turn angle* instead has one rule with no cases in it: a vertex
 * the outline barely turns at is left alone, and a vertex it turns hard at is
 * replaced by a fillet. The sampled arcs turn by a fraction of a degree per
 * point and pass straight through; the four real corners turn by tens of
 * degrees and get rounded. Which vertices those are never has to be known.
 *
 * The fillet is a quadratic Bezier through the trim points with the corner as
 * its control, sampled. That is not an exact circular arc -- it is a parabola --
 * and at fillet sizes anyone would use the difference is well under a pixel,
 * while the arithmetic is four lines that cannot produce a `NaN`.
 *
 * @param radius how far to cut back from each corner, in board units.
 */
export function roundPolygon(points: readonly Point[], radius: number, samples = 5): Point[] {
  if (radius <= 0 || points.length < 3) return points.slice();

  const out: Point[] = [];
  const n = points.length;

  for (let i = 0; i < n; i += 1) {
    const cur = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];

    const inX = prev.x - cur.x;
    const inY = prev.y - cur.y;
    const outX = next.x - cur.x;
    const outY = next.y - cur.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    if (inLen < 1e-9 || outLen < 1e-9) continue;

    // How sharply the outline turns here, as the cosine between the two edges.
    // Near -1 is a straight line -- an arc sample -- and is left as it is.
    const cos = (inX * outX + inY * outY) / (inLen * outLen);
    if (cos < -0.98) {
      out.push(cur);
      continue;
    }

    // Never more than half an edge, or two adjacent fillets would overlap and
    // the outline would fold back through itself.
    const t = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: cur.x + (inX / inLen) * t, y: cur.y + (inY / inLen) * t };
    const b = { x: cur.x + (outX / outLen) * t, y: cur.y + (outY / outLen) * t };

    for (let k = 0; k <= samples; k += 1) {
      const u = k / samples;
      const v = 1 - u;
      out.push({
        x: v * v * a.x + 2 * v * u * cur.x + u * u * b.x,
        y: v * v * a.y + 2 * v * u * cur.y + u * u * b.y,
      });
    }
  }

  return out;
}

/** How finely an arc is sampled, per radian. Well past what any zoom reveals. */
const ARC_SAMPLES_PER_RADIAN = 16;

/**
 * Radial: wedges cut from a ring.
 *
 * ## What this is, and what `orbit` is
 *
 * The two were one kind called `radial`, and it drew neither of them
 * convincingly. It stepped **upright squares** around a circle, so at any
 * useful gutter the modules read as a scattered necklace of dots rather than as
 * a divided ring -- and the kind's own icon, a segmented annulus, promised the
 * thing it could not draw. Told about it, the honest fix was not a better icon:
 * it was that a segmented ring and a ring of objects are two different
 * arrangements, both worth having, sharing one name.
 *
 * So `orbit` keeps the necklace, which is genuinely what you want for a set of
 * photographs or logos arranged around a hub, and `radial` draws the picture
 * the icon always showed: sectors whose straight edges point at the centre and
 * whose curved edges follow the ring.
 *
 * ## Why the modules carry an outline
 *
 * A sector is not a box and cannot be approximated by one -- that approximation
 * *was* the old kind. So the cell keeps its bounding box for placement and
 * culling, and carries its real silhouette in `outline`. It is the first kind
 * to need one, and the reason `GridCell.outline` exists.
 *
 * ## The gutter, in two units at once
 *
 * The gap between two sectors on the same ring is an **angle**; the gap between
 * two rings is a **length**. A single gutter measured in pixels therefore has
 * to be converted for one of them, and it is converted at the sector's mid
 * radius -- so the gap looks even along the sector's face rather than pinching
 * shut at the inner edge and yawning at the outer.
 */
function radial(spec: GridSpec): Omit<GridCell, 'weight'>[] {
  const box = inner(spec);
  const rings = Math.max(1, Math.floor(spec.rows));
  // Two is a ring cut in half, which is still a ring. One is a disc with a
  // hole, which is not a grid -- and is what a spoke count of one would draw.
  const spokes = Math.max(2, Math.floor(spec.columns));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const maxR = Math.min(box.width, box.height) / 2;
  if (maxR <= 0) return [];

  /**
   * How much of the disc is hole.
   *
   * The one control that changes what the thing *is*: a hole at 0.14 is a pie
   * chart with a dot missing, at 0.7 a thin dial. `variation` runs it across
   * that whole range because there is no other dimension of a sector worth a
   * slider -- the count is exact and the gutter is a gutter.
   */
  const hole = maxR * (0.14 + spec.variation * 0.56);
  const band = (maxR - hole) / rings;
  if (band <= 0) return [];

  const step = (Math.PI * 2) / spokes;
  const out: Omit<GridCell, 'weight'>[] = [];

  for (let ring = 0; ring < rings; ring += 1) {
    // The radial gutter is split between the two rings that share the gap, so
    // asking for eight pixels of gap gets eight, not sixteen.
    const r0 = hole + band * ring + (ring === 0 ? 0 : spec.gutterY / 2);
    const r1 = hole + band * (ring + 1) - (ring === rings - 1 ? 0 : spec.gutterY / 2);
    if (r1 - r0 < 1) continue;

    /**
     * The angular gutter, measured where the eye reads it.
     *
     * At the mid radius, so the gap is `gutterX` wide across the middle of the
     * sector's face. Measured at `r0` the outer ends would splay apart; at `r1`
     * the inner ends would collide. Capped below half the step, because a
     * gutter wider than the sector is not a wide gutter -- it is no sector.
     */
    const mid = (r0 + r1) / 2;
    const gapAngle = Math.min(spec.gutterX / Math.max(mid, 1), step * 0.6);

    /**
     * Merged: one band per ring, with a real hole in it.
     *
     * ## Why this is not "the same sectors with no gutter"
     *
     * Zero gutter puts the sectors edge to edge, and at a glance that is a
     * continuous ring -- until you give them different colours, or a stroke, or
     * a corner radius, and it becomes nine pieces again with seams down every
     * join. What the shape actually wants to be is one closed band, and only
     * one module can be that.
     *
     * ## The hole, without a second contour
     *
     * An annulus needs two loops: the outside and the hole. `outline` carries a
     * single polygon, and widening it to a list of contours would cost a branch
     * in the renderer, the exporter, the panel preview and break-apart -- four
     * files, for one shape.
     *
     * The keyhole does it with one. Run the outer circle, cut straight in to
     * the inner circle, run that the *opposite* way round, and cut back out
     * along the same line. The two cuts lie exactly on top of each other, so the
     * seam is invisible, and the reversed winding makes the middle unfilled
     * under either fill rule. A trick as old as vector fonts, and the reason the
     * letter O has never needed a special case.
     */
    if (spec.merged) {
      const steps = Math.max(24, Math.ceil(Math.PI * 2 * ARC_SAMPLES_PER_RADIAN));
      const points: Point[] = [];
      const start = -Math.PI / 2;
      for (let k = 0; k <= steps; k += 1) {
        const a = start + (Math.PI * 2 * k) / steps;
        points.push({ x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 });
      }
      for (let k = steps; k >= 0; k -= 1) {
        const a = start + (Math.PI * 2 * k) / steps;
        points.push({ x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0 });
      }

      const minX = cx - r1;
      const minY = cy - r1;
      out.push({
        x: minX,
        y: minY,
        width: r1 * 2,
        height: r1 * 2,
        row: ring,
        // One module, so one column. A merged ring answers "how many modules"
        // with its ring count, and the spoke count stops meaning anything --
        // which is why the panel hides that stepper when this is on.
        col: 0,
        outline: points.map((pt) => ({ x: pt.x - minX, y: pt.y - minY })),
      });
      continue;
    }

    // Ring zero is the reference, so the innermost ring always starts at twelve
    // o'clock and the offset accumulates outward. Turning every ring including
    // the first would rotate the whole dial, which is a different control.
    const twist = step * (spec.stagger ?? 0) * ring;

    for (let spoke = 0; spoke < spokes; spoke += 1) {
      // Centred on twelve o'clock, like every dial anyone has ever read, and
      // like the kind's own icon.
      const centre = spoke * step - Math.PI / 2 - step / 2 + twist;
      const a0 = centre + gapAngle / 2;
      const a1 = centre + step - gapAngle / 2;
      if (a1 <= a0) continue;

      const steps = Math.max(2, Math.ceil((a1 - a0) * ARC_SAMPLES_PER_RADIAN));
      const points: Point[] = [];
      // Out along the far edge, back along the near one: one closed loop, wound
      // consistently so a fill rule never has to guess.
      for (let k = 0; k <= steps; k += 1) {
        const a = a0 + ((a1 - a0) * k) / steps;
        points.push({ x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 });
      }
      for (let k = steps; k >= 0; k -= 1) {
        const a = a0 + ((a1 - a0) * k) / steps;
        points.push({ x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0 });
      }

      const minX = Math.min(...points.map((pt) => pt.x));
      const minY = Math.min(...points.map((pt) => pt.y));
      const maxX = Math.max(...points.map((pt) => pt.x));
      const maxY = Math.max(...points.map((pt) => pt.y));

      out.push({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        row: ring,
        col: spoke,
        // Relative to the cell's own box, so the cell can be moved, measured
        // and drawn by code that knows nothing about rings.
        outline: points.map((pt) => ({ x: pt.x - minX, y: pt.y - minY })),
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
  columns, modular, bento, masonry, hierarchical, manuscript, baseline, golden, orbit, radial, diagonal,
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
