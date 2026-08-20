import React from 'react';
import type { GridKind } from '../../engine/grid/gridLayout';

/**
 * Each grid system, drawn as itself.
 *
 * ## Why these are miniatures rather than a shared glyph
 *
 * A grid system is a *picture*, and it is the only thing about it anyone
 * actually chooses on. Ten entries behind ten copies of a generic grid icon
 * would make the picker a list of words — and the words are the part people are
 * least sure about, since "hierarchical" and "modular" mean nothing until you
 * have seen one. Six rectangles arranged correctly say it instantly, and the
 * hint line beneath then explains *why* rather than *what*.
 *
 * Drawn at 16×16 on a shared 100-unit viewBox so the strokes match the lucide
 * icons beside them at any size.
 */

const Cell: React.FC<{ x: number; y: number; w: number; h: number; solid?: boolean }> = ({ x, y, w, h, solid }) => (
  <rect
    x={x}
    y={y}
    width={w}
    height={h}
    rx={6}
    fill={solid ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={solid ? 0 : 8}
    opacity={solid ? 0.9 : 0.75}
  />
);

/** A regular r×c lattice, which most of these are variations on. */
function lattice(rows: number, cols: number, gap = 8) {
  const w = (100 - gap * (cols - 1)) / cols;
  const h = (100 - gap * (rows - 1)) / rows;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({ x: c * (w + gap), y: r * (h + gap), w, h });
    }
  }
  return out;
}

const SHAPES: Record<GridKind, React.ReactNode> = {
  columns: <>{lattice(1, 4).map((c, i) => <Cell key={i} {...c} />)}</>,
  modular: <>{lattice(3, 3).map((c, i) => <Cell key={i} {...c} />)}</>,
  bento: (
    <>
      <Cell x={0} y={0} w={58} h={58} solid />
      <Cell x={66} y={0} w={34} h={26} />
      <Cell x={66} y={32} w={34} h={26} />
      <Cell x={0} y={66} w={26} h={34} />
      <Cell x={34} y={66} w={66} h={34} />
    </>
  ),
  masonry: (
    <>
      <Cell x={0} y={0} w={28} h={44} />
      <Cell x={0} y={52} w={28} h={48} />
      <Cell x={36} y={0} w={28} h={64} />
      <Cell x={36} y={72} w={28} h={28} />
      <Cell x={72} y={0} w={28} h={30} />
      <Cell x={72} y={38} w={28} h={62} />
    </>
  ),
  hierarchical: (
    <>
      <Cell x={0} y={0} w={64} h={64} solid />
      <Cell x={72} y={0} w={28} h={28} />
      <Cell x={72} y={36} w={28} h={28} />
      <Cell x={0} y={72} w={28} h={28} />
      <Cell x={36} y={72} w={28} h={28} />
      <Cell x={72} y={72} w={28} h={28} />
    </>
  ),
  manuscript: <Cell x={16} y={16} w={68} h={68} />,
  baseline: (
    <>
      <Cell x={0} y={0} w={100} h={18} />
      <Cell x={0} y={26} w={100} h={30} />
      <Cell x={0} y={64} w={100} h={14} />
      <Cell x={0} y={86} w={100} h={14} />
    </>
  ),
  golden: (
    <>
      <Cell x={0} y={0} w={60} h={100} solid />
      <Cell x={68} y={0} w={32} h={60} />
      <Cell x={68} y={68} w={20} h={32} />
      <Cell x={92} y={68} w={8} h={32} />
    </>
  ),
  radial: (
    <>
      <circle cx={50} cy={50} r={38} fill="none" stroke="currentColor" strokeWidth={6} opacity={0.3} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        return <Cell key={i} x={50 + Math.cos(a) * 38 - 11} y={50 + Math.sin(a) * 38 - 11} w={22} h={22} solid />;
      })}
    </>
  ),
  diagonal: (
    <>
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => (
          <Cell key={`${row}-${col}`} x={col * 30 + row * 8} y={row * 34} w={26} h={26} />
        ))
      )}
    </>
  ),
};

export const GridKindIcon: React.FC<{ kind: GridKind; size?: number }> = ({ kind, size = 15 }) => (
  <svg width={size} height={size} viewBox="-4 -4 108 108" aria-hidden focusable="false">
    {SHAPES[kind]}
  </svg>
);
