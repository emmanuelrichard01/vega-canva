import React from 'react';

/**
 * Specimens for the chart panel: each option drawn as the thing it produces.
 *
 * DESIGN.md's picker rule — *show the shape where the shape is the choice* —
 * applied to the chart controls that were words. "Before", "Middle" and
 * "After" are three guesses about a staircase; three staircases are an answer.
 * The same goes for where a value label sits, which corner of a Riemann strip
 * meets the curve, and whether a run is joined straight or smoothed.
 *
 * All drawn on one 16px grid at one 1.5px stroke, so a row of them reads as a
 * set and sits beside the lucide icons elsewhere in the panel without a seam.
 * Colour is `currentColor` throughout: the segmented control decides ink, the
 * glyph decides only geometry.
 */

const Svg: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const Dot: React.FC<{ x: number; y: number; r?: number }> = ({ x, y, r = 1.6 }) => (
  <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />
);

// ── How a run is joined ────────────────────────────────────────────────────

export const CurveStraight = () => (
  <Svg>
    <polyline points="2,12 6,6 10,9.5 14,4" />
  </Svg>
);

export const CurveSmooth = () => (
  <Svg>
    <path d="M2 12 C4.2 5.5 6.6 5.2 8.4 8 S12 10.8 14 4" />
  </Svg>
);

// ── Where a step happens, relative to the reading ─────────────────────────

export const StepSpecimen: React.FC<{ mode: 'before' | 'mid' | 'after' }> = ({ mode }) => {
  const d = mode === 'before' ? 'M3 11.5 V4.5 H13' : mode === 'mid' ? 'M3 11.5 H8 V4.5 H13' : 'M3 11.5 H13 V4.5';
  return (
    <Svg>
      <path d={d} />
      <Dot x={3} y={11.5} />
      <Dot x={13} y={4.5} />
    </Svg>
  );
};

// ── The mark at each reading ───────────────────────────────────────────────

export const MarkerSpecimen: React.FC<{ shape: 'circle' | 'ring' | 'square' | 'none' }> = ({ shape }) => (
  <Svg>
    <path d="M1.5 11 L14.5 5" strokeWidth={1} opacity={0.55} />
    {shape === 'circle' && <circle cx={8} cy={8} r={3} fill="currentColor" stroke="none" />}
    {shape === 'ring' && <circle cx={8} cy={8} r={2.75} fill="var(--surface-primary, #fff)" />}
    {shape === 'square' && <rect x={5.25} y={5.25} width={5.5} height={5.5} rx={0.75} fill="currentColor" stroke="none" />}
  </Svg>
);

// ── Where a value label sits against its bar ──────────────────────────────

export const PlacementSpecimen: React.FC<{ at: 'inside' | 'outside' | 'center' }> = ({ at }) => {
  const y = at === 'outside' ? 2.75 : at === 'inside' ? 7.25 : 10.5;
  return (
    <Svg>
      <path d="M4.5 14.5 V5.5 H11.5 V14.5" />
      <rect x={6} y={y - 0.9} width={4} height={1.8} rx={0.9} fill="currentColor" stroke="none" />
    </Svg>
  );
};

// ── Aspect of a plotting plane ─────────────────────────────────────────────

export const AspectFree = () => (
  <Svg>
    <rect x={1.75} y={4.25} width={12.5} height={7.5} rx={1.25} />
  </Svg>
);

export const AspectEqual = () => (
  <Svg>
    <rect x={3.75} y={3.75} width={8.5} height={8.5} rx={1.25} />
    <path d="M3.75 8 H12.25 M8 3.75 V12.25" strokeWidth={1} opacity={0.55} />
  </Svg>
);

// ── Which corner of a Riemann strip meets the curve ───────────────────────

export const RiemannSpecimen: React.FC<{ mode: 'left' | 'midpoint' | 'right' }> = ({ mode }) => {
  // The curve is a straight slope so the three contact points are legible at
  // 16px; the strip's top is set to the curve's height at that point.
  const curveY = (x: number) => 11 - (x - 2) * 0.62;
  const cx = mode === 'left' ? 4.5 : mode === 'midpoint' ? 8 : 11.5;
  const top = curveY(cx);
  return (
    <Svg>
      <path d={`M4.5 14.5 V${top} H11.5 V14.5`} strokeWidth={1.25} opacity={0.7} />
      <path d={`M2 ${curveY(2)} L14 ${curveY(14)}`} />
      <Dot x={cx} y={top} r={1.7} />
    </Svg>
  );
};

// ── Reading a function ─────────────────────────────────────────────────────

export const RootsGlyph = () => (
  <Svg>
    <path d="M1.5 8 H14.5" strokeWidth={1} opacity={0.5} />
    <path d="M2 12.5 C5 12.5 6 3.5 9 3.5 S12.5 8 14 10" />
    <circle cx={6.6} cy={8} r={1.9} fill="var(--surface-primary, #fff)" />
  </Svg>
);

export const ExtremaGlyph = () => (
  <Svg>
    <path d="M1.5 12.5 C4 12.5 5.5 4 8 4 S12 12.5 14.5 12.5" />
    <Dot x={8} y={4} r={1.9} />
  </Svg>
);

export const AreaGlyph = () => (
  <Svg>
    <path d="M2 13.5 H14" strokeWidth={1} opacity={0.5} />
    <path d="M3 13.5 V9 C5.5 4 9.5 4 13 8 V13.5 Z" fill="currentColor" fillOpacity={0.28} stroke="none" />
    <path d="M2 10 C5 3.5 9.5 3.8 14 8.5" />
  </Svg>
);

export const DerivativeGlyph = () => (
  <Svg>
    <path d="M2 12.5 C5 12.5 7 5 14 3.5" />
    <path d="M3.5 12.2 L12.5 6" strokeDasharray="1.6 1.8" strokeWidth={1.25} />
    <Dot x={8} y={9.1} r={1.5} />
  </Svg>
);

export const IntegralBoundsGlyph = () => (
  <Svg>
    <path d="M4 2.5 V13.5 M12 2.5 V13.5" strokeWidth={1.25} opacity={0.6} />
    <path d="M4 10 C6.5 5 9.5 5 12 8" />
  </Svg>
);

// ── Annotations ────────────────────────────────────────────────────────────

export const TargetLineGlyph = () => (
  <Svg>
    <path d="M1.5 8 H14.5" strokeDasharray="2.4 2" />
    <path d="M3 13 V10.5 M6.5 13 V6 M10 13 V9 M13.5 13 V4" strokeWidth={1.25} opacity={0.5} />
  </Svg>
);

export const BandGlyph = () => (
  <Svg>
    <rect x={1.5} y={5} width={13} height={6} fill="currentColor" fillOpacity={0.22} stroke="none" />
    <path d="M1.5 5 H14.5 M1.5 11 H14.5" strokeDasharray="2.4 2" strokeWidth={1.25} />
  </Svg>
);

export const SeedGlyph = () => (
  <Svg>
    <path d="M2 12 C5 12 6.5 4 14 4" />
    <circle cx={6.6} cy={8.9} r={2} fill="var(--surface-primary, #fff)" />
  </Svg>
);

// ── The data grid's row gutter ─────────────────────────────────────────────

/** A mark in the series colour, drawn as the chart draws that series. */
export const SeriesKey: React.FC<{ color: string }> = ({ color }) => (
  <span className="chartp-key" style={{ background: color }} aria-hidden="true" />
);
