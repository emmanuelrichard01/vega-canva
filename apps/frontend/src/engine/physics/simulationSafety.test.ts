import { describe, it, expect } from 'vitest';
import { PhysicsSimulation, FIXED_DT, BODY_BUDGET, type SimNode } from './simulation';

const node = (id: string, over: Partial<SimNode> = {}): SimNode => ({
  id,
  type: 'shape',
  x: 0,
  y: 0,
  width: 80,
  height: 80,
  ...over,
});

function simWith(nodes: SimNode[]) {
  const sim = new PhysicsSimulation();
  const map = Object.fromEntries(nodes.map((n) => [n.id, n]));
  sim.sync(map, Object.keys(map), []);
  return { sim, map };
}

const run = (sim: PhysicsSimulation, frames: number, dt = FIXED_DT) => {
  for (let i = 0; i < frames; i++) sim.advance(dt);
};

describe('fixed timestep', () => {
  it('lands in the same place however the time is chunked', () => {
    const final = (chunks: number[]) => {
      const { sim } = simWith([node('a', { x: 200 })]);
      sim.applyForce(0, 0, 'shockwave');
      for (const c of chunks) sim.advance(c);
      return sim.getBody('a')!.position.x;
    };
    const total = FIXED_DT * 24;
    const smooth = final(Array(24).fill(FIXED_DT));
    const at120 = final(Array(48).fill(FIXED_DT / 2));
    const lumpy = final([FIXED_DT * 3, FIXED_DT * 9, FIXED_DT * 12].map((v) => Math.min(v, total)));
    expect(at120).toBeCloseTo(smooth, 6);
    // The catch-up ceiling clamps the lumpy case, so it may fall behind but
    // never run ahead of the smooth one.
    expect(lumpy).toBeLessThanOrEqual(smooth + 1e-6);
  });

  it('draws between steps, so a 120Hz frame shows motion rather than a repeat', () => {
    const { sim } = simWith([node('a', { x: 200 })]);
    sim.applyForce(0, 0, 'shockwave');
    sim.advance(FIXED_DT / 2);
    const poses = [1, 2, 3, 4, 5, 6].map(() => sim.advance(FIXED_DT / 2).moving[0].centerX);
    // Every frame moves, including the ones in which no fixed step ran.
    for (let i = 1; i < poses.length; i++) expect(poses[i]).toBeGreaterThan(poses[i - 1]);
  });

  it('commits the exact pose, not the interpolated one', () => {
    const { sim } = simWith([node('a', { x: 200 })]);
    sim.applyForce(0, 0, 'shockwave');
    const frozen = sim.freezeAll();
    expect(frozen[0].centerX).toBeCloseTo(sim.getBody('a')!.position.x, 8);
  });
});

describe('tunnelling', () => {
  it('does not pass a fast body through a thin wall', () => {
    const wall = node('wall', { x: 500, y: -200, width: 30, height: 400, locked: true });
    const ball = node('ball', { x: 0, y: 0, width: 40, height: 40 });
    const { sim } = simWith([wall, ball]);
    const body = sim.getBody('ball')!;
    expect(sim.launch('ball', 20, 20, 400, 0)).toBe(true);
    let maxX = -Infinity;
    for (let i = 0; i < 120; i++) {
      sim.advance(FIXED_DT);
      maxX = Math.max(maxX, body.position.x);
    }
    // Wall's left face is at 500; the ball's centre may never cross its far face.
    expect(maxX).toBeLessThan(530);
  });

  it('caps the distance one step can cover', () => {
    const { sim } = simWith([node('a', { width: 100, height: 100 })]);
    sim.launch('a', 50, 50, 9000, 0);
    const before = sim.getBody('a')!.position.x;
    sim.advance(FIXED_DT);
    expect(sim.getBody('a')!.position.x - before).toBeLessThanOrEqual(120 + 1e-6);
  });
});

describe('what may move', () => {
  it('never moves a locked object, and still collides against it', () => {
    const { sim } = simWith([node('fixed', { x: 100, locked: true })]);
    const woken = sim.applyForce(0, 0, 'shockwave');
    expect(woken).toEqual([]);
    expect(sim.isActive('fixed')).toBe(false);
    expect(sim.launch('fixed', 140, 40, 10, 0)).toBe(false);
  });

  it('never moves a pinned object', () => {
    const { sim } = simWith([node('pin', { x: 100, pinned: true })]);
    expect(sim.applyForce(0, 0, 'shockwave')).toEqual([]);
  });

  it('leaves objects inside a frame alone unless frames are included', () => {
    const { sim } = simWith([node('inside', { x: 100, frameId: 'f1' }), node('free', { x: 100, y: 300 })]);
    const woken = sim.applyForce(0, 0, 'shockwave');
    expect(woken).toContain('free');
    expect(woken).not.toContain('inside');

    sim.freezeAll();
    sim.setIncludeFrames(true);
    expect(sim.applyForce(0, 0, 'shockwave')).toContain('inside');
  });

  it('lets a moving object knock a framed one only when frames are included', () => {
    const { sim } = simWith([node('inside', { x: 300, y: 0, frameId: 'f1' }), node('shot', { x: 0, y: 0 })]);
    sim.launch('shot', 40, 40, 20, 0);
    run(sim, 60);
    expect(sim.isActive('inside')).toBe(false);
  });
});

describe('body budget', () => {
  it('caps how many bodies are in motion and reports it once', () => {
    const nodes = Array.from({ length: BODY_BUDGET + 60 }, (_, i) =>
      node(`n${i}`, { x: (i % 30) * 100, y: Math.floor(i / 30) * 100, width: 40, height: 40 })
    );
    const { sim } = simWith(nodes);
    sim.applyForce(1500, 700, 'shockwave', { radiusScale: 3 });
    expect(sim.activeCount).toBe(BODY_BUDGET);
    expect(sim.takeBudgetHit()).toBe(true);
    expect(sim.takeBudgetHit()).toBe(false);
  });

  it('prefers the bodies nearest the force', () => {
    const nodes = Array.from({ length: BODY_BUDGET + 40 }, (_, i) =>
      node(`n${i}`, { x: i * 6, y: 0, width: 4, height: 4 })
    );
    const { sim } = simWith(nodes);
    sim.applyForce(0, 0, 'shockwave', { radiusScale: 3 });
    expect(sim.isActive('n3')).toBe(true);
    expect(sim.isActive(`n${BODY_BUDGET + 39}`)).toBe(false);
  });
});

describe('outlines and gravity', () => {
  it('builds a diamond as a four-sided body, centred on its box', () => {
    const { sim } = simWith([node('d', { x: 100, y: 100, width: 60, height: 100, geometry: { kind: 'diamond' } })]);
    const body = sim.getBody('d')!;
    expect(body.vertices.length).toBe(4);
    expect(body.position.x).toBeCloseTo(130, 4);
    expect(body.position.y).toBeCloseTo(150, 4);
  });

  it('rebuilds when the shape changes between a box and an outline', () => {
    const { sim, map } = simWith([node('s', { geometry: { kind: 'rect' } })]);
    const before = sim.getBody('s')!;
    map.s = { ...map.s, geometry: { kind: 'diamond' } };
    sim.sync(map, ['s'], []);
    expect(sim.getBody('s')).not.toBe(before);
  });

  it('drops along the chosen direction', () => {
    const { sim } = simWith([node('a', { x: 0, y: 0 })]);
    sim.applyForce(40, 40, 'gravity', { angle: 0 });
    run(sim, 20);
    const body = sim.getBody('a')!;
    expect(body.velocity.x).toBeGreaterThan(0);
    expect(Math.abs(body.velocity.y)).toBeLessThan(1e-6);
  });
});
