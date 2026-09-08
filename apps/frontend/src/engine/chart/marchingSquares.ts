/**
 * Level curves of a two-variable function, by marching squares.
 *
 * ## What this buys, and why it is one algorithm rather than two
 *
 * An **implicit plot** draws `F(x, y) = 0` — a conic, a Cassini oval, a folium
 * of Descartes, anything where `y` cannot be isolated. A **contour plot** draws
 * `f(x, y) = c` for several values of `c`. Those are the same question asked
 * once and asked repeatedly, so they are the same code: contours call this per
 * level and implicit curves call it once at zero.
 *
 * It is also the only way to draw the first of them at all. Every other plot in
 * this engine samples `y` from `x` and joins the results; an implicit curve has
 * no such function to sample, and the set of points satisfying it can be
 * disconnected, self-intersecting, or a single point. Sampling a grid and
 * finding where the sign changes is what makes those drawable.
 *
 * ## The saddle, and why the midpoint is worth a fifth evaluation
 *
 * Two of the sixteen cell cases are ambiguous: opposite corners inside the
 * level, the other two outside. The curve either passes as two arcs pinching
 * toward the centre or as two arcs pinching away, and the four corners cannot
 * distinguish them. Picking one arbitrarily is what produces the little
 * X-shaped stitches every naive implementation shows on a hyperbola.
 *
 * So the centre is evaluated and its sign decides. That is one extra call for
 * roughly one cell in twenty, and it is the difference between `x² − y² = 1`
 * drawn as two clean branches and drawn as two branches joined by a knot at
 * the origin.
 *
 * ## Interpolation
 *
 * A crossing is placed by linear interpolation between the two corner values
 * rather than at the edge midpoint. The function is close to linear across one
 * cell, so this costs nothing and removes the staircase that midpoint placement
 * leaves on any curve not aligned to the grid.
 */

export interface GridPoint {
  x: number;
  y: number;
}

/** One connected run of the level set. Not closed: a curve may leave the box. */
export type LevelSegment = [GridPoint, GridPoint];

export interface MarchOptions {
  /** The box to search, in the function's own units. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Cells per axis. Cost is quadratic in this, so it is capped by the caller. */
  resolution: number;
  /** The level to trace. Zero for an implicit curve. */
  level?: number;
}

/**
 * Every crossing segment of one level, as unordered pairs of points.
 *
 * Unordered and unlinked on purpose. Chaining them into polylines is a second
 * problem — it needs a spatial index to be fast and a tolerance to be correct —
 * and both painters draw a set of short segments perfectly well. A curve made
 * of a thousand two-point strokes is indistinguishable from one polyline at any
 * zoom this canvas reaches, and it cannot be knotted by a chaining bug.
 */
export function marchingSquares(
  f: (x: number, y: number) => number,
  options: MarchOptions
): LevelSegment[] {
  const level = options.level ?? 0;
  const n = Math.min(300, Math.max(4, Math.round(options.resolution)));

  const { xMin, xMax, yMin, yMax } = options;
  if (!(xMax > xMin) || !(yMax > yMin)) return [];

  const dx = (xMax - xMin) / n;
  const dy = (yMax - yMin) / n;

  // One row of samples is reused as the previous row of the next iteration, so
  // the grid costs (n+1)² evaluations rather than 4n².
  let below = new Float64Array(n + 1);
  let above = new Float64Array(n + 1);

  const sample = (ix: number, iy: number) => {
    const v = f(xMin + ix * dx, yMin + iy * dy);
    return Number.isFinite(v) ? v - level : Number.NaN;
  };

  for (let ix = 0; ix <= n; ix += 1) below[ix] = sample(ix, 0);

  const out: LevelSegment[] = [];

  for (let iy = 0; iy < n; iy += 1) {
    for (let ix = 0; ix <= n; ix += 1) above[ix] = sample(ix, iy + 1);

    for (let ix = 0; ix < n; ix += 1) {
      // Corner values, named by compass position of the cell.
      const sw = below[ix];
      const se = below[ix + 1];
      const nw = above[ix];
      const ne = above[ix + 1];

      // A cell touching a pole or an undefined region is skipped entirely: the
      // level set is not defined across it, and interpolating toward a NaN
      // corner would place a crossing at an arbitrary point.
      if (!Number.isFinite(sw) || !Number.isFinite(se) || !Number.isFinite(nw) || !Number.isFinite(ne)) {
        continue;
      }

      const x0 = xMin + ix * dx;
      const x1 = x0 + dx;
      const y0 = yMin + iy * dy;
      const y1 = y0 + dy;

      const code =
        (sw > 0 ? 1 : 0) | (se > 0 ? 2 : 0) | (ne > 0 ? 4 : 0) | (nw > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;

      // Crossing points on each edge, interpolated. Only the ones the case
      // needs are read, but computing them here keeps the switch readable and
      // the arithmetic is four subtractions.
      const bottom = (): GridPoint => ({ x: lerp(x0, x1, sw, se), y: y0 });
      const right = (): GridPoint => ({ x: x1, y: lerp(y0, y1, se, ne) });
      const top = (): GridPoint => ({ x: lerp(x0, x1, nw, ne), y: y1 });
      const left = (): GridPoint => ({ x: x0, y: lerp(y0, y1, sw, nw) });

      switch (code) {
        case 1:
        case 14:
          out.push([left(), bottom()]);
          break;
        case 2:
        case 13:
          out.push([bottom(), right()]);
          break;
        case 3:
        case 12:
          out.push([left(), right()]);
          break;
        case 4:
        case 11:
          out.push([right(), top()]);
          break;
        case 6:
        case 9:
          out.push([bottom(), top()]);
          break;
        case 7:
        case 8:
          out.push([left(), top()]);
          break;

        // The two ambiguous cases. The centre's sign says which way the pair
        // of arcs pinches; guessing produces the X-shaped stitch every naive
        // implementation shows on a hyperbola.
        case 5:
        case 10: {
          const centre = f((x0 + x1) / 2, (y0 + y1) / 2) - level;
          const joined = Number.isFinite(centre) ? centre > 0 : true;
          if ((code === 5) === joined) {
            out.push([left(), top()], [bottom(), right()]);
          } else {
            out.push([left(), bottom()], [right(), top()]);
          }
          break;
        }
      }
    }

    const swap = below;
    below = above;
    above = swap;
  }

  return out;
}

/** Where the level crosses between two corner samples. */
function lerp(a: number, b: number, va: number, vb: number): number {
  const span = va - vb;
  // Equal corners have no crossing to place; the midpoint is the only answer
  // that cannot be off the edge.
  if (span === 0 || !Number.isFinite(span)) return (a + b) / 2;
  return a + ((b - a) * va) / span;
}

/**
 * A spread of contour levels across what the function actually reaches.
 *
 * Sampled on a coarse grid rather than taken from the axis bounds, because the
 * interesting range of `f` has nothing to do with the range of `x` and `y` —
 * `sin(x)·cos(y)` on a ±5 box lives entirely in [−1, 1], and levels spread over
 * ±5 would draw one line.
 */
export function contourLevels(
  f: (x: number, y: number) => number,
  box: { xMin: number; xMax: number; yMin: number; yMax: number },
  count: number
): number[] {
  const probe = 24;
  let lo = Infinity;
  let hi = -Infinity;

  for (let iy = 0; iy <= probe; iy += 1) {
    for (let ix = 0; ix <= probe; ix += 1) {
      const v = f(
        box.xMin + ((box.xMax - box.xMin) * ix) / probe,
        box.yMin + ((box.yMax - box.yMin) * iy) / probe
      );
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [0];

  const n = Math.min(40, Math.max(2, Math.round(count)));
  // Interior levels only: one exactly at the minimum traces the single point
  // where the surface bottoms out, which is a dot rather than a contour.
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (i + 1)) / (n + 1));
}

/**
 * Stitches a set of unordered level segments into continuous polylines.
 * Joins adjacent edges within a distance tolerance.
 */
export function stitchSegments(
  segments: LevelSegment[],
  tolerance = 1e-4
): GridPoint[][] {
  if (segments.length === 0) return [];

  const keyOf = (p: GridPoint) =>
    `${Math.round(p.x / tolerance)}:${Math.round(p.y / tolerance)}`;

  type Edge = { segIndex: number; p1: GridPoint; p2: GridPoint };
  const graph = new Map<string, Edge[]>();

  segments.forEach((seg, i) => {
    const k1 = keyOf(seg[0]);
    const k2 = keyOf(seg[1]);
    const edge: Edge = { segIndex: i, p1: seg[0], p2: seg[1] };
    if (!graph.has(k1)) graph.set(k1, []);
    if (!graph.has(k2)) graph.set(k2, []);
    graph.get(k1)!.push(edge);
    graph.get(k2)!.push(edge);
  });

  const visited = new Uint8Array(segments.length);
  const polylines: GridPoint[][] = [];

  for (let i = 0; i < segments.length; i += 1) {
    if (visited[i]) continue;
    visited[i] = 1;

    const line: GridPoint[] = [segments[i][0], segments[i][1]];

    // Extend forward from line[line.length - 1]
    let forwardGrowing = true;
    while (forwardGrowing) {
      forwardGrowing = false;
      const tail = line[line.length - 1];
      const edges = graph.get(keyOf(tail)) || [];
      for (const e of edges) {
        if (!visited[e.segIndex]) {
          visited[e.segIndex] = 1;
          const nextPt = Math.hypot(e.p1.x - tail.x, e.p1.y - tail.y) < Math.hypot(e.p2.x - tail.x, e.p2.y - tail.y)
            ? e.p2
            : e.p1;
          line.push(nextPt);
          forwardGrowing = true;
          break;
        }
      }
    }

    // Extend backward from line[0]
    let backwardGrowing = true;
    while (backwardGrowing) {
      backwardGrowing = false;
      const head = line[0];
      const edges = graph.get(keyOf(head)) || [];
      for (const e of edges) {
        if (!visited[e.segIndex]) {
          visited[e.segIndex] = 1;
          const prevPt = Math.hypot(e.p1.x - head.x, e.p1.y - head.y) < Math.hypot(e.p2.x - head.x, e.p2.y - head.y)
            ? e.p2
            : e.p1;
          line.unshift(prevPt);
          backwardGrowing = true;
          break;
        }
      }
    }

    polylines.push(line);
  }

  return polylines;
}

