import React from 'react';
import type { ChartKind } from '../../engine/chart/chartTypes';

/**
 * Each chart kind, drawn as itself.
 *
 * The same argument `gridIcons.tsx` makes, and it holds harder here: a chart
 * kind *is* a picture, and "stacked bar" versus "100% stacked" is a
 * distinction nobody resolves from the words. Sixteen rows behind sixteen
 * copies of a generic chart glyph would be a list nobody can scan. Two full
 * columns of equal height say "100%" instantly, where the words need a
 * sentence.
 *
 * Drawn on a shared 100-unit viewBox so the strokes match the lucide icons
 * beside them at any size, and in `currentColor` so an active row inverts with
 * the rest of the item rather than staying its own colour. The dimmed second
 * tone is opacity rather than a second colour, for the same reason.
 */

const Bar: React.FC<{ x: number; y: number; w: number; h: number; dim?: boolean }> = ({
  x, y, w, h, dim,
}) => <rect x={x} y={y} width={w} height={h} rx={3} fill="currentColor" opacity={dim ? 0.38 : 0.85} />;

const Stroke: React.FC<{ d: string; fill?: boolean; dim?: boolean }> = ({ d, fill, dim }) => (
  <path
    d={d}
    fill={fill ? 'currentColor' : 'none'}
    fillOpacity={fill ? (dim ? 0.16 : 0.28) : undefined}
    stroke="currentColor"
    strokeWidth={9}
    strokeLinecap="round"
    strokeLinejoin="round"
    opacity={dim ? 0.45 : 0.85}
  />
);

const Dot: React.FC<{ x: number; y: number; r?: number; dim?: boolean }> = ({ x, y, r = 8, dim }) => (
  <circle cx={x} cy={y} r={r} fill="currentColor" opacity={dim ? 0.4 : 0.85} />
);

/** A wedge from twelve o'clock, matching how the layout starts a pie. */
function wedge(cx: number, cy: number, r: number, from: number, to: number, inner = 0): string {
  const p = (a: number, rad: number) => [
    cx + Math.cos(a - Math.PI / 2) * rad,
    cy + Math.sin(a - Math.PI / 2) * rad,
  ];
  const [x0, y0] = p(from, r);
  const [x1, y1] = p(to, r);
  const large = to - from > Math.PI ? 1 : 0;

  if (inner <= 0) return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  const [ix1, iy1] = p(to, inner);
  const [ix0, iy0] = p(from, inner);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

/** The radar's pentagon, at a given radius. */
function pentagon(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  });
  return `M ${pts.join(' L ')} Z`;
}

const GLYPHS: Record<ChartKind, React.ReactNode> = {
  bar: (
    <>
      <Bar x={12} y={52} w={18} h={36} />
      <Bar x={41} y={26} w={18} h={62} />
      <Bar x={70} y={40} w={18} h={48} />
    </>
  ),
  barHorizontal: (
    <>
      <Bar x={12} y={16} w={44} h={18} />
      <Bar x={12} y={41} w={76} h={18} />
      <Bar x={12} y={66} w={58} h={18} />
    </>
  ),
  stackedBar: (
    <>
      <Bar x={12} y={56} w={18} h={32} />
      <Bar x={12} y={34} w={18} h={20} dim />
      <Bar x={41} y={44} w={18} h={44} />
      <Bar x={41} y={20} w={18} h={22} dim />
      <Bar x={70} y={62} w={18} h={26} />
      <Bar x={70} y={42} w={18} h={18} dim />
    </>
  ),
  stackedBar100: (
    // Three columns of identical height, which is the whole claim.
    <>
      <Bar x={12} y={52} w={18} h={36} />
      <Bar x={12} y={16} w={18} h={34} dim />
      <Bar x={41} y={38} w={18} h={50} />
      <Bar x={41} y={16} w={18} h={20} dim />
      <Bar x={70} y={60} w={18} h={28} />
      <Bar x={70} y={16} w={18} h={42} dim />
    </>
  ),
  line: <Stroke d="M 14 72 L 38 44 L 60 58 L 86 22" />,
  step: <Stroke d="M 14 74 L 36 74 L 36 50 L 58 50 L 58 62 L 80 62 L 80 26 L 88 26" />,
  area: <Stroke d="M 14 72 L 38 44 L 60 58 L 86 24 L 86 86 L 14 86 Z" fill />,
  stackedArea: (
    <>
      <Stroke d="M 14 58 L 38 34 L 60 46 L 86 18 L 86 86 L 14 86 Z" fill dim />
      <Stroke d="M 14 76 L 38 60 L 60 68 L 86 50 L 86 86 L 14 86 Z" fill />
    </>
  ),
  scatter: (
    <>
      <Dot x={22} y={70} />
      <Dot x={44} y={44} />
      <Dot x={62} y={62} />
      <Dot x={82} y={30} />
    </>
  ),
  bubble: (
    <>
      <Dot x={28} y={66} r={13} />
      <Dot x={58} y={40} r={8} />
      <Dot x={78} y={68} r={17} dim />
    </>
  ),
  histogram: (
    // Touching bars, because the categories are a continuum and not a set —
    // which is the one visual difference from `bar` and the whole meaning.
    <>
      <Bar x={12} y={64} w={18} h={24} />
      <Bar x={31} y={40} w={18} h={48} />
      <Bar x={50} y={26} w={18} h={62} />
      <Bar x={69} y={54} w={18} h={34} />
    </>
  ),
  pie: (
    <>
      <path d={wedge(50, 50, 36, 0, Math.PI * 1.1)} fill="currentColor" opacity={0.85} />
      <path d={wedge(50, 50, 36, Math.PI * 1.1, Math.PI * 2)} fill="currentColor" opacity={0.35} />
    </>
  ),
  donut: (
    <>
      <path d={wedge(50, 50, 36, 0, Math.PI * 1.1, 17)} fill="currentColor" opacity={0.85} />
      <path d={wedge(50, 50, 36, Math.PI * 1.1, Math.PI * 2, 17)} fill="currentColor" opacity={0.35} />
    </>
  ),
  funnel: (
    <>
      <Bar x={12} y={18} w={76} h={16} />
      <Bar x={22} y={42} w={56} h={16} dim />
      <Bar x={34} y={66} w={32} h={16} />
    </>
  ),
  waterfall: (
    // Floating bars at descending bases, which is what distinguishes it from a
    // bar chart at a glance.
    <>
      <Bar x={12} y={54} w={17} h={34} />
      <Bar x={33} y={38} w={17} h={18} dim />
      <Bar x={54} y={38} w={17} h={22} dim />
      <Bar x={75} y={26} w={17} h={62} />
    </>
  ),
  radar: (
    <>
      <path d={pentagon(50, 52, 36)} fill="none" stroke="currentColor" strokeWidth={7} opacity={0.3} />
      <path d={pentagon(50, 52, 20)} fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={7} opacity={0.85} />
    </>
  ),
};

export const ChartKindIcon: React.FC<{ kind: ChartKind; size?: number }> = ({ kind, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    {GLYPHS[kind]}
  </svg>
);
