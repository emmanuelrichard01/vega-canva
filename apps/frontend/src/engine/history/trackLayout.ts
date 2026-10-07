import type { Moment } from './sessionTimeline';
import type { ReplaySession } from './sessions';

/**
 * The timeline track's geometry: wall-clock time, with the idle gaps between
 * sessions cut out.
 *
 * Pure wall-clock time would give an afternoon's pause most of the track and
 * squash the work on either side into slivers; pure index spacing cannot show
 * when anything happened. So each session is drawn **to scale inside its own
 * segment**, segments are sized by duration (with a floor, so a two-minute
 * session is still something you can hit), and the time between sessions is
 * a fixed small break. Everything is in 0..1 track units.
 */
export interface TrackSegment {
  x0: number;
  x1: number;
}

export interface TrackLayout {
  segments: TrackSegment[];
  /** x of each moment, ascending. */
  xs: Float64Array;
}

export interface LayoutOptions {
  /** Width of the break between two sessions. */
  gap?: number;
  /** Smallest share of the track a session may take. */
  minShare?: number;
}

export function layoutTrack(
  moments: readonly Moment[],
  sessions: readonly ReplaySession[],
  options: LayoutOptions = {}
): TrackLayout {
  const xs = new Float64Array(moments.length);
  const n = sessions.length;
  if (n === 0) return { segments: [], xs };

  const gap = n > 1 ? Math.min(options.gap ?? 0.018, 0.3 / (n - 1)) : 0;
  const available = 1 - gap * (n - 1);
  const floor = Math.min(options.minShare ?? 0.06, available / n);

  const durations = sessions.map((s) => Math.max(0, s.endAt - s.startAt));
  const total = durations.reduce((a, b) => a + b, 0);
  // Shares by duration, then lifted to the floor and renormalised to fit.
  let shares = durations.map((d) => (total > 0 ? d / total : 1 / n));
  const lifted = shares.map((s) => Math.max(s, floor / available));
  const sum = lifted.reduce((a, b) => a + b, 0);
  shares = lifted.map((s) => s / sum);

  const segments: TrackSegment[] = [];
  let x = 0;
  sessions.forEach((session, si) => {
    const width = shares[si] * available;
    const segment = { x0: x, x1: x + width };
    segments.push(segment);
    const span = session.endAt - session.startAt;
    const count = session.last - session.first;
    for (let i = session.first; i <= session.last; i++) {
      const t =
        span > 0
          ? (moments[i].at - session.startAt) / span
          : count > 0
            ? (i - session.first) / count
            : 0.5;
      xs[i] = segment.x0 + Math.min(1, Math.max(0, t)) * width;
    }
    x += width + gap;
  });
  return { segments, xs };
}

/**
 * The moment nearest `x`, optionally among `candidates` (sorted moment
 * indices, as for per-object history). Binary search on the ascending xs.
 */
export function nearestMoment(layout: TrackLayout, x: number, candidates?: readonly number[] | null): number {
  const pool = candidates ?? null;
  const size = pool ? pool.length : layout.xs.length;
  if (size === 0) return -1;
  const xAt = (k: number) => layout.xs[pool ? pool[k] : k];
  let lo = 0;
  let hi = size - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xAt(mid) < x) lo = mid + 1;
    else hi = mid;
  }
  let best = lo;
  if (lo > 0 && Math.abs(xAt(lo - 1) - x) <= Math.abs(xAt(lo) - x)) best = lo - 1;
  return pool ? pool[best] : best;
}

/**
 * Edit density in `columns` equal slices of the track, 0..1 against the
 * busiest column, weighted by raw transactions so a long drag reads heavier
 * than a single click. Square-rooted, so one frantic burst does not flatten
 * everything else to nothing, then smoothed.
 */
export function densityColumns(
  moments: readonly Moment[],
  layout: TrackLayout,
  columns: number,
  only?: readonly number[] | null
): Float64Array {
  const out = new Float64Array(Math.max(0, columns));
  if (columns <= 0) return out;
  const add = (i: number) => {
    const col = Math.min(columns - 1, Math.max(0, Math.floor(layout.xs[i] * columns)));
    out[col] += moments[i].updateCount;
  };
  if (only) only.forEach(add);
  else for (let i = 0; i < moments.length; i++) add(i);
  for (let i = 0; i < columns; i++) out[i] = Math.sqrt(out[i]);
  // Two passes of a binomial kernel turn single-column spikes into hills
  // that read at a glance, and keep a burst's position.
  const radius = Math.max(1, Math.round(columns / 90));
  const smoothed = smooth(smooth(out, radius), radius);
  let max = 0;
  for (let i = 0; i < columns; i++) if (smoothed[i] > max) max = smoothed[i];
  if (max > 0) for (let i = 0; i < columns; i++) smoothed[i] /= max;
  return smoothed;
}

function smooth(values: Float64Array, radius: number): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const w = radius + 1 - Math.abs(k);
      sum += values[j] * w;
      weight += w;
    }
    out[i] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

/**
 * An SVG area path for density columns across a `width` × `height` box,
 * baseline at the bottom. Empty columns sit on the baseline, so quiet
 * stretches read as quiet rather than missing.
 */
export function sparklinePath(columns: Float64Array, width: number, height: number): string {
  const n = columns.length;
  if (n === 0) return '';
  const step = width / n;
  let d = `M0 ${height}`;
  for (let i = 0; i < n; i++) {
    const y = height - columns[i] * height;
    d += ` L${((i + 0.5) * step).toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d} L${width} ${height} Z`;
}
