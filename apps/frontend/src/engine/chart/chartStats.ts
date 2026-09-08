export interface RegressionResult {
  slope: number;
  intercept: number;
  r: number;
  r2: number;
  predict: (x: number) => number;
}

/**
 * Computes Ordinary Least Squares (OLS) linear regression y = mx + b
 * and coefficient of determination R².
 */
export function linearRegression(
  points: Array<{ x: number; y: number }>
): RegressionResult | null {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = valid.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of valid) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (const p of valid) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  if (sxx < 1e-12) {
    return null; // Vertical line
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = syy > 1e-12 ? sxy / Math.sqrt(sxx * syy) : 0;
  const r2 = r * r;

  return {
    slope,
    intercept,
    r,
    r2,
    predict: (x: number) => slope * x + intercept,
  };
}

/**
 * Computes sample quantiles (0..1) using linear interpolation.
 */
export function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const pos = (sortedValues.length - 1) * Math.max(0, Math.min(1, q));
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base >= sortedValues.length - 1) return sortedValues[sortedValues.length - 1];
  return sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base]);
}

/**
 * Freedman-Diaconis optimal histogram bin count based on Interquartile Range (IQR).
 * Falls back to Sturges' rule if data has zero variance / zero IQR.
 */
export function optimalBinCount(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = clean.length;
  if (n < 4) return Math.max(1, n);

  const min = clean[0];
  const max = clean[n - 1];
  const span = max - min;
  if (span <= 1e-9) return 1;

  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  const iqr = q3 - q1;

  if (iqr > 1e-9) {
    const binWidth = 2 * iqr * Math.pow(n, -1 / 3);
    if (binWidth > 1e-9) {
      const k = Math.ceil(span / binWidth);
      return Math.min(60, Math.max(4, k));
    }
  }

  // Sturges' rule fallback: k = 1 + log2(n)
  const sturges = Math.ceil(Math.log2(n) + 1);
  return Math.min(60, Math.max(4, sturges));
}

export interface KdePoint {
  x: number;
  density: number;
}

/**
 * Gaussian Kernel Density Estimation (KDE) with Silverman's rule bandwidth.
 */
export function kernelDensityEstimation(
  values: number[],
  evalPoints: number[]
): KdePoint[] {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = clean.length;
  if (n < 2 || evalPoints.length === 0) return [];

  // Variance and standard deviation
  let sum = 0;
  for (const v of clean) sum += v;
  const mean = sum / n;

  let sumSq = 0;
  for (const v of clean) sumSq += (v - mean) * (v - mean);
  const std = Math.sqrt(sumSq / (n - 1));

  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  const iqr = q3 - q1;

  // Silverman's rule of thumb: h = 0.9 * min(std, IQR / 1.34) * n^(-1/5)
  const spread = Math.min(std || 1, iqr > 0 ? iqr / 1.34 : std || 1);
  const h = Math.max(1e-4, 0.9 * spread * Math.pow(n, -0.2));

  const sqrt2Pi = Math.sqrt(2 * Math.PI);
  const normFactor = 1 / (n * h * sqrt2Pi);

  return evalPoints.map((x) => {
    let sumKern = 0;
    for (let i = 0; i < n; i += 1) {
      const u = (x - clean[i]) / h;
      sumKern += Math.exp(-0.5 * u * u);
    }
    return {
      x,
      density: normFactor * sumKern,
    };
  });
}
