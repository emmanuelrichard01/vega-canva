import { RouteStore, type RouteEnv } from '../routeStore';
import type { AnyNode } from '../../schema';
import type { LiveTransform } from '../../liveTransformStore';
import { nodeRect } from '../obstacles';
import { intersects, type Rect } from '../geometry';
import RBush from 'rbush';
const shape = (id: string, x: number, y: number, w = 100, h = 60) => ({ id, type: 'shape', x, y, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0, hidden: false, locked: false, opacity: 1, geometry: { kind: 'rect' } }) as unknown as AnyNode;
const conn = (id: string, from: string, to: string) => ({ id, type: 'connector', x: 0, y: 0, width: 1, height: 1, zIndex: 1, hidden: false, locked: false, opacity: 1, from: { nodeId: from, port: 'auto' }, to: { nodeId: to, port: 'auto' }, routing: 'orthogonal', avoid: true }) as unknown as AnyNode;
const objects: Record<string, AnyNode> = {};
for (let i = 0; i < 200; i += 1) objects[`n${i}`] = shape(`n${i}`, (i % 20) * 160, Math.floor(i / 20) * 140);
for (let i = 0; i < 80; i += 1) { const f = `n${(i * 7) % 200}`, t = `n${(i * 13 + 41) % 200}`; if (f !== t) objects[`k${i}`] = conn(`k${i}`, f, t); }
const tree = new RBush<any>(); tree.load(Object.values(objects).map((n) => ({ ...nodeRect(n), node: n })));
const live = new Map<string, LiveTransform>(); const liveL = new Set<() => void>(); let frames: Array<() => void> = [];
const env: RouteEnv = { getObjects: () => objects, getChanges: () => null, subscribeObjects: () => () => {}, getLive: (id) => live.get(id), liveIds: () => [...live.keys()], subscribeLive: (fn) => (liveL.add(fn), () => liveL.delete(fn)), query: (r: Rect) => tree.search(r).map((e: any) => e.node), now: () => performance.now(), frame: (fn) => (frames.push(fn), () => {}), boardJumps: () => null };
const store = new RouteStore(env);
for (const id of Object.keys(objects)) if (id.startsWith('k')) store.subscribe(id, () => {});
let t0 = performance.now(); store.flush(); console.log('cold full board', (performance.now() - t0).toFixed(1), 'ms');
const times: number[] = [];
for (let f = 0; f < 60; f++) { live.set('n85', { x: 800 + f * 6, y: 560 + f * 3 }); liveL.forEach((l) => l()); const run = frames; frames = []; const t = performance.now(); run.forEach((g) => g()); times.push(performance.now() - t); }
times.sort((a, b) => a - b); console.log('frame p50', times[30].toFixed(2), 'p95', times[56].toFixed(2), 'max', times[59].toFixed(2), 'lastFrameMs', store.lastFrameMs.toFixed(2));
{
  const s: any = store; let ta = 0, tr = 0, na = 0, nr = 0;
  const adj = s.adjust.bind(s); s.adjust = (o: any) => { const t = performance.now(); adj(o); ta += performance.now() - t; na++; };
  const r1 = s.routeOne.bind(s); s.routeOne = (n: any, o: any) => { const t = performance.now(); const x = r1(n, o); tr += performance.now() - t; nr++; return x; };
  const onLive = s.onLive.bind(s); let tl = 0; s.onLive = () => { const t = performance.now(); onLive(); tl += performance.now() - t; };
  liveL.clear(); liveL.add(() => s.onLive());
  for (let f = 0; f < 60; f++) { live.set('n85', { x: 1100 - f * 6, y: 740 - f * 3 }); liveL.forEach((l) => l()); const run = frames; frames = []; run.forEach((g) => g()); }
  console.log('per frame: adjust', (ta / 60).toFixed(2), 'route', (tr / 60).toFixed(2), 'routes/frame', (nr / 60).toFixed(1), 'onLive', (tl / 60).toFixed(2));
}
{
  let bends = 0, len = 0;
  for (const id of Object.keys(objects)) if (id.startsWith('k')) { const r = store.get(id)!; bends += r.points.length - 2; for (let i = 0; i + 1 < r.points.length; i++) len += Math.abs(r.points[i+1].x - r.points[i].x) + Math.abs(r.points[i+1].y - r.points[i].y); }
  console.log('total bends', bends, 'total length', Math.round(len), 'degraded', store.degradedCount);
}
