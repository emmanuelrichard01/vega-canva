import * as R from '../router';
import type { AnyNode } from '../../schema';
import { routeBoard } from '../routeBoard';
import { attachLookup, boxLookup } from '../../connectorTargets';
const shape = (id: string, x: number, y: number) => ({ id, type: 'shape', x, y, width: 100, height: 60, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0, hidden: false, locked: false, opacity: 1, geometry: { kind: 'rect' } }) as unknown as AnyNode;
const conn = (id: string, from: string, to: string) => ({ id, type: 'connector', x: 0, y: 0, width: 1, height: 1, zIndex: 1, hidden: false, locked: false, opacity: 1, from: { nodeId: from, port: 'auto' }, to: { nodeId: to, port: 'auto' }, routing: 'orthogonal', avoid: true }) as unknown as AnyNode;
const objects: Record<string, AnyNode> = {};
for (let i = 0; i < 200; i += 1) objects[`n${i}`] = shape(`n${i}`, (i % 20) * 160, Math.floor(i / 20) * 140);
for (let i = 0; i < 80; i += 1) { const f = `n${(i * 7) % 200}`, t = `n${(i * 13 + 41) % 200}`; if (f !== t) objects[`k${i}`] = conn(`k${i}`, f, t); }
const rows: number[][] = [];
const t0 = performance.now();
const res = routeBoard(objects, { boxOf: boxLookup(objects), attachOf: attachLookup(objects) });
console.log('board', (performance.now() - t0).toFixed(1), 'ms', res.size);
