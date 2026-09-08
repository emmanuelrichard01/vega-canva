import type { Point, Rect } from './chartLayout';

export interface MathTraceFeature {
  kind: 'root' | 'extremum' | 'intersection' | 'intercept' | 'pole' | 'tangent' | 'cusp';
  x: number;
  y: number;
  label: string;
  badgeText?: string;
  curveIndex?: number;
  secondaryCurveIndex?: number;
}

export interface MathTraceFieldVector {
  u: number;
  v: number;
  magnitude: number;
  angleDeg: number;
  segment: [Point, Point];
}

export interface ParametricCurveMeta {
  sourceX: string;
  sourceY: string;
  color: string;
  fx: (t: number) => number;
  fy: (t: number) => number;
  tMin: number;
  tMax: number;
}

export interface PolarCurveMeta {
  source: string;
  color: string;
  fr: (a: number) => number;
  aMin: number;
  aMax: number;
}

export interface ParametricPlotFeature {
  kind: 'pole' | 'cusp' | 'horizontalTangent' | 'verticalTangent' | 'axisCrossing' | 'apsis';
  parameterValue: number;
  x: number;
  y: number;
  label: string;
  badgeText: string;
}

export interface MathTraceInfo {
  x: number;
  y: number;
  screenPoint: Point;
  curveIndex: number;
  curveColor: string;
  curveName: string;
  /**
   * The slope and the tangent, where the thing under the pointer *has* one.
   *
   * A curve does. A surface does not: a heatmap or a contour map has a
   * gradient — a direction and a magnitude — and no single tangent line, and
   * an implicit plot's tangent belongs to its level set rather than to the
   * point. Required fields forced those three kinds to invent both or return
   * no trace at all, and they returned none: they computed the value, the
   * gradient and the position and then dropped the geometry, so the HUD drew
   * nothing on any of them.
   */
  slope?: number;
  tangentEquation?: string;
  tangentSegment?: [Point, Point];
  crosshair: {
    xRay: [Point, Point];
    yRay: [Point, Point];
  };
  snappedFeature?: MathTraceFeature;
  fieldVector?: MathTraceFieldVector;
  parameterValue?: number;
  polarRadius?: number;
  polarAngleRad?: number;
  polarAngleDeg?: number;
  parametricVelocity?: { vx: number; vy: number; speed: number };
}

export interface MathCurveMeta {
  source: string;
  color: string;
  evaluate: (x: number, y?: number) => number;
}

export interface MathPlotFeaturePoint {
  x: number;
  y: number;
  curveIndex?: number;
  kind?: 'min' | 'max' | 'root' | 'intercept';
}

export interface MathPlotIntersection {
  x: number;
  y: number;
  curveIndices?: [number, number];
}

export interface MathPlotMeta {
  isTwoVariable?: boolean;
  kind?: string;
  variable?: string;
  variables?: string[];
  domain: { xMin: number; xMax: number; yMin: number; yMax: number };
  curves: MathCurveMeta[];
  parametric?: ParametricCurveMeta;
  polar?: PolarCurveMeta[];
  paramFeatures?: ParametricPlotFeature[];
  roots: Array<number | MathPlotFeaturePoint>;
  extrema: Array<{ x: number; y: number; kind: 'min' | 'max'; curveIndex?: number }>;
  intersections?: MathPlotIntersection[];
  yIntercepts?: MathPlotFeaturePoint[];
}

/**
 * High-precision interactive curve tracer for math plots (functions, parametric curves, and polar plots).
 * Evaluates numerical derivatives with high-order stencils, computes exact tangent lines,
 * projects radial rays / crosshairs, and magnetically snaps to roots, turning points, apsides, and crossings.
 */
export function traceMathPlot(
  plotBox: Rect,
  mathPlot: MathPlotMeta,
  pointer: Point,
  snapRadius = 18
): MathTraceInfo | null {
  if (mathPlot.kind === 'parametric' && mathPlot.parametric) {
    return traceParametricPlot(plotBox, mathPlot, pointer, snapRadius);
  }
  if (mathPlot.kind === 'polarPlot' && mathPlot.polar?.length) {
    return tracePolarPlot(plotBox, mathPlot, pointer, snapRadius);
  }
  return traceFunctionPlot(plotBox, mathPlot, pointer, snapRadius);
}

/**
 * Tracing and tangent projection for parametric curves: (x(t), y(t)).
 */
function traceParametricPlot(
  plotBox: Rect,
  mathPlot: MathPlotMeta,
  pointer: Point,
  snapRadius: number
): MathTraceInfo | null {
  const p = mathPlot.parametric;
  if (!p || plotBox.width <= 0 || plotBox.height <= 0) return null;

  const REACH = 28;
  if (
    pointer.x < plotBox.x - REACH ||
    pointer.x > plotBox.x + plotBox.width + REACH ||
    pointer.y < plotBox.y - REACH ||
    pointer.y > plotBox.y + plotBox.height + REACH
  ) {
    return null;
  }

  const { xMin, xMax, yMin, yMax } = mathPlot.domain;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  if (xSpan <= 0 || ySpan <= 0) return null;

  const toScreenX = (x: number) => plotBox.x + ((x - xMin) / xSpan) * plotBox.width;
  const toScreenY = (y: number) => plotBox.y + plotBox.height - ((y - yMin) / ySpan) * plotBox.height;

  const { tMin, tMax, fx, fy, color, sourceX, sourceY } = p;
  const tSpan = tMax - tMin;
  if (tSpan <= 0) return null;

  // Step 1: Coarse grid sample search over parameter t (360 steps)
  const N_STEPS = 360;
  let bestT = tMin;
  let minScreenDistSq = Infinity;

  for (let i = 0; i <= N_STEPS; i += 1) {
    const t = tMin + (i / N_STEPS) * tSpan;
    const xVal = fx(t);
    const yVal = fy(t);
    if (!Number.isFinite(xVal) || !Number.isFinite(yVal)) continue;

    const sx = toScreenX(xVal);
    const sy = toScreenY(yVal);
    const dSq = (pointer.x - sx) ** 2 + (pointer.y - sy) ** 2;
    if (dSq < minScreenDistSq) {
      minScreenDistSq = dSq;
      bestT = t;
    }
  }

  if (minScreenDistSq > 50 * 50) return null;

  // Step 2: Golden-section search to refine parameter t to floating-point resolution
  const stepSize = tSpan / N_STEPS;
  const lo = Math.max(tMin, bestT - 1.5 * stepSize);
  const hi = Math.min(tMax, bestT + 1.5 * stepSize);

  const PHI = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - PHI * (b - a);
  let d = a + PHI * (b - a);

  const evalDistSq = (t: number): number => {
    const x = fx(t);
    const y = fy(t);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
    const sx = toScreenX(x);
    const sy = toScreenY(y);
    return (pointer.x - sx) ** 2 + (pointer.y - sy) ** 2;
  };

  let fc = evalDistSq(c);
  let fd = evalDistSq(d);

  for (let i = 0; i < 24; i += 1) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - PHI * (b - a);
      fc = evalDistSq(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + PHI * (b - a);
      fd = evalDistSq(d);
    }
    if (Math.abs(b - a) < 1e-8) break;
  }

  let optT = (a + b) / 2;
  let optX = fx(optT);
  let optY = fy(optT);
  let sx = toScreenX(optX);
  let sy = toScreenY(optY);

  const finalScreenDist = Math.hypot(pointer.x - sx, pointer.y - sy);
  if (finalScreenDist > REACH) return null;

  // Step 3: Feature snapping (horizontal tangents, vertical tangents, cusps, axis crossings)
  let snapped: MathTraceFeature | undefined;
  let minFeatDist = snapRadius;

  for (const feat of mathPlot.paramFeatures || []) {
    const fsx = toScreenX(feat.x);
    const fsy = toScreenY(feat.y);
    const dist = Math.hypot(pointer.x - fsx, pointer.y - fsy);
    if (dist < minFeatDist) {
      minFeatDist = dist;
      optT = feat.parameterValue;
      optX = feat.x;
      optY = feat.y;
      sx = fsx;
      sy = fsy;
      snapped = {
        kind:
          feat.kind === 'axisCrossing'
            ? 'root'
            : feat.kind === 'cusp'
              ? 'cusp'
              : 'tangent',
        x: optX,
        y: optY,
        label: feat.label,
        badgeText: feat.badgeText,
      };
    }
  }

  // Step 4: Analytical derivatives with respect to parameter t (boundary-aware stencils)
  const ht = Math.max(1e-6, tSpan * 1e-5);
  let vx: number;
  let vy: number;
  if (optT - ht < tMin) {
    vx = (fx(optT + ht) - fx(optT)) / ht;
    vy = (fy(optT + ht) - fy(optT)) / ht;
  } else if (optT + ht > tMax) {
    vx = (fx(optT) - fx(optT - ht)) / ht;
    vy = (fy(optT) - fy(optT - ht)) / ht;
  } else {
    vx = (fx(optT + ht) - fx(optT - ht)) / (2 * ht);
    vy = (fy(optT + ht) - fy(optT - ht)) / (2 * ht);
  }
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  const speed = Math.hypot(vx, vy);

  // Screen tangent direction
  const scaleX = plotBox.width / xSpan;
  const scaleY = plotBox.height / ySpan;
  const scrVx = vx * scaleX;
  const scrVy = -vy * scaleY;
  const scrLen = Math.hypot(scrVx, scrVy);

  let uX = 1;
  let uY = 0;
  if (scrLen > 1e-9) {
    uX = scrVx / scrLen;
    uY = scrVy / scrLen;
  }

  const TANGENT_LEN = 38;
  const rawP1 = { x: sx - TANGENT_LEN * uX, y: sy - TANGENT_LEN * uY };
  const rawP2 = { x: sx + TANGENT_LEN * uX, y: sy + TANGENT_LEN * uY };

  const clampPt = (pt: Point): Point => ({
    x: Math.max(plotBox.x, Math.min(plotBox.x + plotBox.width, pt.x)),
    y: Math.max(plotBox.y, Math.min(plotBox.y + plotBox.height, pt.y)),
  });
  const tangentSegment: [Point, Point] = [clampPt(rawP1), clampPt(rawP2)];

  // Cartesian slope & equation
  let slope: number;
  let tangentEquation: string;
  if (speed < 1e-5) {
    slope = 0;
    tangentEquation = 'Cusp / Stationary Point (v = 0)';
  } else if (Math.abs(vx) < 1e-4) {
    slope = vy >= 0 ? Infinity : -Infinity;
    tangentEquation = `x = ${roundNumber(optX, 2)} (Vertical)`;
  } else if (Math.abs(vy) < 1e-4) {
    slope = 0;
    tangentEquation = `y = ${roundNumber(optY, 2)} (Horizontal)`;
  } else {
    slope = vy / vx;
    const b = optY - slope * optX;
    const slopeSign = slope >= 0 ? '' : '-';
    const slopeVal = Math.abs(slope);
    const interceptTerm =
      Math.abs(b) < 1e-4
        ? ''
        : b > 0
          ? ` + ${roundNumber(b, 2)}`
          : ` - ${roundNumber(Math.abs(b), 2)}`;
    tangentEquation = `y = ${slopeSign}${roundNumber(slopeVal, 2)}x${interceptTerm}`;
  }

  const VELOCITY_ARROW_LEN = 24;
  const fieldVector: MathTraceFieldVector | undefined =
    speed > 1e-6
      ? {
          u: vx,
          v: vy,
          magnitude: speed,
          angleDeg: (Math.atan2(vy, vx) * 180) / Math.PI,
          segment: [
            { x: sx, y: sy },
            { x: sx + VELOCITY_ARROW_LEN * uX, y: sy + VELOCITY_ARROW_LEN * uY },
          ],
        }
      : undefined;

  const zeroScreenY = Math.max(plotBox.y, Math.min(plotBox.y + plotBox.height, toScreenY(0)));
  const zeroScreenX = Math.max(plotBox.x, Math.min(plotBox.x + plotBox.width, toScreenX(0)));

  return {
    x: optX,
    y: optY,
    screenPoint: { x: sx, y: sy },
    curveIndex: 0,
    curveColor: color,
    curveName: `x(t)=${sourceX}, y(t)=${sourceY}`,
    slope,
    tangentEquation,
    tangentSegment,
    crosshair: {
      xRay: [{ x: sx, y: sy }, { x: sx, y: zeroScreenY }],
      yRay: [{ x: sx, y: sy }, { x: zeroScreenX, y: sy }],
    },
    snappedFeature: snapped,
    fieldVector,
    parameterValue: optT,
    parametricVelocity: { vx, vy, speed },
  };
}

/**
 * Tracing, radial rays, and tangent projection for polar plots: r = f(θ).
 */
function tracePolarPlot(
  plotBox: Rect,
  mathPlot: MathPlotMeta,
  pointer: Point,
  snapRadius: number
): MathTraceInfo | null {
  const polarList = mathPlot.polar;
  if (!polarList?.length || plotBox.width <= 0 || plotBox.height <= 0) return null;

  const REACH = 28;
  if (
    pointer.x < plotBox.x - REACH ||
    pointer.x > plotBox.x + plotBox.width + REACH ||
    pointer.y < plotBox.y - REACH ||
    pointer.y > plotBox.y + plotBox.height + REACH
  ) {
    return null;
  }

  const { xMin, xMax, yMin, yMax } = mathPlot.domain;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  if (xSpan <= 0 || ySpan <= 0) return null;

  const toScreenX = (x: number) => plotBox.x + ((x - xMin) / xSpan) * plotBox.width;
  const toScreenY = (y: number) => plotBox.y + plotBox.height - ((y - yMin) / ySpan) * plotBox.height;

  const polar = polarList[0];
  const { aMin, aMax, fr, color, source } = polar;
  const aSpan = aMax - aMin;
  if (aSpan <= 0) return null;

  // Step 1: Coarse sample search over angle a (360 steps)
  const N_STEPS = 360;
  let bestA = aMin;
  let minScreenDistSq = Infinity;

  for (let i = 0; i <= N_STEPS; i += 1) {
    const a = aMin + (i / N_STEPS) * aSpan;
    const r = fr(a);
    if (!Number.isFinite(r)) continue;

    const xVal = r * Math.cos(a);
    const yVal = r * Math.sin(a);
    const sx = toScreenX(xVal);
    const sy = toScreenY(yVal);
    const dSq = (pointer.x - sx) ** 2 + (pointer.y - sy) ** 2;
    if (dSq < minScreenDistSq) {
      minScreenDistSq = dSq;
      bestA = a;
    }
  }

  if (minScreenDistSq > 50 * 50) return null;

  // Step 2: Golden-section search to refine angle a to floating-point resolution
  const stepSize = aSpan / N_STEPS;
  const lo = Math.max(aMin, bestA - 1.5 * stepSize);
  const hi = Math.min(aMax, bestA + 1.5 * stepSize);

  const PHI = (Math.sqrt(5) - 1) / 2;
  let aLo = lo;
  let bHi = hi;
  let c = bHi - PHI * (bHi - aLo);
  let d = aLo + PHI * (bHi - aLo);

  const evalDistSq = (angle: number): number => {
    const r = fr(angle);
    if (!Number.isFinite(r)) return Infinity;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    const sx = toScreenX(x);
    const sy = toScreenY(y);
    return (pointer.x - sx) ** 2 + (pointer.y - sy) ** 2;
  };

  let fc = evalDistSq(c);
  let fd = evalDistSq(d);

  for (let i = 0; i < 24; i += 1) {
    if (fc < fd) {
      bHi = d;
      d = c;
      fd = fc;
      c = bHi - PHI * (bHi - aLo);
      fc = evalDistSq(c);
    } else {
      aLo = c;
      c = d;
      fc = fd;
      d = aLo + PHI * (bHi - aLo);
      fd = evalDistSq(d);
    }
    if (Math.abs(bHi - aLo) < 1e-8) break;
  }

  let optA = (aLo + bHi) / 2;
  let optR = fr(optA);
  let optX = optR * Math.cos(optA);
  let optY = optR * Math.sin(optA);
  let sx = toScreenX(optX);
  let sy = toScreenY(optY);

  const finalScreenDist = Math.hypot(pointer.x - sx, pointer.y - sy);
  if (finalScreenDist > REACH) return null;

  // Step 3: Feature snapping (poles r=0, apsides dr/da=0)
  let snapped: MathTraceFeature | undefined;
  let minFeatDist = snapRadius;

  for (const feat of mathPlot.paramFeatures || []) {
    const fsx = toScreenX(feat.x);
    const fsy = toScreenY(feat.y);
    const dist = Math.hypot(pointer.x - fsx, pointer.y - fsy);
    if (dist < minFeatDist) {
      minFeatDist = dist;
      optA = feat.parameterValue;
      optR = fr(optA);
      optX = feat.x;
      optY = feat.y;
      sx = fsx;
      sy = fsy;
      snapped = {
        kind: feat.kind === 'pole' ? 'pole' : 'extremum',
        x: optX,
        y: optY,
        label: feat.label,
        badgeText: feat.badgeText,
      };
    }
  }

  // Step 4: Analytical derivatives in polar and cartesian frames (boundary-aware stencils)
  const ha = Math.max(1e-6, aSpan * 1e-5);
  let drda: number;
  if (optA - ha < aMin) {
    drda = (fr(optA + ha) - fr(optA)) / ha;
  } else if (optA + ha > aMax) {
    drda = (fr(optA) - fr(optA - ha)) / ha;
  } else {
    drda = (fr(optA + ha) - fr(optA - ha)) / (2 * ha);
  }
  if (!Number.isFinite(drda)) drda = 0;

  const dx = drda * Math.cos(optA) - optR * Math.sin(optA);
  const dy = drda * Math.sin(optA) + optR * Math.cos(optA);

  const scaleX = plotBox.width / xSpan;
  const scaleY = plotBox.height / ySpan;
  const scrDx = dx * scaleX;
  const scrDy = -dy * scaleY;
  const scrLen = Math.hypot(scrDx, scrDy);

  let uX = 1;
  let uY = 0;
  if (scrLen > 1e-9) {
    uX = scrDx / scrLen;
    uY = scrDy / scrLen;
  }

  const TANGENT_LEN = 38;
  const rawP1 = { x: sx - TANGENT_LEN * uX, y: sy - TANGENT_LEN * uY };
  const rawP2 = { x: sx + TANGENT_LEN * uX, y: sy + TANGENT_LEN * uY };

  const clampPt = (pt: Point): Point => ({
    x: Math.max(plotBox.x, Math.min(plotBox.x + plotBox.width, pt.x)),
    y: Math.max(plotBox.y, Math.min(plotBox.y + plotBox.height, pt.y)),
  });
  const tangentSegment: [Point, Point] = [clampPt(rawP1), clampPt(rawP2)];

  // Cartesian slope & equation
  let slope: number;
  let tangentEquation: string;
  if (Math.abs(dx) < 1e-4) {
    slope = dy >= 0 ? Infinity : -Infinity;
    tangentEquation = `x = ${roundNumber(optX, 2)} (Vertical)`;
  } else if (Math.abs(dy) < 1e-4) {
    slope = 0;
    tangentEquation = `y = ${roundNumber(optY, 2)} (Horizontal)`;
  } else {
    slope = dy / dx;
    const b = optY - slope * optX;
    const slopeSign = slope >= 0 ? '' : '-';
    const slopeVal = Math.abs(slope);
    const interceptTerm =
      Math.abs(b) < 1e-4
        ? ''
        : b > 0
          ? ` + ${roundNumber(b, 2)}`
          : ` - ${roundNumber(Math.abs(b), 2)}`;
    tangentEquation = `y = ${slopeSign}${roundNumber(slopeVal, 2)}x${interceptTerm}`;
  }

  // Polar ray from origin (0, 0) to point
  const originSx = toScreenX(0);
  const originSy = toScreenY(0);

  const angleDeg = (optA * 180) / Math.PI;

  return {
    x: optX,
    y: optY,
    screenPoint: { x: sx, y: sy },
    curveIndex: 0,
    curveColor: color,
    curveName: `r(θ)=${source}`,
    slope,
    tangentEquation,
    tangentSegment,
    crosshair: {
      xRay: [{ x: originSx, y: originSy }, { x: sx, y: sy }],
      yRay: [{ x: sx, y: sy }, { x: toScreenX(0), y: sy }],
    },
    snappedFeature: snapped,
    parameterValue: optA,
    polarRadius: optR,
    polarAngleRad: optA,
    polarAngleDeg: angleDeg,
  };
}

/**
 * Tracing for standard 1D functions y = f(x).
 */
function traceFunctionPlot(
  plotBox: Rect,
  mathPlot: MathPlotMeta,
  pointer: Point,
  snapRadius: number
): MathTraceInfo | null {
  const { domain, curves, roots, extrema, intersections, yIntercepts } = mathPlot;
  if (!curves.length || plotBox.width <= 0 || plotBox.height <= 0) return null;

  const REACH = 24;
  if (
    pointer.x < plotBox.x - REACH ||
    pointer.x > plotBox.x + plotBox.width + REACH ||
    pointer.y < plotBox.y - REACH ||
    pointer.y > plotBox.y + plotBox.height + REACH
  ) {
    return null;
  }

  const { xMin, xMax, yMin, yMax } = domain;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  if (xSpan <= 0 || ySpan <= 0) return null;

  const toDomainX = (px: number) => xMin + ((px - plotBox.x) / plotBox.width) * xSpan;
  const toScreenX = (x: number) => plotBox.x + ((x - xMin) / xSpan) * plotBox.width;
  const toScreenY = (y: number) => plotBox.y + plotBox.height - ((y - yMin) / ySpan) * plotBox.height;

  const clampedPointerX = Math.max(plotBox.x, Math.min(plotBox.x + plotBox.width, pointer.x));
  let currX = toDomainX(clampedPointerX);
  const varName = mathPlot.variable || 'x';

  interface CurveCandidate {
    curve: MathCurveMeta;
    index: number;
    y: number;
    sy: number;
    distY: number;
  }
  const candidates: CurveCandidate[] = [];
  for (let i = 0; i < curves.length; i += 1) {
    const c = curves[i];
    const yVal = c.evaluate(currX);
    if (Number.isFinite(yVal)) {
      const syVal = toScreenY(yVal);
      candidates.push({
        curve: c,
        index: i,
        y: yVal,
        sy: syVal,
        distY: Math.abs(pointer.y - syVal),
      });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.distY - b.distY);
  let activeCandidate = candidates[0];

  let snapped: MathTraceFeature | undefined;
  let minDistance = snapRadius;

  for (const int of intersections || []) {
    const sx = toScreenX(int.x);
    const sy = toScreenY(int.y);
    const d = Math.hypot(pointer.x - sx, pointer.y - sy);
    if (d < minDistance) {
      minDistance = d;
      currX = int.x;
      snapped = {
        kind: 'intersection',
        x: int.x,
        y: int.y,
        label: `Intersection: (${roundNumber(int.x, 3)}, ${roundNumber(int.y, 3)})`,
        badgeText: `Intersection: (${roundNumber(int.x, 2)}, ${roundNumber(int.y, 2)})`,
        curveIndex: int.curveIndices?.[0],
        secondaryCurveIndex: int.curveIndices?.[1],
      };
      if (int.curveIndices) {
        const match = candidates.find((c) => c.index === int.curveIndices![0]);
        if (match) activeCandidate = match;
      }
    }
  }

  for (const ext of extrema || []) {
    const sx = toScreenX(ext.x);
    const sy = toScreenY(ext.y);
    const d = Math.hypot(pointer.x - sx, pointer.y - sy);
    if (d < minDistance) {
      minDistance = d;
      currX = ext.x;
      const kindLabel = ext.kind === 'max' ? 'Local Max' : 'Local Min';
      const kindShort = ext.kind === 'max' ? 'Max' : 'Min';
      snapped = {
        kind: 'extremum',
        x: ext.x,
        y: ext.y,
        label: `${kindLabel}: (${roundNumber(ext.x, 3)}, ${roundNumber(ext.y, 3)})`,
        badgeText: `${kindShort}: (${roundNumber(ext.x, 2)}, ${roundNumber(ext.y, 2)})`,
        curveIndex: ext.curveIndex,
      };
      if (ext.curveIndex !== undefined) {
        const match = candidates.find((c) => c.index === ext.curveIndex);
        if (match) activeCandidate = match;
      }
    }
  }

  for (const r of roots || []) {
    const rx = typeof r === 'number' ? r : r.x;
    const rCurveIdx = typeof r === 'number' ? undefined : r.curveIndex;
    const sx = toScreenX(rx);
    const sy = toScreenY(0);
    const d = Math.hypot(pointer.x - sx, pointer.y - sy);
    if (d < minDistance) {
      minDistance = d;
      currX = rx;
      snapped = {
        kind: 'root',
        x: rx,
        y: 0,
        label: `Root: ${varName} = ${roundNumber(rx, 3)}, f(${varName}) = 0`,
        badgeText: `Root: ${varName} = ${roundNumber(rx, 2)}`,
        curveIndex: rCurveIdx,
      };
      if (rCurveIdx !== undefined) {
        const match = candidates.find((c) => c.index === rCurveIdx);
        if (match) activeCandidate = match;
      }
    }
  }

  for (const yint of yIntercepts || []) {
    const sx = toScreenX(0);
    const sy = toScreenY(yint.y);
    const d = Math.hypot(pointer.x - sx, pointer.y - sy);
    if (d < minDistance) {
      minDistance = d;
      currX = 0;
      snapped = {
        kind: 'intercept',
        x: 0,
        y: yint.y,
        label: `y-Intercept: (0, ${roundNumber(yint.y, 3)})`,
        badgeText: `y-Int: (0, ${roundNumber(yint.y, 2)})`,
        curveIndex: yint.curveIndex,
      };
      if (yint.curveIndex !== undefined) {
        const match = candidates.find((c) => c.index === yint.curveIndex);
        if (match) activeCandidate = match;
      }
    }
  }

  let currY: number;
  if (snapped?.kind === 'root') {
    currY = 0;
  } else if (
    snapped?.kind === 'extremum' ||
    snapped?.kind === 'intersection' ||
    snapped?.kind === 'intercept'
  ) {
    currY = snapped.y;
  } else {
    currY = activeCandidate.curve.evaluate(currX);
  }
  if (!Number.isFinite(currY)) return null;

  const sx = toScreenX(currX);
  const sy = toScreenY(currY);

  if (sy < plotBox.y - 120 || sy > plotBox.y + plotBox.height + 120) {
    return null;
  }

  let slope = 0;
  if (snapped?.kind === 'extremum') {
    slope = 0;
  } else {
    const h = Math.max(1e-6, xSpan * 1e-5);
    const f = activeCandidate.curve.evaluate;
    const ym2 = f(currX - 2 * h);
    const ym1 = f(currX - h);
    const yp1 = f(currX + h);
    const yp2 = f(currX + 2 * h);

    if (
      Number.isFinite(ym2) &&
      Number.isFinite(ym1) &&
      Number.isFinite(yp1) &&
      Number.isFinite(yp2)
    ) {
      slope = (-yp2 + 8 * yp1 - 8 * ym1 + ym2) / (12 * h);
    } else if (Number.isFinite(ym1) && Number.isFinite(yp1)) {
      slope = (yp1 - ym1) / (2 * h);
    } else if (Number.isFinite(yp1)) {
      slope = (yp1 - currY) / h;
    } else if (Number.isFinite(ym1)) {
      slope = (currY - ym1) / h;
    }
  }

  const m = slope;
  const b = currY - m * currX;
  let tangentEquation: string;
  if (Math.abs(m) < 1e-4) {
    tangentEquation = `y = ${roundNumber(currY, 2)}`;
  } else if (Math.abs(m) > 1e5 || !Number.isFinite(m)) {
    tangentEquation = `${varName} = ${roundNumber(currX, 2)}`;
  } else {
    const slopeSign = m >= 0 ? '' : '-';
    const slopeVal = Math.abs(m);
    const slopeTerm = `${slopeSign}${roundNumber(slopeVal, 2)}${varName}`;
    const interceptTerm =
      Math.abs(b) < 1e-4
        ? ''
        : b > 0
          ? ` + ${roundNumber(b, 2)}`
          : ` - ${roundNumber(Math.abs(b), 2)}`;
    tangentEquation = `y = ${slopeTerm}${interceptTerm}`;
  }

  const scaleX = plotBox.width / xSpan;
  const scaleY = plotBox.height / ySpan;
  const screenSlope = -slope * (scaleY / scaleX);
  const angle = Math.atan(screenSlope);
  const TANGENT_LEN = 38;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const rawP1 = { x: sx - TANGENT_LEN * cosA, y: sy - TANGENT_LEN * sinA };
  const rawP2 = { x: sx + TANGENT_LEN * cosA, y: sy + TANGENT_LEN * sinA };

  const clampPt = (pt: Point): Point => ({
    x: Math.max(plotBox.x, Math.min(plotBox.x + plotBox.width, pt.x)),
    y: Math.max(plotBox.y, Math.min(plotBox.y + plotBox.height, pt.y)),
  });

  const tangentSegment: [Point, Point] = [clampPt(rawP1), clampPt(rawP2)];

  const zeroScreenY = Math.max(plotBox.y, Math.min(plotBox.y + plotBox.height, toScreenY(0)));
  const zeroScreenX = Math.max(plotBox.x, Math.min(plotBox.x + plotBox.width, toScreenX(0)));

  return {
    x: currX,
    y: currY,
    screenPoint: { x: sx, y: sy },
    curveIndex: activeCandidate.index,
    curveColor: activeCandidate.curve.color,
    curveName: activeCandidate.curve.source,
    slope,
    tangentEquation,
    tangentSegment,
    crosshair: {
      xRay: [{ x: sx, y: sy }, { x: sx, y: zeroScreenY }],
      yRay: [{ x: sx, y: sy }, { x: zeroScreenX, y: sy }],
    },
    snappedFeature: snapped,
  };
}

function roundNumber(n: number, decimals: number): string {
  return Number(n.toFixed(decimals)).toString();
}
