/**
 * Track sizing and spans for the regular kinds (`columns`, `modular`).
 *
 * A track is sized one of three ways, the same three CSS grid and Figma's
 * layout grids offer:
 *
 * - `{ px }`: a fixed size in board units.
 * - `{ fr }`: a share of whatever the fixed and auto tracks leave over.
 * - `'auto'`: sized by the content in it. The layout itself cannot see
 *   content, so an auto track takes the size the caller measured for it, and
 *   falls back to one share when nothing was measured.
 *
 * Pure and total like the rest of the layout: any input produces tracks whose
 * sizes are finite and at least one unit, so a grid under a live drag never
 * produces `NaN` cells.
 */

export type GridTrack = { fr: number } | { px: number } | 'auto';

/** How far a module reaches past its own track, in tracks. */
export interface GridSpan {
  rows: number;
  cols: number;
}

/** Inset from the grid's box, per side. */
export interface GridPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ResolvedTrack {
  offset: number;
  size: number;
}

/** The most tracks an axis may carry; matches the normaliser's track count cap. */
export const MAX_TRACKS = 200;

const finitePositive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Lay out `count` tracks across `total`, with `gutter` between them.
 *
 * `tracks` may be shorter or longer than `count`: missing entries are `1fr`,
 * extra entries are ignored. `measured[i]` is the content size of track `i`
 * for `'auto'` tracks.
 *
 * Fixed and auto tracks are honoured first. If they alone overflow the space,
 * they are scaled down together so the run still fits the box, because a
 * track run that overflows its own box makes the box a lie; the fractional
 * tracks then get the minimum size.
 */
export function resolveTracks(
  total: number,
  count: number,
  gutter: number,
  tracks: readonly GridTrack[] | undefined,
  measured?: readonly (number | undefined)[]
): ResolvedTrack[] {
  const n = Math.max(1, Math.min(MAX_TRACKS, Math.floor(count)));
  const usable = Math.max(1, total - gutter * (n - 1));

  const fixed: (number | null)[] = [];
  const shares: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = tracks?.[i] ?? { fr: 1 };
    if (t === 'auto') {
      const m = measured?.[i];
      if (finitePositive(m)) {
        fixed.push(m);
        shares.push(0);
      } else {
        fixed.push(null);
        shares.push(1);
      }
    } else if ('px' in t) {
      fixed.push(finitePositive(t.px) ? t.px : 1);
      shares.push(0);
    } else {
      fixed.push(null);
      shares.push(finitePositive(t.fr) ? t.fr : 1);
    }
  }

  const fixedSum = fixed.reduce<number>((a, b) => a + (b ?? 0), 0);
  const shareSum = shares.reduce((a, b) => a + b, 0);
  const leftover = Math.max(0, usable - fixedSum);
  // Fixed tracks that cannot all fit are scaled together; nothing else is.
  const fixedScale = fixedSum > usable && fixedSum > 0 ? usable / fixedSum : 1;

  let at = 0;
  const out: ResolvedTrack[] = [];
  for (let i = 0; i < n; i += 1) {
    const f = fixed[i];
    const size =
      f !== null
        ? Math.max(1, f * fixedScale)
        : Math.max(1, shareSum > 0 ? (leftover * shares[i]) / shareSum : leftover / n);
    out.push({ offset: at, size });
    at += size + gutter;
  }
  return out;
}

/** Whether any track on an axis is something other than an even share. */
export function hasExplicitTracks(tracks: readonly GridTrack[] | undefined): boolean {
  return Array.isArray(tracks) && tracks.length > 0;
}

/** The key a span is stored under: its anchor's row and column. */
export const spanKey = (row: number, col: number): string => `${row}:${col}`;

export interface SpanCell {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

/**
 * The modules of an `nRows` by `nCols` grid once spans are applied.
 *
 * Row-major. A span is clamped to the grid and shrunk until it overlaps no
 * module placed before it, so overlapping or stale spans (left behind after a
 * track was removed) degrade to smaller modules rather than to a broken grid.
 * Every track position ends up covered exactly once.
 */
export function applySpans(
  nRows: number,
  nCols: number,
  spans: Readonly<Record<string, GridSpan>> | undefined
): SpanCell[] {
  const taken = Array.from({ length: nRows }, () => new Array<boolean>(nCols).fill(false));
  const out: SpanCell[] = [];
  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      if (taken[row][col]) continue;
      const want = spans?.[spanKey(row, col)];
      let rows = Math.max(1, Math.min(nRows - row, Math.floor(want?.rows ?? 1)));
      let cols = Math.max(1, Math.min(nCols - col, Math.floor(want?.cols ?? 1)));
      // Shrink columns first, then rows, until the block is free.
      const free = (h: number, w: number) => {
        for (let r = row; r < row + h; r += 1) for (let c = col; c < col + w; c += 1) if (taken[r][c]) return false;
        return true;
      };
      while (cols > 1 && !free(rows, cols)) cols -= 1;
      while (rows > 1 && !free(rows, cols)) rows -= 1;
      for (let r = row; r < row + rows; r += 1) for (let c = col; c < col + cols; c += 1) taken[r][c] = true;
      out.push({ row, col, rows, cols });
    }
  }
  return out;
}

/**
 * Merge a rectangular block of modules into one.
 *
 * Any span that intersects the block is removed, and the block's top-left
 * becomes the anchor of a span covering it. Returns a new map; the input is
 * not changed.
 */
export function mergeSpans(
  spans: Readonly<Record<string, GridSpan>> | undefined,
  block: { row: number; col: number; rows: number; cols: number }
): Record<string, GridSpan> {
  const next: Record<string, GridSpan> = {};
  for (const [key, span] of Object.entries(spans ?? {})) {
    const [r, c] = key.split(':').map(Number);
    const intersects =
      r < block.row + block.rows && r + span.rows > block.row && c < block.col + block.cols && c + span.cols > block.col;
    if (!intersects) next[key] = span;
  }
  if (block.rows > 1 || block.cols > 1) {
    next[spanKey(block.row, block.col)] = { rows: block.rows, cols: block.cols };
  }
  return next;
}

/** Undo a merge: the span anchored at `row:col` goes back to single modules. */
export function splitSpan(
  spans: Readonly<Record<string, GridSpan>> | undefined,
  row: number,
  col: number
): Record<string, GridSpan> {
  const next = { ...(spans ?? {}) };
  delete next[spanKey(row, col)];
  return next;
}

/**
 * The spans a laid-out grid would need to reproduce its modules as a regular
 * grid. Used to pin a bento layout before its modules are edited by hand, so
 * an edit changes one module rather than reshuffling the bag.
 */
export function spansFromModules(
  modules: readonly { row: number; col: number; rows: number; cols: number }[]
): Record<string, GridSpan> {
  const out: Record<string, GridSpan> = {};
  for (const m of modules) {
    if (m.rows > 1 || m.cols > 1) out[spanKey(m.row, m.col)] = { rows: m.rows, cols: m.cols };
  }
  return out;
}

/** Read a track list off the wire. Unknown entries become `1fr`. */
export function normalizeTracks(raw: unknown): GridTrack[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.slice(0, MAX_TRACKS).map((t): GridTrack => {
    if (t === 'auto') return 'auto';
    if (t && typeof t === 'object') {
      const o = t as Record<string, unknown>;
      if (finitePositive(o.px)) return { px: Math.min(o.px, 100_000) };
      if (finitePositive(o.fr)) return { fr: Math.min(o.fr, 1000) };
    }
    return { fr: 1 };
  });
}

/** Read a span map off the wire. Malformed keys and non-positive spans are dropped. */
export function normalizeSpans(raw: unknown): Record<string, GridSpan> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, GridSpan> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{1,3}:\d{1,3}$/.test(key)) continue;
    const v = value as Record<string, unknown> | null;
    const rows = Math.floor(Number(v?.rows));
    const cols = Math.floor(Number(v?.cols));
    if (!(rows >= 1 && cols >= 1) || (rows === 1 && cols === 1)) continue;
    out[key] = { rows: Math.min(rows, MAX_TRACKS), cols: Math.min(cols, MAX_TRACKS) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Read padding off the wire; absent when every side is zero. */
export function normalizePadding(raw: unknown): GridPadding | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const side = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(400, Math.max(0, v)) : 0;
  const p = { top: side(o.top), right: side(o.right), bottom: side(o.bottom), left: side(o.left) };
  return p.top || p.right || p.bottom || p.left ? p : undefined;
}
