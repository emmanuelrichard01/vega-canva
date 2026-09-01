import RBush from 'rbush';
import type { SpatialNode } from '../SpatialIndex';
import type { AnyNode, ShapeNode } from '../model/schema';

/**
 * Large-Scale Canvas Stress Testing & Spatial Index Benchmark Suite.
 *
 * Evaluates performance characteristics under heavy node populations (10,000+ objects):
 * 1. Bulk insertion & tree construction throughput.
 * 2. Real-time viewport culling query latency (p50, p95, p99) during 60fps panning.
 * 3. Spatial tree removal and mutation overhead.
 *
 * Run it with `BENCH=1 npx vitest run stressTest`. It is not part of the
 * default suite: see the note at the top of `stressTest.test.ts` for why a
 * wall-clock number makes a bad assertion.
 *
 * ## Why the randomness is seeded
 *
 * The numbers here only mean something compared against the last run, and
 * `Math.random()` would redraw the whole node layout every time -- so a real
 * regression and a slightly denser scattering of rectangles would look
 * exactly alike. A fixed seed makes the population the constant and the code
 * the variable, which is the only arrangement in which the comparison says
 * anything.
 */

/**
 * mulberry32: a small, fast, seeded PRNG.
 *
 * Deliberately not cryptographic and not shared -- each generator call gets
 * its own, so populations do not depend on how many were built before.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Any value; changing it invalidates comparison against older recorded runs. */
const BENCHMARK_SEED = 0x5eed_1dea;

export interface BenchmarkMetrics {
  nodeCount: number;
  bulkInsertTimeMs: number;
  insertThroughputNodesPerSec: number;
  viewportQueryCount: number;
  avgQueryTimeMs: number;
  maxQueryTimeMs: number;
  p95QueryTimeMs: number;
  nodesPerViewportAvg: number;
  updateTimeMs: number;
}

/**
 * Generates synthetic nodes spread across a virtual coordinate space.
 */
export function generateSyntheticNodes(
  count: number,
  canvasWidth = 12000,
  canvasHeight = 12000,
  seed = BENCHMARK_SEED
): SpatialNode[] {
  const nodes: SpatialNode[] = [];
  const random = seededRandom(seed);

  for (let i = 0; i < count; i++) {
    const x = random() * (canvasWidth - 200);
    const y = random() * (canvasHeight - 200);
    const width = 50 + random() * 150;
    const height = 50 + random() * 150;

    const fakeNode: ShapeNode = {
      id: `node-synthetic-${i}`,
      type: 'shape',
      x,
      y,
      width,
      height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      zIndex: i,
      locked: false,
      hidden: false,
      createdBy: 'benchmark',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      geometry: { kind: 'rect' },
      appearance: {
        fill: [{ type: 'solid', color: '#3B82F6', opacity: 1 }],
        stroke: { color: '#1D4ED8', width: 2 },
      },
    };

    nodes.push({
      id: fakeNode.id,
      minX: x,
      minY: y,
      maxX: x + width,
      maxY: y + height,
      node: fakeNode as AnyNode,
    });
  }

  return nodes;
}

/**
 * Runs a high-precision stress test and returns latency & throughput metrics.
 */
export function runSpatialStressBenchmark(
  nodeCount = 10000,
  queryIterations = 100,
  seed = BENCHMARK_SEED
): BenchmarkMetrics {
  const nodes = generateSyntheticNodes(nodeCount, 12000, 12000, seed);
  // A separate stream, so changing the query count cannot shift the layout.
  const random = seededRandom(seed ^ 0x9e3779b9);

  // 1. Benchmark Bulk Insertion
  const tree = new RBush<SpatialNode>(9);
  const t0 = performance.now();
  tree.load(nodes);
  const t1 = performance.now();
  const bulkInsertTimeMs = Math.max(0.001, t1 - t0);
  const insertThroughputNodesPerSec = Math.round((nodeCount / bulkInsertTimeMs) * 1000);

  // 2. Benchmark Viewport Queries (1920x1080 screen at varying zooms)
  const queryTimes: number[] = [];
  let totalNodesVisible = 0;

  for (let q = 0; q < queryIterations; q++) {
    // Random viewport placement on canvas
    const vx = random() * 10000;
    const vy = random() * 10000;
    const vWidth = 1920;
    const vHeight = 1080;

    const q0 = performance.now();
    const visible = tree.search({
      minX: vx,
      minY: vy,
      maxX: vx + vWidth,
      maxY: vy + vHeight,
    });
    const q1 = performance.now();

    queryTimes.push(q1 - q0);
    totalNodesVisible += visible.length;
  }

  queryTimes.sort((a, b) => a - b);
  const avgQueryTimeMs = queryTimes.reduce((s, t) => s + t, 0) / queryTimes.length;
  const maxQueryTimeMs = queryTimes[queryTimes.length - 1];
  const p95QueryTimeMs = queryTimes[Math.floor(queryTimes.length * 0.95)];
  const nodesPerViewportAvg = Math.round(totalNodesVisible / queryIterations);

  // 3. Benchmark Spatial Updates (moving 100 nodes)
  const sampleUpdateNodes = nodes.slice(0, 100);
  const u0 = performance.now();
  for (const item of sampleUpdateNodes) {
    tree.remove(item);
    item.minX += 10;
    item.maxX += 10;
    tree.insert(item);
  }
  const u1 = performance.now();
  const updateTimeMs = u1 - u0;

  return {
    nodeCount,
    bulkInsertTimeMs: Number(bulkInsertTimeMs.toFixed(3)),
    insertThroughputNodesPerSec,
    viewportQueryCount: queryIterations,
    avgQueryTimeMs: Number(avgQueryTimeMs.toFixed(4)),
    maxQueryTimeMs: Number(maxQueryTimeMs.toFixed(4)),
    p95QueryTimeMs: Number(p95QueryTimeMs.toFixed(4)),
    nodesPerViewportAvg,
    updateTimeMs: Number(updateTimeMs.toFixed(3)),
  };
}
