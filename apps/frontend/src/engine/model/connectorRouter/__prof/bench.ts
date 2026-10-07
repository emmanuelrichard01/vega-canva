import { routeOrthogonalAvoiding, OBSTACLE_MARGIN, type Obstacle } from '../router';
import { inflate } from '../geometry';
const obs: Obstacle[] = [];
for (let i = 0; i < 30; i += 1) {
  const col = i % 6, row = Math.floor(i / 6);
  const x = 180 + col * 200, y = row * 140 + ((col % 2) * 50);
  obs.push({ id: 'o' + i, rect: inflate({ minX: x, minY: y, maxX: x + 90, maxY: y + 70 }, OBSTACLE_MARGIN) });
}
const req = { a: { x: 100, y: 330 }, dirA: 0 as const, b: { x: 1400, y: 330 }, dirB: 1 as const,
  ownA: inflate({ minX: 0, minY: 300, maxX: 100, maxY: 360 }, 12), ownB: inflate({ minX: 1400, minY: 300, maxX: 1500, maxY: 360 }, 12),
  obstaclesIn: () => obs };
for (let k = 0; k < 50; k++) routeOrthogonalAvoiding(req);
const t0 = performance.now(); let r: any;
for (let k = 0; k < 2000; k++) r = routeOrthogonalAvoiding(req);
console.log('avg', ((performance.now() - t0) / 2000).toFixed(3), 'exp', r.expansions);
let L = 0; for (let i = 0; i + 1 < r.points.length; i++) L += Math.abs(r.points[i+1].x - r.points[i].x) + Math.abs(r.points[i+1].y - r.points[i].y);
console.log('bends', r.points.length - 2, 'length', L);
