import React, { useId } from 'react';
import { categoryLabel } from '../../engine/music/library/manifest';

/**
 * A drawn cover for each station, used when a track has no artwork of its
 * own. Static SVG on a 100-unit grid: one motif and one palette per
 * category, the same every time. Unknown categories get a quiet initial.
 */
const PALETTES: Record<string, readonly [string, string, string, string]> = {
  ambient: ['#dfe7e2', '#9fb8ad', '#5f7f74', '#2f4a43'],
  piano: ['#efe7da', '#c9b79c', '#8a7358', '#3c3226'],
  lofi: ['#ead9c6', '#d39a77', '#8c5a4a', '#3a2a33'],
  synth: ['#1d1533', '#5b2a86', '#e1488a', '#ffb36b'],
  house: ['#14232b', '#1f5f6b', '#3fb5a3', '#e8d27a'],
  retro: ['#1b1b2f', '#3a7bd5', '#f2c94c', '#eb5757'],
};

function motif(category: string, [bg, a, b, c]: readonly [string, string, string, string], uid: string): React.ReactNode {
  switch (category) {
    case 'ambient':
      return (
        <>
          <path d="M0 46 C 18 40, 34 44, 52 41 S 84 36, 100 40 V100 H0 Z" fill={a} opacity={0.55} />
          <path d="M0 58 C 20 52, 38 57, 56 53 S 86 50, 100 54 V100 H0 Z" fill={b} opacity={0.75} />
          <path d="M0 72 C 22 67, 40 72, 60 68 S 88 66, 100 70 V100 H0 Z" fill={c} opacity={0.85} />
          <circle cx={72} cy={26} r={8} fill="#ffffff" opacity={0.6} />
        </>
      );
    case 'piano':
      return (
        <>
          <circle cx={36} cy={24} r={11} fill={b} opacity={0.7} />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} x={i * 14.3 + 1} y={46} width={12.3} height={54} fill={i === 2 || i === 5 ? a : '#fbf7f0'} />
          ))}
          {[0, 1, 3, 4, 5].map((i) => (
            <rect key={i} x={(i + 0.68) * 14.3} y={46} width={9.2} height={32} fill={c} />
          ))}
        </>
      );
    case 'lofi':
      return (
        <>
          <rect x={8} y={9} width={22} height={4} rx={1} fill={b} />
          <circle cx={52} cy={56} r={38} fill={c} />
          {[14, 19, 24, 29, 34].map((r) => (
            <circle key={r} cx={52} cy={56} r={r} fill="none" stroke={b} strokeWidth={1} opacity={0.35} />
          ))}
          <circle cx={52} cy={56} r={10} fill={b} />
          <circle cx={52} cy={56} r={1.6} fill={c} />
        </>
      );
    case 'synth':
      return (
        <>
          <defs>
            <linearGradient id={`${uid}-sun`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c} />
              <stop offset="1" stopColor={b} />
            </linearGradient>
          </defs>
          <path d="M24 50 A 26 26 0 0 1 76 50 Z" fill={`url(#${uid}-sun)`} />
          {[32, 37, 42, 47].map((y, i) => (
            <rect key={y} x={0} y={y} width={100} height={1 + i * 0.9} fill={bg} />
          ))}
          <g stroke={b} strokeWidth={1.1}>
            {[52, 54, 58, 65, 75, 88, 100].map((y) => (
              <line key={y} x1={0} y1={y} x2={100} y2={y} />
            ))}
            {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => (
              <line key={i} x1={50 + i * 4} y1={52} x2={50 + i * 30} y2={100} />
            ))}
          </g>
        </>
      );
    case 'house':
      return (
        <>
          {[6, 5, 4, 3, 2, 1].map((i) => (
            <circle key={i} cx={50} cy={50} r={8 * i} fill={[a, b, c][i % 3]} opacity={0.3 + (6 - i) * 0.12} />
          ))}
        </>
      );
    case 'retro': {
      const heights = [4, 5, 4, 3, 5, 6, 5, 4, 3, 4, 5, 4];
      const px = 100 / 12;
      return (
        <>
          <rect x={px * 2} y={px * 2} width={px * 2} height={px * 2} fill={b} />
          {heights.map((h, x) =>
            Array.from({ length: h }, (_, k) => (
              <rect key={`${x}-${k}`} x={x * px} y={(12 - h + k) * px} width={px + 0.2} height={px + 0.2} fill={k === 0 ? c : a} />
            ))
          )}
        </>
      );
    }
    default:
      return null;
  }
}

export const CategoryCover: React.FC<{ category: string; className?: string }> = ({ category, className }) => {
  const uid = useId().replace(/:/g, '');
  const palette = PALETTES[category];
  if (!palette) {
    return (
      <span className={`music-art music-art--blank ${className ?? ''}`} aria-hidden="true">
        {categoryLabel(category).slice(0, 1)}
      </span>
    );
  }
  return (
    <svg className={`music-cover ${className ?? ''}`} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={100} height={100} fill={palette[0]} />
      {motif(category, palette, uid)}
    </svg>
  );
};
