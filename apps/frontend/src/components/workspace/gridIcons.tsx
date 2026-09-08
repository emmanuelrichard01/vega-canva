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
  /* Compartments, none of them the main one -- which is the whole difference
     from `hierarchical` below, and the icon has to say so or the two read as
     the same thing before they are even tried. */
  bento: (
    <>
      <Cell x={0} y={0} w={44} h={44} />
      <Cell x={52} y={0} w={20} h={20} />
      <Cell x={80} y={0} w={20} h={20} />
      <Cell x={52} y={28} w={48} h={16} />
      <Cell x={0} y={52} w={20} h={48} />
      <Cell x={28} y={52} w={44} h={20} />
      <Cell x={28} y={80} w={44} h={20} />
      <Cell x={80} y={52} w={20} h={48} />
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
  /* Two concentric rings, six blocks each, spokes lined up between them.
     A single ring was the layout's own shape misreported: a picker that shows
     one thing and produces another is worse than one with no picture at all,
     because the reader has no reason to doubt it. The faint circles are the
     rings the blocks are stepped around. */
  /* The necklace: modules stepped around two rings, each one an upright shape.
     What the kind actually draws, which is the whole reason it is no longer
     called Radial -- that name now belongs to the segmented ring below, whose
     picture this icon used to promise and its layout could not deliver. */
  orbit: (
    <>
      <circle cx={50} cy={50} r={19} fill="none" stroke="currentColor" strokeWidth={4} opacity={0.25} />
      <circle cx={50} cy={50} r={40} fill="none" stroke="currentColor" strokeWidth={4} opacity={0.25} />
      {[19, 40].map((r) =>
        [0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          return (
            <Cell
              key={`${r}-${i}`}
              x={50 + Math.cos(a) * r - 6}
              y={50 + Math.sin(a) * r - 6}
              w={12}
              h={12}
              solid
            />
          );
        })
      )}
    </>
  ),
  /* Sectors, drawn as sectors.
     Built from the same arithmetic the layout uses rather than hand-drawn
     paths, so the picture cannot promise a division the kind declines to
     produce -- which is exactly what the old icon did. */
  radial: (
    <>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const step = (Math.PI * 2) / 8;
        const gap = 0.16;
        const a0 = i * step - Math.PI / 2 - step / 2 + gap / 2;
        const a1 = a0 + step - gap;
        const r0 = 24;
        const r1 = 48;
        const pt = (a: number, r: number) => `${50 + Math.cos(a) * r} ${50 + Math.sin(a) * r}`;
        const d = [
          `M ${pt(a0, r1)}`,
          `A ${r1} ${r1} 0 0 1 ${pt(a1, r1)}`,
          `L ${pt(a1, r0)}`,
          `A ${r0} ${r0} 0 0 0 ${pt(a0, r0)}`,
          'Z',
        ].join(' ');
        return (
          <path
            key={i}
            d={d}
            fill="currentColor"
            // Every third sector solid, matching how the other icons mark a
            // rhythm: enough contrast to read as divided rather than as a
            // single ring with hairlines scratched into it.
            opacity={i % 3 === 0 ? 0.85 : 0.3}
            strokeLinejoin="round"
          />
        );
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
  isometric: (
    <>
      <polygon
        points="30,12 52,24 30,36 8,24"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        opacity="0.85"
      />
      <polygon
        points="70,12 92,24 70,36 48,24"
        fill="currentColor"
        opacity="0.25"
        stroke="currentColor"
        strokeWidth="7"
      />
      <polygon
        points="50,38 72,50 50,62 28,50"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        opacity="0.85"
      />
      <polygon
        points="30,64 52,76 30,88 8,76"
        fill="currentColor"
        opacity="0.2"
        stroke="currentColor"
        strokeWidth="7"
      />
      <polygon
        points="70,64 92,76 70,88 48,76"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        opacity="0.85"
      />
    </>
  ),
};

export const GridKindIcon: React.FC<{ kind: GridKind; size?: number }> = ({ kind, size = 15 }) => (
  <svg width={size} height={size} viewBox="-4 -4 108 108" aria-hidden focusable="false">
    {SHAPES[kind]}
  </svg>
);
