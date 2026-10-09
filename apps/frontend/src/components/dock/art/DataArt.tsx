import React, { useId } from 'react';
import type { ChartKind } from '../../../engine/chart/chartTypes';
import { KIND_DEFAULTS, layoutGrid, type GridCell, type GridKind, type GridSpec } from '../../../engine/grid/gridLayout';
import { gridPreset } from '../../../engine/grid/gridPresets';
import './dataArt.css';

/**
 * The chart and grid pickers' tiles, drawn as small lit plates.
 *
 * Original art for vega-canva, in the drawing tray's family (`ToolArt.tsx`):
 * light from above, a gentle depth, and every colour bound to a custom
 * property so a theme or contrast change is a style change, never a re-render.
 *
 * ## The plate
 *
 * Every tile is a 64 × 48 sheet with a soft shadow under it. A chart is drawn
 * on it as the chart would be on the board -- baseline, faint rules, its own
 * marks -- and a grid treats it as the page, so a margin is the paper showing
 * round the tracks. One plate for both families keeps a mixed sheet of them
 * reading as one set.
 *
 * ## Colour
 *
 * The marks take the first five colours of the chart palette
 * (`CHART_PALETTE`), in its order, so the icon shows the colours the chart
 * will actually be drawn in. Each hue is a vertical gradient, lighter at the
 * top. The dark theme lifts every hue a step (`dataArt.css`) rather than
 * dimming it, which is what keeps them clean on a dark plate.
 *
 * ## Grids are laid out, not drawn
 *
 * A grid tile is `layoutGrid` run on the preset's (or the kind's) own numbers
 * and scaled onto the plate, so a picture cannot promise a division the layout
 * will not produce. Two liberties are taken, both for legibility at plate
 * size: a gutter under one unit is widened to one, and margins are drawn
 * deeper than the page scale (`MARGIN_DEPTH`). Neither changes how many
 * cells there are or how they are arranged.
 *
 * ## Alive
 *
 * Each mark carries one motion class (`da-a-*`); `da-d1`..`da-d5` order the
 * marks. On hover or focus the CSS eases each mark a few percent from the
 * resting picture and eases it back on leave, only when motion is allowed. The
 * art at rest is the finished chart.
 */

export type DataSeat = 'chart' | 'grid' | 'table';

type Hue = 0 | 1 | 2 | 3 | 4;

const W = 64;
const H = 48;
const PLATE = { x: 3, y: 3, w: 58, h: 40, r: 4.5 } as const;
/** The chart plot area on the plate. */
const X0 = 10;
const X1 = 54;
const TOP = 10;
const BASE = 36;

/** Two decimals: plenty at this size, and it keeps the markup short. */
const n = (v: number) => Math.round(v * 100) / 100;

/**
 * How strongly a mark is painted: the hue itself, a step back, or a tint.
 *
 * A tier rather than an opacity. Opacity mixes a hue towards the plate, and
 * on the dark plate that is towards grey: every weaker cell went muddy. Each
 * tier is mixed instead towards a base the theme chooses -- white on the
 * light plate, the hue's own deep shade on the dark one (`dataArt.css`) -- so
 * a quieter cell stays the same colour, only calmer.
 */
type Tier = 0 | 1 | 2;

/** What a scene asks of the art around it: gradients, each created on first use. */
interface Paint {
  /** A hue lit from above, at a tier. */
  fill(h: Hue, tier?: Tier): string;
  /** A hue fading downwards, for the space under a curve. */
  fade(h: Hue): string;
  /** A radial glow in a hue, for the painted surface. */
  glow(h: Hue): string;
}

type Scene = (p: Paint) => React.ReactNode;

interface Used {
  fill: Set<string>;
  fade: Set<Hue>;
  glow: Set<Hue>;
}

function paintFor(id: string): { paint: Paint; used: Used } {
  const used: Used = { fill: new Set(), fade: new Set(), glow: new Set() };
  const paint: Paint = {
    fill: (h, tier = 0) => (used.fill.add(`${h}${tier}`), `url(#${id}-h${h}${tier})`),
    fade: (h) => (used.fade.add(h), `url(#${id}-f${h})`),
    glow: (h) => (used.glow.add(h), `url(#${id}-g${h})`),
  };
  return { paint, used };
}

/**
 * The gradients a scene used, and the plate's own. Prefixed per instance:
 * a gradient referenced from a hidden copy of the dock stops painting in
 * Chromium when two instances share an id.
 *
 * Each gradient names its hue (`da-k*`) and tier (`da-tier*`) as classes, and
 * its stops read the colour those set as inherited custom properties, so one
 * pair of stop rules serves every hue at every tier.
 */
function Defs({ id, used }: { id: string; used: Used }) {
  return (
    <defs>
      <linearGradient id={`${id}-plate`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" className="da-plate-top" />
        <stop offset="1" className="da-plate-low" />
      </linearGradient>
      <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="150%">
        <feGaussianBlur stdDeviation="1.1" />
      </filter>
      {[...used.fill].map((key) => (
        <linearGradient key={`h${key}`} id={`${id}-h${key}`} className={`da-k${key[0]} da-tier${key[1]}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="da-stop-lit" />
          <stop offset="1" className="da-stop" />
        </linearGradient>
      ))}
      {[...used.fade].map((h) => (
        <linearGradient key={`f${h}`} id={`${id}-f${h}`} className={`da-k${h} da-tier0`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="da-stop da-fade-top" />
          <stop offset="1" className="da-stop da-fade-low" />
        </linearGradient>
      ))}
      {[...used.glow].map((h) => (
        <radialGradient key={`g${h}`} id={`${id}-g${h}`} className={`da-k${h} da-tier0`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="da-stop-lit" />
          <stop offset="0.55" className="da-stop da-glow-mid" />
          <stop offset="1" className="da-stop da-glow-out" />
        </radialGradient>
      ))}
    </defs>
  );
}

function Plate({ id }: { id: string }) {
  const { x, y, w, h, r } = PLATE;
  return (
    <>
      <rect className="da-plate-shadow" x={x + 0.5} y={y + 1.4} width={w - 1} height={h} rx={r} filter={`url(#${id}-soft)`} />
      <rect className="da-plate" x={x} y={y} width={w} height={h} rx={r} fill={`url(#${id}-plate)`} />
    </>
  );
}

/** One tile: the plate, the scene, and the gradients the scene used. */
function Tile({ scene, size, kind }: { scene: Scene; size: number; kind: string }) {
  const id = `da${useId().replace(/:/g, '')}`;
  const { paint, used } = paintFor(id);
  // The scene runs first so `Defs` knows which gradients it reached for.
  const body = scene(paint);
  return (
    <svg
      className="data-art"
      data-art={kind}
      viewBox={`0 0 ${W} ${H}`}
      width={size}
      height={n((size * H) / W)}
      aria-hidden="true"
      focusable="false"
    >
      <Defs id={id} used={used} />
      <Plate id={id} />
      {body}
    </svg>
  );
}

/* ------------------------------------------------------------ geometry */

type Pt = readonly [number, number];

/** A column standing on `bottom`, its top corners rounded. */
function column(x: number, top: number, w: number, bottom: number, r = 1.1): string {
  const rr = Math.min(r, w / 2, Math.max(0, bottom - top));
  return `M${n(x)} ${n(bottom)}V${n(top + rr)}Q${n(x)} ${n(top)} ${n(x + rr)} ${n(top)}H${n(x + w - rr)}Q${n(x + w)} ${n(top)} ${n(x + w)} ${n(top + rr)}V${n(bottom)}Z`;
}

/** A bar reaching right from `x`, its far corners rounded. */
function reach(x: number, y: number, len: number, h: number, r = 1.1): string {
  const rr = Math.min(r, h / 2, len);
  const e = x + len;
  return `M${n(x)} ${n(y)}H${n(e - rr)}Q${n(e)} ${n(y)} ${n(e)} ${n(y + rr)}V${n(y + h - rr)}Q${n(e)} ${n(y + h)} ${n(e - rr)} ${n(y + h)}H${n(x)}Z`;
}

const poly = (pts: readonly Pt[], close = false) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('') + (close ? 'Z' : '');

/** A smooth curve through the points (Catmull-Rom, as cubic Béziers). */
function smooth(pts: readonly Pt[]): string {
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

/** A closed curve sampled from `r(θ)` around a centre. */
function closed(cx: number, cy: number, r: (a: number) => number, sx = 1, sy = 1, steps = 48): string {
  const pts: Pt[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const rad = r(a);
    pts.push([cx + Math.cos(a) * rad * sx, cy + Math.sin(a) * rad * sy]);
  }
  return poly(pts, true);
}

/** A wedge from twelve o'clock, clockwise, as the chart layout starts a pie. */
function wedge(cx: number, cy: number, r: number, from: number, to: number, inner = 0): string {
  const at = (a: number, rad: number) => `${n(cx + Math.sin(a) * rad)} ${n(cy - Math.cos(a) * rad)}`;
  const large = to - from > Math.PI ? 1 : 0;
  if (inner <= 0) return `M${n(cx)} ${n(cy)}L${at(from, r)}A${r} ${r} 0 ${large} 1 ${at(to, r)}Z`;
  return `M${at(from, r)}A${r} ${r} 0 ${large} 1 ${at(to, r)}L${at(to, inner)}A${inner} ${inner} 0 ${large} 0 ${at(from, inner)}Z`;
}

const xs = (count: number) => Array.from({ length: count }, (_, i) => X0 + ((X1 - X0) * i) / (count - 1));
const series = (ys: readonly number[]): Pt[] => xs(ys.length).map((x, i) => [x, ys[i]] as const);
const d = (i: number) => (i > 0 ? ` da-d${Math.min(5, i)}` : '');

/* --------------------------------------------------------------- chrome */

/** The baseline and two faint rules a cartesian chart sits on. */
const Rules: React.FC<{ rules?: boolean }> = ({ rules = true }) => (
  <>
    {rules && <path className="da-rule" d={`M${X0 - 1} 19H${X1 + 1}M${X0 - 1} 27.5H${X1 + 1}`} />}
    <path className="da-axis" d={`M${X0 - 1} ${BASE + 0.5}H${X1 + 1}`} />
  </>
);

/** The axis cross a plot of a function sits on. */
const Cross: React.FC = () => <path className="da-axis" d="M8 23.5H56M32 8V39" />;

/* --------------------------------------------------------------- charts */

const pieSlices = [0.42, 0.26, 0.18, 0.14];

function pie(p: Paint, inner: number) {
  let a = 0;
  return (
    <g className="da-a-turn">
      {pieSlices.map((share, i) => {
        const from = a;
        a += share * Math.PI * 2;
        return <path key={i} className="da-sep" d={wedge(32, 23, 16, from, a, inner)} fill={p.fill(i as Hue)} />;
      })}
    </g>
  );
}

const gauss = (mu: number, sd: number, peak: number) => (x: number) => peak * Math.exp(-((x - mu) ** 2) / (2 * sd * sd));

function densityPath(f: (x: number) => number): { line: string; area: string } {
  const pts: Pt[] = [];
  for (let i = 0; i <= 22; i += 1) {
    const x = X0 + ((X1 - X0) * i) / 22;
    pts.push([x, BASE - f(x)]);
  }
  const line = smooth(pts);
  return { line, area: `${line}L${X1} ${BASE}L${X0} ${BASE}Z` };
}

const DENSITY = [densityPath(gauss(24, 6, 22)), densityPath(gauss(39, 6.5, 15))];

/** Cassini's oval with b just over a: one closed peanut, the set where F(x, y) = 0. */
const PEANUT = closed(32, 23.5, (t) => {
  const a = 10;
  const b = 10.8;
  const r2 = a * a * Math.cos(2 * t) + Math.sqrt(b ** 4 - a ** 4 * Math.sin(2 * t) ** 2);
  return Math.sqrt(Math.max(0, r2));
}, 1.25, 1.25, 64);

const LISSAJOUS = (() => {
  const pts: Pt[] = [];
  for (let i = 0; i <= 96; i += 1) {
    const t = (i / 96) * Math.PI * 2;
    pts.push([32 + 18 * Math.sin(3 * t + Math.PI / 2), 23.5 + 12 * Math.sin(2 * t)]);
  }
  return poly(pts);
})();

const ROSE = closed(32, 23.5, (t) => Math.abs(13 * Math.cos(2 * t)), 1, 1, 96);

const WAVE = (() => {
  const pts: Pt[] = [];
  for (let i = 0; i <= 32; i += 1) {
    const x = 9 + (46 * i) / 32;
    pts.push([x, 23.5 - 10 * Math.sin((x - 32) / 7.2) * Math.exp(-(((x - 32) / 30) ** 2))]);
  }
  return smooth(pts);
})();

/** The slope field of dy/dx = x/2, and the parabola one solution traces through it. */
const SLOPES = (() => {
  const out: string[] = [];
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const u = -2.4 + c * 0.8;
      const cx = 32 + u * 8.2;
      const cy = 11 + r * 6.2;
      const len = 2.1;
      const k = u / 2;
      const m = Math.hypot(1, k);
      out.push(`M${n(cx - len / m)} ${n(cy + (len * k) / m)}L${n(cx + len / m)} ${n(cy - (len * k) / m)}`);
    }
  }
  const sol: Pt[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const u = -2.6 + (5.2 * i) / 24;
    sol.push([32 + u * 8.2, 23.5 - (u * u / 4 - 0.85) * 8.2]);
  }
  return { segs: out, solution: smooth(sol) };
})();

/** A vortex: each arrow turns about the centre, its length its magnitude. */
const VORTEX = (() => {
  const out: { d: string; q: number; band: number }[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const x = 14 + c * 9;
      const y = 13 + r * 10.5;
      const u = (x - 32) / 18;
      const v = (y - 23.5) / 10.5;
      // The eye of the vortex has no direction to point in.
      if (Math.hypot(u, v) < 0.05) continue;
      const mag = Math.min(1, Math.hypot(u, v));
      const len = 3.6 + mag * 3.4;
      const ang = Math.atan2(u, -v);
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      const tx = x + dx / 2;
      const ty = y + dy / 2;
      const hx = Math.cos(ang) * 2.1;
      const hy = Math.sin(ang) * 2.1;
      out.push({
        d: `M${n(x - dx / 2)} ${n(y - dy / 2)}L${n(tx)} ${n(ty)}M${n(tx - hx - hy * 0.7)} ${n(ty - hy + hx * 0.7)}L${n(tx)} ${n(ty)}L${n(tx - hx + hy * 0.7)} ${n(ty - hy - hx * 0.7)}`,
        q: Math.min(4, Math.round(mag * 4)),
        band: c,
      });
    }
  }
  return out;
})();

const RADAR_AXES = 6;
const radarPoint = (i: number, v: number): Pt => {
  const a = (i / RADAR_AXES) * Math.PI * 2;
  return [32 + Math.sin(a) * 15.5 * v, 23 - Math.cos(a) * 15.5 * v];
};

const CHART_SCENES: Record<ChartKind, Scene> = {
  bar: (p) => {
    const blue = [15, 23, 19];
    const amber = [10, 17, 24];
    return (
      <>
        <Rules />
        {blue.map((h, i) => {
          const x = 12 + i * 15;
          return (
            <g key={i}>
              <path className={`da-mark da-a-rise${d(i * 2)}`} d={column(x, BASE - h, 5.4, BASE)} fill={p.fill(0)} />
              <path className={`da-mark da-a-rise${d(i * 2 + 1)}`} d={column(x + 6.4, BASE - amber[i], 5.4, BASE)} fill={p.fill(1)} />
            </g>
          );
        })}
      </>
    );
  },
  barHorizontal: (p) => (
    <>
      <path className="da-axis" d={`M${X0 + 0.5} 9V38`} />
      {[40, 31, 24, 15].map((len, i) => (
        <path key={i} className={`da-mark da-a-reach${d(i)}`} d={reach(X0 + 1, 11 + i * 6.6, len, 4.6)} fill={p.fill(i as Hue)} />
      ))}
    </>
  ),
  stackedBar: (p) => {
    const stacks = [[8, 5, 4], [10, 7, 5], [7, 6, 3], [12, 8, 6]];
    return (
      <>
        <Rules />
        {stacks.map((parts, i) => {
          const x = 12.5 + i * 10.5;
          let y = BASE;
          return (
            <g key={i} className={`da-a-rise${d(i)}`}>
              {parts.map((v, j) => {
                const bottom = y;
                y -= v;
                const top = j === parts.length - 1;
                return (
                  <path
                    key={j}
                    className="da-mark"
                    d={top ? column(x, y, 7, bottom - 0.5) : `M${x} ${n(bottom - (j ? 0.5 : 0))}V${n(y)}H${x + 7}V${n(bottom - (j ? 0.5 : 0))}Z`}
                    fill={p.fill(j as Hue)}
                  />
                );
              })}
            </g>
          );
        })}
      </>
    );
  },
  stackedBar100: (p) => {
    const stacks = [[0.5, 0.3, 0.2], [0.35, 0.4, 0.25], [0.6, 0.25, 0.15], [0.42, 0.33, 0.25]];
    const full = BASE - TOP;
    return (
      <>
        <Rules rules={false} />
        {stacks.map((parts, i) => {
          const x = 12.5 + i * 10.5;
          let y = BASE;
          return (
            <g key={i} className={`da-a-rise${d(i)}`}>
              {parts.map((share, j) => {
                const bottom = y;
                y -= share * full;
                const top = j === parts.length - 1;
                return (
                  <path
                    key={j}
                    className="da-mark"
                    d={top ? column(x, y, 7, bottom - 0.5) : `M${x} ${n(bottom - (j ? 0.5 : 0))}V${n(y)}H${x + 7}V${n(bottom - (j ? 0.5 : 0))}Z`}
                    fill={p.fill(j as Hue)}
                  />
                );
              })}
            </g>
          );
        })}
      </>
    );
  },
  matrix: () => {
    // A value at every row and column, on the blue-to-violet ramp.
    const values = [
      [0, 1, 2, 1, 3, 4],
      [1, 2, 4, 3, 2, 1],
      [2, 3, 3, 4, 1, 0],
      [1, 0, 2, 3, 2, 1],
    ];
    const cw = (X1 - X0 - 5) / 6;
    const ch = (BASE + 1 - TOP - 3) / 4;
    return (
      <>
        {values.map((row, r) =>
          row.map((q, c) => (
            <rect
              key={`${r}-${c}`}
              className={`da-mark da-a-fade${d(c)}`}
              x={n(X0 + c * (cw + 1))}
              y={n(TOP + r * (ch + 1))}
              width={n(cw)}
              height={n(ch)}
              rx="1"
              fill={`var(--da-q${q})`}
            />
          ))
        )}
      </>
    );
  },
  line: () => {
    const blue = series([30, 24, 26, 18, 20, 13]);
    const amber = series([33, 31, 27, 28.5, 23, 22]);
    const last = blue[blue.length - 1];
    return (
      <>
        <Rules />
        <path className="da-line da-a-draw da-d1" d={poly(amber)} stroke="var(--da-1)" pathLength={1} />
        <path className="da-line da-a-draw" d={poly(blue)} stroke="var(--da-0)" pathLength={1} />
        <circle className="da-dot da-a-pop da-d3" cx={last[0]} cy={last[1]} r="2" fill="var(--da-0)" />
      </>
    );
  },
  step: (p) => {
    const ys = [30, 25, 27, 19, 22, 14];
    const x = xs(7);
    const pts: Pt[] = [];
    ys.forEach((y, i) => {
      pts.push([x[i], y], [x[i + 1], y]);
    });
    return (
      <>
        <Rules />
        <path className="da-area da-a-rise" d={`${poly(pts)}L${X1} ${BASE}L${X0} ${BASE}Z`} fill={p.fade(2)} />
        <path className="da-line da-a-draw" d={poly(pts)} stroke="var(--da-2)" pathLength={1} />
      </>
    );
  },
  area: (p) => {
    const line = smooth(series([29, 22, 25, 16, 19, 12]));
    return (
      <>
        <Rules />
        <g className="da-a-rise">
          <path className="da-area" d={`${line}L${X1} ${BASE}L${X0} ${BASE}Z`} fill={p.fade(0)} />
          <path className="da-line" d={line} stroke="var(--da-0)" />
        </g>
      </>
    );
  },
  stackedArea: (p) => {
    const bands = [
      [8, 10, 9, 12, 11, 13],
      [5, 6, 8, 6, 8, 9],
      [4, 5, 4, 6, 5, 4],
    ];
    const acc = [0, 0, 0, 0, 0, 0];
    const tops = bands.map((band) => series(band.map((v, i) => BASE - (acc[i] += v))));
    return (
      <>
        <Rules />
        <g className="da-a-rise">
          {[...tops].reverse().map((top, k) => {
            const j = tops.length - 1 - k;
            return (
              <path key={j} className="da-mark da-band" d={`${smooth(top)}L${X1} ${BASE}L${X0} ${BASE}Z`} fill={p.fill(j as Hue)} />
            );
          })}
        </g>
      </>
    );
  },
  timeline: (p) => {
    const spans: Array<[number, number]> = [[11, 29], [21, 39], [28, 45], [38, 53]];
    return (
      <>
        <path className="da-rule" d={`M${X0 - 1} 16.6H${X1 + 1}M${X0 - 1} 23.2H${X1 + 1}M${X0 - 1} 29.8H${X1 + 1}`} />
        {spans.map(([a, b], i) => (
          <path key={i} className={`da-mark da-a-reach${d(i)}`} d={reach(a, 11 + i * 6.6, b - a, 4.2, 2.1)} fill={p.fill(i as Hue)} />
        ))}
        <path className="da-marker" d="M34 9V38" stroke="var(--da-4)" />
        <circle className="da-dot" cx="34" cy="9" r="1.5" fill="var(--da-4)" />
      </>
    );
  },
  scatter: () => {
    const blue: Pt[] = [[13, 31], [17, 27.5], [20.5, 29], [24, 24.5], [27.5, 25.5], [31, 20.5], [35, 22], [39, 17], [44, 15], [49, 11.5]];
    const amber: Pt[] = [[33, 31.5], [38, 29], [42.5, 32], [46.5, 28], [51, 30.5], [45, 24.5]];
    return (
      <>
        <Rules />
        {blue.map(([x, y], i) => (
          <circle key={`b${i}`} className={`da-dot da-a-pop${d(i % 6)}`} cx={x} cy={y} r="1.9" fill="var(--da-0)" />
        ))}
        {amber.map(([x, y], i) => (
          <circle key={`a${i}`} className={`da-dot da-a-pop${d((i + 2) % 6)}`} cx={x} cy={y} r="1.9" fill="var(--da-1)" />
        ))}
      </>
    );
  },
  bubble: (p) => {
    const bubbles: Array<[number, number, number, Hue]> = [
      [20, 26, 7.5, 0],
      [34, 17.5, 5.5, 1],
      [45, 28, 6.5, 2],
      [49, 13.5, 3.4, 3],
      [29, 32.5, 3.2, 4],
    ];
    return (
      <>
        <Rules />
        {bubbles.map(([x, y, r, h], i) => (
          <circle key={i} className={`da-sep da-a-pop${d(i)}`} cx={x} cy={y} r={r} fill={p.fill(h)} />
        ))}
      </>
    );
  },
  histogram: (p) => {
    const bins = [4, 8, 14, 21, 25, 19, 12, 7, 3];
    const w = (X1 - X0) / bins.length;
    return (
      <>
        <Rules />
        {bins.map((h, i) => (
          <path key={i} className={`da-mark da-a-rise${d(i % 6)}`} d={column(X0 + i * w + 0.3, BASE - h, w - 0.6, BASE, 0.8)} fill={p.fill(2)} />
        ))}
      </>
    );
  },
  boxPlot: () => {
    // [min, q1, median, q3, max], as heights over the baseline.
    const boxes: Array<[number, number, number, number, number]> = [
      [6, 10, 13.5, 17, 22],
      [3, 7, 10, 13, 18],
      [9, 13, 18, 21, 25],
    ];
    return (
      <>
        <Rules />
        {boxes.map(([lo, q1, med, q3, hi], i) => {
          const cx = 17 + i * 15;
          const h = i as Hue;
          return (
            <g key={i} className={`da-a-rise${d(i)}`}>
              <path className="da-whisker" d={`M${cx} ${BASE - hi}V${BASE - q3}M${cx} ${BASE - q1}V${BASE - lo}M${cx - 2} ${BASE - hi}H${cx + 2}M${cx - 2} ${BASE - lo}H${cx + 2}`} stroke={`var(--da-${h})`} />
              <rect className="da-box" x={cx - 4.5} y={BASE - q3} width="9" height={q3 - q1} rx="1.2" fill={`var(--da-${h}-tint)`} stroke={`var(--da-${h})`} />
              <path className="da-median" d={`M${cx - 4.5} ${BASE - med}H${cx + 4.5}`} stroke={`var(--da-${h}-deep)`} />
            </g>
          );
        })}
      </>
    );
  },
  density: (p) => (
    <>
      <Rules />
      {DENSITY.map((c, i) => (
        <g key={i} className={`da-a-rise${d(i)}`}>
          <path className="da-area" d={c.area} fill={p.fade(i ? 3 : 0)} />
          <path className="da-line" d={c.line} stroke={`var(--da-${i ? 3 : 0})`} />
        </g>
      ))}
    </>
  ),
  pie: (p) => pie(p, 0),
  donut: (p) => pie(p, 8.8),
  funnel: () => {
    const widths = [42, 32, 23, 14, 8];
    return (
      <>
        {widths.slice(0, 4).map((w, i) => {
          const y = 10 + i * 6.8;
          const next = widths[i + 1];
          return (
            <path
              key={i}
              className={`da-mark da-a-spread${d(i)}`}
              d={`M${n(32 - w / 2)} ${y}H${n(32 + w / 2)}L${n(32 + next / 2)} ${n(y + 5.8)}H${n(32 - next / 2)}Z`}
              fill={`var(--da-q${4 - i})`}
              strokeLinejoin="round"
            />
          );
        })}
      </>
    );
  },
  treemap: (p) => {
    const cells: Array<[number, number, number, number, Hue]> = [
      [10, 10, 23.4, 27, 0],
      [34.4, 10, 19.6, 14.4, 1],
      [34.4, 25.4, 10.6, 11.6, 2],
      [46, 25.4, 8, 6.2, 3],
      [46, 32.6, 8, 4.4, 4],
    ];
    return (
      <>
        {cells.map(([x, y, w, h, hue], i) => (
          <rect key={i} className={`da-mark da-a-pop${d(i)}`} x={x} y={y} width={w} height={h} rx="1.4" fill={p.fill(hue)} />
        ))}
      </>
    );
  },
  waterfall: (p) => {
    // Start, +6, -4, +7, -3, total.
    const steps: Array<[number, number, Hue]> = [[0, 16, 0], [16, 22, 2], [18, 22, 4], [18, 25, 2], [22, 25, 4], [0, 22, 0]];
    return (
      <>
        <Rules />
        <path
          className="da-connector"
          d={steps
            .slice(0, -1)
            .map(([a, b], i) => {
              const level = i === 0 || steps[i][2] === 2 ? Math.max(a, b) : Math.min(a, b);
              return `M${n(11 + i * 7.5 + 5.6)} ${BASE - level}H${n(11 + (i + 1) * 7.5)}`;
            })
            .join('')}
        />
        {steps.map(([a, b, hue], i) => (
          <path key={i} className={`da-mark da-a-rise${d(i)}`} d={column(11 + i * 7.5, BASE - b, 5.6, BASE - a, 0.9)} fill={p.fill(hue)} />
        ))}
      </>
    );
  },
  radar: () => {
    const ring = (v: number) => poly(Array.from({ length: RADAR_AXES }, (_, i) => radarPoint(i, v)), true);
    const a = [0.95, 0.7, 0.82, 0.42, 0.62, 0.5];
    const b = [0.48, 0.5, 0.58, 0.9, 0.86, 0.8];
    return (
      <>
        <path className="da-rule da-rule--web" d={`${ring(1)}${ring(0.5)}`} />
        <path className="da-rule" d={Array.from({ length: RADAR_AXES }, (_, i) => `M32 23L${radarPoint(i, 1).map(n).join(' ')}`).join('')} />
        <path className="da-web da-a-pop da-d1" d={poly(b.map((v, i) => radarPoint(i, v)), true)} fill="var(--da-1-wash)" stroke="var(--da-1)" />
        <path className="da-web da-a-pop" d={poly(a.map((v, i) => radarPoint(i, v)), true)} fill="var(--da-0-wash)" stroke="var(--da-0)" />
      </>
    );
  },
  network: (p) => {
    const nodes: Array<[number, number, number, Hue]> = [
      [32, 23, 4.2, 0],
      [15, 12.5, 2.6, 1],
      [49, 11.5, 2.9, 2],
      [14, 33, 2.4, 3],
      [48, 34, 3.1, 4],
      [26, 37, 1.9, 1],
    ];
    const edges: Array<[number, number, number]> = [[0, 1, 1.6], [0, 2, 1.2], [0, 3, 0.9], [0, 4, 1.8], [0, 5, 0.8], [1, 3, 0.8], [2, 4, 1], [1, 2, 0.6]];
    return (
      <>
        {edges.map(([a, b, w], i) => (
          <path
            key={i}
            className={`da-edge-line da-a-draw${d(i % 4)}`}
            d={`M${nodes[a][0]} ${nodes[a][1]}L${nodes[b][0]} ${nodes[b][1]}`}
            strokeWidth={w}
            pathLength={1}
          />
        ))}
        {nodes.map(([x, y, r, h], i) => (
          <circle key={i} className={`da-sep da-a-pop${d(i)}`} cx={x} cy={y} r={r} fill={p.fill(h)} />
        ))}
      </>
    );
  },
  function: () => (
    <>
      <Cross />
      <path className="da-line da-a-draw" d={WAVE} stroke="var(--da-0)" pathLength={1} />
      <circle className="da-dot da-feature da-a-pop da-d4" cx="20.7" cy="14" r="1.9" fill="var(--da-1)" />
    </>
  ),
  parametric: () => (
    <>
      <Cross />
      <path className="da-line da-line--fine da-a-draw" d={LISSAJOUS} stroke="var(--da-3)" pathLength={1} />
      <circle className="da-dot da-a-pop da-d4" cx="50" cy="23.5" r="1.9" fill="var(--da-4)" />
    </>
  ),
  polarPlot: () => (
    <>
      <circle className="da-rule" cx="32" cy="23.5" r="7" fill="none" />
      <circle className="da-rule" cx="32" cy="23.5" r="14" fill="none" />
      <path className="da-rule" d="M16 23.5H48M32 7.5V39.5" />
      <path className="da-line da-line--fine da-a-draw" d={ROSE} fill="var(--da-4-wash)" stroke="var(--da-4)" pathLength={1} />
    </>
  ),
  implicit: () => (
    <>
      <Cross />
      <path className="da-line da-a-draw" d={PEANUT} fill="var(--da-2-wash)" stroke="var(--da-2)" pathLength={1} />
    </>
  ),
  contour: () => {
    const level = (cx: number, cy: number, R: number, phase: number) =>
      closed(cx, cy, (t) => R * (1 + 0.1 * Math.sin(3 * t + phase) + 0.05 * Math.cos(2 * t)), 1.35, 1);
    const hill: Array<[number, Hue]> = [[13.5, 0], [10, 2], [6.6, 1], [3.4, 4]];
    return (
      <>
        {hill.map(([R, h], i) => (
          <path key={i} className={`da-contour da-a-pop${d(i)}`} d={level(28, 23, R, 0.6 + i * 0.3)} stroke={`var(--da-${h})`} />
        ))}
        <path className="da-contour da-a-pop da-d2" d={level(47.5, 31, 4.2, 1.2)} stroke="var(--da-3)" />
      </>
    );
  },
  slopeField: () => (
    <>
      {SLOPES.segs.map((seg, i) => (
        <path key={i} className={`da-slope da-a-tilt${d(i % 7)}`} d={seg} />
      ))}
      <path className="da-line da-a-draw da-d2" d={SLOPES.solution} stroke="var(--da-1)" pathLength={1} />
    </>
  ),
  vectorField: () => (
    <>
      {VORTEX.map((a, i) => (
        <path key={i} className={`da-arrow da-a-tilt${d(a.band)}`} d={a.d} stroke={`var(--da-q${Math.max(1, a.q)})`} />
      ))}
    </>
  ),
  heatmap: (p) => (
    <>
      <rect className="da-mark" x={X0} y={TOP - 1} width={X1 - X0} height={BASE - TOP + 2} rx="2" fill="var(--da-q1)" />
      <g className="da-surface">
        <ellipse className="da-a-pop" cx="23" cy="20" rx="15" ry="12" fill={p.glow(3)} />
        <ellipse className="da-a-pop da-d1" cx="43" cy="29" rx="13" ry="10" fill={p.glow(4)} />
        <ellipse className="da-a-pop da-d2" cx="24" cy="21" rx="8" ry="6.5" fill={p.glow(1)} />
      </g>
    </>
  ),
};

/* ---------------------------------------------------------------- grids */

/** The plate is the page. Layout runs at this size and is scaled onto it. */
const PAGE_W = 960;
const PAGE_H = (PAGE_W * PLATE.h) / PLATE.w;
const SCALE = PLATE.w / PAGE_W;
/** The narrowest gutter the plate can show: one unit of the art. */
const MIN_GUTTER = 1 / SCALE;
/**
 * A margin is drawn this much deeper than the page scale would make it.
 *
 * The second liberty, and the reason for it is the same: at plate size a
 * 48-unit margin is under three pixels, and a manuscript's wide margin -- the
 * whole point of choosing it -- reads as a hairline. Deepened evenly, the
 * presets keep their order (four < twelve < Swiss < manuscript) and the
 * difference between them becomes visible.
 */
const MARGIN_DEPTH = 1.6;
/** Kinds arrive with no margin; the art gives them some paper round the edge. */
const KIND_MARGIN = 4 / SCALE / MARGIN_DEPTH;

type GridNumbers = Pick<GridSpec, 'rows' | 'columns' | 'gutterX' | 'gutterY' | 'margin' | 'variation'>;

/** How a grid tile is coloured: which hue each cell takes, and how strongly. */
type CellPaint = (cell: GridCell, i: number) => { hue: Hue; tier: Tier };

const solid = (hue: Hue): CellPaint => () => ({ hue, tier: 0 });
/** The layout's own weight, which says which module is the hero, as a tier. */
const tierOf = (weight: number): Tier => (weight > 0.85 ? 0 : weight > 0.45 ? 1 : 2);
const byWeight = (hue: Hue): CellPaint => (c) => ({ hue, tier: tierOf(c.weight) });
const cycle = (hues: Hue[]): CellPaint => (_c, i) => ({ hue: hues[i % hues.length], tier: 0 });

interface GridLook {
  paint: CellPaint;
  /** Tint the area inside the margin, so the gutters show as well as the margin. */
  field?: boolean;
  /** The four points a composition is placed on. */
  powerPoints?: boolean;
  /** Cells that touch, parted by a line of the plate. */
  touching?: boolean;
}

const KIND_LOOK: Record<GridKind, GridLook> = {
  columns: { paint: solid(0) },
  modular: { paint: solid(3) },
  bento: { paint: cycle([0, 1, 2, 3, 4]) },
  masonry: { paint: cycle([2, 0, 1, 3]) },
  hierarchical: { paint: (c) => (c.weight > 0.99 ? { hue: 1, tier: 0 } : { hue: 0, tier: tierOf(c.weight) === 1 ? 1 : 2 }) },
  manuscript: { paint: solid(1) },
  baseline: { paint: byWeight(4) },
  golden: { paint: (_c, i) => ({ hue: 1, tier: Math.min(2, i) as Tier }) },
  // Each ring its own hue, so the rings read as rings and not as a scatter.
  orbit: { paint: (c) => ({ hue: ([3, 0, 2] as Hue[])[c.row % 3], tier: 0 }) },
  radial: { paint: cycle([0, 3, 4, 1, 2]) },
  diagonal: { paint: (c) => ({ hue: 4, tier: c.row % 2 ? 1 : 0 }) },
  isometric: { paint: (c) => ({ hue: 0, tier: (c.row % 3) as Tier }) },
};

const PRESET_LOOK: Record<string, GridLook> = {
  twelve: { paint: solid(0), field: true },
  eight: { paint: solid(3), field: true },
  four: { paint: solid(2), field: true },
  thirds: { paint: (c) => ({ hue: 1, tier: (c.row + c.col) % 2 ? 2 : 1 }), powerPoints: true, touching: true },
  'contact-sheet': { paint: cycle([0, 1, 2, 3, 4, 2, 0]), field: true },
  swiss: { paint: (c) => ({ hue: 4, tier: c.col === 0 ? 0 : 2 }), field: true },
  manuscript: { paint: solid(1), field: true },
  'bento-wall': KIND_LOOK.bento,
  'isometric-3d': KIND_LOOK.isometric,
};

const layoutCache = new Map<string, GridCell[]>();

function cellsFor(key: string, kind: GridKind, numbers: GridNumbers): GridCell[] {
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const widen = (g: number) => (g > 0 ? Math.max(g, MIN_GUTTER) : 0);
  const cells = layoutGrid({
    kind,
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    ...numbers,
    margin: numbers.margin * MARGIN_DEPTH,
    gutterX: widen(numbers.gutterX),
    gutterY: widen(numbers.gutterY),
    seed: 1,
  });
  layoutCache.set(key, cells);
  return cells;
}

/** The outline of a cell on the plate, as a path. */
function cellPath(c: GridCell): string {
  const ox = PLATE.x + c.x * SCALE;
  const oy = PLATE.y + c.y * SCALE;
  if (c.outline && c.outline.length > 2) {
    return poly(c.outline.map((pt) => [ox + pt.x * SCALE, oy + pt.y * SCALE] as const), true);
  }
  const w = c.width * SCALE;
  const h = c.height * SCALE;
  const r = Math.min(1, w / 3, h / 3);
  return `M${n(ox + r)} ${n(oy)}H${n(ox + w - r)}Q${n(ox + w)} ${n(oy)} ${n(ox + w)} ${n(oy + r)}V${n(oy + h - r)}Q${n(ox + w)} ${n(oy + h)} ${n(ox + w - r)} ${n(oy + h)}H${n(ox + r)}Q${n(ox)} ${n(oy + h)} ${n(ox)} ${n(oy + h - r)}V${n(oy + r)}Q${n(ox)} ${n(oy)} ${n(ox + r)} ${n(oy)}Z`;
}

function gridScene(cells: GridCell[], look: GridLook, margin: number): Scene {
  return (p) => {
    const m = margin * MARGIN_DEPTH * SCALE;
    const inner = { x: PLATE.x + m, y: PLATE.y + m, w: PLATE.w - 2 * m, h: PLATE.h - 2 * m };
    const fieldHue = cells.length ? look.paint(cells[0], 0).hue : 0;
    return (
      <>
        {look.field && m > 0 && (
          <rect x={n(inner.x)} y={n(inner.y)} width={n(inner.w)} height={n(inner.h)} rx="0.8" fill={`var(--da-${fieldHue}-field)`} />
        )}
        {cells.map((c, i) => {
          const { hue, tier } = look.paint(c, i);
          // Stagger by column, so a row of tracks breathes left to right.
          const step = c.col % 6;
          // A cell too small to carry an edge keeps its hue under increased
          // contrast rather than turning into a ring of outline.
          const edge = look.touching ? 'da-sep' : Math.min(c.width, c.height) * SCALE < 3.5 ? 'da-cell' : 'da-mark';
          return (
            <path
              key={i}
              className={`${edge} da-a-breathe${d(step)}`}
              d={cellPath(c)}
              fill={p.fill(hue, tier)}
            />
          );
        })}
        {look.powerPoints &&
          [1, 2].flatMap((r) =>
            [1, 2].map((c) => (
              <circle
                key={`${r}${c}`}
                className={`da-dot da-power da-a-pop${d(r + c - 1)}`}
                cx={n(PLATE.x + (PLATE.w * c) / 3)}
                cy={n(PLATE.y + (PLATE.h * r) / 3)}
                r="1.7"
                fill="var(--da-1-deep)"
              />
            ))
          )}
      </>
    );
  };
}

const presetSceneCache = new Map<string, Scene>();

function presetScene(id: string): Scene | null {
  const hit = presetSceneCache.get(id);
  if (hit) return hit;
  // Only real presets are cached, so the cache is bounded by the preset list.
  const preset = gridPreset(id);
  if (!preset) return null;
  const numbers: GridNumbers = { ...KIND_DEFAULTS[preset.kind], margin: 0, ...preset.patch };
  const look = PRESET_LOOK[preset.id] ?? KIND_LOOK[preset.kind];
  const scene = gridScene(cellsFor(`p:${id}`, preset.kind, numbers), look, numbers.margin);
  presetSceneCache.set(id, scene);
  return scene;
}

const kindSceneCache = new Map<GridKind, Scene>();

function kindScene(kind: GridKind): Scene {
  const hit = kindSceneCache.get(kind);
  if (hit) return hit;
  const numbers: GridNumbers = { ...KIND_DEFAULTS[kind], margin: KIND_MARGIN };
  const scene = gridScene(cellsFor(`k:${kind}`, kind, numbers), KIND_LOOK[kind], numbers.margin);
  kindSceneCache.set(kind, scene);
  return scene;
}

/* -------------------------------------------------------------- exports */

/**
 * A chart kind, as a lit tile. `size` is the width in pixels; the tile is 4:3.
 * A kind with no art (one read from a newer board, say) draws nothing.
 */
export const ChartArt = React.memo(function ChartArt({ kind, size = 64 }: { kind: ChartKind; size?: number }) {
  const scene = CHART_SCENES[kind] as Scene | undefined;
  return scene ? <Tile scene={scene} size={size} kind={kind} /> : null;
});

/**
 * A named grid preset (`GRID_PRESETS`), laid out from its own numbers.
 * An id that names no preset draws nothing.
 */
export const GridArt = React.memo(function GridArt({ preset, size = 64 }: { preset: string; size?: number }) {
  const scene = presetScene(preset);
  return scene ? <Tile scene={scene} size={size} kind={`grid-${preset}`} /> : null;
});

/** A grid system (`GRID_KINDS`) at its own defaults: what the dock's Grid sheet offers. */
export const GridKindArt = React.memo(function GridKindArt({ kind, size = 64 }: { kind: GridKind; size?: number }) {
  return <Tile scene={kindScene(kind)} size={size} kind={`grid-${kind}`} />;
});

/* ---------------------------------------------------------- seat art */

/**
 * The Data seats, coloured.
 *
 * On the dock glyphs' own grid (`glyphs.tsx`: 24 units, a 1.75 stroke, round
 * caps) and with the same silhouettes, so a coloured seat sits in a row of
 * line glyphs as the same family: the frame and the baseline stay
 * `currentColor` and reverse on the armed seat's marker like every other
 * glyph, and only the data inside takes the palette.
 */
function SeatSvg({ size, seat, children }: { size: number; seat: DataSeat; children: (id: string) => React.ReactNode }) {
  const id = `ds${useId().replace(/:/g, '')}`;
  return (
    <svg className="data-art data-art--seat" data-art={`seat-${seat}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        {([0, 1, 2, 3] as Hue[]).map((h) => (
          <linearGradient key={h} id={`${id}-h${h}`} className={`da-k${h} da-tier0`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="da-stop-lit" />
            <stop offset="1" className="da-stop" />
          </linearGradient>
        ))}
      </defs>
      {children(id)}
    </svg>
  );
}

const SEATS: Record<DataSeat, (id: string) => React.ReactNode> = {
  chart: (id) => (
    <>
      <path className="da-seat-mark da-a-rise" d={column(5.4, 11, 3.2, 17.6, 0.9)} fill={`url(#${id}-h0)`} />
      <path className="da-seat-mark da-a-rise da-d1" d={column(10.4, 5.6, 3.2, 17.6, 0.9)} fill={`url(#${id}-h1)`} />
      <path className="da-seat-mark da-a-rise da-d2" d={column(15.4, 8.6, 3.2, 17.6, 0.9)} fill={`url(#${id}-h2)`} />
      <path className="da-seat-line" d="M4 20H20" />
    </>
  ),
  grid: (id) => (
    <>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          className={`da-seat-mark da-a-breathe${d(i)}`}
          x={n(6.6 + i * 4.2)}
          y="6.6"
          width="2.4"
          height="10.8"
          rx="0.7"
          fill={`url(#${id}-h${[0, 3, 2][i]})`}
        />
      ))}
      <rect className="da-seat-line" x="4" y="4" width="16" height="16" rx="2" />
    </>
  ),
  table: (id) => (
    <>
      <path className="da-seat-mark da-a-fade" d="M4.9 9.1V7Q4.9 5.9 6 5.9H18Q19.1 5.9 19.1 7V9.1Z" fill={`url(#${id}-h1)`} />
      <rect className="da-seat-line" x="4" y="5" width="16" height="14" rx="2" />
      <path className="da-seat-line" d="M4 10H20M10 10V19" />
    </>
  ),
};

/**
 * A Data seat's glyph with its data in colour. Drawn for 20–24px; the dock's
 * `.dock-btn svg` rule sizes it with the rest of the row.
 */
export const DataSeatArt = React.memo(function DataSeatArt({ seat, size = 24 }: { seat: DataSeat; size?: number }) {
  return (
    <SeatSvg size={size} seat={seat}>
      {SEATS[seat]}
    </SeatSvg>
  );
});
