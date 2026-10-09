import { describe, expect, it } from 'vitest';
import { PHYSICS, PHYSICS_PRIMERS } from './physics';
import { PhysicsSimulation, FIXED_DT, isPhysicalType, type SimNode } from '../../physics/simulation';
import type { FalloffId, ForceId } from '../../physics/forces';
import { frameForNode } from '../../model/frames';

/**
 * The physics boards, played in the real simulation.
 *
 * Each board is built, given the frame memberships the room would give it on
 * creation, and driven the way its guide tells a person to drive it. The
 * assertions are what someone watching would notice: something moved, nothing
 * went NaN, nothing left through a wall, and it all came to rest.
 */

type Node = SimNode & { text?: string; locked?: boolean; pinned?: boolean; [k: string]: unknown };

function board(id: string) {
  const nodes = PHYSICS.find((t) => t.id === id)!.build() as unknown as Node[];
  const frames = nodes.filter((n) => n.type === 'frame').map((n, i) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, zIndex: i }));
  const map: Record<string, Node> = {};
  for (const n of nodes) {
    const frameId = n.type === 'connector' ? null : frameForNode({ id: n.id, type: n.type, x: n.x, y: n.y, width: n.width, height: n.height }, frames);
    map[n.id] = { ...n, ...(frameId ? { frameId } : null) };
  }
  const sim = new PhysicsSimulation();
  sim.sync(map, Object.keys(map), []);
  const loose = Object.values(map).filter((n) => isPhysicalType(n.type) && !n.locked && !n.pinned && !n.frameId);
  return { nodes: Object.values(map), map, sim, loose };
}

interface Field { x: number; y: number; mode: ForceId; steps: number; radiusScale?: number; falloff?: FalloffId; angle?: number }

/** Apply a field once per fixed step for its life, then run until everything rests. */
function play(sim: PhysicsSimulation, fields: Field[], restSteps = 900) {
  let gesture = 0;
  for (const f of fields) {
    gesture += 1;
    for (let s = 0; s < f.steps; s++) {
      sim.applyForce(f.x, f.y, f.mode, { radiusScale: f.radiusScale, falloff: f.falloff ?? 'smooth', angle: f.angle, gesture: f.mode === 'shockwave' ? undefined : gesture });
      sim.advance(FIXED_DT);
    }
  }
  let s = 0;
  while (sim.activeCount > 0 && s < restSteps) {
    sim.advance(FIXED_DT);
    s++;
  }
  return sim.activeCount;
}

const centre = (sim: PhysicsSimulation, id: string) => sim.getBody(id)!.position;
const finite = (sim: PhysicsSimulation, ids: string[]) => ids.every((id) => Number.isFinite(centre(sim, id).x) && Number.isFinite(centre(sim, id).y));

describe('the physics boards', () => {
  it('are four, each with a primer for the Forces bar', () => {
    expect(PHYSICS.map((t) => t.id)).toEqual(['physics-playground', 'physics-marble-run', 'physics-orbits', 'physics-dominoes']);
    for (const t of PHYSICS) expect(PHYSICS_PRIMERS[t.id], t.id).toBeDefined();
  });

  it('keep every word in a frame or on a plate, never loose in an arena', () => {
    for (const t of PHYSICS) {
      const { nodes } = board(t.id);
      const loose = nodes.filter((n) => n.type === 'text' && !n.frameId);
      expect(loose.map((n) => n.text), t.id).toEqual([]);
    }
  });

  it('open at rest, with movers on the open board', () => {
    for (const t of PHYSICS) {
      const { sim, loose } = board(t.id);
      expect(sim.activeCount, t.id).toBe(0);
      expect(loose.length, t.id).toBeGreaterThan(10);
    }
  });
});

describe('played as the guides say', () => {
  it('marble run: a latched hard-edged gravity sends every marble into a bin', () => {
    const { sim, loose, nodes } = board('physics-marble-run');
    const walls = nodes.filter((n) => n.locked && n.height > 1000);
    const left = Math.min(...walls.map((w) => w.x + w.width));
    const right = Math.max(...walls.map((w) => w.x));
    const pegs = nodes.filter((n) => n.locked && n.width === 24 && n.height === 24);
    const px = pegs.reduce((s, p) => s + p.x + 12, 0) / pegs.length;
    const py = pegs.reduce((s, p) => s + p.y + 12, 0) / pegs.length;
    // Ten seconds of latched field, at the middle of the pegs.
    const resting = play(sim, [{ x: px, y: py, mode: 'gravity', steps: 600, radiusScale: 3, falloff: 'constant', angle: 90 }]);
    const ids = loose.map((n) => n.id);
    expect(finite(sim, ids)).toBe(true);
    expect(resting).toBe(0);
    for (const id of ids) {
      const p = centre(sim, id);
      expect(p.y, `${id} reached the bins`).toBeGreaterThan(1260);
      expect(p.x).toBeGreaterThan(left);
      expect(p.x).toBeLessThan(right);
    }
  });

  it('orbits: a latched swirl at the star turns the belts without flinging them away', () => {
    const { sim, loose, nodes } = board('physics-orbits');
    const sun = nodes.find((n) => n.text === 'Sun')!;
    const sx = sun.x + sun.width / 2;
    const sy = sun.y + sun.height / 2;
    const before = new Map(loose.map((n) => [n.id, Math.atan2(n.y + n.height / 2 - sy, n.x + n.width / 2 - sx)]));
    play(sim, [{ x: sx, y: sy, mode: 'swirl', steps: 600, radiusScale: PHYSICS_PRIMERS['physics-orbits'].radiusScale, falloff: 'smooth' }]);
    const ids = loose.map((n) => n.id);
    expect(finite(sim, ids)).toBe(true);
    let turned = 0;
    for (const n of loose) {
      const p = centre(sim, n.id);
      const r = Math.hypot(p.x - sx, p.y - sy);
      expect(r, 'never inside the star').toBeGreaterThan(sun.width / 2 + n.width / 2 - 4);
      expect(r, 'still in the system').toBeLessThan(1100);
      let d = Math.atan2(p.y - sy, p.x - sx) - before.get(n.id)!;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 0.5) turned++;
    }
    expect(turned / loose.length).toBeGreaterThan(0.7);
  });

  it('dominoes: one shockwave at the centre clears the note and keeps every tile inside the walls', () => {
    const { sim, loose, nodes } = board('physics-dominoes');
    const sticky = nodes.find((n) => n.type === 'sticky')!;
    const cx = sticky.x + sticky.width / 2;
    const cy = sticky.y + sticky.height / 2;
    const resting = play(sim, [{ x: cx, y: cy, mode: 'shockwave', steps: 1 }], 1200);
    const ids = loose.map((n) => n.id);
    expect(finite(sim, ids)).toBe(true);
    expect(resting).toBe(0);
    expect(centre(sim, sticky.id)).toEqual({ x: cx, y: cy });
    for (const id of ids) {
      const p = centre(sim, id);
      const r = Math.hypot(p.x - cx, p.y - cy);
      expect(r, `${id} cleared the note`).toBeGreaterThan(sticky.width / 2);
      // Inside the octagon: no further out than the wall along any of its eight normals.
      const reach = Math.max(...Array.from({ length: 8 }, (_, k) => (p.x - cx) * Math.cos((k * Math.PI) / 4) + (p.y - cy) * Math.sin((k * Math.PI) / 4)));
      expect(reach, `${id} stayed inside the octagon`).toBeLessThan(560);
    }
  });

  it('playground: each tray contains its own lesson', () => {
    const { sim, loose, nodes } = board('physics-playground');
    const trays = nodes.filter((n) => n.locked && n.width > 500 && n.height === 24);
    // Every tray in turn: hold the force its card names at the tray's middle.
    const modes: ForceId[] = ['magnet', 'repel', 'swirl', 'gravity', 'shockwave', 'repel'];
    const tops = trays.filter((_, i) => i % 2 === 0);
    tops.forEach((top, i) => {
      const x = top.x + top.width / 2 - (modes[i] === 'shockwave' ? 200 : 0);
      const y = top.y + 24 + 170;
      play(sim, [{ x, y, mode: modes[i], steps: modes[i] === 'shockwave' ? 1 : 120, angle: 90 }]);
    });
    const ids = loose.map((n) => n.id);
    expect(finite(sim, ids)).toBe(true);
    // Nothing tunnelled out of its tray.
    for (const n of loose) {
      const p = centre(sim, n.id);
      const home = tops.find((t) => n.x >= t.x && n.x <= t.x + t.width && n.y >= t.y && n.y <= t.y + 24 + 340);
      expect(home, n.id).toBeDefined();
      expect(p.x).toBeGreaterThan(home!.x + 24);
      expect(p.x).toBeLessThan(home!.x + home!.width - 24);
      expect(p.y).toBeGreaterThan(home!.y + 24);
      expect(p.y).toBeLessThan(home!.y + 24 + 340);
    }
  });
});
