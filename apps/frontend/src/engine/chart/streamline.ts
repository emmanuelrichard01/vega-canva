import type { Point } from './chartLayout';

export interface StreamlineBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface StreamlineOptions {
  bounds: StreamlineBounds;
  /** Step length in function space units */
  stepSize?: number;
  /** Maximum steps in each direction */
  maxSteps?: number;
}

/**
 * 4th-Order Runge-Kutta (RK4) streamline integration.
 *
 * Given a directional field (either slope dy/dx or vector <P, Q>),
 * integrates both forward and backward along normalized arc-length
 * ds to trace the exact trajectory passing through the seed point (x0, y0).
 */
export function integrateStreamline(
  directionFn: (x: number, y: number) => { dx: number; dy: number } | null,
  seed: Point,
  options: StreamlineOptions
): Point[] {
  const { bounds } = options;
  const xSpan = bounds.xMax - bounds.xMin;
  const ySpan = bounds.yMax - bounds.yMin;
  const avgSpan = (xSpan + ySpan) / 2;

  const h = options.stepSize ?? Math.max(1e-4, avgSpan / 150);
  const maxSteps = options.maxSteps ?? 350;

  const inBounds = (x: number, y: number) =>
    x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax;

  if (!inBounds(seed.x, seed.y)) {
    return [];
  }

  // Evaluates normalized vector [dx, dy] at (x, y)
  const evalUnit = (x: number, y: number, sign: number): [number, number] | null => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const v = directionFn(x, y);
    if (!v) return null;
    const mag = Math.hypot(v.dx, v.dy);
    if (mag < 1e-12 || !Number.isFinite(mag)) return null;
    return [(v.dx / mag) * sign, (v.dy / mag) * sign];
  };

  const integrateBranch = (sign: 1 | -1): Point[] => {
    const pts: Point[] = [];
    let curX = seed.x;
    let curY = seed.y;

    for (let i = 0; i < maxSteps; i += 1) {
      // RK4 step
      const k1 = evalUnit(curX, curY, sign);
      if (!k1) break;

      const x2 = curX + (h / 2) * k1[0];
      const y2 = curY + (h / 2) * k1[1];
      const k2 = evalUnit(x2, y2, sign);
      if (!k2) break;

      const x3 = curX + (h / 2) * k2[0];
      const y3 = curY + (h / 2) * k2[1];
      const k3 = evalUnit(x3, y3, sign);
      if (!k3) break;

      const x4 = curX + h * k3[0];
      const y4 = curY + h * k3[1];
      const k4 = evalUnit(x4, y4, sign);
      if (!k4) break;

      const nextX = curX + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      const nextY = curY + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);

      if (!inBounds(nextX, nextY) || !Number.isFinite(nextX) || !Number.isFinite(nextY)) {
        break;
      }

      curX = nextX;
      curY = nextY;
      pts.push({ x: curX, y: curY });
    }
    return pts;
  };

  const forward = integrateBranch(1);
  const backward = integrateBranch(-1);

  // Backward reversed + seed + forward
  const result: Point[] = [];
  for (let i = backward.length - 1; i >= 0; i -= 1) {
    result.push(backward[i]);
  }
  result.push({ x: seed.x, y: seed.y });
  for (const pt of forward) {
    result.push(pt);
  }

  return result;
}
