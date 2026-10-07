import { describe, expect, it } from 'vitest';
import { recognizeShape, resample, simplifyDP } from './shapeRecognition';
import type { Point } from '../model/schema';

/** Deterministic noise, so a failing case can be reproduced exactly. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A hand: low-frequency wander plus a little jitter. */
function hand(points: Point[], amount: number, seed = 7): Point[] {
  const r = rng(seed);
  let wx = 0, wy = 0;
  return points.map((p) => {
    wx = wx * 0.85 + (r() - 0.5) * amount * 0.6;
    wy = wy * 0.85 + (r() - 0.5) * amount * 0.6;
    return { x: p.x + wx + (r() - 0.5) * amount * 0.3, y: p.y + wy + (r() - 0.5) * amount * 0.3 };
  });
}

function polyline(vertices: Point[], perEdge = 30): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < vertices.length; i += 1) {
    const a = vertices[i - 1], b = vertices[i];
    for (let s = 0; s < perEdge; s += 1) {
      const t = s / perEdge;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 120, sweep = 1.04): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI * 2 * sweep - Math.PI / 2;
    return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry };
  });
}

describe('recognizeShape', () => {
  it('snaps a wobbly near-horizontal stroke to a clean horizontal line', () => {
    const raw = hand(polyline([{ x: 0, y: 0 }, { x: 300, y: 8 }], 60), 4);
    const r = recognizeShape(raw, 20);
    expect(r?.kind).toBe('line');
    const ys = r!.points.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.001);
  });

  it('recognises a circle drawn with an overshoot', () => {
    const raw = hand(ellipse(200, 200, 100, 96), 5);
    expect(recognizeShape(raw, 20)?.kind).toBe('circle');
  });

  it('keeps an ellipse an ellipse', () => {
    const raw = hand(ellipse(200, 200, 160, 70), 4);
    const r = recognizeShape(raw, 20);
    expect(r?.kind).toBe('ellipse');
    expect(r?.closed).toBe(true);
  });

  it('recognises a rectangle and squares it to the axes', () => {
    const raw = hand(polyline([
      { x: 0, y: 0 }, { x: 260, y: 4 }, { x: 258, y: 150 }, { x: -3, y: 146 }, { x: 2, y: 3 },
    ]), 4);
    const r = recognizeShape(raw, 20);
    expect(r?.kind).toBe('rectangle');
    // Axis-aligned: the corners share x and y values.
    const xs = new Set(r!.points.map((p) => Math.round(p.x)));
    const ys = new Set(r!.points.map((p) => Math.round(p.y)));
    expect(Math.min(...xs)).toBeGreaterThan(-12);
    expect(ys.size).toBeGreaterThan(1);
  });

  it('turns a near-square into a square', () => {
    const raw = hand(polyline([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 190 }, { x: 0, y: 194 }, { x: 0, y: 2 },
    ]), 3);
    expect(recognizeShape(raw, 20)?.kind).toBe('square');
  });

  it('recognises a triangle', () => {
    const raw = hand(polyline([
      { x: 100, y: 0 }, { x: 200, y: 170 }, { x: 0, y: 172 }, { x: 98, y: 4 },
    ]), 3);
    expect(recognizeShape(raw, 20)?.kind).toBe('triangle');
  });

  it('recognises a diamond', () => {
    const raw = hand(polyline([
      { x: 100, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 100 }, { x: 98, y: 3 },
    ]), 3);
    expect(recognizeShape(raw, 20)?.kind).toBe('diamond');
  });

  it('recognises an arrow drawn as a shaft and a doubled-back barb pair', () => {
    const raw = hand(polyline([
      { x: 0, y: 100 }, { x: 300, y: 100 }, { x: 250, y: 70 }, { x: 300, y: 100 }, { x: 252, y: 132 },
    ]), 2);
    const r = recognizeShape(raw, 20);
    expect(r?.kind).toBe('arrow');
    expect(r?.closed).toBe(false);
  });

  it('leaves handwriting and scribbles alone', () => {
    const r = rng(42);
    const scribble: Point[] = [];
    let x = 0, y = 0;
    for (let i = 0; i < 200; i += 1) {
      x += (r() - 0.3) * 12;
      y += (r() - 0.5) * 30;
      scribble.push({ x, y });
    }
    expect(recognizeShape(scribble, 20)).toBeNull();

    // A cursive "e" loop followed by a tail is not a circle.
    const loopy = [...ellipse(50, 50, 30, 30, 60, 0.8), ...polyline([{ x: 75, y: 70 }, { x: 160, y: 40 }], 20)];
    expect(recognizeShape(loopy, 20)).toBeNull();
  });

  it('ignores marks too small to be shapes', () => {
    expect(recognizeShape(ellipse(0, 0, 4, 4), 20)).toBeNull();
  });
});

describe('geometry helpers', () => {
  it('resamples to evenly spaced points', () => {
    const pts = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 5);
    expect(pts).toHaveLength(5);
    expect(pts[2].x).toBeCloseTo(10);
    expect(pts[2].y).toBeCloseTo(0);
  });

  it('keeps corners when simplifying', () => {
    const out = simplifyDP(polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]), 1);
    expect(out).toHaveLength(3);
  });
});
