import { describe, expect, it } from 'vitest';
import {
  gapFor,
  HACHURE_ANGLE,
  nibScale,
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

describe('how many times a drawn curve wanders', () => {
  /**
   * The on-curve points of one lap, and how far each sits off the true radius.
   *
   * The lap is a run of cubics, so every sixth number after the move is an
   * endpoint. Measuring the *radial* deviation is the only measurement that
   * says anything here: a tangential displacement slides a sample along the
   * ring and changes nothing about the shape.
   */
  const deviations = (radius: number, level: 'light' | 'medium' | 'heavy', seed = 9) => {
    const lap = roughEllipse(0, 0, radius, radius, { seed, level }).split('M ').filter(Boolean)[0];
    const n = lap.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const points: Array<[number, number]> = [[n[0], n[1]]];
    for (let i = 2; i + 5 < n.length; i += 6) points.push([n[i + 4], n[i + 5]]);
    return points.map(([x, y]) => Math.hypot(x, y) - radius);
  };

  /** One bow is a wander out and back, so two sign changes. */
  const bows = (dev: number[]) => {
    let crossings = 0;
    for (let i = 1; i < dev.length; i += 1) if (dev[i] > 0 !== dev[i - 1] > 0) crossings += 1;
    return crossings / 2;
  };

  /**
   * Averaged over several seeds, because this is a stochastic quantity.
   *
   * One lap's crossing count is a sample from a distribution, and a tight
   * bound on a single seed is a test that fails when somebody changes an
   * unrelated constant and the noise lands differently — which says nothing
   * about whether the drawing got better or worse. The property is the
   * *typical* number of bows, so that is what is measured.
   */
  const typicalBows = (radius: number) => {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => bows(deviations(radius, 'medium', seed)));
    return runs.reduce((a, b) => a + b, 0) / runs.length;
  };

  it('wanders a few times per lap, not a dozen', () => {
    /**
     * The bug, and it was a *frequency* problem rather than an amplitude one.
     * The wander wavelength was 58 world units, absolute — so the number of
     * undulations was the perimeter divided by 58, and a 240px circle got
     * thirteen of them. Thirteen deviations round a ring is not a drawn circle,
     * it is a noisy one: the eye reads the individual wobbles rather than the
     * stroke.
     *
     * The corner sketcher, which nobody complains about, gives a rectangle four
     * edges and one bow each. This is that, for a curve.
     */
    for (const radius of [40, 120, 260]) {
      expect(typicalBows(radius)).toBeGreaterThan(0.5);
      expect(typicalBows(radius)).toBeLessThan(5);
    }
  });

  it('keeps that count as the shape grows', () => {
    // A fixed wavelength ties the count to the size; a fraction of the run does
    // not, which is what makes a small circle and a large one the same *hand*.
    // Six times the radius, and the same handful of bows.
    expect(Math.abs(typicalBows(260) - typicalBows(40))).toBeLessThan(2);
  });

  it('still wanders further for a heavier hand', () => {
    /**
     * The amplitude had to be made independent of the frequency for this to
     * survive the fix above: an AR(1) process's spread is `b·σ/√(1−a²)`, and
     * the old `b = (1−a)·k` meant raising the retention silently flattened the
     * wobble to nothing.
     */
    const peak = (level: 'light' | 'medium' | 'heavy') =>
      Math.max(...deviations(120, level).map(Math.abs));
    expect(peak('heavy')).toBeGreaterThan(peak('light'));
  });

  it('strays enough to be seen and not enough to look wonky', () => {
    /**
     * The first pass at the frequency fix left the amplitude where it was, and
     * with three slow bows instead of thirteen fast ones that amplitude stopped
     * reading as "drawn" and started reading as "out of shape" — a hand is
     * confident and slightly off, not unsteady. Halved.
     */
    for (const level of ['light', 'medium', 'heavy'] as const) {
      const peak = Math.max(...deviations(120, level).map(Math.abs));
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThan(120 * 0.06);
    }
  });
});

describe('the pen the sketch is drawn with', () => {
  /** The on-curve points of each lap of a drawn ellipse, as angle and radius. */
  const lapsOf = (level: 'light' | 'medium' | 'heavy', width: number, seed = 9) =>
    roughEllipse(0, 0, 140, 140, { seed, level, width })
      .split('M ')
      .filter(Boolean)
      .map((lap) => {
        const n = lap.match(/-?\d+(\.\d+)?/g)!.map(Number);
        const points: Array<{ a: number; r: number }> = [
          { a: Math.atan2(n[1], n[0]), r: Math.hypot(n[0], n[1]) },
        ];
        for (let i = 2; i + 5 < n.length; i += 6) {
          const x = n[i + 4];
          const y = n[i + 5];
          points.push({ a: Math.atan2(y, x), r: Math.hypot(x, y) });
        }
        return points;
      });

  /** How far the drawing strays from the true circle, at its worst. */
  const stray = (level: 'light' | 'medium' | 'heavy', width: number, seed = 9) =>
    Math.max(...lapsOf(level, width, seed).flat().map((p) => Math.abs(p.r - 140)));

  /**
   * The signed gap between the two laps, sampled at the first lap's angles.
   *
   * Signed, because the sign changes are the measurement that matters here: a
   * pair of strokes that never changes sign is a pair of parallel curves.
   */
  const between = (width: number, seed: number) => {
    const pair = lapsOf('medium', width, seed);
    if (pair.length < 2) return [];
    return pair[0].map((p) => {
      const near = pair[1].reduce(
        (best, q) => {
          const d = Math.abs(Math.atan2(Math.sin(q.a - p.a), Math.cos(q.a - p.a)));
          return d < best.d ? { d, r: q.r } : best;
        },
        { d: Infinity, r: 0 }
      );
      return p.r - near.r;
    });
  };

  it('strays further when it is thicker, because the ratio is what is seen', () => {
    /**
     * Every displacement in the sketcher was in world units and blind to the
     * stroke about to be drawn with it, so the *visible* roughness was the
     * wander over the stroke width and only the numerator was ever tuned. At
     * two pixels a medium hand strays about one and a half units and it reads;
     * at eight the stroke covers its own wander and a sketched shape is a
     * clean shape with a faintly furry edge.
     */
    expect(stray('medium', 8)).toBeGreaterThan(stray('medium', 2));
    expect(nibScale(8)).toBeGreaterThan(nibScale(2));
  });

  it('stops growing, so a marker does not become a different shape', () => {
    // Past about three times the reference it is the drawing's silhouette
    // being damaged rather than its edge quality.
    expect(nibScale(64)).toBe(nibScale(24));
    expect(stray('medium', 64)).toBe(stray('medium', 24));
  });

  it('does not thin below the reference, so a hairline still reads as drawn', () => {
    // A strictly proportional rule would draw a half-pixel stroke perfectly
    // smooth, which is the feature silently switching itself off. So the
    // wander has a floor, and a hairline strays as far as the reference pen.
    expect(nibScale(0.5)).toBe(1);
    expect(nibScale(undefined)).toBe(1);
    expect(stray('medium', 0.5)).toBeGreaterThan(1);
    // The gap between the two laps does keep tracking downward, and should:
    // there is no minimum separation worth holding when the strokes drawn at
    // it are thinner than the gap already.
  });

  it('bellies the same however wide the pen, because that is the shape', () => {
    /**
     * An edge's belly is `bow x offset x length`, so scaling `offset` for a
     * wide pen scaled the belly with it -- and at eight pixels a rectangle's
     * bottom edge sagged into a visible arc. How far an edge departs from
     * straight is *fidelity*; how far the pen strays from where it meant to be
     * is character. Keeping the product invariant separates the two, which is
     * the same separation this file has already had to make for the ellipse's
     * sample count and for the drift's frequency.
     */
    const boxed = (width: number): ShapeNode =>
      ({
        id: 'n',
        type: 'shape',
        x: 0,
        y: 0,
        width: 400,
        height: 260,
        geometry: { kind: 'rect' },
        appearance: { sketch: 'medium', fillStyle: 'solid', stroke: { width } },
      }) as unknown as ShapeNode;

    /** How far the drawn contour gets from the box it is tracing. */
    const sag = (width: number) => {
      const n = roughShape(boxed(width), true).silhouette.match(/-?\d+(\.\d+)?/g)!.map(Number);
      let worst = 0;
      for (let i = 0; i + 1 < n.length; i += 2) {
        const dx = Math.min(Math.abs(n[i]), Math.abs(n[i] - 400));
        const dy = Math.min(Math.abs(n[i + 1]), Math.abs(n[i + 1] - 260));
        worst = Math.max(worst, Math.min(dx, dy));
      }
      return worst;
    };
    // Eight times the pen, and no further out of shape. Not identical -- the
    // ends do wander more -- but bounded by the same handful of units rather
    // than growing with the nib.
    expect(sag(16)).toBeLessThan(sag(2) + 8);
  });

  it('goes over the line rather than beside it', () => {
    /**
     * The first version of the second pass leaned a *fixed* distance off the
     * normal, and a fixed normal offset is the definition of a parallel curve:
     * the pair never met, and two strokes holding a constant gap for a whole
     * lap read as a ruled double line rather than as one line drawn twice. The
     * lean drifts now, so the laps part, cross, and part the other way.
     */
    for (const width of [1, 2, 4]) {
      const crossings = [1, 2, 3, 4, 5, 6].map((seed) => {
        const gaps = between(width, seed);
        let n = 0;
        for (let i = 1; i < gaps.length; i += 1) if (gaps[i] > 0 !== gaps[i - 1] > 0) n += 1;
        return n;
      });
      expect(crossings.reduce((a, b) => a + b, 0) / crossings.length).toBeGreaterThan(1);
    }
  });

  it('separates by about the width of the stroke, at any width', () => {
    /**
     * Which is the whole point of tying it to the pen: two strokes half a nib
     * apart are one stroke. Left to the drift alone the gap was about one unit
     * whatever the stroke, so at anything above a hairline the second pass hid
     * underneath the first and the most recognisable thing about a hand-drawn
     * shape was invisible.
     */
    for (const width of [2, 4, 8]) {
      const gaps = [1, 2, 3, 4, 5, 6].map((seed) => {
        const g = between(width, seed).map(Math.abs);
        return g.reduce((a, b) => a + b, 0) / g.length;
      });
      const typical = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      expect(typical).toBeGreaterThan(width * 0.4);
      expect(typical).toBeLessThan(width * 1.2);
    }
  });

  it('is still stable for a seed, which is what makes it exportable', () => {
    expect(roughEllipse(0, 0, 90, 60, { seed: 11, level: 'medium', width: 6 })).toBe(
      roughEllipse(0, 0, 90, 60, { seed: 11, level: 'medium', width: 6 })
    );
  });

  it('reaches the exporter, or the file is not the canvas', () => {
    /**
     * A sketch is *seeded*, so a renderer and an exporter that disagree about
     * the pen are not two styles of one drawing, they are two drawings.
     * `roughShape` is the shared path, and it reads the width off the node
     * rather than being told -- the same reasoning as the shading density.
     */
    const round = (width: number): ShapeNode =>
      ({
        id: 'n',
        type: 'shape',
        x: 0,
        y: 0,
        width: 200,
        height: 140,
        geometry: { kind: 'ellipse' },
        appearance: { sketch: 'medium', fillStyle: 'solid', stroke: { width } },
      }) as unknown as ShapeNode;

    expect(roughShape(round(8), true).outline).not.toBe(roughShape(round(2), true).outline);
    expect(roughShape(round(8), true).outline).toBe(roughShape(round(8), true).outline);
  });
});
