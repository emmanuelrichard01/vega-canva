import { caps, chord } from './chords';

/**
 * The scripted lesson demos, as data.
 *
 * ## What a script is
 *
 * A demo is a short film of one gesture: where the ghost pointer goes and when
 * it presses, which keys are held while it happens, and three frames worth
 * pausing on. That is all of it, and it is plain data so it can be tested
 * without drawing anything -- durations, ordering, that every key comes from
 * `chords.ts` rather than from a string typed here.
 *
 * What gets drawn at each moment is the scene's job (`components/learn/scenes`),
 * and the scene is a pure function of the clock. There is no animation state to
 * fall out of step: scrub to 4.2 seconds and you are at 4.2 seconds.
 *
 * ## Why one clock
 *
 * Keycaps, the pointer and the drawing all read the same `t`. The previous demos
 * were CSS keyframes, one per element, each with its own duration and delay, so
 * a key could not be made to arrive *because* of the press it belongs to, and
 * nothing could be paused or scrubbed.
 *
 * ## Choreography
 *
 * Each beat is anticipation, action, settle: the pointer arrives and rests
 * (the eye catches up), presses, the thing happens, and the result is held long
 * enough to read before the loop ends. Everything eases on the product's own
 * exponential ease-out (`--ease-settle`), which decelerates into place and
 * never passes its target; nothing overshoots.
 */

/* --------------------------------------------------------------- easing */

/** CSS `cubic-bezier()` as a function of progress, so the demos use the same curves as the stylesheet. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < x) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

/** `--ease-settle`: exponential ease-out. Quick off the mark, soft landing, no overshoot. */
export const settle = cubicBezier(0.16, 1, 0.3, 1);
/** `--motion-expand`: the standard in-out, for travel that should read as a hand moving. */
export const standard = cubicBezier(0.4, 0, 0.2, 1);
export const linear = (x: number) => Math.min(1, Math.max(0, x));

export type EaseName = 'settle' | 'standard' | 'linear';
const EASES: Record<EaseName, (x: number) => number> = { settle, standard, linear };

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Eased progress of something that starts at `at` and takes `dur`. */
export const prog = (t: number, at: number, dur: number, ease: (x: number) => number = settle) =>
  ease(clamp01((t - at) / dur));

/** Visible from `a` to `b`, fading over `fade` at each end. */
export const win = (t: number, a: number, b: number, fade = 240) =>
  Math.min(clamp01((t - a) / fade), clamp01((b - t) / fade));

/**
 * The envelope that hides the loop point.
 *
 * Every scene is drawn at full strength in the middle and eased out at the end,
 * so the jump back to 0 is a cut between two empty stages rather than a visible
 * reset.
 */
export const loopEnvelope = (t: number, duration: number) =>
  Math.min(clamp01(t / 260), clamp01((duration - t) / 420));

/* --------------------------------------------------------------- types */

export type Pt = readonly [number, number];

export interface CursorKey {
  /** When the pointer is here, in ms from the start. */
  at: number;
  x: number;
  y: number;
  /** The button is down from this key until the next one. */
  down?: boolean;
  /**
   * Follow this path between this key and the next, instead of a straight
   * line. `p` is the eased progress, so the shape of the stroke and the pace of
   * the hand are separate decisions.
   */
  along?: (p: number) => Pt;
  /** How the move leaving this key is paced. Settle by default. */
  ease?: EaseName;
}

export interface KeyBeat {
  at: number;
  until: number;
  /** One cap per key, already resolved for this platform. */
  caps: readonly string[];
}

export interface Frame {
  at: number;
  caption: string;
}

export interface DemoScript {
  /** 4 to 8 seconds. */
  duration: number;
  /** The tool whose badge the ghost pointer wears. */
  tool?: string;
  /** False for a scene with no single pointer (fingers, remote people). */
  ghost?: false;
  cursor: readonly CursorKey[];
  keys: readonly KeyBeat[];
  /** Exactly three: what the reduced-motion storyboard shows. */
  frames: readonly [Frame, Frame, Frame];
}

export interface CursorSample {
  x: number;
  y: number;
  down: boolean;
  /** ms since the button last went down, or null while it is up. */
  pressAge: number | null;
}

/* ------------------------------------------------------------- sampling */

/** Where the ghost pointer is at `t`. */
export function sampleCursor(keys: readonly CursorKey[], t: number): CursorSample {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return { x: 0, y: 0, down: false, pressAge: null };

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].at <= t) i += 1;
  const a = keys[i];
  const b = keys[i + 1];

  let x = a.x;
  let y = a.y;
  if (b && t > a.at) {
    const p = EASES[a.ease ?? 'settle'](clamp01((t - a.at) / Math.max(1, b.at - a.at)));
    if (a.along) {
      [x, y] = a.along(p);
    } else {
      x = lerp(a.x, b.x, p);
      y = lerp(a.y, b.y, p);
    }
  } else if (!b && a.along) {
    [x, y] = a.along(1);
  }

  const down = Boolean(a.down);
  let pressAge: number | null = null;
  if (down) {
    let j = i;
    while (j > 0 && keys[j - 1].down) j -= 1;
    pressAge = t - keys[j].at;
  } else if (i > 0 && keys[i - 1].down) {
    // A release is as readable as a press: keep the ring for a beat after it.
    pressAge = null;
  }
  return { x, y, down, pressAge };
}

/** How far through a key's entrance it is, 0 to 1, or 0 when it is not up. */
export function keyPresence(beat: KeyBeat, t: number): number {
  if (t < beat.at) return 0;
  const inP = settle(clamp01((t - beat.at) / 220));
  const outP = clamp01((beat.until - t) / 200);
  return Math.min(inP, outP);
}

/* ------------------------------------------------------ shared geometry */

/** A rough freehand ring, as the pen would lay it down. Shared by the pointer and the drawing. */
export const SNAP_RING = { cx: 112, cy: 56, rx: 44, ry: 30 } as const;

export function snapPoint(s: number): Pt {
  const { cx, cy, rx, ry } = SNAP_RING;
  const th = -Math.PI / 2 + s * Math.PI * 2 * 1.05;
  const wob = 1 + 0.07 * Math.sin(th * 3 + 0.6);
  return [
    cx + rx * Math.cos(th) * wob + 2.2 * Math.sin(th * 7),
    cy + ry * Math.sin(th) * (1 + 0.06 * Math.cos(th * 2)) + 1.8 * Math.cos(th * 9),
  ];
}

export const SNAP_LINE = { from: [46, 100] as Pt, to: [180, 34] as Pt };

/** The hand's path for the straight-line beat: aimed at the end, wobbling on the way. */
export function snapLinePoint(p: number): Pt {
  const { from, to } = SNAP_LINE;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const bell = Math.sin(p * Math.PI);
  const off = 5 * Math.sin(p * 13) * bell;
  return [lerp(from[0], to[0], p) - (dy / len) * off, lerp(from[1], to[1], p) + (dx / len) * off];
}

/** The loop the lasso eraser draws around what it will remove. */
export const LASSO_LOOP = { cx: 72, cy: 66, rx: 36, ry: 34 } as const;

export function lassoPoint(s: number): Pt {
  const { cx, cy, rx, ry } = LASSO_LOOP;
  const th = -Math.PI / 2 + s * Math.PI * 2 * 1.02;
  return [cx + rx * Math.cos(th) + 2 * Math.sin(th * 5), cy + ry * Math.sin(th) + 1.6 * Math.cos(th * 6)];
}

/** Where each bar's top sits for a value, in the chart demo. */
export const CHART_DEMO = { base: 108, scale: 0.8, barX: (i: number) => 120 + i * 24, barW: 16 } as const;
export const CHART_VALUES = [42, 66, 30, 80] as const;

/** The shape library demo: three tiles and where each is dropped, in stage units. */
export const SHAPES_DEMO = {
  /** Where a tile's centre is: four columns by three rows, 20 apart. */
  tile: (col: number, row: number): Pt => [22 + col * 20, 46 + row * 20],
  drags: [
    { from: [42, 66] as Pt, to: [156, 62] as Pt, start: 800, drop: 2300 },
    { from: [82, 66] as Pt, to: [128, 100] as Pt, start: 3600, drop: 4300 },
    { from: [62, 46] as Pt, to: [160, 100] as Pt, start: 5000, drop: 5700 },
    { from: [82, 86] as Pt, to: [192, 100] as Pt, start: 6200, drop: 6900 },
  ],
} as const;

/* ------------------------------------------------------------- scripts */

const at = (p: Pt, extra: Partial<CursorKey> & { at: number }): CursorKey => ({ x: p[0], y: p[1], ...extra });

/**
 * The ids with a script. Lessons name one of these in `demo`; the legacy CSS
 * scenes keep their own ids.
 */
export type ScriptedId =
  | 'snap'
  | 'lasso'
  | 'shapes'
  | 'flow'
  | 'arrange'
  | 'fill'
  | 'chartlive'
  | 'chain'
  | 'present'
  | 'select'
  | 'cursorchat'
  | 'slides'
  | 'gridedit'
  | 'anchors'
  | 'sketch'
  | 'shadow'
  | 'touch'
  | 'voice'
  | 'cursors'
  | 'follow'
  | 'spotlight'
  | 'ping'
  | 'reactions'
  | 'thread'
  | 'share';

/** Times other parts of the scene need to agree with the script on. */
export const TIMES = {
  snap: { drawAt: 460, drawEnd: 2460, holdMs: 450, lineAt: 5100, lineEnd: 6300 },
  lasso: { loopAt: 520, loopEnd: 2360, releaseAt: 2500, brushAt: 4700, brushEnd: 5800 },
  flow: { magnetAt: 600, clickAt: 1900, tabAt: 3700, backTabAt: 5300 },
  arrange: { marqueeAt: 300, marqueeEnd: 1500, arrangeAt: 2300, mergeAt: 4700 },
  fill: { dragAt: 900, dragEnd: 2300, selectAt: 3700, selectEnd: 4500, fillDownAt: 5000 },
  chartlive: { editAt: 1700, dragAt: 4300, dragEnd: 5300 },
  chain: { placeAt: 500, tab1: 1700, tab2: 3200, shiftTab: 4700, recolourAt: 6000 },
  present: { startAt: 800, nextAt: 2500, exitAt: 3700, fitAt: 5500 },
  select: { clickAt: [900, 1900], measureAt: 4000, similarAt: 6300 },
  cursorchat: { openAt: 700, typeAt: 1500, typeEnd: 3200 },
  slides: { gridEnd: 2700, pickAt: 1700, pushAt: 3300, pushEnd: 4200, laserAt: 5000 },
  gridedit: { dragAt: 900, dragEnd: 2100, altAt: 3500, altEnd: 4700, dblAt: 5800 },
  anchors: { marqueeAt: 900, marqueeEnd: 2000, scaleAt: 3700, scaleEnd: 5000 },
  sketch: { onAt: 1900, offAt: 4600 },
  shadow: { onAt: 1400, blurAt: 2800, blurEnd: 4200, innerAt: 5200 },
  voice: { placeAt: 1300, pauseAt: 3400, keepAt: 4700 },
  follow: { clickAt: 1500, escAt: 5900 },
  spotlight: { goAt: 3300 },
  ping: { pingAt: 2000 },
  reactions: { taps: [1300, 2900, 4400] },
  thread: { pinAt: 1500, sendAt: 3500, resolveAt: 5800 },
  share: { roleAt: 1900, copyAt: 4300 },
} as const;

const SNAP_T = TIMES.snap;
const LASSO_T = TIMES.lasso;
const FL_T = TIMES.flow;
const AR_T = TIMES.arrange;
const FI_T = TIMES.fill;
const CH_T = TIMES.chartlive;
const CN_T = TIMES.chain;
const PR_T = TIMES.present;
const SE_T = TIMES.select;
const CC_T = TIMES.cursorchat;

const SL_T = TIMES.slides;
const GE_T = TIMES.gridedit;
const AN_T = TIMES.anchors;
const SK_T = TIMES.sketch;
const SH_T = TIMES.shadow;
const VO_T = TIMES.voice;
const FO_T = TIMES.follow;
const SP_T = TIMES.spotlight;
const PI_T = TIMES.ping;
const RE_T = TIMES.reactions;
const TH_T = TIMES.thread;
const SA_T = TIMES.share;

/**
 * Where the new scenes put things the pointer has to find, shared with the
 * drawing so the hand lands on what it is meant to touch.
 */
export const GE = { edges: [20, 70, 120, 170], rows: [18, 62, 108], drag1: 98, drag2: 152 } as const;
export const AN = {
  /** The five anchors of the path, in order. */
  points: [[60, 92], [84, 34], [128, 24], [160, 56], [142, 100]] as readonly Pt[],
  /** Which of them the marquee picks. */
  picked: [1, 2, 3] as readonly number[],
  /** Marquee: x0, y0, x1, y1. */
  marquee: [74, 14, 174, 70] as const,
  /** The point box's bottom-right handle, then how far the drag takes it. */
  corner: [168, 64] as Pt,
  box: { x: 76, y: 16, w: 92, h: 48 },
  drag: [22, 14] as Pt,
} as const;
export const SH = {
  toggle: [182, 34] as Pt,
  /** The blur slider: start x, y, end x. */
  slider: [160, 62, 200] as const,
  inner: [196, 90] as Pt,
} as const;
export const VO = { spot: [96, 60] as Pt } as const;
export const FO = { face: [188, 16] as Pt } as const;
export const SP = { go: [178, 26] as Pt } as const;
export const PI = { spot: [96, 62] as Pt } as const;
export const RE = { btn: (i: number): Pt => [62 + i * 20, 112] } as const;
export const TH = { pin: [96, 40] as Pt, send: [198, 88] as Pt, resolve: [198, 32] as Pt } as const;
export const SA = { role: [112, 65] as Pt, copy: [158, 90] as Pt } as const;

const snapStart = snapPoint(0);
const snapEnd = snapPoint(1);
const lassoStart = lassoPoint(0);
const lassoEnd = lassoPoint(1);

/** Dwelling: the same point twice, so the pointer rests while the eye catches up. */
export const SCRIPTS: Record<ScriptedId, DemoScript> = {
  snap: {
    duration: 7600,
    tool: 'pen',
    cursor: [
      at(snapStart, { at: 0 }),
      at(snapStart, { at: 300 }),
      at(snapStart, { at: SNAP_T.drawAt, down: true, along: snapPoint, ease: 'standard' }),
      at(snapEnd, { at: SNAP_T.drawEnd, down: true }),
      at(snapEnd, { at: 3500 }),
      at(snapEnd, { at: 4300, ease: 'settle' }),
      at(SNAP_LINE.from, { at: 4900 }),
      at(SNAP_LINE.from, { at: SNAP_T.lineAt, down: true, along: snapLinePoint, ease: 'standard' }),
      at(SNAP_LINE.to, { at: SNAP_T.lineEnd, down: true }),
      at(SNAP_LINE.to, { at: 6500 }),
      at(SNAP_LINE.to, { at: 7600 }),
    ],
    keys: [{ at: 4600, until: 6900, caps: ['Shift'] }],
    frames: [
      { at: 1500, caption: 'Draw the shape roughly' },
      { at: 2800, caption: 'Hold still at the end of the stroke' },
      { at: 3700, caption: 'It snaps to a clean ellipse' },
    ],
  },

  lasso: {
    duration: 7000,
    tool: 'eraser',
    cursor: [
      at([196, 100], { at: 0 }),
      at(lassoStart, { at: 300, ease: 'settle' }),
      at(lassoStart, { at: LASSO_T.loopAt, down: true, along: lassoPoint, ease: 'standard' }),
      at(lassoEnd, { at: LASSO_T.loopEnd, down: true }),
      at(lassoEnd, { at: LASSO_T.releaseAt }),
      at([124, 52], { at: 4100, ease: 'settle' }),
      at([124, 52], { at: LASSO_T.brushAt, down: true, ease: 'standard' }),
      at([176, 52], { at: LASSO_T.brushEnd, down: true }),
      at([176, 52], { at: 6000 }),
      at([176, 52], { at: 7000 }),
    ],
    keys: [{ at: 4000, until: 6200, caps: ['Alt'] }],
    frames: [
      { at: 1500, caption: 'Draw a loop around what to remove' },
      { at: 3200, caption: 'Let go and it is gone' },
      { at: 5400, caption: 'Hold Alt to swap to the brush' },
    ],
  },

  shapes: {
    duration: 8000,
    tool: 'shape',
    cursor: [
      at([60, 112], { at: 0 }),
      at(SHAPES_DEMO.drags[0].from, { at: 500, ease: 'settle' }),
      ...SHAPES_DEMO.drags.flatMap((d, i): CursorKey[] => [
        ...(i > 0 ? [at(d.from, { at: d.start - 280, ease: 'settle' })] : []),
        at(d.from, { at: d.start, down: true, ease: 'standard' }),
        at(d.to, { at: d.drop, down: true }),
        at(d.to, { at: d.drop + 160 }),
      ]),
      at(SHAPES_DEMO.drags[3].to, { at: 8000 }),
    ],
    keys: [],
    frames: [
      { at: 2000, caption: 'Drag a tile out onto the board' },
      { at: 4700, caption: 'The library stays open for the next one' },
      { at: 7300, caption: 'Place as many as you need' },
    ],
  },

  flow: {
    duration: 7600,
    tool: 'connector',
    cursor: [
      at([100, 100], { at: 0 }),
      at([46, 52], { at: FL_T.magnetAt, ease: 'settle' }),
      at([80, 36], { at: 1500, ease: 'settle' }),
      at([80, 36], { at: FL_T.clickAt, down: true }),
      at([80, 36], { at: 2150 }),
      at([100, 70], { at: 3000, ease: 'settle' }),
      at([100, 70], { at: 7600 }),
    ],
    keys: [
      { at: FL_T.tabAt - 150, until: FL_T.tabAt + 1100, caps: [...caps('quickNext')] },
      { at: FL_T.backTabAt - 150, until: FL_T.backTabAt + 1300, caps: [...caps('quickBack')] },
    ],
    frames: [
      { at: 1500, caption: 'Move near a shape and four magnets appear' },
      { at: 2800, caption: 'Click one for a connected copy' },
      { at: 6500, caption: `${chord('quickNext')} grows the chain, ${chord('quickBack')} steps back along it` },
    ],
  },

  arrange: {
    duration: 7000,
    tool: 'select',
    cursor: [
      at([196, 112], { at: 0 }),
      at([14, 8], { at: AR_T.marqueeAt, ease: 'settle' }),
      at([14, 8], { at: 600, down: true, ease: 'standard' }),
      at([212, 118], { at: AR_T.marqueeEnd, down: true }),
      at([212, 118], { at: 1700 }),
      at([212, 118], { at: 3500 }),
      at([118, 56], { at: 4150, ease: 'settle' }),
      at([118, 56], { at: AR_T.mergeAt - 300, down: true, ease: 'standard' }),
      at([190, 56], { at: AR_T.mergeAt - 80, down: true }),
      at([190, 56], { at: AR_T.mergeAt }),
      at([190, 56], { at: 7000 }),
    ],
    keys: [
      { at: 2000, until: 3900, caps: [...caps('arrangeInGrid')] },
      { at: AR_T.mergeAt - 200, until: 6200, caps: [...caps('mergeCells')] },
    ],
    frames: [
      { at: 1500, caption: 'Select the objects you want in a grid' },
      { at: 3600, caption: `${chord('arrangeInGrid')} deals them into cells` },
      { at: 5600, caption: `${chord('mergeCells')} merges selected cells` },
    ],
  },

  fill: {
    duration: 7600,
    tool: 'table',
    cursor: [
      at([210, 118], { at: 0 }),
      at([138, 44], { at: 600, ease: 'settle' }),
      at([138, 44], { at: FI_T.dragAt, down: true, ease: 'standard' }),
      at([138, 92], { at: FI_T.dragEnd, down: true }),
      at([138, 92], { at: 2500 }),
      at([168, 38], { at: 3500, ease: 'settle' }),
      at([168, 38], { at: FI_T.selectAt, down: true, ease: 'standard' }),
      at([168, 102], { at: FI_T.selectEnd, down: true }),
      at([168, 102], { at: 4600 }),
      at([190, 118], { at: 5400, ease: 'settle' }),
      at([190, 118], { at: 7600 }),
    ],
    keys: [{ at: FI_T.fillDownAt - 200, until: 6700, caps: [...caps('fillDown')] }],
    frames: [
      { at: 1500, caption: 'Drag the fill handle down' },
      { at: 2800, caption: 'The series carries on' },
      { at: 6200, caption: `${chord('fillDown')} copies the first cell down` },
    ],
  },

  chartlive: {
    duration: 7600,
    tool: 'chart',
    cursor: [
      at([210, 118], { at: 0 }),
      at([76, 75], { at: 700, ease: 'settle' }),
      at([76, 75], { at: 1100, down: true }),
      at([76, 75], { at: 1250 }),
      at([76, 75], { at: 1400, down: true }),
      at([76, 75], { at: 1550 }),
      at([76, 75], { at: 3300 }),
      at([CHART_DEMO.barX(1) + 8, CHART_DEMO.base - CHART_VALUES[1] * CHART_DEMO.scale], { at: 3900, ease: 'settle' }),
      at([CHART_DEMO.barX(1) + 8, CHART_DEMO.base - CHART_VALUES[1] * CHART_DEMO.scale], { at: CH_T.dragAt, down: true, ease: 'standard' }),
      at([CHART_DEMO.barX(1) + 8, CHART_DEMO.base - 92 * CHART_DEMO.scale], { at: CH_T.dragEnd, down: true }),
      at([CHART_DEMO.barX(1) + 8, CHART_DEMO.base - 92 * CHART_DEMO.scale], { at: 5500 }),
      at([CHART_DEMO.barX(1) + 8, CHART_DEMO.base - 92 * CHART_DEMO.scale], { at: 7600 }),
    ],
    keys: [],
    frames: [
      { at: 1400, caption: 'Change a number in the table' },
      { at: 2900, caption: 'The linked chart redraws with it' },
      { at: 5100, caption: 'Or drag a bar: the cell follows' },
    ],
  },

  chain: {
    duration: 7600,
    tool: 'sticky',
    cursor: [
      at([196, 112], { at: 0 }),
      at([34, 50], { at: 300, ease: 'settle' }),
      at([34, 50], { at: CN_T.placeAt, down: true }),
      at([34, 50], { at: 700 }),
      at([196, 112], { at: 1500, ease: 'settle' }),
      at([196, 112], { at: 7600 }),
    ],
    keys: [
      { at: CN_T.tab1 - 150, until: CN_T.tab1 + 900, caps: [...caps('chainRight')] },
      { at: CN_T.tab2 - 150, until: CN_T.tab2 + 900, caps: [...caps('chainRight')] },
      { at: CN_T.shiftTab - 150, until: CN_T.shiftTab + 1000, caps: [...caps('chainDown')] },
      { at: CN_T.recolourAt - 150, until: 7000, caps: ['2'] },
    ],
    frames: [
      { at: 1200, caption: 'Type a note' },
      { at: 3900, caption: `${chord('chainRight')} starts the next one beside it` },
      { at: 6900, caption: `${chord('chainDown')} drops one below, and 1 to 8 recolour` },
    ],
  },

  present: {
    duration: 8000,
    tool: 'frame',
    cursor: [
      at([196, 112], { at: 0 }),
      at([40, 60], { at: 300, ease: 'settle' }),
      at([40, 60], { at: 600, down: true }),
      at([40, 60], { at: 750 }),
      at([196, 112], { at: 1800, ease: 'settle' }),
      at([196, 112], { at: 8000 }),
    ],
    keys: [
      { at: PR_T.startAt - 200, until: 2300, caps: [...caps('present')] },
      { at: PR_T.nextAt - 150, until: 3300, caps: ['→'] },
      { at: PR_T.exitAt - 150, until: 4600, caps: ['Esc'] },
      { at: PR_T.fitAt - 200, until: 7300, caps: [...caps('fitFrame')] },
    ],
    frames: [
      { at: 1000, caption: `${chord('present')} presents the frames` },
      { at: 3000, caption: 'Arrow keys move between slides' },
      { at: 6800, caption: `${chord('fitFrame')} fits a frame to what is inside it` },
    ],
  },

  select: {
    duration: 8000,
    tool: 'select',
    cursor: [
      at([196, 112], { at: 0 }),
      at([124, 66], { at: 500, ease: 'settle' }),
      at([124, 66], { at: SE_T.clickAt[0], down: true }),
      at([124, 66], { at: 1050 }),
      at([124, 66], { at: SE_T.clickAt[1], down: true }),
      at([124, 66], { at: 2050 }),
      at([124, 66], { at: 3000 }),
      at([56, 50], { at: SE_T.measureAt, ease: 'settle' }),
      at([56, 50], { at: 5000 }),
      at([190, 112], { at: 5600, ease: 'settle' }),
      at([190, 112], { at: 8000 }),
    ],
    keys: [
      { at: 400, until: 2900, caps: [...caps('selectBehind')] },
      { at: SE_T.measureAt - 200, until: 5200, caps: [...caps('measure')] },
      { at: SE_T.similarAt - 200, until: 7500, caps: [...caps('similarFill')] },
    ],
    frames: [
      { at: 1500, caption: 'Alt-click picks the object behind' },
      { at: 4600, caption: 'Hold Alt over an object to measure' },
      { at: 7000, caption: `${chord('similarFill')} selects everything with that fill` },
    ],
  },

  cursorchat: {
    duration: 5200,
    cursor: [
      at([60, 84], { at: 0 }),
      at([84, 52], { at: 500, ease: 'settle' }),
      at([84, 52], { at: 5200 }),
    ],
    keys: [{ at: CC_T.openAt - 150, until: 2200, caps: [...caps('cursorChat')] }],
    frames: [
      { at: 800, caption: `Press ${chord('cursorChat')} with the pointer over the board` },
      { at: 2400, caption: 'Type where your pointer is' },
      { at: 3600, caption: 'Everyone sees it live, then it fades' },
    ],
  },
  slides: {
    duration: 7600,
    cursor: [
      at([196, 110], { at: 0 }),
      at([150, 46], { at: 900, ease: 'settle' }),
      at([150, 46], { at: SL_T.pickAt, down: true }),
      at([150, 46], { at: SL_T.pickAt + 160 }),
      at([128, 78], { at: 3000, ease: 'settle' }),
      at([128, 78], { at: 4600 }),
      at([66, 62], { at: 4900, ease: 'settle' }),
      at([66, 62], { at: SL_T.laserAt }),
      at([150, 48], { at: 6000, ease: 'standard' }),
      at([166, 88], { at: 6800, ease: 'standard' }),
      at([166, 88], { at: 7600 }),
    ],
    keys: [
      { at: 250, until: 1800, caps: [...caps('slideView')] },
      { at: 4700, until: 7100, caps: [...caps('laser')] },
    ],
    frames: [
      { at: 1500, caption: `Press ${chord('slideView')} to see every frame as a slide` },
      { at: 3700, caption: 'Each slide has its own transition: push, dissolve, zoom or glide' },
      { at: 6200, caption: `Press ${chord('laser')} to point with a laser while presenting` },
    ],
  },

  gridedit: {
    duration: 7600,
    tool: 'grid',
    cursor: [
      at([196, 108], { at: 0 }),
      at([GE.edges[1], 66], { at: 600, ease: 'settle' }),
      at([GE.edges[1], 66], { at: GE_T.dragAt, down: true, ease: 'standard' }),
      at([GE.drag1, 66], { at: GE_T.dragEnd, down: true }),
      at([GE.drag1, 66], { at: 2900 }),
      at([GE.edges[2], 66], { at: 3300, ease: 'settle' }),
      at([GE.edges[2], 66], { at: GE_T.altAt, down: true, ease: 'standard' }),
      at([GE.drag2, 66], { at: GE_T.altEnd, down: true }),
      at([GE.drag2, 66], { at: 5000 }),
      at([46, 88], { at: 5500, ease: 'settle' }),
      at([46, 88], { at: GE_T.dblAt }),
      at([46, 88], { at: 7600 }),
    ],
    keys: [{ at: 3200, until: 5000, caps: ['Alt'] }],
    frames: [
      { at: 2300, caption: 'Drag a border: the two tracks trade space' },
      { at: 4800, caption: 'Hold Alt: only that track changes and the grid grows' },
      { at: 6900, caption: 'Double-click a cell to type in it' },
    ],
  },

  anchors: {
    duration: 7200,
    tool: 'direct-select',
    cursor: [
      at([196, 108], { at: 0 }),
      at([AN.marquee[0], AN.marquee[1]], { at: 700, ease: 'settle' }),
      at([AN.marquee[0], AN.marquee[1]], { at: AN_T.marqueeAt, down: true, ease: 'standard' }),
      at([AN.marquee[2], AN.marquee[3]], { at: AN_T.marqueeEnd, down: true }),
      at([AN.marquee[2], AN.marquee[3]], { at: 2600 }),
      at([AN.corner[0], AN.corner[1]], { at: 3300, ease: 'settle' }),
      at([AN.corner[0], AN.corner[1]], { at: AN_T.scaleAt, down: true, ease: 'standard' }),
      at([AN.corner[0] + 22, AN.corner[1] + 14], { at: AN_T.scaleEnd, down: true }),
      at([AN.corner[0] + 22, AN.corner[1] + 14], { at: 6200 }),
      at([AN.corner[0] + 22, AN.corner[1] + 14], { at: 7200 }),
    ],
    keys: [],
    frames: [
      { at: 1500, caption: 'Drag across points to pick several' },
      { at: 3000, caption: 'The picked points get a box of their own' },
      { at: 5500, caption: 'Drag the box to scale or turn them together' },
    ],
  },

  sketch: {
    duration: 6400,
    ghost: false,
    cursor: [at([112, 108], { at: 0 }), at([112, 108], { at: 6400 })],
    keys: [
      { at: SK_T.onAt - 300, until: SK_T.onAt + 1300, caps: [...caps('sketchBoard')] },
      { at: SK_T.offAt - 300, until: SK_T.offAt + 1300, caps: [...caps('sketchBoard')] },
    ],
    frames: [
      { at: 700, caption: 'A board of clean lines' },
      { at: 2800, caption: `Press ${chord('sketchBoard')} and it is all drawn by hand` },
      { at: 5800, caption: 'Press it again for clean lines' },
    ],
  },

  shadow: {
    duration: 7200,
    cursor: [
      at([196, 112], { at: 0 }),
      at([SH.toggle[0], SH.toggle[1]], { at: 700, ease: 'settle' }),
      at([SH.toggle[0], SH.toggle[1]], { at: SH_T.onAt, down: true }),
      at([SH.toggle[0], SH.toggle[1]], { at: SH_T.onAt + 160 }),
      at([SH.slider[0], SH.slider[1]], { at: 2400, ease: 'settle' }),
      at([SH.slider[0], SH.slider[1]], { at: SH_T.blurAt, down: true, ease: 'standard' }),
      at([SH.slider[2], SH.slider[1]], { at: SH_T.blurEnd, down: true }),
      at([SH.slider[2], SH.slider[1]], { at: 4500 }),
      at([SH.inner[0], SH.inner[1]], { at: 4900, ease: 'settle' }),
      at([SH.inner[0], SH.inner[1]], { at: SH_T.innerAt, down: true }),
      at([SH.inner[0], SH.inner[1]], { at: SH_T.innerAt + 160 }),
      at([SH.inner[0], SH.inner[1]], { at: 7200 }),
    ],
    keys: [],
    frames: [
      { at: 800, caption: 'A flat card' },
      { at: 4300, caption: 'Switch on a drop shadow and set how soft it is' },
      { at: 6500, caption: 'Choose inner for a shadow that sits inside' },
    ],
  },

  touch: {
    duration: 8000,
    ghost: false,
    cursor: [at([112, 64], { at: 0 }), at([112, 64], { at: 8000 })],
    keys: [],
    frames: [
      { at: 1900, caption: 'Pinch with two fingers to zoom and pan' },
      { at: 4200, caption: 'Press and hold for the context menu' },
      { at: 7000, caption: 'Tap with two fingers to undo, three to redo' },
    ],
  },

  voice: {
    duration: 7200,
    tool: 'audio',
    cursor: [
      at([196, 108], { at: 0 }),
      at([VO.spot[0], VO.spot[1]], { at: 600, ease: 'settle' }),
      at([VO.spot[0], VO.spot[1]], { at: VO_T.placeAt, down: true }),
      at([VO.spot[0], VO.spot[1]], { at: VO_T.placeAt + 160 }),
      at([VO.spot[0], VO.spot[1]], { at: 7200 }),
    ],
    keys: [
      { at: VO_T.pauseAt - 200, until: VO_T.pauseAt + 1100, caps: [...caps('voicePause')] },
      { at: VO_T.keepAt - 200, until: VO_T.keepAt + 1400, caps: [...caps('voiceKeep')] },
    ],
    frames: [
      { at: 1900, caption: 'Click where it should sit, then talk' },
      { at: 3700, caption: 'Space pauses. Enter keeps it. Esc throws it away' },
      { at: 6300, caption: 'It lands as a note with a waveform you can play' },
    ],
  },

  cursors: {
    duration: 7200,
    cursor: [
      at([40, 100], { at: 0 }),
      at([60, 80], { at: 800, ease: 'settle' }),
      at([100, 100], { at: 3000, ease: 'standard' }),
      at([84, 70], { at: 5400, ease: 'standard' }),
      at([84, 70], { at: 7200 }),
    ],
    keys: [],
    frames: [
      { at: 1300, caption: 'Everyone’s pointer is live on the board' },
      { at: 3400, caption: 'A name tag says whose it is' },
      { at: 5600, caption: 'What someone selects or drags shows in their colour' },
    ],
  },

  follow: {
    duration: 7600,
    cursor: [
      at([196, 108], { at: 0 }),
      at([FO.face[0], FO.face[1]], { at: 700, ease: 'settle' }),
      at([FO.face[0], FO.face[1]], { at: FO_T.clickAt, down: true }),
      at([FO.face[0], FO.face[1]], { at: FO_T.clickAt + 160 }),
      at([120, 76], { at: 2900, ease: 'settle' }),
      at([120, 76], { at: 6000 }),
      at([150, 84], { at: 6300, ease: 'settle' }),
      at([150, 84], { at: 7600 }),
    ],
    keys: [{ at: FO_T.escAt - 100, until: FO_T.escAt + 1300, caps: ['Esc'] }],
    frames: [
      { at: 1300, caption: 'Click someone’s face to follow their view' },
      { at: 3900, caption: 'Your board moves with them, inside their colour' },
      { at: 7000, caption: 'Move, click it again or press Esc to stop' },
    ],
  },

  spotlight: {
    duration: 7600,
    cursor: [
      at([196, 108], { at: 0 }),
      at([SP.go[0], SP.go[1]], { at: 2700, ease: 'settle' }),
      at([SP.go[0], SP.go[1]], { at: SP_T.goAt, down: true }),
      at([SP.go[0], SP.go[1]], { at: SP_T.goAt + 160 }),
      at([120, 100], { at: 4500, ease: 'settle' }),
      at([120, 100], { at: 7600 }),
    ],
    keys: [],
    frames: [
      { at: 800, caption: 'Someone presents to everyone' },
      { at: 2400, caption: 'You are asked, never dragged along' },
      { at: 5600, caption: 'Follow, and you are looking where they are' },
    ],
  },

  ping: {
    duration: 6400,
    cursor: [
      at([196, 108], { at: 0 }),
      at([PI.spot[0], PI.spot[1]], { at: 600, ease: 'settle' }),
      at([PI.spot[0], PI.spot[1]], { at: PI_T.pingAt, down: true }),
      at([PI.spot[0], PI.spot[1]], { at: PI_T.pingAt + 180 }),
      at([PI.spot[0], PI.spot[1]], { at: 6400 }),
    ],
    keys: [{ at: PI_T.pingAt - 700, until: PI_T.pingAt + 1700, caps: [...caps('pingMods')] }],
    frames: [
      { at: 800, caption: `Hold ${chord('pingMods')}` },
      { at: 1900, caption: 'Click, and a ripple draws every eye to the spot' },
      { at: 4600, caption: 'Everyone sees who pinged, then it fades' },
    ],
  },

  reactions: {
    duration: 6800,
    cursor: [
      at([196, 108], { at: 0 }),
      at(RE.btn(0), { at: 700, ease: 'settle' }),
      at(RE.btn(0), { at: RE_T.taps[0], down: true }),
      at(RE.btn(0), { at: RE_T.taps[0] + 140 }),
      at(RE.btn(2), { at: 2500, ease: 'settle' }),
      at(RE.btn(2), { at: RE_T.taps[1], down: true }),
      at(RE.btn(2), { at: RE_T.taps[1] + 140 }),
      at(RE.btn(4), { at: 4000, ease: 'settle' }),
      at(RE.btn(4), { at: RE_T.taps[2], down: true }),
      at(RE.btn(4), { at: RE_T.taps[2] + 140 }),
      at(RE.btn(4), { at: 6800 }),
    ],
    keys: [],
    frames: [
      { at: 1500, caption: 'While a show runs, viewers send a reaction' },
      { at: 3000, caption: 'It floats up on the presenter’s screen' },
      { at: 5000, caption: 'Several at once make a small crowd' },
    ],
  },

  thread: {
    duration: 7600,
    tool: 'comment',
    cursor: [
      at([196, 108], { at: 0 }),
      at(TH.pin, { at: 700, ease: 'settle' }),
      at(TH.pin, { at: TH_T.pinAt, down: true }),
      at(TH.pin, { at: TH_T.pinAt + 160 }),
      at(TH.send, { at: 3000, ease: 'settle' }),
      at(TH.send, { at: TH_T.sendAt, down: true }),
      at(TH.send, { at: TH_T.sendAt + 160 }),
      at(TH.resolve, { at: 5400, ease: 'settle' }),
      at(TH.resolve, { at: TH_T.resolveAt, down: true }),
      at(TH.resolve, { at: TH_T.resolveAt + 160 }),
      at(TH.resolve, { at: 7600 }),
    ],
    keys: [],
    frames: [
      { at: 1500, caption: 'Click a spot and a pin opens a thread' },
      { at: 4300, caption: 'Replies stack up beside the work' },
      { at: 6900, caption: 'Resolve it and the pin goes quiet' },
    ],
  },

  share: {
    duration: 7600,
    cursor: [
      at([196, 108], { at: 0 }),
      at(SA.role, { at: 800, ease: 'settle' }),
      at(SA.role, { at: SA_T.roleAt, down: true }),
      at(SA.role, { at: SA_T.roleAt + 160 }),
      at(SA.copy, { at: 3200, ease: 'settle' }),
      at(SA.copy, { at: SA_T.copyAt, down: true }),
      at(SA.copy, { at: SA_T.copyAt + 160 }),
      at(SA.copy, { at: 7600 }),
    ],
    keys: [],
    frames: [
      { at: 800, caption: 'Open Share and choose what the link allows' },
      { at: 3400, caption: 'Edit, comment or view: the server holds the limit' },
      { at: 6200, caption: 'Copy the link. People arrive as live cursors' },
    ],
  },
};

export const isScripted = (id: string): id is ScriptedId => id in SCRIPTS;
