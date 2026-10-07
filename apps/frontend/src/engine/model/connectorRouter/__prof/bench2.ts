import { OBSTACLE_MARGIN, type Obstacle } from '../router';
import * as R from '../router';
(globalThis as any).__T = { axis: 0, lines: 0, lineCalls: 0 };
import { inflate } from '../geometry';
const obs: Obstacle[] = [];
for (let i = 0; i < 30; i += 1) {
  const col = i % 6, row = Math.floor(i / 6);
  const x = 180 + col * 200, y = row * 140 + ((col % 2) * 50);
  obs.push({ id: 'o' + i, rect: inflate({ minX: x, minY: y, maxX: x + 90, maxY: y + 70 }, OBSTACLE_MARGIN) });
}
let calls = 0;
const req = { a: { x: 100, y: 330 }, dirA: 0 as const, b: { x: 1400, y: 330 }, dirB: 1 as const,
  ownA: inflate({ minX: 0, minY: 300, maxX: 100, maxY: 360 }, 12), ownB: inflate({ minX: 1400, minY: 300, maxX: 1500, maxY: 360 }, 12),
  obstaclesIn: () => { calls++; return obs; } };
R.routeOrthogonalAvoiding(req);
console.log('attempts', calls);
const N = 300;
let t0 = performance.now();
for (let k = 0; k < N; k++) R.routeOrthogonalAvoiding(req);
console.log('full', ((performance.now() - t0) / N).toFixed(3));
// Open sparse board: 30 obstacles scattered, path mostly clear
const sparse: Obstacle[] = [];
for (let i = 0; i < 30; i += 1) sparse.push({ id: 's' + i, rect: inflate({ minX: 150 + (i * 37) % 1200, minY: -400 + ((i * 53) % 300), maxX: 210 + (i * 37) % 1200, maxY: -350 + ((i * 53) % 300) }, 12) });
sparse.push({ id: 'blk', rect: inflate({ minX: 600, minY: 280, maxX: 700, maxY: 380 }, 12) });
const req2 = { ...req, obstaclesIn: () => sparse };
const r2 = R.routeOrthogonalAvoiding(req2);
t0 = performance.now();
for (let k = 0; k < N; k++) R.routeOrthogonalAvoiding(req2);
console.log('sparse', ((performance.now() - t0) / N).toFixed(3), 'exp', r2.expansions, 'pts', r2.points.length);
