import { describe, expect, it, vi } from 'vitest';
import {
  EASINGS,
  entryOffset,
  handle,
  konvaEasing,
  lerpColor,
  lerpPose,
  paneFrame,
  playableTransition,
  REDUCED_TRANSITION,
  TransitionRunner,
  travellerStart,
  zoomPhase,
  DIVE_SHARE,
} from './transitionMath';
import { normalizeSlideFields, transitionSpecOf, MAX_TRANSITION_MS, MIN_TRANSITION_MS } from './slideMeta';
import type { FrameNode } from '../model/schema';

describe('easing', () => {
  it('starts at 0, ends at 1 and never runs backwards, for every curve', () => {
    for (const [name, f] of Object.entries(EASINGS)) {
      expect(f(0), name).toBeCloseTo(0);
      expect(f(1), name).toBeCloseTo(1);
      let last = -1;
      for (let i = 0; i <= 50; i++) {
        const v = f(i / 50);
        expect(v, `${name} at ${i}`).toBeGreaterThanOrEqual(last - 1e-9);
        last = v;
      }
    }
  });

  it('gives each curve its own character', () => {
    // Snappy covers most of the way early; standard holds back at the start.
    expect(EASINGS.snappy(0.25)).toBeGreaterThan(0.6);
    expect(EASINGS.standard(0.25)).toBeLessThan(0.1);
    expect(EASINGS.gentle(0.5)).toBeCloseTo(0.5);
  });

  it('wraps a curve in Konva’s tween signature', () => {
    const f = konvaEasing('standard');
    expect(f(0, 10, 20, 2)).toBeCloseTo(10);
    expect(f(1, 10, 20, 2)).toBeCloseTo(20);
    expect(f(2, 10, 20, 2)).toBeCloseTo(30);
  });
});

describe('what plays', () => {
  const spec = { kind: 'push' as const, direction: 'up' as const, ms: 700, ease: 'snappy' as const };

  it('turns every moving transition into a quick dissolve under reduced motion, and keeps a cut a cut', () => {
    expect(playableTransition(spec, true)).toBe(REDUCED_TRANSITION);
    expect(playableTransition({ ...spec, kind: 'zoom' }, true).kind).toBe('dissolve');
    expect(playableTransition({ ...spec, kind: 'none' }, true)).toMatchObject({ kind: 'none', ms: 0 });
    expect(playableTransition(spec, false)).toBe(spec);
  });

  it('reads a slide’s tuning, with defaults, and holds the length in range', () => {
    expect(transitionSpecOf({ type: 'frame' } as FrameNode)).toEqual({ kind: 'glide', direction: 'left', ms: 620, ease: 'standard' });
    const frame = { type: 'frame', transition: 'slide', transitionDir: 'down', transitionMs: 9999, transitionEase: 'gentle' } as unknown as FrameNode;
    expect(transitionSpecOf(frame)).toEqual({ kind: 'slide', direction: 'down', ms: MAX_TRANSITION_MS, ease: 'gentle' });
    expect(normalizeSlideFields({ transitionMs: 1 }).transitionMs).toBe(MIN_TRANSITION_MS);
    expect(normalizeSlideFields({ transitionDir: 'sideways', transitionEase: 'bouncy', transitionMs: Number.NaN })).toEqual({});
  });
});

describe('push and slide', () => {
  it('bring the new slide in from the side it travels away from', () => {
    expect(entryOffset('left')).toEqual({ x: 1, y: 0 });
    expect(entryOffset('down')).toEqual({ x: 0, y: -1 });
  });

  it('push moves both slides together, a full slide apart', () => {
    for (const e of [0, 0.3, 0.8, 1]) {
      const { from, to } = paneFrame('push', 'left', e);
      expect(to.x - from.x).toBeCloseTo(1);
    }
    expect(paneFrame('push', 'left', 1).from.x).toBeCloseTo(-1);
    expect(paneFrame('push', 'left', 1).to.x).toBeCloseTo(0);
  });

  it('slide keeps the old slide in place, dimmed, while the new one covers it', () => {
    const { from, to } = paneFrame('slide', 'up', 1);
    expect(from.x).toBe(0);
    expect(from.y).toBe(0);
    expect(from.opacity).toBeLessThan(1);
    expect(to.y).toBeCloseTo(0);
    expect(paneFrame('slide', 'up', 0).to.y).toBe(1);
  });
});

describe('the camera', () => {
  const stage = { width: 1000, height: 600 };
  const a = { x: 0, y: 0, zoom: 1 };
  const b = { x: -4000, y: -2000, zoom: 8 };

  it('lands exactly on both poses', () => {
    expect(lerpPose(a, b, stage, 0)).toEqual(a);
    const end = lerpPose(a, b, stage, 1);
    expect(end.x).toBeCloseTo(b.x);
    expect(end.y).toBeCloseTo(b.y);
    expect(end.zoom).toBeCloseTo(b.zoom);
  });

  it('zooms geometrically: halfway through an eightfold dive is close to threefold', () => {
    expect(lerpPose(a, b, stage, 0.5).zoom).toBeCloseTo(Math.sqrt(8));
  });

  it('dives first, then reveals the new slide', () => {
    expect(zoomPhase(0, 'standard')).toEqual({ dive: 0, reveal: 0 });
    const mid = zoomPhase(DIVE_SHARE / 2, 'gentle');
    expect(mid.dive).toBeGreaterThan(0);
    expect(mid.reveal).toBe(0);
    expect(zoomPhase(DIVE_SHARE, 'standard').dive).toBeCloseTo(1);
    expect(zoomPhase(1, 'standard')).toEqual({ dive: 1, reveal: 1 });
  });
});

describe('a smart-moved object', () => {
  it('starts drawn exactly over where it stood on the old slide', () => {
    // Resting at 100,100 (200×100) with a group positioned at its centre.
    const rest = { x: 100, y: 100, width: 200, height: 100 };
    const node = { x: 200, y: 150, scaleX: 1, scaleY: 1, rotation: 0 };
    const start = { x: 500, y: 300, width: 100, height: 50 };
    const t = travellerStart(node, rest, start, 15);
    expect(t.scaleX).toBeCloseTo(0.5);
    expect(t.scaleY).toBeCloseTo(0.5);
    // The box's centre (the group origin) lands on the old box's centre.
    expect(t.x).toBeCloseTo(550);
    expect(t.y).toBeCloseTo(325);
    expect(t.rotation).toBe(15);
  });

  it('changes colour on the way', () => {
    expect(lerpColor('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(lerpColor('#4F46E5', '#F3A024', 0)).toBe('#4F46E5');
    expect(lerpColor('#4F46E5', '#F3A024', 1)).toBe('#F3A024');
    expect(lerpColor('red', '#F3A024', 0.5)).toBe('#F3A024');
  });
});

describe('interrupting a transition', () => {
  const pending = () => {
    const finished = vi.fn();
    const h = handle(finished);
    return { h, finished };
  };

  it('finishes the playing transition before the next one begins', () => {
    const runner = new TransitionRunner();
    const first = pending();
    const order: string[] = [];
    first.finished.mockImplementation(() => order.push('first finished'));
    runner.start(() => first.h);
    runner.start(() => {
      order.push('second begins');
      return pending().h;
    });
    expect(order).toEqual(['first finished', 'second begins']);
  });

  it('finishes each transition exactly once, however it ends', async () => {
    const runner = new TransitionRunner();
    const t = pending();
    runner.start(() => t.h);
    t.h.complete(); // it played out
    runner.settle(); // and the show ended
    t.h.finish();
    expect(t.finished).toHaveBeenCalledTimes(1);
    await t.h.done;
    expect(runner.running).toBe(false);
  });

  it('settles when the show stops, and is idle afterwards', async () => {
    const runner = new TransitionRunner();
    const t = pending();
    runner.start(() => t.h);
    expect(runner.running).toBe(true);
    runner.settle();
    expect(t.finished).toHaveBeenCalledTimes(1);
    expect(runner.running).toBe(false);
    await t.h.done;
  });

  it('lets a quick succession of presses land each one cleanly', () => {
    const runner = new TransitionRunner();
    const all = [pending(), pending(), pending()];
    all.forEach((t) => runner.start(() => t.h));
    expect(all[0].finished).toHaveBeenCalledTimes(1);
    expect(all[1].finished).toHaveBeenCalledTimes(1);
    expect(all[2].finished).not.toHaveBeenCalled();
    expect(all[2].h.settled()).toBe(false);
  });
});
