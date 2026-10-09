import React from 'react';
import {
  AN,
  GE,
  lerp,
  prog,
  sampleCursor,
  SCRIPTS,
  SH,
  standard,
  TIMES,
  VO,
  win,
  type ScriptedId,
} from '../../engine/learn/demoScript';
import { Bar, f, grow, Sel, type SceneProps } from './sceneKit';

/**
 * The scenes for slides, grid editing, point editing, sketch mode, shadows,
 * touch and voice notes.
 *
 * Same rules as `scenes.tsx`: a pure function of the clock, authored on the
 * 224 by 128 stage, painted from the product's tokens. Nothing overshoots, and
 * every state change eases on the product's settle curve so a loop reads as
 * one hand rather than a slideshow.
 */

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/* ============================================================== slides */

/** What each slide in the deck carries, so they are told apart at a glance. */
const SlideArt: React.FC<{ kind: number; x: number; y: number; w: number; h: number }> = ({ kind, x, y, w, h }) => {
  const u = w / 160;
  return (
    <g>
      <Bar x={x + 12 * u} y={y + 12 * u} w={50 * u} h={Math.max(2.4, 6 * u)} fill="var(--text-primary)" o={0.85} />
      {kind === 0 && (
        <>
          <Bar x={x + 12 * u} y={y + 28 * u} w={92 * u} h={Math.max(2, 4 * u)} />
          <Bar x={x + 12 * u} y={y + 38 * u} w={72 * u} h={Math.max(2, 4 * u)} />
          <circle cx={x + w - 34 * u} cy={y + h - 32 * u} r={20 * u} fill="var(--accent)" opacity={0.55} />
        </>
      )}
      {kind === 1 &&
        [0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={x + (16 + i * 30) * u}
            y={y + h - (14 + [26, 44, 34, 56][i] * u)}
            width={20 * u}
            height={[26, 44, 34, 56][i] * u}
            rx={2 * u}
            fill="var(--accent)"
            opacity={0.35 + i * 0.15}
          />
        ))}
      {kind === 2 && (
        <>
          <rect x={x + 12 * u} y={y + 28 * u} width={64 * u} height={50 * u} rx={3 * u} fill="var(--text-tertiary)" opacity={0.45} />
          <Bar x={x + 88 * u} y={y + 32 * u} w={52 * u} h={Math.max(2, 4 * u)} />
          <Bar x={x + 88 * u} y={y + 42 * u} w={40 * u} h={Math.max(2, 4 * u)} />
        </>
      )}
      {kind === 3 && (
        <>
          {[0, 1, 2].map((i) => (
            <Bar key={i} x={x + 12 * u} y={y + (30 + i * 12) * u} w={(100 - i * 18) * u} h={Math.max(2, 4 * u)} />
          ))}
        </>
      )}
    </g>
  );
};

const SLIDE_CARDS = [
  { x: 38, y: 16 },
  { x: 118, y: 16 },
  { x: 38, y: 68 },
  { x: 118, y: 68 },
] as const;

const SlidesScene: React.FC<SceneProps> = ({ t, uid }) => {
  const T = TIMES.slides;
  const clip = `${uid}-deck`;
  const full = { x: 32, y: 14, w: 160, h: 100 };
  const grid = 1 - prog(t, 2400, 460);
  const pick = prog(t, T.pickAt, 180, (x) => x);
  const open = prog(t, 2500, 640);
  const push = prog(t, T.pushAt, T.pushEnd - T.pushAt, standard);
  const laser = prog(t, T.laserAt - 200, 360, (x) => x);

  const card = SLIDE_CARDS[1];
  const rect = {
    x: lerp(card.x, full.x, open),
    y: lerp(card.y, full.y, open),
    w: lerp(68, full.w, open),
    h: lerp(42, full.h, open),
  };

  // The laser: the ghost pointer's last half second, drawn as a fading comet.
  const trail = range(9).map((i) => sampleCursor(SCRIPTS.slides.cursor, Math.max(0, t - i * 55)));
  const lead = trail[0];

  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={full.x} y={full.y} width={full.w} height={full.h} rx={4} />
        </clipPath>
      </defs>

      <g opacity={grid}>
        {SLIDE_CARDS.map((c, i) => (
          <g key={i} opacity={i === 1 ? 0 : 1}>
            <rect className="sd-card" x={c.x} y={c.y} width={68} height={42} rx={3} />
            <SlideArt kind={i} x={c.x} y={c.y} w={68} h={42} />
            <Bar x={c.x} y={c.y + 47} w={14} h={3} fill="var(--text-tertiary)" />
          </g>
        ))}
      </g>

      {/* The picked card, which grows into the show. */}
      <g>
        <rect className="sd-card" x={f(rect.x)} y={f(rect.y)} width={f(rect.w)} height={f(rect.h)} rx={3} />
        {open < 0.02 && <SlideArt kind={1} x={rect.x} y={rect.y} w={rect.w} h={rect.h} />}
        {open < 0.02 && <Sel x={rect.x} y={rect.y} w={rect.w} h={rect.h} o={pick} r={5} />}
      </g>

      {open >= 0.02 && (
        <g clipPath={`url(#${clip})`}>
          <g transform={`translate(${f(-push * full.w)} 0)`}>
            <rect className="sd-slide" x={full.x} y={full.y} width={full.w} height={full.h} />
            <SlideArt kind={1} x={full.x} y={full.y} w={full.w} h={full.h} />
          </g>
          <g transform={`translate(${f((1 - push) * full.w)} 0)`}>
            <rect className="sd-slide" x={full.x} y={full.y} width={full.w} height={full.h} />
            <SlideArt kind={2} x={full.x} y={full.y} w={full.w} h={full.h} />
          </g>
          <rect x={full.x} y={full.y} width={full.w} height={full.h} rx={4} fill="none" className="sd-sel" opacity={open} />
        </g>
      )}

      {/* The name of the transition, for the length of it. */}
      {win(t, T.pushAt - 200, T.pushEnd + 700, 240) > 0.01 && (
        <g opacity={win(t, T.pushAt - 200, T.pushEnd + 700, 240)} transform={`translate(0 ${f((1 - win(t, T.pushAt - 200, T.pushEnd + 700, 240)) * 4)})`}>
          <rect className="sd-pill" x={96} y={100} width={32} height={11} rx={5.5} />
          <text className="sd-pill-text sd-pill-text--s" x={112} y={107.6} textAnchor="middle">
            Push
          </text>
        </g>
      )}

      {laser > 0.01 && (
        <g opacity={laser}>
          {trail
            .slice(1)
            .map((p, i) => (
              <line
                key={i}
                x1={f(trail[i].x)}
                y1={f(trail[i].y)}
                x2={f(p.x)}
                y2={f(p.y)}
                stroke="#FF3B30"
                strokeWidth={Math.max(0.6, 3.2 - i * 0.34)}
                strokeLinecap="round"
                opacity={Math.max(0, 0.7 - i * 0.08)}
              />
            ))}
          <circle cx={f(lead.x)} cy={f(lead.y)} r={7} fill="#FF3B30" opacity={0.22} />
          <circle cx={f(lead.x)} cy={f(lead.y)} r={3.3} fill="#FF3B30" />
        </g>
      )}
    </g>
  );
};

/* ============================================================ gridedit */

const GridEditScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.gridedit;
  const d1 = prog(t, T.dragAt, T.dragEnd - T.dragAt, standard);
  const d2 = prog(t, T.altAt, T.altEnd - T.altAt, standard);
  const c1 = lerp(GE.edges[1], GE.drag1, d1);
  const c2 = lerp(GE.edges[2], GE.drag2, d2);
  const right = GE.edges[3] + (c2 - GE.edges[2]);
  const xs = [GE.edges[0], c1, c2, right];
  const ys = GE.rows;

  const active = t < T.altAt - 300 ? (d1 > 0 && d1 < 1 ? 1 : 0) : d2 > 0 && d2 < 1 ? 2 : 0;
  const hold = (n: number) => (n === 1 ? d1 : d2);

  const dbl = prog(t, T.dblAt, 200, (x) => x);
  const type = prog(t, T.dblAt + 500, 1200, (x) => x);
  const caret = Math.floor(t / 480) % 2 === 0;
  const cx0 = xs[0] + 1.5;
  const cy0 = ys[1] + 1.5;

  return (
    <g>
      <rect className="sd-card sd-card--ghost" x={f(xs[0] - 3)} y={ys[0] - 3} width={f(right - xs[0] + 6)} height={ys[2] - ys[0] + 6} rx={5} />
      {range(2).map((r) =>
        range(3).map((c) => {
          const x = xs[c] + 1.5;
          const w = xs[c + 1] - xs[c] - 3;
          const y = ys[r] + 1.5;
          const h = ys[r + 1] - ys[r] - 3;
          const first = r === 0 && c === 0;
          return (
            <g key={`${r}-${c}`}>
              <rect className="sd-card" x={f(x)} y={y} width={f(w)} height={h} rx={3} />
              {first && <rect x={f(x + 4)} y={y + 4} width={f(w - 8)} height={h - 8} rx={2} fill="var(--accent)" opacity={0.4} />}
              {!first && !(r === 1 && c === 0) && (
                <>
                  <Bar x={x + 6} y={y + 7} w={Math.max(0, Math.min(w - 12, 34))} />
                  <Bar x={x + 6} y={y + 16} w={Math.max(0, Math.min(w - 12, 22))} />
                </>
              )}
            </g>
          );
        })
      )}

      {/* The border being dragged, with the handle it is held by. */}
      {active > 0 && (
        <g>
          <line x1={f(xs[active])} y1={ys[0] - 6} x2={f(xs[active])} y2={ys[2] + 6} className="sd-sel" strokeWidth={2} />
          <rect x={f(xs[active] - 2.5)} y={f((ys[0] + ys[2]) / 2 - 8)} width={5} height={16} rx={2.5} fill="var(--text-primary)" opacity={Math.min(1, hold(active) * 8)} />
        </g>
      )}

      {/* Double-click: the cell opens for typing. */}
      {dbl > 0.01 && (
        <g>
          <rect className="sd-sel" x={f(cx0 - 2)} y={cy0 - 2} width={f(xs[1] - xs[0] - 3 + 4)} height={ys[2] - ys[1] - 3 + 4} rx={5} opacity={dbl} />
          <Bar x={cx0 + 8} y={cy0 + 14} w={46 * type} h={4} fill="var(--text-primary)" o={0.8} />
          <Bar x={cx0 + 8} y={cy0 + 24} w={28 * Math.max(0, type * 1.6 - 0.6)} h={4} fill="var(--text-primary)" o={0.8} />
          {caret && type < 1 && <rect x={f(cx0 + 10 + 28 * Math.max(0, type * 1.6 - 0.6))} y={cy0 + 21} width={1.5} height={10} fill="var(--text-primary)" />}
        </g>
      )}
    </g>
  );
};

/* ============================================================== anchors */

/** A closed path through the points, rounded by the midpoints between them. */
function smoothClosed(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  const mid = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const start = mid(pts[n - 1], pts[0]);
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < n; i += 1) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    d += ` Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`;
  }
  return `${d}Z`;
}

const AnchorsScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.anchors;
  const sweep = prog(t, T.marqueeAt, T.marqueeEnd - T.marqueeAt, standard);
  const picked = prog(t, T.marqueeEnd, 220, (x) => x);
  const sc = prog(t, T.scaleAt, T.scaleEnd - T.scaleAt, standard);
  const [mx0, my0, mx1, my1] = AN.marquee;
  const box = AN.box;
  const w = box.w + AN.drag[0] * sc;
  const h = box.h + AN.drag[1] * sc;
  const sx = w / box.w;
  const sy = h / box.h;

  const pts = AN.points.map((p, i) =>
    AN.picked.includes(i) ? ([box.x + (p[0] - box.x) * sx, box.y + (p[1] - box.y) * sy] as const) : ([p[0], p[1]] as const)
  );

  return (
    <g>
      <path d={smoothClosed(pts)} className="sd-card" fill="var(--surface-primary)" strokeWidth={1.75} strokeLinejoin="round" />
      <path d={smoothClosed(pts)} fill="var(--accent)" opacity={0.14} />

      {t < T.marqueeEnd + 220 && sweep > 0 && (
        <rect
          x={mx0}
          y={my0}
          width={f((mx1 - mx0) * sweep)}
          height={f((my1 - my0) * sweep)}
          className="sd-sel sd-sel--dashed"
          fill="var(--text-primary)"
          fillOpacity={0.06}
          opacity={1 - picked}
          strokeWidth={1.2}
        />
      )}

      {picked > 0.01 && (
        <g opacity={picked}>
          <rect className="sd-sel sd-sel--dashed" x={box.x} y={box.y} width={f(w)} height={f(h)} strokeWidth={1.2} />
          {[
            [box.x, box.y],
            [box.x + w, box.y],
            [box.x, box.y + h],
            [box.x + w, box.y + h],
          ].map(([x, y], i) => (
            <rect key={i} x={f(x - 2.8)} y={f(y - 2.8)} width={5.6} height={5.6} rx={1.2} fill="var(--surface-primary)" stroke="var(--text-primary)" strokeWidth={1.3} />
          ))}
        </g>
      )}

      {pts.map((p, i) => {
        const on = AN.picked.includes(i) && picked > 0.5;
        return (
          <rect
            key={i}
            x={f(p[0] - 3)}
            y={f(p[1] - 3)}
            width={6}
            height={6}
            rx={1.2}
            fill={on ? 'var(--text-primary)' : 'var(--surface-primary)'}
            stroke="var(--text-primary)"
            strokeWidth={1.3}
          />
        );
      })}
    </g>
  );
};

/* =============================================================== sketch */

/** A tiny deterministic noise, so a sketched line wobbles the same way every loop. */
const noise = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/** A polyline between points, bent and jittered the way a pen drawing it by hand would. */
function roughPath(pts: readonly (readonly [number, number])[], seed: number, tick: number, amp = 1.6): string {
  let d = '';
  let k = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const parts = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 14));
    for (let j = 0; j <= parts; j += 1) {
      if (i > 0 && j === 0) continue;
      const p = j / parts;
      const bow = Math.sin(p * Math.PI) * noise(seed, i + 3);
      const x = lerp(a[0], b[0], p) + noise(seed + k, tick) * amp + bow * 0.8;
      const y = lerp(a[1], b[1], p) + noise(seed + k + 9, tick + 4) * amp + bow * 0.8;
      d += `${d ? 'L' : 'M'}${f(x)} ${f(y)} `;
      k += 1;
    }
  }
  return d;
}

const ellipsePts = (cx: number, cy: number, rx: number, ry: number, n = 16, over = 1.08) =>
  range(n + 2).map((i) => {
    const th = (i / n) * Math.PI * 2 * over - Math.PI / 2;
    return [cx + rx * Math.cos(th), cy + ry * Math.sin(th)] as const;
  });

const SketchScene: React.FC<SceneProps> = ({ t, uid }) => {
  const T = TIMES.sketch;
  const mix = prog(t, T.onAt, 520) * (1 - prog(t, T.offAt, 520));
  const tick = Math.floor(t / 130) % 3;
  const clip = `${uid}-box`;
  const box = [32, 30, 64, 44] as const;
  const boxPts = [
    [box[0], box[1]],
    [box[0] + box[2], box[1]],
    [box[0] + box[2], box[1] + box[3]],
    [box[0], box[1] + box[3]],
    [box[0], box[1]],
  ] as const;
  const circ = { cx: 160, cy: 52, r: 24 };
  const arrowPts = [
    [100, 52],
    [132, 52],
  ] as const;
  const lowPts = [
    [48, 98],
    [112, 98],
    [112, 84],
  ] as const;

  const ink = { fill: 'none', stroke: 'var(--text-primary)', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} />
        </clipPath>
      </defs>

      <g opacity={1 - mix}>
        <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} rx={2} {...ink} strokeWidth={2} />
        <circle cx={circ.cx} cy={circ.cy} r={circ.r} {...ink} strokeWidth={2} />
        <path d="M100 52 H132 M126 47 L132 52 L126 57" {...ink} strokeWidth={2} />
        <path d="M48 98 H112 V84 M107 89 L112 84 L117 89" {...ink} strokeWidth={2} />
        <rect x={box[0] + 8} y={box[1] + 8} width={30} height={5} rx={2.5} fill="var(--text-tertiary)" />
      </g>

      <g opacity={mix}>
        <g clipPath={`url(#${clip})`} stroke="var(--accent)" strokeWidth={1.3} opacity={0.5} strokeLinecap="round">
          {range(14).map((i) => (
            <line key={i} x1={box[0] - 8 + i * 8 + noise(i, tick) * 0.6} y1={box[1] + box[3] + 4} x2={box[0] + 20 + i * 8 + noise(i + 5, tick) * 0.6} y2={box[1] - 4} />
          ))}
        </g>
        <path d={roughPath(boxPts, 1, tick)} {...ink} strokeWidth={1.9} />
        <path d={roughPath(boxPts, 7, tick + 1, 1.3)} {...ink} strokeWidth={1.1} opacity={0.6} />
        <path d={roughPath(ellipsePts(circ.cx, circ.cy, circ.r, circ.r), 2, tick)} {...ink} strokeWidth={1.9} />
        <path d={roughPath(ellipsePts(circ.cx, circ.cy, circ.r - 0.5, circ.r + 0.8, 14, 1.12), 9, tick + 1, 1.2)} {...ink} strokeWidth={1.1} opacity={0.6} />
        <path d={`${roughPath(arrowPts, 3, tick)}`} {...ink} strokeWidth={1.9} />
        <path d={roughPath([[126, 47], [132, 52], [126, 57]], 4, tick, 0.9)} {...ink} strokeWidth={1.9} />
        <path d={roughPath(lowPts, 5, tick)} {...ink} strokeWidth={1.9} />
        <path d={roughPath([[107, 89], [112, 84], [117, 89]], 6, tick, 0.9)} {...ink} strokeWidth={1.9} />
        <path d={roughPath([[box[0] + 8, box[1] + 11], [box[0] + 38, box[1] + 11]], 8, tick, 1)} {...ink} stroke="var(--text-tertiary)" strokeWidth={3} />
      </g>
    </g>
  );
};

/* =============================================================== shadow */

const ShadowScene: React.FC<SceneProps> = ({ t, uid }) => {
  const T = TIMES.shadow;
  const drop = `${uid}-drop`;
  const soft = `${uid}-soft`;
  const clip = `${uid}-card`;
  const on = prog(t, T.onAt, 420);
  const blur = lerp(1.5, 8, prog(t, T.blurAt, T.blurEnd - T.blurAt, standard));
  const inner = prog(t, T.innerAt, 520);
  const segX = lerp(146, 178, inner);
  const knob = lerp(SH.slider[0], SH.slider[2], prog(t, T.blurAt, T.blurEnd - T.blurAt, standard));
  const card = { x: 26, y: 28, w: 94, h: 68 };

  return (
    <g>
      <defs>
        <filter id={drop} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy={f(blur * 0.55)} stdDeviation={f(blur * 0.7)} floodColor="#000" floodOpacity={f(0.34 * on * (1 - inner))} />
        </filter>
        <filter id={soft} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
        <clipPath id={clip}>
          <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={7} />
        </clipPath>
      </defs>

      <g filter={`url(#${drop})`}>
        <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={7} fill="var(--surface-primary)" stroke="var(--text-tertiary)" strokeWidth={1.1} />
      </g>
      <g clipPath={`url(#${clip})`}>
        <g transform="translate(0 2.2)" opacity={0.42 * inner} filter={`url(#${soft})`}>
          <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={7} fill="none" stroke="#000" strokeWidth={13} />
        </g>
      </g>
      <Bar x={card.x + 12} y={card.y + 14} w={42} h={6} fill="var(--text-primary)" o={0.85} />
      <Bar x={card.x + 12} y={card.y + 28} w={64} h={4} />
      <Bar x={card.x + 12} y={card.y + 37} w={48} h={4} />
      <circle cx={card.x + card.w - 22} cy={card.y + card.h - 18} r={9} fill="var(--accent)" opacity={0.5} />

      {/* The Effects panel. */}
      <rect className="sd-card" x={138} y={16} width={78} height={96} rx={5} />
      <Bar x={146} y={24} w={26} h={4} fill="var(--text-primary)" o={0.8} />
      <rect x={172} y={29} width={20} height={10} rx={5} fill={on > 0.5 ? 'var(--text-primary)' : 'var(--text-tertiary)'} opacity={on > 0.5 ? 1 : 0.5} />
      <circle cx={lerp(177, 187, on)} cy={34} r={3.6} fill="var(--surface-primary)" />
      <Bar x={146} y={50} w={22} h={3} />
      <rect x={SH.slider[0]} y={61} width={SH.slider[2] - SH.slider[0]} height={2.6} rx={1.3} fill="var(--text-tertiary)" opacity={0.4} />
      <rect x={SH.slider[0]} y={61} width={f(knob - SH.slider[0])} height={2.6} rx={1.3} fill="var(--text-primary)" opacity={0.85 * on} />
      <circle cx={f(knob)} cy={62.3} r={4} fill="var(--surface-primary)" stroke="var(--text-primary)" strokeWidth={1.4} />
      <rect x={146} y={80} width={64} height={20} rx={5} className="sd-well" />
      <rect x={f(segX + 1.5)} y={81.5} width={30} height={17} rx={4} fill="var(--surface-primary)" stroke="var(--text-tertiary)" strokeWidth={1} />
      <text className="sd-soft sd-pill-text sd-pill-text--s" style={{ fill: 'var(--text-primary)' }} x={162} y={92.4} textAnchor="middle">
        Drop
      </text>
      <text className="sd-soft sd-pill-text sd-pill-text--s" style={{ fill: 'var(--text-primary)' }} x={194} y={92.4} textAnchor="middle">
        Inner
      </text>
    </g>
  );
};

/* ================================================================ touch */

const Finger: React.FC<{ x: number; y: number; o?: number; press?: number }> = ({ x, y, o = 1, press = 0 }) =>
  o > 0.01 ? (
    <g opacity={o}>
      <circle cx={f(x)} cy={f(y)} r={9 + press * 2} fill="var(--text-primary)" opacity={0.12} />
      <circle cx={f(x)} cy={f(y)} r={5.4} fill="var(--text-primary)" opacity={0.78} stroke="var(--surface-primary)" strokeWidth={1.2} />
    </g>
  ) : null;

const TouchScene: React.FC<SceneProps> = ({ t }) => {
  // Pinch.
  const pinchIn = win(t, 350, 2900, 260);
  const pinch = prog(t, 600, 1800, standard);
  const zoom = lerp(1, 1.55, pinch);
  const aSpread = [lerp(94, 62, pinch), lerp(66, 52, pinch)] as const;
  const bSpread = [lerp(130, 160, pinch), lerp(62, 76, pinch)] as const;
  const camBack = prog(t, 3000, 520);
  const k = lerp(zoom, 1, camBack);

  // Long-press.
  const pressIn = win(t, 3300, 5200, 220);
  const ring = prog(t, 3500, 800, (x) => x);
  const menu = prog(t, 4350, 420);

  // Two- and three-finger taps.
  const twoAt = 5700;
  const threeAt = 6900;
  const tapRing = (at: number) => prog(t, at, 520);
  const twoIn = win(t, twoAt - 250, twoAt + 900, 160);
  const threeIn = win(t, threeAt - 250, threeAt + 900, 160);
  const objOn = t < twoAt + 160 || t >= threeAt + 160;

  return (
    <g>
      <g transform={`translate(112 64) scale(${f(k)}) translate(-112 -64)`}>
        {range(6).map((r) => range(10).map((c) => <circle key={`${r}-${c}`} className="sd-dot" cx={14 + c * 22} cy={8 + r * 22} r={1.2} />))}
        <rect className="sd-card" x={86} y={42} width={52} height={36} rx={4} />
        <Bar x={93} y={50} w={22} h={4} fill="var(--text-primary)" o={0.8} />
        <Bar x={93} y={60} w={34} h={3.5} />
        <Bar x={93} y={67} w={26} h={3.5} />
        {objOn && <rect x={150} y={82} width={20} height={20} rx={4} fill="var(--accent)" opacity={0.6} />}
      </g>

      <Finger x={aSpread[0]} y={aSpread[1]} o={pinchIn} />
      <Finger x={bSpread[0]} y={bSpread[1]} o={pinchIn} />
      {pinchIn > 0.01 && (
        <line x1={f(aSpread[0])} y1={f(aSpread[1])} x2={f(bSpread[0])} y2={f(bSpread[1])} stroke="var(--text-primary)" strokeWidth={1} strokeDasharray="2 3" opacity={0.35 * pinchIn} />
      )}

      <g opacity={pressIn}>
        <Finger x={84} y={70} press={ring} />
        <circle
          cx={84}
          cy={70}
          r={14}
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeDasharray={`${f(88 * ring)} 88`}
          transform="rotate(-90 84 70)"
          opacity={0.8 * (1 - menu)}
        />
      </g>
      {menu > 0.01 && (
        <g opacity={menu * pressIn} transform={`${grow(96, 78, 0.86 + 0.14 * menu)}`}>
          <rect className="sd-card" x={96} y={78} width={58} height={34} rx={5} />
          {range(3).map((i) => (
            <Bar key={i} x={104} y={86 + i * 9} w={[34, 26, 30][i]} h={3.5} fill={i === 0 ? 'var(--text-primary)' : 'var(--text-tertiary)'} o={i === 0 ? 0.8 : 1} />
          ))}
        </g>
      )}

      {twoIn > 0.01 && (
        <g opacity={twoIn}>
          {[[100, 60], [130, 66]].map(([x, y], i) => (
            <g key={i}>
              <Finger x={x} y={y} press={tapRing(twoAt)} />
              <circle cx={x} cy={y} r={6 + 18 * tapRing(twoAt)} fill="none" stroke="var(--text-primary)" strokeWidth={1.2} opacity={0.5 * (1 - tapRing(twoAt))} />
            </g>
          ))}
          <g transform={`translate(0 ${f((1 - prog(t, twoAt + 150, 380)) * 5)})`} opacity={prog(t, twoAt + 150, 380)}>
            <rect className="sd-pill" x={92} y={92} width={40} height={13} rx={6.5} />
            <text className="sd-pill-text sd-pill-text--s" x={112} y={101.2} textAnchor="middle">
              Undo
            </text>
          </g>
        </g>
      )}
      {threeIn > 0.01 && (
        <g opacity={threeIn}>
          {[[90, 70], [112, 54], [134, 70]].map(([x, y], i) => (
            <g key={i}>
              <Finger x={x} y={y} press={tapRing(threeAt)} />
              <circle cx={x} cy={y} r={6 + 18 * tapRing(threeAt)} fill="none" stroke="var(--text-primary)" strokeWidth={1.2} opacity={0.5 * (1 - tapRing(threeAt))} />
            </g>
          ))}
          <g transform={`translate(0 ${f((1 - prog(t, threeAt + 150, 380)) * 5)})`} opacity={prog(t, threeAt + 150, 380)}>
            <rect className="sd-pill" x={92} y={92} width={40} height={13} rx={6.5} />
            <text className="sd-pill-text sd-pill-text--s" x={112} y={101.2} textAnchor="middle">
              Redo
            </text>
          </g>
        </g>
      )}
    </g>
  );
};

/* ================================================================ voice */

/** The shape of a voice: the same bars for the recording and the note it becomes. */
const VOICE = range(26).map((i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 0.9 + 0.4) * Math.cos(i * 0.37 + 1.1)));

const VoiceScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.voice;
  const hud = win(t, T.placeAt + 150, T.keepAt + 100, 280);
  const live = Math.max(0, Math.min(t, T.pauseAt) - (T.placeAt + 300)) + Math.max(0, Math.min(t, T.keepAt) - (T.pauseAt + 1100));
  const seconds = Math.floor(live / 600);
  const shown = Math.min(VOICE.length, Math.floor(live / 90));
  const paused = t >= T.pauseAt && t < T.pauseAt + 1100;
  const pulse = 0.55 + 0.45 * Math.sin(t / 160);
  const note = prog(t, T.keepAt + 150, 520);
  const play = prog(t, T.keepAt + 1200, 1500, (x) => x);

  return (
    <g>
      {range(5).map((r) => range(8).map((c) => <circle key={`${r}-${c}`} className="sd-dot" cx={16 + c * 28} cy={14 + r * 25} r={1} />))}
      <circle cx={VO.spot[0]} cy={VO.spot[1]} r={3} className="sd-ink" opacity={0.7 * prog(t, T.placeAt, 220) * (1 - note)} />

      {hud > 0.01 && (
        <g opacity={hud} transform={`translate(0 ${f((1 - hud) * 6)})`}>
          <rect className="sd-pill" x={44} y={90} width={136} height={24} rx={12} />
          <circle cx={58} cy={102} r={3.4} fill="#FF453A" opacity={paused ? 0.5 : pulse} />
          <text className="sd-pill-text sd-pill-text--s" x={67} y={104.6}>
            0:0{Math.min(9, seconds)}
          </text>
          {VOICE.slice(0, shown).map((v, i) => (
            <rect key={i} x={92 + i * 3.2} y={f(102 - v * 7)} width={2} height={f(v * 14)} rx={1} style={{ fill: 'var(--surface-primary)' }} opacity={0.85} />
          ))}
          {paused && (
            <g style={{ fill: 'var(--surface-primary)' }}>
              <rect x={168} y={98} width={2.4} height={8} rx={1} />
              <rect x={173} y={98} width={2.4} height={8} rx={1} />
            </g>
          )}
        </g>
      )}

      {note > 0.01 && (
        <g opacity={note} transform={grow(VO.spot[0], VO.spot[1], 0.92 + 0.08 * note)}>
          <rect className="sd-card" x={VO.spot[0] - 46} y={VO.spot[1] - 17} width={112} height={34} rx={17} />
          <circle cx={VO.spot[0] - 29} cy={VO.spot[1]} r={9} className="sd-pill" />
          <path d={`M${VO.spot[0] - 31.5} ${VO.spot[1] - 4} L${VO.spot[0] - 25} ${VO.spot[1]} L${VO.spot[0] - 31.5} ${VO.spot[1] + 4}Z`} style={{ fill: 'var(--surface-primary)' }} />
          {VOICE.map((v, i) => (
            <rect
              key={i}
              x={VO.spot[0] - 14 + i * 3}
              y={f(VO.spot[1] - v * 7)}
              width={2}
              height={f(v * 14)}
              rx={1}
              fill={i / VOICE.length < play ? 'var(--text-primary)' : 'var(--text-tertiary)'}
              opacity={i / VOICE.length < play ? 0.9 : 0.55}
            />
          ))}
        </g>
      )}
    </g>
  );
};

export const MORE_SCENES: Partial<Record<ScriptedId, React.FC<SceneProps>>> = {
  slides: SlidesScene,
  gridedit: GridEditScene,
  anchors: AnchorsScene,
  sketch: SketchScene,
  shadow: ShadowScene,
  touch: TouchScene,
  voice: VoiceScene,
};
