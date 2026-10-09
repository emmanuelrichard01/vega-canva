import React from 'react';
import { ARROW_D, ARROW_SCALE, ARROW_TIP } from '../../engine/cursor/cursorVisual';
import type { CursorSample, Pt } from '../../engine/learn/demoScript';

/** Helpers the scripted scenes share. */

export interface SceneProps {
  t: number;
  cur: CursorSample;
  /** Unique to this instance, for the ids a scene defines (several demos share a page). */
  uid: string;
}

export const f = (n: number) => Math.round(n * 100) / 100;
export const poly = (points: readonly Pt[]) => points.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');

/** Scale about a point, then place. Keeps every "grow in" in one spelling. */
export const grow = (cx: number, cy: number, k: number) => `translate(${cx} ${cy}) scale(${f(k)}) translate(${-cx} ${-cy})`;

/** The selection outline: ink, never the accent. */
export const Sel: React.FC<{ x: number; y: number; w: number; h: number; o?: number; r?: number; dashed?: boolean }> = ({
  x,
  y,
  w,
  h,
  o = 1,
  r = 4,
  dashed,
}) =>
  o > 0.01 ? (
    <rect
      className="sd-sel"
      x={x - 3}
      y={y - 3}
      width={w + 6}
      height={h + 6}
      rx={r}
      opacity={o}
      strokeDasharray={dashed ? '3 3' : undefined}
    />
  ) : null;

/** A line of "text": a rounded bar, so nothing needs translating. */
export const Bar: React.FC<{ x: number; y: number; w: number; h?: number; fill?: string; o?: number }> = ({
  x,
  y,
  w,
  h = 4,
  fill = 'var(--text-tertiary)',
  o = 1,
}) => (w > 0.5 ? <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} opacity={o} /> : null);


/* -------------------------------------------------------- people on a board */

/** The colours people take on a shared board, as the demos draw them. */
export const PEOPLE = {
  maya: { name: 'Maya', color: '#E5484D' },
  ravi: { name: 'Ravi', color: '#3E63DD' },
  jo: { name: 'Jo', color: '#30A46C' },
} as const;

/** A name tag: a small rounded label in a person's colour. */
export const NameTag: React.FC<{ x: number; y: number; name: string; color: string; o?: number }> = ({ x, y, name, color, o = 1 }) => {
  const w = name.length * 3.9 + 9;
  return o > 0.01 ? (
    <g opacity={o}>
      <rect x={x} y={y} width={f(w)} height={10} rx={5} fill={color} />
      <text className="sd-tag-text" x={x + 4.5} y={y + 7.1}>
        {name}
      </text>
    </g>
  ) : null;
};

/** Another person's pointer: the real arrow in their colour, with their name beside it. */
export const RemoteCursor: React.FC<{ x: number; y: number; name: string; color: string; o?: number; tag?: boolean }> = ({
  x,
  y,
  name,
  color,
  o = 1,
  tag = true,
}) =>
  o > 0.01 ? (
    <g opacity={o} pointerEvents="none">
      <g transform={`translate(${f(x)} ${f(y)}) translate(${-ARROW_TIP.x} ${-ARROW_TIP.y})`}>
        <g transform={`scale(${ARROW_SCALE})`}>
          <path d={ARROW_D} fill={color} stroke="var(--surface-primary)" strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      </g>
      {tag && <NameTag x={x + 8} y={y + 9} name={name} color={color} />}
    </g>
  ) : null;

/** A round avatar with an initial. */
export const Face: React.FC<{ x: number; y: number; r?: number; color: string; initial: string; o?: number }> = ({
  x,
  y,
  r = 6.5,
  color,
  initial,
  o = 1,
}) => (
  <g opacity={o}>
    <circle cx={x} cy={y} r={r} fill={color} stroke="var(--surface-primary)" strokeWidth={1.5} />
    <text className="sd-tag-text" x={x} y={y + 2.4} textAnchor="middle">
      {initial}
    </text>
  </g>
);

/** A soft wandering path for a remote pointer: smooth, never still, never random. */
export const wander = (t: number, cx: number, cy: number, ax: number, ay: number, phase = 0): [number, number] => [
  cx + ax * Math.sin(t / 1150 + phase) + (ax / 3) * Math.sin(t / 470 + phase * 2),
  cy + ay * Math.sin(t / 830 + phase * 1.7) + (ay / 3) * Math.cos(t / 390 + phase),
];
