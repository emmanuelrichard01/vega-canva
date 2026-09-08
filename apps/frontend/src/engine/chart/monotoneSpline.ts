export interface Point {
  x: number;
  y: number;
}

/**
 * Fritsch-Carlson monotone cubic Hermite spline interpolation.
 *
 * ## The overshoot problem with Catmull-Rom
 * Standard Catmull-Rom splines or cubic splines can severely overshoot
 * local extrema: a series with values [0, 10, 0] can dip below 0 into negative
 * territory, and plateau regions [10, 10, 10] can ripple.
 *
 * Fritsch & Carlson (1980) proved that a cubic Hermite spline is strictly
 * monotonic if and only if (alpha, beta) lies within a specific ellipse,
 * simplified to alpha^2 + beta^2 <= 9. Clamping tangents to this radius
 * guarantees:
 * 1. Monotonic intervals stay monotonic (no artificial bumps or dips).
 * 2. Flat segments stay strictly flat.
 * 3. Local extrema have tangent 0, with zero overshoot.
 */
export function monotoneSplinePoints(
  points: readonly Point[],
  transposed = false,
  samplesPerSegment = 8
): Point[] {
  if (points.length < 3) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }

  // Independent variable t, dependent variable v
  const tArr: number[] = [];
  const vArr: number[] = [];

  for (const p of points) {
    const t = transposed ? p.y : p.x;
    const v = transposed ? p.x : p.y;
    // Skip duplicate t points to prevent division by zero
    if (tArr.length > 0 && Math.abs(t - tArr[tArr.length - 1]) < 1e-6) {
      continue;
    }
    tArr.push(t);
    vArr.push(v);
  }

  const n = tArr.length;
  if (n < 3) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }

  // 1. Calculate secant slopes delta_k = (v_{k+1} - v_k) / (t_{k+1} - t_k)
  const deltas: number[] = new Array(n - 1);
  const dtArr: number[] = new Array(n - 1);

  for (let k = 0; k < n - 1; k += 1) {
    const dt = tArr[k + 1] - tArr[k];
    dtArr[k] = dt;
    deltas[k] = (vArr[k + 1] - vArr[k]) / (dt || 1e-9);
  }

  // 2. Initialize tangents d_k as average of adjacent secants
  const d: number[] = new Array(n);
  d[0] = deltas[0];
  d[n - 1] = deltas[n - 2];

  for (let k = 1; k < n - 1; k += 1) {
    const mPrev = deltas[k - 1];
    const mNext = deltas[k];
    if (mPrev * mNext <= 0) {
      // Local extremum: tangent must be 0 to prevent overshoot
      d[k] = 0;
    } else {
      d[k] = (mPrev + mNext) / 2;
    }
  }

  // 3. Fritsch-Carlson modification
  for (let k = 0; k < n - 1; k += 1) {
    const delta = deltas[k];
    if (Math.abs(delta) < 1e-12) {
      d[k] = 0;
      d[k + 1] = 0;
    } else {
      const alpha = d[k] / delta;
      const beta = d[k + 1] / delta;
      if (alpha < 0) d[k] = 0;
      if (beta < 0) d[k + 1] = 0;

      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        d[k] = tau * alpha * delta;
        d[k + 1] = tau * beta * delta;
      }
    }
  }

  // 4. Sample the cubic Hermite curve
  const out: Point[] = [];

  for (let k = 0; k < n - 1; k += 1) {
    const t0 = tArr[k];
    const v0 = vArr[k];
    const v1 = vArr[k + 1];
    const d0 = d[k];
    const d1 = d[k + 1];
    const dt = dtArr[k];

    const segSteps = Math.max(4, Math.min(24, Math.round(samplesPerSegment * (Math.abs(dt) / 40 || 1))));

    for (let step = 0; step < segSteps; step += 1) {
      const u = step / segSteps;
      const u2 = u * u;
      const u3 = u2 * u;

      // Hermite basis functions
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;

      const tInterp = t0 + u * dt;
      const vInterp = h00 * v0 + h10 * dt * d0 + h01 * v1 + h11 * dt * d1;

      out.push({
        x: transposed ? vInterp : tInterp,
        y: transposed ? tInterp : vInterp,
      });
    }
  }

  // Final endpoint
  out.push({
    x: transposed ? vArr[n - 1] : tArr[n - 1],
    y: transposed ? tArr[n - 1] : vArr[n - 1],
  });

  return out;
}
