import React from 'react';
import { THEMES } from '../../engine/model/stickyThemes';
import { CHART_PALETTE } from '../../engine/chart/chartTypes';
import {
  CHART_DEMO,
  CHART_VALUES,
  clamp01,
  lassoPoint,
  lerp,
  prog,
  SHAPES_DEMO,
  SNAP_LINE,
  SNAP_RING,
  snapLinePoint,
  snapPoint,
  standard,
  TIMES,
  win,
  type CursorSample,
  type Pt,
  type ScriptedId,
} from '../../engine/learn/demoScript';

/**
 * What each scripted demo draws, as a pure function of the clock.
 *
 * Every scene receives the time and where the ghost pointer is, and returns
 * SVG. There is no state and no effect here: scrub to any moment and the frame
 * is exactly the one the film would show then. That is also what makes the
 * reduced-motion storyboard free, since a still is the same function evaluated
 * once.
 *
 * ## What the drawings are made of
 *
 * Objects take their look from the product's own tokens, stickies and chart
 * series from the real palettes, and the ghost pointer from `engine/cursor`, so
 * the demo cannot drift from the board it is teaching. The accent is spent only
 * on armed states (a hovered magnet); selection is ink, as everywhere else.
 *
 * The stage is 224 by 128 units and every scene is authored in those units.
 */

export interface SceneProps {
  t: number;
  cur: CursorSample;
  /** Unique to this instance, for the ids a scene defines (several demos share a page). */
  uid: string;
}

const f = (n: number) => Math.round(n * 100) / 100;
const poly = (points: readonly Pt[]) => points.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');

/** Scale about a point, then place. Keeps every "grow in" in one spelling. */
const grow = (cx: number, cy: number, k: number) => `translate(${cx} ${cy}) scale(${f(k)}) translate(${-cx} ${-cy})`;

/** The selection outline: ink, never the accent. */
const Sel: React.FC<{ x: number; y: number; w: number; h: number; o?: number; r?: number; dashed?: boolean }> = ({
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
const Bar: React.FC<{ x: number; y: number; w: number; h?: number; fill?: string; o?: number }> = ({
  x,
  y,
  w,
  h = 4,
  fill = 'var(--text-tertiary)',
  o = 1,
}) => (w > 0.5 ? <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} opacity={o} /> : null);

/** A small glyph for a shape tile, centred on 0,0 and about 12 units across. */
const GLYPHS: readonly React.ReactNode[] = [
  <rect key="sq" x={-6} y={-6} width={12} height={12} />,
  <circle key="ci" r={6.5} />,
  <polygon key="tr" points="0,-7 7,6 -7,6" />,
  <polygon key="di" points="0,-7.5 7.5,0 0,7.5 -7.5,0" />,
  <polygon key="he" points="-3.5,-6.5 3.5,-6.5 7,0 3.5,6.5 -3.5,6.5 -7,0" />,
  <polygon key="st" points="0,-7.5 2.2,-2.4 7.5,-2.1 3.4,1.4 4.7,6.8 0,3.9 -4.7,6.8 -3.4,1.4 -7.5,-2.1 -2.2,-2.4" />,
  <polygon key="pe" points="0,-7 6.7,-2.2 4.1,5.7 -4.1,5.7 -6.7,-2.2" />,
  <polygon key="ar" points="-7,-2.5 1,-2.5 1,-6.5 7.5,0 1,6.5 1,2.5 -7,2.5" />,
  <polygon key="cr" points="-2.5,-7 2.5,-7 2.5,-2.5 7,-2.5 7,2.5 2.5,2.5 2.5,7 -2.5,7 -2.5,2.5 -7,2.5 -7,-2.5 -2.5,-2.5" />,
  <polygon key="pa" points="-4,-5.5 7.5,-5.5 4,5.5 -7.5,5.5" />,
  <polygon key="tz" points="-4.5,-5.5 4.5,-5.5 7.5,5.5 -7.5,5.5" />,
  <path key="ch" d="M-6 -6 L2 0 L-6 6 M0 -6 L8 0 L0 6" fill="none" />,
];

const Glyph: React.FC<{ i: number; at: Pt; k?: number; o?: number; ink?: boolean }> = ({ i, at, k = 1, o = 1, ink }) => (
  <g
    transform={`translate(${f(at[0])} ${f(at[1])}) scale(${f(k)})`}
    className={ink ? 'sd-glyph sd-glyph--ink' : 'sd-glyph'}
    opacity={o}
  >
    {GLYPHS[i % GLYPHS.length]}
  </g>
);

/* ============================================================= snap */

const SnapScene: React.FC<SceneProps> = ({ t, cur }) => {
  const T = TIMES.snap;
  const snapAt = T.drawEnd + T.holdMs;

  // Beat A: a rough ring, then the held beat, then the clean one.
  const drawP = standard(clamp01((t - T.drawAt) / (T.drawEnd - T.drawAt)));
  const N = 64;
  const stroke = Array.from({ length: N + 1 }, (_, i) => snapPoint((drawP * i) / N));
  const cleanP = prog(t, snapAt, 380);
  const opA = 1 - prog(t, 3900, 400, (x) => x);
  const holdP = clamp01((t - T.drawEnd) / T.holdMs);
  const ringO = t >= T.drawEnd && t < snapAt + 140 ? 1 - prog(t, snapAt, 140, (x) => x) : 0;
  const C = 2 * Math.PI * 9;

  // Beat B: Shift makes the line straight whatever the hand did.
  const lineP = standard(clamp01((t - T.lineAt) / (T.lineEnd - T.lineAt)));
  const trail = Array.from({ length: 41 }, (_, i) => snapLinePoint((lineP * i) / 40));
  const end: Pt = t < T.lineEnd ? [cur.x, cur.y] : SNAP_LINE.to;
  const opB = prog(t, 4800, 240, (x) => x);

  return (
    <g>
      <g opacity={opA}>
        {drawP > 0 && (
          <polyline
            className="sd-stroke"
            points={poly(stroke)}
            opacity={1 - cleanP}
            fill="none"
          />
        )}
        <g transform={grow(SNAP_RING.cx, SNAP_RING.cy, lerp(0.97, 1, cleanP))} opacity={cleanP}>
          <ellipse className="sd-stroke" cx={SNAP_RING.cx} cy={SNAP_RING.cy} rx={SNAP_RING.rx} ry={SNAP_RING.ry} fill="none" />
        </g>
        {ringO > 0 && (
          <g transform={`translate(${f(cur.x)} ${f(cur.y)}) rotate(-90)`} opacity={ringO}>
            <circle r={9} className="sd-hold-track" fill="none" />
            <circle r={9} className="sd-hold" fill="none" strokeDasharray={`${f(C * holdP)} ${f(C)}`} />
          </g>
        )}
      </g>

      <g opacity={opB}>
        {lineP > 0.02 && <polyline className="sd-trail" points={poly(trail)} fill="none" />}
        {lineP > 0.02 && (
          <line className="sd-stroke" x1={SNAP_LINE.from[0]} y1={SNAP_LINE.from[1]} x2={f(end[0])} y2={f(end[1])} />
        )}
      </g>
    </g>
  );
};

/* ============================================================= lasso */

const LASSO_MARKS: readonly { at: Pt; round: boolean }[] = [
  { at: [60, 44], round: true },
  { at: [88, 70], round: false },
  { at: [62, 88], round: true },
  { at: [150, 50], round: true },
  { at: [168, 86], round: false },
];

const LassoScene: React.FC<SceneProps> = ({ t, cur }) => {
  const T = TIMES.lasso;
  const loopP = standard(clamp01((t - T.loopAt) / (T.loopEnd - T.loopAt)));
  const N = 72;
  const loop = Array.from({ length: N + 1 }, (_, i) => lassoPoint((loopP * i) / N));
  const loopO = loopP > 0 ? 1 - prog(t, T.releaseAt, 320, (x) => x) : 0;

  const brushing = t >= T.brushAt - 200 && t < 6200;
  const swept = t >= T.brushAt ? clamp01((cur.x - 138) / 14) : 0;

  return (
    <g>
      {LASSO_MARKS.map((m, i) => {
        const inside = i < 3;
        const gone = inside ? prog(t, T.releaseAt + i * 70, 420) : i === 3 ? swept : 0;
        if (gone >= 0.99) return null;
        return (
          <g key={i} transform={grow(m.at[0], m.at[1], 1 - 0.35 * gone)} opacity={1 - gone} className="sd-mark">
            {m.round ? <circle cx={m.at[0]} cy={m.at[1]} r={6} /> : <rect x={m.at[0] - 6} y={m.at[1] - 6} width={12} height={12} rx={2.5} />}
          </g>
        );
      })}
      {loopP > 0 && <polyline className="sd-lasso" points={poly(loop)} fill="none" opacity={loopO} />}
      {brushing && (
        <circle
          className="sd-brush"
          cx={f(cur.x)}
          cy={f(cur.y)}
          r={10}
          fill="none"
          opacity={win(t, T.brushAt - 200, 6200, 200)}
        />
      )}
    </g>
  );
};

/* ============================================================ shapes */

const ShapesScene: React.FC<SceneProps> = ({ t, cur }) => {
  const drags = SHAPES_DEMO.drags;
  const dragging = drags.findIndex((d) => t >= d.start && t < d.drop + 40);
  return (
    <g>
      {/* The library. It never closes: that is the point of the second beat. */}
      <rect className="sd-card" x={6} y={8} width={88} height={112} rx={8} />
      <rect className="sd-well" x={12} y={14} width={76} height={14} rx={5} />
      <circle className="sd-ink-line" cx={20} cy={21} r={3} fill="none" />
      <Bar x={28} y={19} w={prog(t, 300, 900) * 26} h={4} fill="var(--text-secondary)" />
      {Array.from({ length: 12 }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const c = SHAPES_DEMO.tile(col, row);
        const held = dragging >= 0 && drags[dragging].from[0] === c[0] && drags[dragging].from[1] === c[1];
        return (
          <g key={i}>
            <rect
              className={held ? 'sd-tile sd-tile--held' : 'sd-tile'}
              x={c[0] - 9}
              y={c[1] - 9}
              width={18}
              height={18}
              rx={4}
            />
            <Glyph i={i} at={c} k={0.9} />
          </g>
        );
      })}

      {/* What has landed on the board. */}
      {drags.map((d, i) => {
        const landed = prog(t, d.drop, 520);
        if (landed <= 0) return null;
        const glyph = (d.from[1] - 46) / 20 * 4 + (d.from[0] - 22) / 20;
        return <Glyph key={i} i={glyph} at={d.to} k={lerp(1.3, 2.3, landed)} o={landed} ink />;
      })}

      {/* The tile in hand. */}
      {dragging >= 0 && (
        <Glyph
          i={(drags[dragging].from[1] - 46) / 20 * 4 + (drags[dragging].from[0] - 22) / 20}
          at={[cur.x, cur.y]}
          k={lerp(0.9, 2.3, prog(t, drags[dragging].start, 360))}
          o={0.8}
          ink
        />
      )}
    </g>
  );
};

/* ============================================================== flow */

const FLOW = {
  a: { x: 24, y: 22, w: 44, h: 28 },
  b: { x: 96, y: 22, w: 44, h: 28 },
  c: { x: 168, y: 22, w: 44, h: 28 },
} as const;

const Box: React.FC<{ r: { x: number; y: number; w: number; h: number }; o?: number; k?: number; dashed?: boolean }> = ({
  r,
  o = 1,
  k = 1,
  dashed,
}) => (
  <g transform={grow(r.x + r.w / 2, r.y + r.h / 2, k)} opacity={o}>
    <rect className={dashed ? 'sd-card sd-card--ghost' : 'sd-card'} x={r.x} y={r.y} width={r.w} height={r.h} rx={5} />
    <Bar x={r.x + 8} y={r.y + 11} w={r.w - 16} h={4} />
  </g>
);

/** A connector drawing itself from one side to the other, head arriving last. */
const Wire: React.FC<{ from: Pt; to: Pt; p: number }> = ({ from, to, p }) => {
  if (p <= 0) return null;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const dir = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
  const head = prog(p, 0.82, 0.18, (x) => x);
  const tip = to;
  const back = [tip[0] - dir[0] * 6, tip[1] - dir[1] * 6];
  const side = [-dir[1] * 3.2, dir[0] * 3.2];
  return (
    <g>
      <line
        className="sd-wire"
        x1={from[0]}
        y1={from[1]}
        x2={to[0] - dir[0] * 5}
        y2={to[1] - dir[1] * 5}
        strokeDasharray={f(len)}
        strokeDashoffset={f(len * (1 - Math.min(1, p / 0.85)))}
      />
      <polygon
        className="sd-head"
        opacity={head}
        points={`${f(tip[0])},${f(tip[1])} ${f(back[0] + side[0])},${f(back[1] + side[1])} ${f(back[0] - side[0])},${f(back[1] - side[1])}`}
      />
    </g>
  );
};

const FlowScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.flow;
  const { a, b, c } = FLOW;
  const mid = (r: { x: number; y: number; w: number; h: number }) => r.y + r.h / 2;

  const magnets = win(t, T.magnetAt, T.clickAt + 200, 220);
  const hoverRight = t >= 1500 && t < T.clickAt + 160;
  const bIn = prog(t, T.clickAt + 80, 520);
  const cIn = prog(t, T.tabAt + 80, 520);
  const wireAB = prog(t, T.clickAt + 140, 520, standard);
  const wireBC = prog(t, T.tabAt + 140, 520, standard);

  // Selection follows the newest shape, and steps back on the way home.
  const sel = t < T.clickAt + 120 ? a : t < T.tabAt + 120 ? b : t < T.backTabAt ? c : b;
  const selFade = t >= T.backTabAt ? prog(t, T.backTabAt, 220) : 1;

  const sides: readonly [string, Pt][] = [
    ['right', [a.x + a.w + 12, mid(a)]],
    ['bottom', [a.x + a.w / 2, a.y + a.h + 12]],
    ['top', [a.x + a.w / 2, a.y - 12]],
    ['left', [a.x - 12, mid(a)]],
  ];

  return (
    <g>
      <Box r={a} />
      {bIn > 0 && <Box r={b} o={bIn} k={lerp(0.88, 1, bIn)} />}
      {cIn > 0 && <Box r={c} o={cIn} k={lerp(0.88, 1, cIn)} />}
      <Wire from={[a.x + a.w, mid(a)]} to={[b.x, mid(b)]} p={wireAB} />
      <Wire from={[b.x + b.w, mid(b)]} to={[c.x, mid(c)]} p={wireBC} />

      {/* What a click on the right-hand magnet would make. */}
      {hoverRight && (
        <g opacity={0.55 * (1 - bIn)}>
          <Box r={b} dashed />
          <line className="sd-wire sd-wire--ghost" x1={a.x + a.w} y1={mid(a)} x2={b.x} y2={mid(b)} />
        </g>
      )}

      {magnets > 0.01 &&
        sides.map(([name, p]) => {
          const armed = name === 'right' && hoverRight;
          return (
            <g key={name} opacity={magnets} transform={grow(p[0], p[1], armed ? 1.12 : 1)}>
              <circle className={armed ? 'sd-magnet sd-magnet--armed' : 'sd-magnet'} cx={p[0]} cy={p[1]} r={6} />
              <path className={armed ? 'sd-plus sd-plus--armed' : 'sd-plus'} d={`M${p[0] - 2.6} ${p[1]}H${p[0] + 2.6}M${p[0]} ${p[1] - 2.6}V${p[1] + 2.6}`} />
            </g>
          );
        })}

      <Sel x={sel.x} y={sel.y} w={sel.w} h={sel.h} o={selFade} />
    </g>
  );
};

/* ============================================================ arrange */

interface Tile {
  from: { x: number; y: number; w: number; h: number; r: number };
  to: { x: number; y: number; w: number; h: number };
  theme: keyof typeof THEMES;
}

const TILES: readonly Tile[] = [
  { from: { x: 30, y: 62, w: 46, h: 30, r: -8 }, to: { x: 12, y: 10, w: 100, h: 60 }, theme: 'sky' },
  { from: { x: 122, y: 16, w: 34, h: 34, r: 12 }, to: { x: 120, y: 10, w: 92, h: 28 }, theme: 'pink' },
  { from: { x: 78, y: 32, w: 50, h: 24, r: 6 }, to: { x: 120, y: 44, w: 44, h: 26 }, theme: 'mint' },
  { from: { x: 150, y: 74, w: 36, h: 30, r: -10 }, to: { x: 168, y: 44, w: 44, h: 26 }, theme: 'lavender' },
  { from: { x: 26, y: 18, w: 32, h: 22, r: 4 }, to: { x: 12, y: 78, w: 200, h: 40 }, theme: 'yellow' },
];

const ArrangeScene: React.FC<SceneProps> = ({ t, cur }) => {
  const T = TIMES.arrange;
  const marquee = win(t, 600, T.arrangeAt, 160);
  const selected = prog(t, T.marqueeEnd, 200, (x) => x) * (1 - prog(t, T.arrangeAt + 700, 300, (x) => x));
  const guides = prog(t, T.arrangeAt + 500, 500, (x) => x);
  const merge = prog(t, T.mergeAt, 520);
  const mergeSel = win(t, T.mergeAt - 350, T.mergeAt + 1000, 200);

  return (
    <g>
      {guides > 0 && (
        <g opacity={guides * 0.9}>
          <rect className="sd-guide" x={10} y={8} width={204} height={112} rx={3} fill="none" />
          <line className="sd-guide" x1={116} y1={8} x2={116} y2={74} />
          <line className="sd-guide" x1={10} y1={74} x2={214} y2={74} />
          <line className="sd-guide" x1={116} y1={41} x2={214} y2={41} />
          <line className="sd-guide" x1={166} y1={41} x2={166} y2={74} opacity={1 - merge} />
        </g>
      )}

      {TILES.map((tile, i) => {
        const e = prog(t, T.arrangeAt + i * 70, 900);
        const x = lerp(tile.from.x, tile.to.x, e);
        const y = lerp(tile.from.y, tile.to.y, e);
        let w = lerp(tile.from.w, tile.to.w, e);
        const h = lerp(tile.from.h, tile.to.h, e);
        const r = lerp(tile.from.r, 0, e);
        let o = 1;
        if (i === 2) w = lerp(w, 92, merge);
        if (i === 3) o = 1 - merge;
        const th = THEMES[tile.theme];
        return (
          <g key={i} opacity={o} transform={`translate(${f(x + w / 2)} ${f(y + h / 2)}) rotate(${f(r)}) translate(${f(-w / 2)} ${f(-h / 2)})`}>
            <rect width={f(w)} height={f(h)} rx={5} fill={th.bg} stroke={th.edge} strokeWidth={1.25} />
            <Bar x={7} y={h / 2 - 2} w={Math.max(0, Math.min(w - 14, 26))} h={4} fill={th.text} o={0.55} />
            {selected > 0.01 && (
              <rect className="sd-sel" x={-3} y={-3} width={f(w + 6)} height={f(h + 6)} rx={7} opacity={selected} />
            )}
          </g>
        );
      })}

      {marquee > 0.01 && (
        <rect
          className="sd-marquee"
          x={Math.min(14, cur.x)}
          y={Math.min(8, cur.y)}
          width={Math.abs(cur.x - 14)}
          height={Math.abs(cur.y - 8)}
          opacity={marquee}
        />
      )}
      {mergeSel > 0.01 && <Sel x={120} y={44} w={92} h={26} o={mergeSel} r={4} dashed />}
    </g>
  );
};

/* =============================================================== fill */

const TABLE = { x: 28, y: 14, colW: 56, headH: 16, rowH: 16, cols: 3, rows: 5 };
const cellRect = (col: number, row: number) => ({
  x: TABLE.x + col * TABLE.colW,
  y: TABLE.y + TABLE.headH + row * TABLE.rowH,
  w: TABLE.colW,
  h: TABLE.rowH,
});

const Num: React.FC<{ col: number; row: number; v: string | number; o?: number; lift?: number }> = ({ col, row, v, o = 1, lift = 0 }) => {
  const c = cellRect(col, row);
  return (
    <text
      className="sd-num"
      x={c.x + c.w - 8}
      y={c.y + c.h / 2 + 3.6 + lift}
      textAnchor="end"
      opacity={o}
    >
      {v}
    </text>
  );
};

const FillScene: React.FC<SceneProps> = ({ t, cur }) => {
  const T = TIMES.fill;
  const tb = TABLE;
  const bodyH = tb.rows * tb.rowH;

  // Beat 1: how many rows of column B the drag has covered so far.
  const dragging = t >= T.dragAt && t < T.dragEnd + 200;
  const covered = t < T.dragAt ? 0 : t >= T.dragEnd ? 3 : clamp01((cur.y - 44) / 48) * 3;
  const reveal = (row: number) => (t >= T.dragEnd ? 1 : prog(covered, row - 0.35, 0.6, (x) => x));
  const selB = t < T.dragAt ? 0 : Math.ceil(covered + 0.001);
  const selBO = 1 - prog(t, 3000, 300, (x) => x);

  // Beat 2: a range down column C, then Ctrl+D.
  const rangeH = t < T.selectAt ? 0 : t >= T.selectEnd ? 5 : clamp01((cur.y - 38) / 64) * 5;
  const rangeO = win(t, T.selectAt, 6900, 160);
  const filled = (row: number) => prog(t, T.fillDownAt + (row - 1) * 90, 380);

  return (
    <g>
      <rect className="sd-card" x={tb.x} y={tb.y} width={tb.colW * tb.cols} height={tb.headH + bodyH} rx={4} />
      <rect className="sd-well" x={tb.x} y={tb.y} width={tb.colW * tb.cols} height={tb.headH} rx={4} />
      {[1, 2].map((c) => (
        <line key={c} className="sd-cell-line" x1={tb.x + c * tb.colW} y1={tb.y} x2={tb.x + c * tb.colW} y2={tb.y + tb.headH + bodyH} />
      ))}
      {Array.from({ length: tb.rows + 1 }, (_, r) => (
        <line key={r} className="sd-cell-line" x1={tb.x} y1={tb.y + tb.headH + r * tb.rowH} x2={tb.x + tb.colW * tb.cols} y2={tb.y + tb.headH + r * tb.rowH} />
      ))}
      {[0, 1, 2].map((c) => (
        <Bar key={c} x={tb.x + c * tb.colW + 9} y={tb.y + 6} w={c === 0 ? 24 : 18} h={4} fill="var(--text-secondary)" />
      ))}
      {Array.from({ length: tb.rows }, (_, r) => (
        <Bar key={r} x={tb.x + 9} y={cellRect(0, r).y + 6} w={14 + ((r * 7) % 12)} h={4} o={0.7} />
      ))}

      {/* Column B: one value, then the series the handle carries on. */}
      <Num col={1} row={0} v={1} />
      {[1, 2, 3].map((r) => (
        <Num key={r} col={1} row={r} v={r + 1} o={reveal(r)} lift={(1 - reveal(r)) * 3} />
      ))}
      {selB > 0 && selBO > 0.01 && (
        <>
          <rect
            className={dragging ? 'sd-sel sd-sel--dashed' : 'sd-sel'}
            x={cellRect(1, 0).x}
            y={cellRect(1, 0).y}
            width={tb.colW}
            height={tb.rowH * Math.max(1, selB)}
            rx={1}
            opacity={selBO}
          />
          <rect
            className="sd-handle"
            x={cellRect(1, 0).x + tb.colW - 3}
            y={cellRect(1, 0).y + tb.rowH * Math.max(1, selB) - 3}
            width={6}
            height={6}
            opacity={selBO}
          />
        </>
      )}

      {/* Column C: copied down from its first cell. */}
      <Num col={2} row={0} v={7} />
      {[1, 2, 3, 4].map((r) => (
        <Num key={r} col={2} row={r} v={7} o={filled(r)} lift={(1 - filled(r)) * 3} />
      ))}
      {rangeH > 0.02 && rangeO > 0.01 && (
        <rect
          className="sd-sel"
          x={cellRect(2, 0).x}
          y={cellRect(2, 0).y}
          width={tb.colW}
          height={tb.rowH * rangeH}
          rx={1}
          opacity={rangeO}
        />
      )}
    </g>
  );
};

/* ========================================================= chartlive */

const ROW_Y = (i: number) => 30 + i * 18;
const valueY = (v: number) => CHART_DEMO.base - v * CHART_DEMO.scale;

const ChartLiveScene: React.FC<SceneProps> = ({ t, cur }) => {
  const T = TIMES.chartlive;

  // Row 2 is typed over; bar 1 is dragged. Each bar and each number read the
  // same value, so the two cannot disagree at any moment.
  const edit = prog(t, T.editAt + 80, 700);
  const v2 = lerp(CHART_VALUES[2], 75, edit);
  const dragP = t < T.dragAt ? 0 : t >= T.dragEnd ? 1 : clamp01((cur.y - valueY(CHART_VALUES[1])) / (valueY(92) - valueY(CHART_VALUES[1])));
  const v1 = lerp(CHART_VALUES[1], 92, dragP);
  const values = [CHART_VALUES[0], v1, v2, CHART_VALUES[3]];
  const shown = (i: number) => (i === 2 ? (t >= T.editAt ? 75 : CHART_VALUES[2]) : Math.round(values[i]));

  const editing = win(t, 1000, T.editAt + 600, 140);
  const grabbing = t >= T.dragAt - 200 && t < T.dragEnd + 500;

  return (
    <g>
      <rect className="sd-card" x={10} y={14} width={92} height={88} rx={4} />
      <rect className="sd-well" x={10} y={14} width={92} height={16} rx={4} />
      <Bar x={18} y={20} w={22} h={4} fill="var(--text-secondary)" />
      {values.map((_, i) => (
        <g key={i}>
          <line className="sd-cell-line" x1={10} y1={ROW_Y(i)} x2={102} y2={ROW_Y(i)} />
          <rect x={17} y={ROW_Y(i) + 6} width={6} height={6} rx={1.5} fill={CHART_PALETTE[i]} />
          <text className="sd-num" x={96} y={ROW_Y(i) + 12.6} textAnchor="end">
            {shown(i)}
          </text>
        </g>
      ))}
      {editing > 0.01 && <rect className="sd-sel" x={56} y={ROW_Y(2)} width={46} height={18} rx={1} opacity={editing} />}

      {/* The link: a range of the table is what the chart reads. */}
      <path className="sd-link" d={`M102 ${ROW_Y(1) + 9}H107V${ROW_Y(1) + 9}H112`} fill="none" />
      <circle className="sd-link-dot" cx={102} cy={ROW_Y(1) + 9} r={2.2} />

      <rect className="sd-card" x={112} y={14} width={104} height={98} rx={4} />
      <line className="sd-axis" x1={118} y1={CHART_DEMO.base} x2={210} y2={CHART_DEMO.base} />
      {values.map((v, i) => (
        <rect
          key={i}
          x={CHART_DEMO.barX(i)}
          y={f(valueY(v))}
          width={CHART_DEMO.barW}
          height={f(v * CHART_DEMO.scale)}
          rx={2}
          fill={CHART_PALETTE[i]}
          opacity={0.92}
        />
      ))}
      {grabbing && (
        <circle
          className="sd-grab"
          cx={CHART_DEMO.barX(1) + CHART_DEMO.barW / 2}
          cy={f(valueY(v1))}
          r={4}
          opacity={win(t, T.dragAt - 200, T.dragEnd + 500, 200)}
        />
      )}
    </g>
  );
};

/* ============================================================== chain */

const NOTE_W = 44;
const slot = (i: number) => 10 + i * 54;
const NOTES: readonly { x: number; y: number }[] = [
  { x: slot(0), y: 28 },
  { x: slot(1), y: 28 },
  { x: slot(2), y: 28 },
  { x: slot(2), y: 78 },
];

const ChainScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.chain;
  const born = [T.placeAt + 60, T.tab1 + 60, T.tab2 + 60, T.shiftTab + 60];
  const recolour = prog(t, T.recolourAt, 460);
  const selected = win(t, T.recolourAt - 300, 7100, 200);
  const newest = born.reduce((acc, b, i) => (t >= b ? i : acc), -1);
  const caretOn = Math.floor(t / 520) % 2 === 0;

  return (
    <g>
      {NOTES.map((n, i) => {
        const e = prog(t, born[i], 460);
        if (e <= 0) return null;
        const y = n.y + (1 - e) * 6;
        const typed = prog(t, born[i] + 160, 640, (x) => x);
        const yellow = THEMES.yellow;
        const mint = THEMES.mint;
        return (
          <g key={i} opacity={e} transform={grow(n.x + NOTE_W / 2, y + NOTE_W / 2, lerp(0.9, 1, e))}>
            <rect x={n.x} y={y} width={NOTE_W} height={NOTE_W} rx={8} fill={yellow.bg} stroke={yellow.edge} strokeWidth={1.25} opacity={1 - recolour} />
            <rect x={n.x} y={y} width={NOTE_W} height={NOTE_W} rx={8} fill={mint.bg} stroke={mint.edge} strokeWidth={1.25} opacity={recolour} />
            <Bar x={n.x + 8} y={y + 11} w={28 * typed} fill={recolour > 0.5 ? mint.text : yellow.text} o={0.6} />
            <Bar x={n.x + 8} y={y + 20} w={18 * Math.max(0, typed - 0.4) / 0.6} fill={recolour > 0.5 ? mint.text : yellow.text} o={0.6} />
            {i === newest && caretOn && t < T.recolourAt - 400 && (
              <rect x={n.x + 8 + 18 * Math.max(0, typed - 0.4) / 0.6 + 2} y={y + 18} width={1.6} height={8} fill={yellow.text} />
            )}
            {selected > 0.01 && <rect className="sd-sel" x={n.x - 3} y={y - 3} width={NOTE_W + 6} height={NOTE_W + 6} rx={10} opacity={selected} />}
          </g>
        );
      })}
    </g>
  );
};

/* ============================================================ present */

const FRAMES: readonly { x: number; y: number; w: number; h: number }[] = [
  { x: 14, y: 44, w: 56, h: 38 },
  { x: 84, y: 44, w: 56, h: 38 },
  { x: 154, y: 44, w: 56, h: 38 },
];

/** What is inside a frame, in the frame's own 56 by 38 units. */
const FrameArt: React.FC<{ kind: number }> = ({ kind }) => {
  const tint = (n: number) => CHART_PALETTE[n];
  return kind === 0 ? (
    <g>
      <circle cx={19} cy={19} r={9} fill={tint(0)} opacity={0.9} />
      <Bar x={32} y={13} w={16} h={4} fill="var(--text-secondary)" />
      <Bar x={32} y={22} w={11} h={4} />
    </g>
  ) : kind === 1 ? (
    <g>
      <rect x={8} y={20} width={9} height={10} rx={1.5} fill={tint(2)} />
      <rect x={21} y={11} width={9} height={19} rx={1.5} fill={tint(2)} opacity={0.8} />
      <rect x={34} y={15} width={9} height={15} rx={1.5} fill={tint(2)} opacity={0.65} />
    </g>
  ) : (
    <g>
      <Bar x={9} y={11} w={38} h={4} fill="var(--text-secondary)" />
      <Bar x={9} y={20} w={30} h={4} />
      <Bar x={9} y={28} w={22} h={4} />
    </g>
  );
};

const framePlace = (r: { x: number; y: number; w: number; h: number }) =>
  `translate(${f(r.x)} ${f(r.y)}) scale(${f(r.w / 56)} ${f(r.h / 38)})`;

const PresentScene: React.FC<SceneProps> = ({ t, uid }) => {
  const slideClip = `${uid}-slide`;
  const fitClip = `${uid}-fit`;
  const T = TIMES.present;
  const beatA = win(t, 0, 4700, 260);
  const beatB = win(t, 4600, 8000, 300);

  // Beat A: expand the selected frame to fill the stage, step on, leave.
  const open = prog(t, T.startAt + 100, 820);
  const close = prog(t, T.exitAt + 100, 620);
  const full = { x: 22, y: 12, w: 180, h: 104 };
  const home = t < T.exitAt + 100 ? FRAMES[0] : FRAMES[1];
  const e = open * (1 - close);
  const rect = {
    x: lerp(home.x, full.x, e),
    y: lerp(home.y, full.y, e),
    w: lerp(home.w, full.w, e),
    h: lerp(home.h, full.h, e),
  };
  const veil = e * 0.9;
  const slide = prog(t, T.nextAt, 520);

  // Beat B: a frame fitted to what is in it. Contents clip to the frame until it is.
  const fit = prog(t, T.fitAt, 760);
  const from = { x: 70, y: 40, w: 56, h: 38 };
  const to = { x: 70, y: 38, w: 98, h: 70 };
  const g = {
    x: lerp(from.x, to.x, fit),
    y: lerp(from.y, to.y, fit),
    w: lerp(from.w, to.w, fit),
    h: lerp(from.h, to.h, fit),
  };

  return (
    <g>
      <g opacity={beatA}>
        {FRAMES.map((r, i) => (
          <g key={i}>
            <Bar x={r.x} y={r.y - 9} w={i === 0 ? 20 : 16} h={4} fill="var(--text-secondary)" />
            <rect className="sd-card" x={r.x} y={r.y} width={r.w} height={r.h} rx={3} />
            <g transform={framePlace(r)}>
              <FrameArt kind={i} />
            </g>
          </g>
        ))}
        <Sel x={FRAMES[0].x} y={FRAMES[0].y} w={FRAMES[0].w} h={FRAMES[0].h} o={prog(t, 700, 160, (x) => x)} r={5} />

        <rect className="sd-veil" x={0} y={0} width={224} height={128} opacity={veil} />
        {e > 0.01 && (
          <g>
            <rect className="sd-slide" x={f(rect.x)} y={f(rect.y)} width={f(rect.w)} height={f(rect.h)} rx={3} />
            <clipPath id={slideClip}>
              <rect x={f(rect.x)} y={f(rect.y)} width={f(rect.w)} height={f(rect.h)} rx={3} />
            </clipPath>
            <g clipPath={`url(#${slideClip})`}>
              <g opacity={1 - slide} transform={`translate(${f(-slide * 40)} 0)`}>
                <g transform={framePlace(rect)}>
                  <FrameArt kind={0} />
                </g>
              </g>
              <g opacity={slide} transform={`translate(${f((1 - slide) * 40)} 0)`}>
                <g transform={framePlace(rect)}>
                  <FrameArt kind={1} />
                </g>
              </g>
            </g>
          </g>
        )}
      </g>

      <g opacity={beatB}>
        <clipPath id={fitClip}>
          <rect x={f(g.x)} y={f(g.y)} width={f(g.w)} height={f(g.h)} rx={3} />
        </clipPath>
        <Bar x={g.x} y={g.y - 9} w={22} h={4} fill="var(--text-secondary)" />
        <rect className="sd-card" x={f(g.x)} y={f(g.y)} width={f(g.w)} height={f(g.h)} rx={3} />
        <g clipPath={`url(#${fitClip})`}>
          <rect x={80} y={48} width={24} height={16} rx={2.5} fill={CHART_PALETTE[0]} opacity={0.9} />
          <rect x={124} y={56} width={34} height={22} rx={2.5} fill={CHART_PALETTE[1]} opacity={0.9} />
          <circle cx={96} cy={88} r={10} fill={CHART_PALETTE[2]} opacity={0.9} />
        </g>
        <Sel x={g.x} y={g.y} w={g.w} h={g.h} o={1} r={5} />
      </g>
    </g>
  );
};

/* ============================================================= select */

const SelectScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.select;
  const b1 = win(t, 0, 3700, 260);
  const b2 = win(t, 3800, 5900, 260);
  const b3 = win(t, 5900, 8000, 300);

  // Beat 1: three overlapping objects and the one behind the top.
  const stack = [
    { x: 60, y: 40, w: 70, h: 50, theme: 'sky' as const },
    { x: 84, y: 30, w: 70, h: 50, theme: 'pink' as const },
    { x: 108, y: 50, w: 70, h: 50, theme: 'mint' as const },
  ];
  const picked = t < T.clickAt[0] + 60 ? 2 : t < T.clickAt[1] + 60 ? 1 : 0;

  // Beat 2: measuring from the hovered object to its neighbour.
  const m1 = { x: 30, y: 34, w: 50, h: 40 };
  const m2 = { x: 132, y: 58, w: 62, h: 44 };
  const measure = prog(t, T.measureAt + 200, 520);

  // Beat 3: same fill.
  const row = [0, 1, 2, 3, 4].map((i) => ({ x: 20 + i * 38, y: 48, w: 30, h: 30, theme: i % 2 === 0 ? ('yellow' as const) : ('sky' as const) }));
  const matched = (i: number) => (i === 0 ? 1 : i % 2 === 0 ? prog(t, T.similarAt + (i / 2) * 110, 260) : 0);

  return (
    <g>
      <g opacity={b1}>
        {stack.map((s, i) => {
          const th = THEMES[s.theme];
          return (
            <g key={i}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={6} fill={th.bg} stroke={th.edge} strokeWidth={1.25} />
              <Bar x={s.x + 8} y={s.y + 9} w={22} h={4} fill={th.text} o={0.55} />
            </g>
          );
        })}
        <Sel x={stack[picked].x} y={stack[picked].y} w={stack[picked].w} h={stack[picked].h} r={8} />
      </g>

      <g opacity={b2}>
        <rect x={m1.x} y={m1.y} width={m1.w} height={m1.h} rx={6} fill={THEMES.sky.bg} stroke={THEMES.sky.edge} strokeWidth={1.25} />
        <rect x={m2.x} y={m2.y} width={m2.w} height={m2.h} rx={6} fill={THEMES.peach.bg} stroke={THEMES.peach.edge} strokeWidth={1.25} />
        <Sel x={m1.x} y={m1.y} w={m1.w} h={m1.h} r={8} o={prog(t, T.measureAt, 200, (x) => x)} />
        {measure > 0.01 && (
          <g opacity={measure}>
            <line className="sd-measure" x1={m1.x + m1.w} y1={66} x2={lerp(m1.x + m1.w, m2.x, measure)} y2={66} />
            <line className="sd-measure" x1={m1.x + m1.w} y1={61} x2={m1.x + m1.w} y2={71} />
            <line className="sd-measure" x1={m2.x} y1={61} x2={m2.x} y2={71} opacity={measure} />
            <rect className="sd-pill" x={95} y={57} width={22} height={13} rx={6.5} />
            <text className="sd-pill-text" x={106} y={66.6} textAnchor="middle">
              52
            </text>
          </g>
        )}
      </g>

      <g opacity={b3}>
        {row.map((s, i) => {
          const th = THEMES[s.theme];
          return (
            <g key={i}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={6} fill={th.bg} stroke={th.edge} strokeWidth={1.25} />
              <Sel x={s.x} y={s.y} w={s.w} h={s.h} r={8} o={matched(i)} />
            </g>
          );
        })}
      </g>
    </g>
  );
};

/* ========================================================= cursorchat */

const CursorChatScene: React.FC<SceneProps> = ({ t, cur }) => {
  const T = TIMES.cursorchat;
  const open = prog(t, T.openAt, 520);
  const typed = prog(t, T.typeAt, T.typeEnd - T.typeAt, (x) => x);
  const step = (v: number, n: number) => Math.floor(v * n) / n;
  const fade = 1 - prog(t, 4200, 700, (x) => x);
  const w = lerp(16, 112, open);
  const bx = cur.x + 12;
  const by = cur.y + 18;
  const caret = Math.floor(t / 480) % 2 === 0;
  const textW = 80 * step(typed, 14);

  return (
    <g>
      {[0, 1, 2, 3, 4].map((r) =>
        [0, 1, 2, 3, 4, 5, 6, 7].map((c) => (
          <circle key={`${r}-${c}`} className="sd-dot" cx={16 + c * 28} cy={14 + r * 25} r={1} />
        ))
      )}
      {open > 0.01 && (
        <g opacity={open * fade}>
          <rect className="sd-card" x={bx} y={by} width={f(w)} height={22} rx={11} />
          {open > 0.7 && (
            <>
              <Bar x={bx + 11} y={by + 9} w={textW} h={4} fill="var(--text-primary)" o={0.8} />
              {caret && typed < 1 && <rect x={bx + 13 + textW} y={by + 6} width={1.5} height={10} fill="var(--text-primary)" />}
            </>
          )}
        </g>
      )}
    </g>
  );
};

/* ============================================================== table */

export const SCENES: Record<ScriptedId, React.FC<SceneProps>> = {
  snap: SnapScene,
  lasso: LassoScene,
  shapes: ShapesScene,
  flow: FlowScene,
  arrange: ArrangeScene,
  fill: FillScene,
  chartlive: ChartLiveScene,
  chain: ChainScene,
  present: PresentScene,
  select: SelectScene,
  cursorchat: CursorChatScene,
};
