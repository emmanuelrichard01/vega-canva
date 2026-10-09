import { describe, expect, it } from 'vitest';
import { SceneContext } from 'konva/lib/Context';
import { MIN_DEVICE_STROKE, flooredLineWidth } from './hairline';

describe('flooredLineWidth', () => {
  it('leaves every weight above half a device pixel exactly as stored', () => {
    // 100% zoom on a retina screen: a quarter-unit hairline is half a device pixel.
    expect(flooredLineWidth(0.25, 2)).toBe(0.25);
    expect(flooredLineWidth(0.5, 1)).toBe(0.5);
    expect(flooredLineWidth(0.75, 1)).toBe(0.75);
    expect(flooredLineWidth(2, 0.3)).toBe(2);
  });

  it('holds a hairline at half a device pixel when zoomed out, rather than letting it vanish', () => {
    // 10% zoom on a 1x screen: 0.25 would be 0.025 of a pixel.
    expect(flooredLineWidth(0.25, 0.1) * 0.1).toBeCloseTo(MIN_DEVICE_STROKE);
    expect(flooredLineWidth(1, 0.1) * 0.1).toBeCloseTo(MIN_DEVICE_STROKE);
  });

  it('keeps weights in order: a thicker stroke is never drawn thinner', () => {
    for (const scale of [0.05, 0.2, 0.5, 1, 2]) {
      const drawn = [0.25, 0.5, 0.75, 1, 2].map((w) => flooredLineWidth(w, scale));
      for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeGreaterThanOrEqual(drawn[i - 1]);
    }
  });

  it('passes through what it cannot reason about', () => {
    expect(flooredLineWidth(0, 0.1)).toBe(0);
    expect(flooredLineWidth(1, 0)).toBe(1);
    expect(flooredLineWidth(1, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

/**
 * The floor is a wrap of Konva's own scene stroke. These drive the real
 * `SceneContext.prototype._stroke` with a recording context, so a Konva upgrade
 * that renames or reshapes it fails here rather than silently dropping the
 * floor.
 */
describe('installed on Konva', () => {
  const run = (attrs: Record<string, unknown>, stageScale: number, pixelRatio: number) => {
    const widths: number[] = [];
    const ctx = {
      canvas: { getPixelRatio: () => pixelRatio },
      setAttr: (name: string, value: unknown) => {
        if (name === 'lineWidth') widths.push(value as number);
      },
      _applyLineCap: () => undefined,
      setLineDash: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      getCanvas: () => ({ getPixelRatio: () => pixelRatio }),
    };
    const shape = {
      attrs,
      dash: () => undefined,
      getStrokeScaleEnabled: () => attrs.strokeScaleEnabled !== false,
      hasStroke: () => true,
      strokeWidth: () => attrs.strokeWidth,
      getShadowForStrokeEnabled: () => true,
      getStrokeLinearGradientColorStops: () => undefined,
      stroke: () => '#000',
      getStage: () => ({ scaleX: () => stageScale }),
      _strokeFunc: () => undefined,
    };
    (SceneContext.prototype as unknown as { _stroke: (this: unknown, s: unknown) => void })._stroke.call(ctx, shape);
    return { widths, attrs };
  };

  it('draws a zoomed-out hairline at the floor and gives the node its weight back', () => {
    const { widths, attrs } = run({ strokeWidth: 0.25 }, 0.1, 1);
    expect(widths[0] * 0.1).toBeCloseTo(MIN_DEVICE_STROKE);
    expect(attrs.strokeWidth).toBe(0.25);
  });

  it('draws an ordinary stroke untouched', () => {
    expect(run({ strokeWidth: 0.75 }, 1, 2).widths[0]).toBe(0.75);
  });

  it('floors for the scale the pixels are drawn at, so an export is floored for its own resolution', () => {
    // An export at 2x of a board viewed at 10%: the stage is at 2 while drawing.
    expect(run({ strokeWidth: 0.25 }, 2, 1).widths[0]).toBe(0.25);
  });

  it('leaves screen-space chrome alone', () => {
    expect(run({ strokeWidth: 0.25, strokeScaleEnabled: false }, 0.1, 1).widths[0]).toBe(0.25);
  });
});
