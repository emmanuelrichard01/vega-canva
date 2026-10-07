import { describe, expect, it } from 'vitest';
import { LESSONS } from './lessons';
import {
  clamp01,
  cubicBezier,
  isScripted,
  keyPresence,
  loopEnvelope,
  prog,
  sampleCursor,
  SCRIPTS,
  settle,
  win,
  type ScriptedId,
} from './demoScript';

const ids = Object.keys(SCRIPTS) as ScriptedId[];

describe('easing', () => {
  it('matches the product curve and never passes its target', () => {
    // `--ease-settle`: exponential ease-out. Overshoot is the failure the token
    // was recurved to remove, so a sample past 1 is a bug here too.
    let last = 0;
    for (let i = 0; i <= 200; i += 1) {
      const y = settle(i / 200);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      expect(y).toBeLessThanOrEqual(1);
      last = y;
    }
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBe(1);
    // Most of the travel is done early: that is what makes it a settle.
    expect(settle(0.25)).toBeGreaterThan(0.6);
  });

  it('solves a bezier the way CSS does', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 2);
  });

  it('clamps rather than extrapolating', () => {
    expect(prog(-500, 100, 400)).toBe(0);
    expect(prog(9000, 100, 400)).toBe(1);
    expect(clamp01(2)).toBe(1);
    expect(win(0, 100, 900)).toBe(0);
    expect(win(500, 100, 900)).toBe(1);
    expect(win(1200, 100, 900)).toBe(0);
  });

  it('hides the loop point behind an empty stage', () => {
    const d = 6000;
    expect(loopEnvelope(0, d)).toBe(0);
    expect(loopEnvelope(d, d)).toBe(0);
    expect(loopEnvelope(d / 2, d)).toBe(1);
  });
});

describe('every script', () => {
  it('runs between four and eight seconds', () => {
    for (const id of ids) {
      const { duration } = SCRIPTS[id];
      expect(duration, id).toBeGreaterThanOrEqual(4000);
      expect(duration, id).toBeLessThanOrEqual(8000);
    }
  });

  it('keeps the pointer track in order and inside its own length', () => {
    for (const id of ids) {
      const { cursor, duration } = SCRIPTS[id];
      expect(cursor.length, id).toBeGreaterThan(1);
      for (let i = 1; i < cursor.length; i += 1) {
        expect(cursor[i].at, `${id} key ${i}`).toBeGreaterThanOrEqual(cursor[i - 1].at);
      }
      expect(cursor[0].at, id).toBe(0);
      expect(cursor[cursor.length - 1].at, id).toBeLessThanOrEqual(duration);
    }
  });

  it('keeps the pointer on the stage', () => {
    for (const id of ids) {
      const { cursor, duration } = SCRIPTS[id];
      for (let t = 0; t <= duration; t += 100) {
        const c = sampleCursor(cursor, t);
        expect(c.x, `${id} @${t}`).toBeGreaterThanOrEqual(-1);
        expect(c.x, `${id} @${t}`).toBeLessThanOrEqual(225);
        expect(c.y, `${id} @${t}`).toBeGreaterThanOrEqual(-1);
        expect(c.y, `${id} @${t}`).toBeLessThanOrEqual(129);
      }
    }
  });

  it('shows each key for long enough to read it, and inside the film', () => {
    for (const id of ids) {
      const { keys, duration } = SCRIPTS[id];
      for (const k of keys) {
        expect(k.until - k.at, `${id} ${k.caps.join('+')}`).toBeGreaterThanOrEqual(900);
        expect(k.at, id).toBeGreaterThanOrEqual(0);
        expect(k.until, id).toBeLessThanOrEqual(duration);
        expect(k.caps.length, id).toBeGreaterThan(0);
      }
    }
  });

  it('has exactly three storyboard frames, in order, each with a caption', () => {
    for (const id of ids) {
      const { frames, duration } = SCRIPTS[id];
      expect(frames, id).toHaveLength(3);
      for (let i = 0; i < 3; i += 1) {
        expect(frames[i].caption.length, id).toBeGreaterThan(0);
        expect(frames[i].caption, id).not.toContain('—');
        expect(frames[i].at, id).toBeGreaterThanOrEqual(0);
        expect(frames[i].at, id).toBeLessThan(duration);
        if (i > 0) expect(frames[i].at, id).toBeGreaterThan(frames[i - 1].at);
      }
    }
  });

  it('is named by a lesson, and every scripted lesson demo has a script', () => {
    const named = new Set(LESSONS.map((l) => l.demo).filter(Boolean));
    for (const id of ids) expect(named.has(id), `no lesson plays "${id}"`).toBe(true);
    for (const demo of named) {
      if (demo && isScripted(demo)) expect(SCRIPTS[demo], demo).toBeDefined();
    }
  });
});

describe('sampleCursor', () => {
  const keys = [
    { at: 0, x: 0, y: 0 },
    { at: 1000, x: 100, y: 0, down: true },
    { at: 2000, x: 100, y: 50, down: true },
    { at: 3000, x: 100, y: 50 },
  ];

  it('rests at the first and last keys outside the film', () => {
    expect(sampleCursor(keys, -50)).toMatchObject({ x: 0, y: 0 });
    expect(sampleCursor(keys, 9000)).toMatchObject({ x: 100, y: 50 });
  });

  it('eases between keys without passing either', () => {
    const mid = sampleCursor(keys, 500);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThanOrEqual(100);
  });

  it('reports the press from the key that started it', () => {
    expect(sampleCursor(keys, 500).down).toBe(false);
    const pressed = sampleCursor(keys, 1400);
    expect(pressed.down).toBe(true);
    expect(pressed.pressAge).toBe(400);
    expect(sampleCursor(keys, 3100).down).toBe(false);
  });

  it('follows a path instead of a straight line when a key says so', () => {
    const arc = [
      { at: 0, x: 0, y: 0, along: (p: number) => [p * 10, 40] as const, ease: 'linear' as const },
      { at: 100, x: 10, y: 40 },
    ];
    expect(sampleCursor(arc, 50)).toMatchObject({ x: 5, y: 40 });
  });
});

describe('keyPresence', () => {
  it('rises when the key is pressed and falls before it is released', () => {
    const beat = { at: 1000, until: 2200, caps: ['Tab'] };
    expect(keyPresence(beat, 900)).toBe(0);
    expect(keyPresence(beat, 1300)).toBeGreaterThan(0.9);
    expect(keyPresence(beat, 2100)).toBeLessThan(0.6);
    expect(keyPresence(beat, 2300)).toBe(0);
  });
});
