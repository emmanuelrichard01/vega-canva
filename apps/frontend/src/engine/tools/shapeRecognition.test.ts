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

describe('recognizeShape: extended shapes', () => {
  const regular = (cx: number, cy: number, r: number, n: number, phase = -Math.PI / 2) =>
    Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos(phase + (i * Math.PI * 2) / n) * r, y: cy + Math.sin(phase + (i * Math.PI * 2) / n) * r }));
  const closeRing = (v: Point[]) => [...v, { x: v[0].x + 2, y: v[0].y + 3 }];
  const starVertices = (cx: number, cy: number, R: number, ratio = 0.45) =>
    Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 === 0 ? R : R * ratio;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
  const heartCurve = (n = 120) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = (i / n) * Math.PI * 2 + 0.3;
      return { x: 200 + 10 * 16 * Math.sin(t) ** 3 / 1, y: 200 - 10 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) };
    });
  const roundedRect = (w: number, h: number, r: number) => {
    const pts: Point[] = [];
    const arc = (cx: number, cy: number, from: number) => {
      for (let i = 0; i <= 10; i += 1) {
        const a = from + (i / 10) * (Math.PI / 2);
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    };
    arc(w - r, r, -Math.PI / 2);
    arc(w - r, h - r, 0);
    arc(r, h - r, Math.PI / 2);
    arc(r, r, Math.PI);
    pts.push({ ...pts[0] });
    return polyline(pts, 3);
  };

  for (const seed of [1, 2, 3]) {
    it(`recognises an outline star (seed ${seed})`, () => {
      expect(recognizeShape(hand(polyline(closeRing(starVertices(200, 200, 120))), 4, seed), 20)?.kind).toBe('star');
    });

    it(`recognises a pentagram stroke as a star (seed ${seed})`, () => {
      const tips = regular(200, 200, 120, 5);
      const order = [0, 2, 4, 1, 3, 0].map((i) => tips[i]);
      expect(recognizeShape(hand(polyline(order), 4, seed), 20)?.kind).toBe('star');
    });

    it(`recognises a pentagon (seed ${seed})`, () => {
      expect(recognizeShape(hand(polyline(closeRing(regular(200, 200, 110, 5))), 3, seed), 20)?.kind).toBe('pentagon');
    });

    it(`recognises a hexagon (seed ${seed})`, () => {
      expect(recognizeShape(hand(polyline(closeRing(regular(200, 200, 110, 6, 0))), 3, seed), 20)?.kind).toBe('hexagon');
    });

    it(`recognises a heart (seed ${seed})`, () => {
      expect(recognizeShape(hand(heartCurve(), 4, seed), 20)?.kind).toBe('heart');
    });

    it(`recognises a rounded rectangle (seed ${seed})`, () => {
      expect(recognizeShape(hand(roundedRect(300, 180, 45), 3, seed), 20)?.kind).toBe('roundedRectangle');
    });
  }

  it('recognises a double-headed arrow', () => {
    const raw = hand(polyline([
      { x: 40, y: 70 }, { x: 0, y: 100 }, { x: 40, y: 130 }, { x: 0, y: 100 }, { x: 300, y: 100 },
      { x: 260, y: 70 }, { x: 300, y: 100 }, { x: 260, y: 130 },
    ]), 2);
    expect(recognizeShape(raw, 20)?.kind).toBe('doubleArrow');
  });

  it('recognises a circular arc', () => {
    const arc = Array.from({ length: 80 }, (_, i) => {
      const t = Math.PI * 0.1 + (i / 79) * Math.PI * 1.1;
      return { x: 200 + Math.cos(t) * 120, y: 200 + Math.sin(t) * 120 };
    });
    const r = recognizeShape(hand(arc, 3), 20);
    expect(r?.kind).toBe('arc');
    expect(r?.closed).toBe(false);
  });

  it('recognises a check mark', () => {
    const raw = hand(polyline([{ x: 0, y: 60 }, { x: 40, y: 110 }, { x: 150, y: 0 }]), 2);
    expect(recognizeShape(raw, 20)?.kind).toBe('check');
  });

  it('does not confuse the shapes with one another', () => {
    const kinds = (pts: Point[]) => recognizeShape(pts, 20)?.kind ?? null;
    const circle = ellipse(200, 200, 100, 100);
    expect(kinds(hand(circle, 4))).toBe('circle');
    expect(kinds(hand(ellipse(200, 200, 150, 70), 4))).toBe('ellipse');
    expect(kinds(hand(polyline([{ x: 0, y: 0 }, { x: 260, y: 4 }, { x: 258, y: 150 }, { x: -3, y: 146 }, { x: 2, y: 3 }]), 4))).toBe('rectangle');
    expect(kinds(hand(polyline([{ x: 100, y: 0 }, { x: 200, y: 170 }, { x: 0, y: 172 }, { x: 98, y: 4 }]), 3))).toBe('triangle');
    expect(kinds(hand(polyline([{ x: 100, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 100 }, { x: 98, y: 3 }]), 3))).toBe('diamond');
    expect(kinds(hand(polyline(closeRing(regular(200, 200, 110, 4, 0))), 3))).not.toMatch(/star|heart|pentagon|hexagon|roundedRectangle/);
  });

  it('leaves a zigzag, an S curve and a spiral alone', () => {
    const zig = polyline([{ x: 0, y: 0 }, { x: 60, y: 90 }, { x: 120, y: 0 }, { x: 180, y: 90 }, { x: 240, y: 0 }, { x: 300, y: 90 }], 20);
    expect(recognizeShape(zig, 20)).toBeNull();
    const s = Array.from({ length: 100 }, (_, i) => ({ x: i * 3, y: Math.sin((i / 99) * Math.PI * 2) * 60 }));
    expect(recognizeShape(s, 20)).toBeNull();
    const spiral = Array.from({ length: 160 }, (_, i) => {
      const t = (i / 159) * Math.PI * 4;
      return { x: 200 + Math.cos(t) * (20 + t * 8), y: 200 + Math.sin(t) * (20 + t * 8) };
    });
    expect(recognizeShape(spiral, 20)).toBeNull();
  });
});
