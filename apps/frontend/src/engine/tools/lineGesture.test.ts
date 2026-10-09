import { describe, expect, it } from 'vitest';
import {
  IDLE,
  formatMeasure,
  lineGesture,
  measureRun,
  segmentEnds,
  type LineEffect,
  type LineEvent,
  type LinePhase,
} from './lineGesture';

/** Feed a sequence of events and collect every effect that is not `none`. */
function play(events: LineEvent[], zoom = 1, start: LinePhase = IDLE) {
  let phase = start;
  const effects: LineEffect[] = [];
  for (const event of events) {
    const out = lineGesture(phase, event, { zoom });
    phase = out.phase;
    if (out.effect.type !== 'none') effects.push(out.effect);
  }
  return { phase, effects };
}

const down = (x: number, y: number): LineEvent => ({ type: 'down', at: { x, y } });
const move = (x: number, y: number): LineEvent => ({ type: 'move', at: { x, y } });
const up = (x: number, y: number): LineEvent => ({ type: 'up', at: { x, y } });
const click = (x: number, y: number): LineEvent[] => [down(x, y), up(x, y)];

describe('drag draws one segment', () => {
  it('commits the press and the release as the two ends', () => {
    const { phase, effects } = play([down(10, 10), move(60, 10), move(200, 90), up(200, 90)]);
    expect(phase.kind).toBe('idle');
    expect(effects).toEqual([{ type: 'segment', from: { x: 10, y: 10 }, to: { x: 200, y: 90 } }]);
  });

  it('decides drag or click in screen pixels, so zoom does not change the gesture', () => {
    // Four world units is eight screen pixels at 200% — a drag — and two at
    // 50%, which is a wobbling click.
    expect(play([down(0, 0), move(4, 0)], 2).phase.kind).toBe('dragging');
    expect(play([down(0, 0), move(4, 0)], 0.5).phase.kind).toBe('pressed');
  });

  it('throws a drag away on Escape', () => {
    const { phase, effects } = play([down(0, 0), move(100, 0), { type: 'cancel' }]);
    expect(phase.kind).toBe('idle');
    expect(effects).toEqual([{ type: 'discard' }]);
  });
});

describe('clicks draw a run of corners', () => {
  it('starts a run on a click and adds a corner on every further click', () => {
    const { phase, effects } = play([...click(0, 0), move(100, 0), ...click(100, 0), ...click(100, 80)]);
    expect(effects).toEqual([]);
    expect(phase.kind === 'run' && phase.session.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
  });

  it('finishes on a double-click, because its second click lands on the last corner', () => {
    const { phase, effects } = play([...click(0, 0), ...click(120, 0), ...click(120, 0)]);
    expect(phase.kind).toBe('idle');
    expect(effects).toEqual([{ type: 'run', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }] }]);
  });

  it('finishes on Enter and keeps the run on Escape', () => {
    const base = [...click(0, 0), ...click(50, 50), ...click(90, 10)];
    for (const key of ['finish', 'cancel'] as const) {
      const { effects } = play([...base, { type: key }]);
      expect(effects, key).toEqual([{ type: 'run', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 90, y: 10 }] }]);
    }
  });

  it('discards a run that never got a second point', () => {
    expect(play([...click(0, 0), { type: 'finish' }]).effects).toEqual([{ type: 'discard' }]);
  });

  it('takes back the last corner on Backspace, and the gesture with the first', () => {
    const two = play([...click(0, 0), ...click(50, 0), { type: 'undo' }]);
    expect(two.phase.kind === 'run' && two.phase.session.points).toEqual([{ x: 0, y: 0 }]);
    const none = play([{ type: 'undo' }], 1, two.phase);
    expect(none.phase.kind).toBe('idle');
    expect(none.effects).toEqual([{ type: 'discard' }]);
  });

  it('never turns a move during a run into a drag', () => {
    const { phase } = play([...click(0, 0), down(10, 0), move(300, 0)]);
    expect(phase.kind).toBe('run');
  });

  it('ignores a release it did not see pressed', () => {
    const { phase } = play([...click(0, 0), up(80, 80)]);
    expect(phase.kind === 'run' && phase.session.points).toHaveLength(1);
  });

  it('places each corner through the tool, which is where grid and Shift apply', () => {
    let phase: LinePhase = IDLE;
    const place = (p: { x: number; y: number }) => ({ x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 });
    for (const event of [...click(3, 4), ...click(48, 52)]) {
      phase = lineGesture(phase, event, { zoom: 1, place }).phase;
    }
    expect(phase.kind === 'run' && phase.session.points).toEqual([{ x: 0, y: 0 }, { x: 50, y: 50 }]);
  });
});

describe('segmentEnds', () => {
  it('draws from the centre with Alt: the press becomes the middle', () => {
    expect(segmentEnds({ x: 100, y: 100 }, { x: 160, y: 120 }, { shift: false, alt: true })).toEqual({
      a: { x: 40, y: 80 },
      b: { x: 160, y: 120 },
    });
  });

  it('steps the angle to fifteen degrees with Shift, keeping the length', () => {
    const { a, b } = segmentEnds({ x: 0, y: 0 }, { x: 100, y: 12 }, { shift: true, alt: false });
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b.y).toBeCloseTo(0, 9);
    expect(b.x).toBeCloseTo(Math.hypot(100, 12), 9);
  });

  it('constrains first and mirrors after when both are held', () => {
    const { a, b } = segmentEnds({ x: 0, y: 0 }, { x: 50, y: 48 }, { shift: true, alt: true });
    expect(b.x).toBeCloseTo(b.y, 9);
    expect(a.x).toBeCloseTo(-b.x, 9);
    expect(a.y).toBeCloseTo(-b.y, 9);
  });
});

describe('the readout', () => {
  it('measures angles the way a person reads them, up being positive', () => {
    expect(measureRun({ x: 0, y: 0 }, { x: 10, y: -10 }).angle).toBeCloseTo(45, 9);
    expect(measureRun({ x: 0, y: 0 }, { x: 0, y: 10 }).angle).toBeCloseTo(-90, 9);
    expect(measureRun({ x: 0, y: 0 }, { x: -10, y: 0 }).angle).toBeCloseTo(180, 9);
    expect(measureRun({ x: 0, y: 0 }, { x: 10, y: 0 }).angle).toBe(0);
  });

  it('formats whole units and degrees, and has no zero-length surprises', () => {
    expect(formatMeasure(measureRun({ x: 0, y: 0 }, { x: 30, y: -40 }))).toBe('50 · 53°');
    expect(formatMeasure(measureRun({ x: 5, y: 5 }, { x: 5, y: 5 }))).toBe('0 · 0°');
  });
});
