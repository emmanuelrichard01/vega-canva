import { describe, expect, it } from 'vitest';
import {
  gapFor,
  HACHURE_ANGLE,
  roughEllipse,
  SHADING_DENSITIES,
  shapeFill,
  type FillStyle,
} from './rough';
import { roughShape } from './roughShape';
import type { ShapeNode } from './schema';

/** A square ring, which is what every specimen and every rect fill runs over. */
const ring = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/** How many strokes a shading pass laid down. */
const strokes = (d: string) => (d.match(/M/g) ?? []).length;

const shaded = (style: FillStyle, over: Parameters<typeof shapeFill>[1] | object = {}) =>
  shapeFill(ring, { seed: 7, style, level: 'light', ...over } as Parameters<typeof shapeFill>[1]);

describe('shading density', () => {
  it('is the tone control pen shading exists to have', () => {
    /**
     * The gap was one constant, so every hachured shape on a board carried the
     * same weight of grey — and telling a light surface from a dark one by how
     * densely it is hatched is the whole point of the technique.
     */
    const light = strokes(shaded('hachure', { density: 'light' }));
    const medium = strokes(shaded('hachure', { density: 'medium' }));
    const dense = strokes(shaded('hachure', { density: 'dense' }));

    expect(light).toBeLessThan(medium);
    expect(medium).toBeLessThan(dense);
    expect(light).toBeGreaterThan(0);
  });

  it('treats absent as medium, so nothing already drawn moves', () => {
    expect(shaded('hachure')).toBe(shaded('hachure', { density: 'medium' }));
    expect(gapFor(undefined)).toBe(gapFor('medium'));
  });

  it('stays inside the range where strokes still read as strokes', () => {
    /**
     * Below about four units the strokes merge into a flat tone and the drawn
     * quality is lost; above about sixteen they read as stripes rather than as
     * shading. Three steps exist because the useful range is that narrow.
     */
    for (const density of SHADING_DENSITIES) {
      expect(gapFor(density)).toBeGreaterThanOrEqual(4);
      expect(gapFor(density)).toBeLessThanOrEqual(16);
    }
  });

  it('applies to every shading style, not only hachure', () => {
    for (const style of ['hachure', 'crosshatch', 'zigzag', 'dots'] as FillStyle[]) {
      expect(shaded(style, { density: 'dense' })).not.toBe(shaded(style, { density: 'light' }));
    }
  });

  it('does nothing to a solid fill, which has no strokes to space', () => {
    expect(shaded('solid', { density: 'dense' })).toBe('');
  });
});

describe('shading angle', () => {
  it('turns the strokes', () => {
    /**
     * Every shape used to shade at exactly one angle, so two hatched shapes
     * laid over each other ran in lockstep and the pair read as one continuous
     * field rather than as two objects.
     */
    expect(shaded('hachure', { angle: 0 })).not.toBe(shaded('hachure', { angle: 45 }));
  });

  it('treats absent as the shared default', () => {
    expect(shaded('hachure')).toBe(shaded('hachure', { angle: HACHURE_ANGLE }));
  });

  it('carries the cross-hatch\'s second pass with it', () => {
    // The second set is a right angle off the first, so turning the first has
    // to turn both -- otherwise crossing at 90° becomes crossing at whatever.
    const turned = shaded('crosshatch', { angle: 10 });
    const plain = shaded('crosshatch', { angle: HACHURE_ANGLE });
    expect(turned).not.toBe(plain);
    expect(strokes(turned)).toBeGreaterThan(strokes(shaded('hachure', { angle: 10 })));
  });

  it('ignores a value that is not a number', () => {
    // It arrives from a stepper and from the document, and a shape that fails
    // to shade is worse than one that shades at the default angle.
    expect(shaded('hachure', { angle: NaN })).toBe(shaded('hachure'));
    expect(shaded('hachure', { angle: undefined })).toBe(shaded('hachure'));
  });
});

describe('a shape carries its own shading', () => {
  const shape = (over: Record<string, unknown>): ShapeNode =>
    ({
      id: 'n',
      type: 'shape',
      x: 0,
      y: 0,
      width: 200,
      height: 140,
      geometry: { kind: 'rect' },
      appearance: {
        sketch: 'medium',
        fillStyle: 'hachure',
        fill: [{ type: 'solid', color: '#fff' }],
        ...over,
      },
    }) as unknown as ShapeNode;

  it('reads density and angle off the node rather than being told', () => {
    /**
     * Which is what makes the exporter agree with the canvas for free: both go
     * through `roughShape`, and every caller that had to pass these along
     * would be a caller that could forget one — and a sketch is *seeded*, so a
     * disagreement is not a style drift, it is two different drawings of one
     * object.
     */
    const plain = roughShape(shape({}), true);
    const dense = roughShape(shape({ shadingDensity: 'dense' }), true);
    const turned = roughShape(shape({ shadingAngle: 12 }), true);

    expect(dense.fill).not.toBe(plain.fill);
    expect(turned.fill).not.toBe(plain.fill);
    // The outline is not shading and must not move when the shading does.
    expect(dense.outline).toBe(plain.outline);
    expect(turned.outline).toBe(plain.outline);
  });

  it('stays stable for the same node, which is what makes it exportable', () => {
    const a = roughShape(shape({ shadingDensity: 'dense', shadingAngle: 20 }), true);
    const b = roughShape(shape({ shadingDensity: 'dense', shadingAngle: 20 }), true);
    expect(a.fill).toBe(b.fill);
  });
});

describe('a curve drawn by hand', () => {
  /** How many cubic segments a drawing is made of. */
  const segments = (d: string) => (d.match(/C /g) ?? []).length;
  /** How many times the pen was put down. */
  const laps = (d: string) => (d.match(/M /g) ?? []).length;

  it('takes its density from the shape, not from the roughness', () => {
    /**
     * The bug: an ellipse had a construction of its own that used `prof.steps`
     * as its sample count -- twelve at Light and **seven** at Heavy. So a
     * heavier hand did not draw a rougher circle, it drew a lower-resolution
     * one, and Heavy came out as a blobby seven-point spline. Density decides
     * how faithfully the lap follows the curve; amplitude decides how far the
     * pen wanders. Corners always kept those separate; curves did not.
     */
    const small = roughEllipse(0, 0, 40, 40, { seed: 5, level: 'medium' });
    const large = roughEllipse(0, 0, 160, 160, { seed: 5, level: 'medium' });
    expect(segments(large)).toBeGreaterThan(segments(small));

    const light = roughEllipse(0, 0, 120, 120, { seed: 5, level: 'light' });
    const heavy = roughEllipse(0, 0, 120, 120, { seed: 5, level: 'heavy' });
    // Per lap, the two are sampled alike -- heavy simply goes round again.
    expect(segments(heavy) / laps(heavy)).toBeCloseTo(segments(light) / laps(light), 0);
  });

  it('is drawn finely enough to read as a curve at all', () => {
    // Seven control points is a heptagon with opinions. Twenty is a circle.
    expect(segments(roughEllipse(0, 0, 40, 40, { seed: 5, level: 'heavy' })) / 2)
      .toBeGreaterThan(15);
  });

  it('goes round once for a light hand and twice for the others', () => {
    expect(laps(roughEllipse(0, 0, 80, 80, { seed: 5, level: 'light' }))).toBe(1);
    expect(laps(roughEllipse(0, 0, 80, 80, { seed: 5, level: 'medium' }))).toBe(2);
    expect(laps(roughEllipse(0, 0, 80, 80, { seed: 5, level: 'heavy' }))).toBe(2);
  });

  it('is stable for a seed, which is what makes it exportable', () => {
    expect(roughEllipse(0, 0, 90, 60, { seed: 11, level: 'medium' }))
      .toBe(roughEllipse(0, 0, 90, 60, { seed: 11, level: 'medium' }));
  });

  it('differs between two shapes, so a board is not one repeated circle', () => {
    expect(roughEllipse(0, 0, 90, 60, { seed: 11 })).not.toBe(roughEllipse(0, 0, 90, 60, { seed: 12 }));
  });
});
