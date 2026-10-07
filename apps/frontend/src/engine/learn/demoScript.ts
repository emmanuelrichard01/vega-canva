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
  | 'cursorchat';

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
};

export const isScripted = (id: string): id is ScriptedId => id in SCRIPTS;
