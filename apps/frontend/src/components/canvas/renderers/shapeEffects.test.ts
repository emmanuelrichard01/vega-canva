import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type React from 'react';

/**
 * The canvas half of the shadows: what `paintSilhouette`, `InnerShadow` and
 * `shapePath2D` ask a 2D context to do. Run against a recording context, so
 * the geometry (joins, widths, compositing, device-pixel scaling) is asserted
 * without a real canvas.
 */

type Call = { op: string; args: unknown[]; state: Record<string, unknown> };

/** A 2D context that records every call with the state it was made in. */
function recorder(transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const stack: Record<string, unknown>[] = [];
  let m = { ...transform };
  const ctx = new Proxy(
    {},
    {
      get(_t, key: string) {
        if (key === 'calls') return calls;
        if (key === 'canvas') return { width: 1000, height: 800 };
        if (key === 'getTransform') return () => ({ ...m });
        if (key === 'setTransform')
          return (a: number, b: number, c: number, d: number, e: number, f: number) => {
            m = { a, b, c, d, e, f };
          };
        if (key === 'save') return () => stack.push({ ...state });
        if (key === 'restore') return () => Object.assign(state, stack.pop());
        if (key in state) return state[key];
        return (...args: unknown[]) => calls.push({ op: key, args, state: { ...state, transform: { ...m } } });
      },
      set(_t, key: string, value) {
        state[key] = value;
        return true;
      },
    }
  ) as unknown as CanvasRenderingContext2D & { calls: Call[] };
  return ctx;
}

/** Path2D stand-in that remembers how it was built. */
class FakePath {
  ops: Array<[string, unknown[]]> = [];
  constructor(_d?: string) {}
  roundRect(...a: unknown[]) { this.ops.push(['roundRect', a]); }
  rect(...a: unknown[]) { this.ops.push(['rect', a]); }
  ellipse(...a: unknown[]) { this.ops.push(['ellipse', a]); }
  moveTo(...a: unknown[]) { this.ops.push(['moveTo', a]); }
  lineTo(...a: unknown[]) { this.ops.push(['lineTo', a]); }
  closePath() { this.ops.push(['closePath', []]); }
  addPath(...a: unknown[]) { this.ops.push(['addPath', a]); }
}

const pads: Array<CanvasRenderingContext2D & { calls: Call[] }> = [];
const g = globalThis as Record<string, unknown>;
const saved = { document: g.document, Path2D: g.Path2D };

beforeAll(() => {
  g.Path2D = FakePath;
  g.document = {
    createElement: () => {
      const ctx = recorder();
      pads.push(ctx);
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
});
afterAll(() => {
  g.document = saved.document;
  g.Path2D = saved.Path2D;
});

const { paintSilhouette, InnerShadow } = await import('./ShapeEffects');
const { shapePath2D } = await import('./shapePath2D');

describe('paintSilhouette: spread', () => {
  const box = { x: 0, y: 0, width: 100, height: 60 };

  it('grows a box mitred, so square corners stay square and round ones grow concentric', () => {
    const ctx = recorder();
    const path = new FakePath() as unknown as Path2D;
    paintSilhouette(ctx, { fills: [{ path, join: 'miter' }] }, box, 6);
    const grow = ctx.calls.find((c) => c.op === 'stroke')!;
    expect(grow.state).toMatchObject({ lineJoin: 'miter', lineWidth: 12, globalCompositeOperation: 'source-over' });
  });

  it('grows any other outline round, its true offset', () => {
    const ctx = recorder();
    paintSilhouette(ctx, { fills: [{ path: new FakePath() as unknown as Path2D }] }, box, 3);
    expect(ctx.calls.find((c) => c.op === 'stroke')!.state.lineJoin).toBe('round');
  });

  it('erodes for a negative spread, and narrows a line by twice it', () => {
    const ctx = recorder();
    const path = new FakePath() as unknown as Path2D;
    paintSilhouette(ctx, { fills: [{ path }], strokes: [{ path, width: 10 }] }, box, -2);
    const [erode, line] = ctx.calls.filter((c) => c.op === 'stroke');
    expect(erode.state).toMatchObject({ globalCompositeOperation: 'destination-out', lineWidth: 4 });
    expect(line.state).toMatchObject({ globalCompositeOperation: 'source-over', lineWidth: 6 });
  });

  it('drops a line that a negative spread erodes away entirely', () => {
    const ctx = recorder();
    paintSilhouette(ctx, { strokes: [{ path: new FakePath() as unknown as Path2D, width: 2 }] }, box, -2);
    expect(ctx.calls.some((c) => c.op === 'stroke')).toBe(false);
  });
});

describe('InnerShadow', () => {
  const sceneOf = (props: Record<string, unknown>) => {
    const el = (InnerShadow as React.FC<any>)(props) as React.ReactElement<{ sceneFunc: (c: unknown) => void }>;
    return el.props.sceneFunc;
  };
  const shadow = { color: '#000000', blur: 8, offsetX: 0, offsetY: 2, spread: 0, opacity: 0.4 };

  /** The shared scratch pads, `ink` then `cast`, with their records cleared. */
  const fresh = () => {
    pads.forEach((p) => (p.calls.length = 0));
    return () => ({ ink: pads[0], cast: pads[1] });
  };

  it('scales blur and offset with the zoom and pixel ratio, as the drop shadow does', () => {
    const scratch = fresh();
    const board = recorder({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 100 });
    sceneOf({ path: new FakePath(), width: 100, height: 60, shadow })({ _context: board });
    const { cast } = scratch();
    const drawn = cast.calls.find((c) => c.op === 'drawImage')!;
    expect(drawn.state.shadowBlur).toBe(16);
    expect(drawn.state.shadowOffsetY).toBe(4);
    // Laid on the board at the shadow's opacity, in device pixels.
    const laid = board.calls.find((c) => c.op === 'drawImage')!;
    expect(laid.state.globalAlpha).toBeCloseTo(0.4);
    expect(laid.args.slice(5)).toEqual([100, 100, 200, 120]);
  });

  it('is cut to the shape and kept off the stroke it sits under', () => {
    const scratch = fresh();
    sceneOf({ path: new FakePath(), width: 100, height: 60, shadow, inset: 2 })({ _context: recorder() });
    const { cast } = scratch();
    const cut = cast.calls.filter((c) => c.state.globalCompositeOperation !== 'source-over');
    expect(cut.map((c) => [c.op, c.state.globalCompositeOperation])).toEqual([
      ['fill', 'destination-in'],
      ['stroke', 'destination-out'],
    ]);
    expect(cut[1].state.lineWidth).toBe(4);
  });

  it('grows the casting region inward by inset plus spread, or pulls it back', () => {
    for (const [spread, op, width] of [
      [3, 'source-over', 10],
      [-5, 'destination-out', 6],
    ] as const) {
      const scratch = fresh();
      sceneOf({ path: new FakePath(), width: 100, height: 60, shadow: { ...shadow, spread }, inset: 2 })({ _context: recorder() });
      const { ink } = scratch();
      const edge = ink.calls.find((c) => c.op === 'stroke')!;
      expect(edge.state).toMatchObject({ globalCompositeOperation: op, lineWidth: width });
    }
  });
});

describe('shapePath2D', () => {
  it('rounds each corner by its own radius, not the largest of the four', () => {
    const path = shapePath2D({
      geometry: { kind: 'rect' },
      width: 200,
      height: 100,
      appearance: { cornerRadius: [0, 24, 0, 8] },
    } as never) as unknown as FakePath;
    expect(path.ops[0]).toEqual(['roundRect', [0, 0, 200, 100, [0, 24, 0, 8]]]);
  });
});
