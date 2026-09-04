import React from 'react';
import type { ChartKind } from '../../engine/chart/chartTypes';

/**
 * Each chart kind, drawn as itself.
 *
 * The same argument `gridIcons.tsx` makes, and it holds harder here: a chart
 * kind *is* a picture, and "stacked bar" versus "bar" is a distinction nobody
 * resolves from the words. Seven rows behind seven copies of a generic chart
 * glyph would be a list nobody can scan. Three bars at different heights say
 * "bar" instantly; three bars in two colours say "stacked".
 *
 * Drawn on a shared 100-unit viewBox so the strokes match the lucide icons
 * beside them at any size, and in `currentColor` so an active row inverts with
 * the rest of the item rather than staying its own colour.
 */

const Bar: React.FC<{ x: number; y: number; w: number; h: number; dim?: boolean }> = ({
  x, y, w, h, dim,
}) => <rect x={x} y={y} width={w} height={h} rx={3} fill="currentColor" opacity={dim ? 0.4 : 0.85} />;

const Stroke: React.FC<{ d: string; fill?: boolean }> = ({ d, fill }) => (
  <path
    d={d}
    fill={fill ? 'currentColor' : 'none'}
    fillOpacity={fill ? 0.28 : undefined}
    stroke="currentColor"
    strokeWidth={9}
    strokeLinecap="round"
    strokeLinejoin="round"
    opacity={0.85}
  />
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

  if (inner <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  }
  const [ix1, iy1] = p(to, inner);
  const [ix0, iy0] = p(from, inner);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

const GLYPHS: Record<ChartKind, React.ReactNode> = {
  bar: (
    <>
      <Bar x={12} y={52} w={18} h={36} />
      <Bar x={41} y={26} w={18} h={62} />
      <Bar x={70} y={40} w={18} h={48} />
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
  line: <Stroke d="M 14 72 L 38 44 L 60 58 L 86 22" />,
  area: <Stroke d="M 14 72 L 38 44 L 60 58 L 86 24 L 86 86 L 14 86 Z" fill />,
  scatter: (
    <>
      <circle cx={22} cy={70} r={8} fill="currentColor" opacity={0.85} />
      <circle cx={44} cy={44} r={8} fill="currentColor" opacity={0.85} />
      <circle cx={62} cy={62} r={8} fill="currentColor" opacity={0.85} />
      <circle cx={82} cy={30} r={8} fill="currentColor" opacity={0.85} />
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
      <path
        d={wedge(50, 50, 36, Math.PI * 1.1, Math.PI * 2, 17)}
        fill="currentColor"
        opacity={0.35}
      />
    </>
  ),
};

export const ChartKindIcon: React.FC<{ kind: ChartKind; size?: number }> = ({ kind, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    {GLYPHS[kind]}
  </svg>
);
