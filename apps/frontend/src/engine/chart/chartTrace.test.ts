import { describe, expect, it } from 'vitest';
import { traceMathPlot, type MathPlotMeta } from './chartTrace';

describe('traceMathPlot', () => {
  const plotBox = { x: 50, y: 50, width: 300, height: 200 };
  const meta: MathPlotMeta = {
    domain: { xMin: -5, xMax: 5, yMin: -10, yMax: 10 },
    curves: [
      {
        source: 'x^2',
        color: '#2563EB',
        evaluate: (x: number) => x * x,
      },
    ],
    roots: [0],
    extrema: [{ x: 0, y: 0, kind: 'min' }],
  };

  it('evaluates coordinates and numerical derivative accurately', () => {
    // Pointer at x = 200 (center of plotBox => x = 0 in domain)
    const trace = traceMathPlot(plotBox, meta, { x: 200, y: 150 });
    expect(trace).not.toBeNull();
    expect(trace?.x).toBeCloseTo(0, 2);
    expect(trace?.y).toBeCloseTo(0, 2);
    expect(trace?.slope).toBeCloseTo(0, 2);
    expect(trace?.tangentEquation).toBe('y = 0');
  });

  it('evaluates non-zero points on curve: x = 2 => y = 4, slope = 4', () => {
    // x = 2 in [-5, 5] is at fraction (2 - (-5)) / 10 = 7/10 = 0.7
    // screen x = 50 + 0.7 * 300 = 260
    const trace = traceMathPlot(plotBox, meta, { x: 260, y: 150 });
    expect(trace).not.toBeNull();
    expect(trace?.x).toBeCloseTo(2, 2);
    expect(trace?.y).toBeCloseTo(4, 2);
    expect(trace?.slope).toBeCloseTo(4, 2);
    expect(trace?.tangentEquation).toBe('y = 4x - 4');
  });

  it('magnetically snaps to roots and extrema within threshold', () => {
    // Close to (0, 0), which is at screen x = 200, y = 150
    const trace = traceMathPlot(plotBox, meta, { x: 205, y: 152 }, 20);
    expect(trace).not.toBeNull();
    expect(trace?.snappedFeature).toBeDefined();
    expect(trace?.snappedFeature?.x).toBe(0);
    expect(trace?.snappedFeature?.kind).toBe('extremum');
  });

  it('returns null when pointer is outside plot box by a margin', () => {
    const trace = traceMathPlot(plotBox, meta, { x: 10, y: 10 });
    expect(trace).toBeNull();
  });

  it('selects nearest curve in multi-curve plots', () => {
    const multiMeta: MathPlotMeta = {
      domain: { xMin: -5, xMax: 5, yMin: -10, yMax: 10 },
      curves: [
        {
          source: 'x^2',
          color: '#2563EB',
          evaluate: (x: number) => x * x,
        },
        {
          source: '-x^2 + 8',
          color: '#DC2626',
          evaluate: (x: number) => -x * x + 8,
        },
      ],
      roots: [],
      extrema: [],
    };

    // At x = 0 (screen x = 200):
    // Curve 0: y = 0 (screen y = 150)
    // Curve 1: y = 8 (screen y = 70)
    // If pointer is at screen (200, 80), it should lock onto Curve 1
    const traceTop = traceMathPlot(plotBox, multiMeta, { x: 200, y: 80 });
    expect(traceTop).not.toBeNull();
    expect(traceTop?.curveIndex).toBe(1);
    expect(traceTop?.curveName).toBe('-x^2 + 8');
    expect(traceTop?.y).toBeCloseTo(8, 2);

    // If pointer is at screen (200, 140), it should lock onto Curve 0
    const traceBottom = traceMathPlot(plotBox, multiMeta, { x: 200, y: 140 });
    expect(traceBottom).not.toBeNull();
    expect(traceBottom?.curveIndex).toBe(0);
    expect(traceBottom?.curveName).toBe('x^2');
    expect(traceBottom?.y).toBeCloseTo(0, 2);
  });

  it('snaps to curve intersections', () => {
    // Intersections of x^2 and -x^2 + 8 are at x = 2, y = 4 and x = -2, y = 4
    // At x = 2 (screen x = 260), y = 4 (screen y = 110)
    const multiMeta: MathPlotMeta = {
      domain: { xMin: -5, xMax: 5, yMin: -10, yMax: 10 },
      curves: [
        { source: 'x^2', color: '#2563EB', evaluate: (x) => x * x },
        { source: '-x^2 + 8', color: '#DC2626', evaluate: (x) => -x * x + 8 },
      ],
      roots: [],
      extrema: [],
      intersections: [{ x: 2, y: 4, curveIndices: [0, 1] }],
    };

    // Pointer close to (260, 110)
    const trace = traceMathPlot(plotBox, multiMeta, { x: 263, y: 112 }, 15);
    expect(trace).not.toBeNull();
    expect(trace?.snappedFeature).toBeDefined();
    expect(trace?.snappedFeature?.kind).toBe('intersection');
    expect(trace?.snappedFeature?.x).toBeCloseTo(2, 2);
    expect(trace?.snappedFeature?.y).toBeCloseTo(4, 2);
  });

  it('respects custom variable names in labels and equations', () => {
    const timeMeta: MathPlotMeta = {
      variable: 't',
      domain: { xMin: 0, xMax: 10, yMin: 0, yMax: 100 },
      curves: [
        {
          source: '0.5 * 9.8 * t^2',
          color: '#10B981',
          evaluate: (t: number) => 0.5 * 9.8 * t * t,
        },
      ],
      roots: [{ x: 0, y: 0, curveIndex: 0 }],
      extrema: [],
      yIntercepts: [{ x: 0, y: 0, curveIndex: 0 }],
    };

    // Hover near t = 2 (screen x = 50 + 0.2 * 300 = 110)
    const trace = traceMathPlot(plotBox, timeMeta, { x: 110, y: 150 });
    expect(trace).not.toBeNull();
    expect(trace?.tangentEquation).toContain('t');
    expect(trace?.tangentEquation).not.toContain('x');
  });

  it('clamps tangent line segments within the plotBox bounds', () => {
    const trace = traceMathPlot(plotBox, meta, { x: 260, y: 150 });
    expect(trace).not.toBeNull();
    const seg = trace!.tangentSegment;
    expect(seg[0].x).toBeGreaterThanOrEqual(plotBox.x);
    expect(seg[0].x).toBeLessThanOrEqual(plotBox.x + plotBox.width);
    expect(seg[0].y).toBeGreaterThanOrEqual(plotBox.y);
    expect(seg[0].y).toBeLessThanOrEqual(plotBox.y + plotBox.height);
    expect(seg[1].x).toBeGreaterThanOrEqual(plotBox.x);
    expect(seg[1].x).toBeLessThanOrEqual(plotBox.x + plotBox.width);
    expect(seg[1].y).toBeGreaterThanOrEqual(plotBox.y);
    expect(seg[1].y).toBeLessThanOrEqual(plotBox.y + plotBox.height);
  });

  it('traces parametric curves with vector derivatives, tangents, and snapping', () => {
    // Circle x(t) = cos(t), y(t) = sin(t), t in [0, 2pi]
    const parametricMeta: MathPlotMeta = {
      kind: 'parametric',
      domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
      curves: [],
      roots: [],
      extrema: [],
      parametric: {
        sourceX: 'cos(t)',
        sourceY: 'sin(t)',
        color: '#8B5CF6',
        fx: (t: number) => Math.cos(t),
        fy: (t: number) => Math.sin(t),
        tMin: 0,
        tMax: Math.PI * 2,
      },
      paramFeatures: [
        {
          kind: 'horizontalTangent',
          parameterValue: Math.PI / 2,
          x: 0,
          y: 1,
          label: 'Horizontal Tangent (dy/dt = 0 at t = 1.571)',
          badgeText: 'dy/dt = 0',
        },
        {
          kind: 'verticalTangent',
          parameterValue: 0,
          x: 1,
          y: 0,
          label: 'Vertical Tangent (dx/dt = 0 at t = 0)',
          badgeText: 'dx/dt = 0',
        },
      ],
    };

    // Screen top of circle: x = 0 (screen 200), y = 1 (screen 100)
    const traceTop = traceMathPlot(plotBox, parametricMeta, { x: 202, y: 102 }, 15);
    expect(traceTop).not.toBeNull();
    expect(traceTop?.parameterValue).toBeCloseTo(Math.PI / 2, 2);
    expect(traceTop?.x).toBeCloseTo(0, 2);
    expect(traceTop?.y).toBeCloseTo(1, 2);
    expect(traceTop?.parametricVelocity?.vx).toBeCloseTo(-1, 2);
    expect(traceTop?.parametricVelocity?.vy).toBeCloseTo(0, 2);
    expect(traceTop?.tangentEquation).toContain('y = 1');
    expect(traceTop?.snappedFeature?.kind).toBe('tangent');
    expect(traceTop?.snappedFeature?.badgeText).toBe('dy/dt = 0');
    expect(traceTop?.fieldVector).toBeDefined();

    // Screen right of circle: x = 1 (screen 275), y = 0 (screen 150)
    const traceRight = traceMathPlot(plotBox, parametricMeta, { x: 274, y: 151 }, 15);
    expect(traceRight).not.toBeNull();
    expect(traceRight?.parameterValue).toBeCloseTo(0, 1);
    expect(traceRight?.x).toBeCloseTo(1, 2);
    expect(traceRight?.y).toBeCloseTo(0, 2);
    expect(traceRight?.parametricVelocity?.vx).toBeCloseTo(0, 2);
    expect(traceRight?.parametricVelocity?.vy).toBeCloseTo(1, 2);
    expect(traceRight?.tangentEquation).toContain('x = 1');
    expect(traceRight?.snappedFeature?.badgeText).toBe('dx/dt = 0');
  });

  it('traces polar plots with radius, angle, radial rays, and pole/apsis snapping', () => {
    // Cardioid: r(a) = 1 + cos(a), a in [0, 2pi]
    const polarMeta: MathPlotMeta = {
      kind: 'polarPlot',
      domain: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
      curves: [],
      roots: [],
      extrema: [],
      polar: [
        {
          source: '1 + cos(theta)',
          color: '#EC4899',
          fr: (a: number) => 1 + Math.cos(a),
          aMin: 0,
          aMax: Math.PI * 2,
        },
      ],
      paramFeatures: [
        {
          kind: 'apsis',
          parameterValue: 0,
          x: 2,
          y: 0,
          label: 'Max Radius (r = 2 at theta = 0°)',
          badgeText: 'Max Radius (2)',
        },
        {
          kind: 'pole',
          parameterValue: Math.PI,
          x: 0,
          y: 0,
          label: 'Pole: r = 0 at theta = 180°',
          badgeText: 'r = 0 (Pole)',
        },
      ],
    };

    // Apsis at theta = 0: r = 2, x = 2 (screen 300), y = 0 (screen 150)
    const traceApsis = traceMathPlot(plotBox, polarMeta, { x: 298, y: 151 }, 15);
    expect(traceApsis).not.toBeNull();
    expect(traceApsis?.polarRadius).toBeCloseTo(2, 2);
    expect(traceApsis?.polarAngleDeg).toBeCloseTo(0, 1);
    expect(traceApsis?.x).toBeCloseTo(2, 2);
    expect(traceApsis?.y).toBeCloseTo(0, 2);
    expect(traceApsis?.snappedFeature?.kind).toBe('extremum');
    expect(traceApsis?.snappedFeature?.badgeText).toBe('Max Radius (2)');

    // Pole at theta = pi: r = 0, x = 0 (screen 200), y = 0 (screen 150)
    const tracePole = traceMathPlot(plotBox, polarMeta, { x: 202, y: 150 }, 15);
    expect(tracePole).not.toBeNull();
    expect(tracePole?.polarRadius).toBeCloseTo(0, 2);
    expect(tracePole?.snappedFeature?.kind).toBe('pole');
    expect(tracePole?.snappedFeature?.badgeText).toBe('r = 0 (Pole)');
    expect(tracePole?.crosshair.xRay[0]).toBeDefined(); // Radial ray anchored at origin
  });
});

