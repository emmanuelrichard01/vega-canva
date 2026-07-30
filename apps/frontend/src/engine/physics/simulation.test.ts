import { describe, it, expect } from 'vitest';
import { PhysicsSimulation, FIXED_DT, type SimNode, type SimTransform } from './simulation';

/**
 * Every case here corresponds to a bug that actually shipped and had to be
 * found by hand in a browser. The simulation was previously buried inside a
 * React hook alongside Konva, Yjs and awareness, so none of it could be
 * asserted — "it feels glitchy" was the only available bug report.
 */

const node = (id: string, over: Partial<SimNode> = {}): SimNode => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  width: 120,
  height: 120,
  ...over,
});

/** Build a simulation holding the given nodes. */
function simWith(nodes: SimNode[]) {
  const sim = new PhysicsSimulation();
  const map = Object.fromEntries(nodes.map(n => [n.id, n]));
  sim.sync(map, Object.keys(map), []);
  return { sim, map };
}

/** Run until everything settles, returning the last committed transforms. */
function runToRestTransforms(sim: PhysicsSimulation, maxFrames = 600) {
  const settled = new Map<string, SimTransform>();
  const woken: string[] = [];
  let frames = 0;
  while (sim.activeCount > 0 && frames < maxFrames) {
    const result = sim.advance(FIXED_DT);
    result.settled.forEach(t => settled.set(t.id, t));
    result.woken.forEach(id => woken.push(id));
    frames++;
  }
  return { settled, woken, frames };
}

const runToRest = runToRestTransforms;

describe('PhysicsSimulation - bodies', () => {
  it('creates a body per physical node and skips anchors', () => {
    const { sim } = simWith([
      node('a'),
      node('c', { type: 'comment' }),
      node('f', { type: 'frame' }),
    ]);
    expect(sim.bodyCount).toBe(1);
    expect(sim.getBody('a')).toBeDefined();
    expect(sim.getBody('c')).toBeUndefined();
  });

  it('gives a woken body finite mass', () => {
    // The bug: bodies created static never had mass computed, so they woke at
    // Infinity. Force scaled by mass became Infinity, Matter multiplied it by
    // an inverse mass of 0, and every position became NaN on the first step.
    const { sim } = simWith([node('a', { x: 300, y: 0 })]);
    expect(Number.isFinite(sim.getBody('a')!.mass)).toBe(false); // static: Infinity

    sim.applyForce(0, 0, 'shockwave');

    const body = sim.getBody('a')!;
    expect(body.isStatic).toBe(false);
    expect(Number.isFinite(body.mass)).toBe(true);
    expect(Number.isFinite(body.inertia)).toBe(true);
  });

  it('rebuilds a body when its material changes', () => {
    const { sim, map } = simWith([node('a')]);
    const before = sim.getBody('a')!;
    expect(before.plugin.materialId).toBe('paper');

    map.a = { ...map.a, material: 'stone' };
    sim.sync(map, ['a'], []);

    const after = sim.getBody('a')!;
    expect(after).not.toBe(before);
    expect(after.plugin.materialId).toBe('stone');
  });

  it('rebuilds a body when its size changes', () => {
    const { sim, map } = simWith([node('a')]);
    const before = sim.getBody('a')!;
    map.a = { ...map.a, width: 400 };
    sim.sync(map, ['a'], []);
    expect(sim.getBody('a')).not.toBe(before);
    expect(sim.getBody('a')!.plugin.width).toBe(400);
  });

  it('drops bodies for removed nodes', () => {
    const { sim, map } = simWith([node('a'), node('b', { x: 400 })]);
    delete (map as Record<string, SimNode>).a;
    sim.sync(map, [], ['a']);
    expect(sim.bodyCount).toBe(1);
    expect(sim.getBody('a')).toBeUndefined();
  });
});

describe('PhysicsSimulation - forces', () => {
  it('moves objects away from a shockwave', () => {
    const { sim } = simWith([node('a', { x: 200, y: 0 })]);
    const startX = sim.getBody('a')!.position.x;

    sim.applyForce(0, 0, 'shockwave');
    expect(sim.activeCount).toBe(1);
    runToRest(sim);

    // Pushed outward, away from the blast at the origin.
    expect(sim.getBody('a')!.position.x).toBeGreaterThan(startX);
  });

  it('pulls objects toward a magnet', () => {
    const { sim } = simWith([node('a', { x: 300, y: 0 })]);
    const startX = sim.getBody('a')!.position.x;
    // Held forces apply per frame, so a hold is many applications.
    for (let i = 0; i < 30; i++) {
      sim.applyForce(0, 0, 'magnet');
      sim.advance(FIXED_DT);
    }
    expect(sim.getBody('a')!.position.x).toBeLessThan(startX);
  });

  it('applies a held force without the cursor moving', () => {
    // The bug: continuous forces were applied from the mousemove handler, so
    // pressing and holding — exactly what the tool tells you to do — did
    // nothing at all unless you jiggled the mouse.
    const { sim } = simWith([node('a', { x: 300, y: 0 })]);
    const startX = sim.getBody('a')!.position.x;
    for (let i = 0; i < 30; i++) {
      sim.applyForce(0, 0, 'magnet'); // same point every frame
      sim.advance(FIXED_DT);
    }
    expect(sim.getBody('a')!.position.x).toBeLessThan(startX - 1);
  });

  it('ignores objects outside the force radius', () => {
    const { sim } = simWith([node('far', { x: 100000, y: 0 })]);
    const woken = sim.applyForce(0, 0, 'shockwave');
    expect(woken).toEqual([]);
    expect(sim.activeCount).toBe(0);
  });

  it('reports newly woken ids once, so ownership is claimed in one broadcast', () => {
    // The lag: ownership was published per object, per frame, for every body
    // in the document — thousands of awareness writes a second.
    const { sim } = simWith([node('a', { x: 150, y: 0 }), node('b', { x: -150, y: 0 })]);
    expect(sim.applyForce(0, 0, 'magnet').sort()).toEqual(['a', 'b']);
    // Already awake on the next frame, so nothing further to claim.
    expect(sim.applyForce(0, 0, 'magnet')).toEqual([]);
  });

  it('skips objects another client owns', () => {
    const { sim } = simWith([node('a', { x: 150, y: 0 }), node('b', { x: -150, y: 0 })]);
    const woken = sim.applyForce(0, 0, 'magnet', { skip: new Set(['a']) });
    expect(woken).toEqual(['b']);
    expect(sim.isActive('a')).toBe(false);
  });

  it('scales with the strength multiplier', () => {
    const travel = (scale: number) => {
      const { sim } = simWith([node('a', { x: 200, y: 0 })]);
      const start = sim.getBody('a')!.position.x;
      sim.applyForce(0, 0, 'shockwave', { scale });
      runToRest(sim);
      return sim.getBody('a')!.position.x - start;
    };
    expect(travel(2)).toBeGreaterThan(travel(0.5));
  });

  it('leaves an object centred exactly under the cursor alone', () => {
    // Dividing by a zero distance was another route to NaN positions.
    const { sim } = simWith([node('a', { x: -60, y: -60 })]); // centre at 0,0
    sim.applyForce(0, 0, 'magnet');
    const body = sim.getBody('a')!;
    expect(Number.isFinite(body.position.x)).toBe(true);
    expect(Number.isFinite(body.position.y)).toBe(true);
  });
});

describe('PhysicsSimulation - materials', () => {
  it('gives a heavier, slicker material more travel than a light draggy one', () => {
    const travel = (material: string) => {
      const { sim } = simWith([node('a', { x: 200, y: 0, material })]);
      const start = sim.getBody('a')!.position.x;
      sim.applyForce(0, 0, 'shockwave');
      runToRest(sim);
      return Math.abs(sim.getBody('a')!.position.x - start);
    };
    // Feather is almost pure air drag; stone barely slows down.
    expect(travel('stone')).toBeGreaterThan(travel('feather'));
  });

  it('falls back to the type default when no material is set', () => {
    const { sim } = simWith([node('a'), node('t', { id: 't', type: 'text', x: 400 })]);
    expect(sim.getBody('a')!.plugin.materialId).toBe('paper');
    expect(sim.getBody('t')!.plugin.materialId).toBe('stone');
  });
});

describe('PhysicsSimulation - stepping and settling', () => {
  it('does nothing when nothing is in motion', () => {
    const { sim } = simWith([node('a')]);
    const result = sim.advance(FIXED_DT);
    expect(result.moving).toEqual([]);
    expect(result.settled).toEqual([]);
  });

  it('reports an object as moving, then settled exactly once', () => {
    const { sim } = simWith([node('a', { x: 200, y: 0 })]);
    sim.applyForce(0, 0, 'shockwave');

    let movingFrames = 0;
    const settledIds: string[] = [];
    for (let i = 0; i < 600 && sim.activeCount > 0; i++) {
      const r = sim.advance(FIXED_DT);
      if (r.moving.length > 0) movingFrames++;
      r.settled.forEach(t => settledIds.push(t.id));
    }

    expect(movingFrames).toBeGreaterThan(0);
    expect(settledIds).toEqual(['a']); // exactly once, never duplicated
    expect(sim.activeCount).toBe(0);
  });

  it('advances by a fixed step regardless of the delta it is handed', () => {
    // Variable timesteps make the same throw travel different distances
    // depending on frame pacing, which is what juddering looks like.
    const run = (deltas: number[]) => {
      const { sim } = simWith([node('a', { x: 200, y: 0 })]);
      sim.applyForce(0, 0, 'shockwave');
      deltas.forEach(d => sim.advance(d));
      return sim.getBody('a')!.position.x;
    };
    const steady = run(Array(12).fill(FIXED_DT));
    // Same total time, wildly uneven frames.
    const jittery = run([FIXED_DT * 4, FIXED_DT, FIXED_DT * 3, FIXED_DT * 2, FIXED_DT * 2]);
    expect(Math.abs(steady - jittery)).toBeLessThan(1);
  });

  it('never emits a non-finite transform', () => {
    const { sim } = simWith([node('a', { x: 120, y: 0 }), node('b', { x: -120, y: 0 })]);
    sim.applyForce(0, 0, 'shockwave', { scale: 2 });
    for (let i = 0; i < 400 && sim.activeCount > 0; i++) {
      const { moving, settled } = sim.advance(FIXED_DT);
      [...moving, ...settled].forEach(t => {
        expect(Number.isFinite(t.x)).toBe(true);
        expect(Number.isFinite(t.y)).toBe(true);
        expect(Number.isFinite(t.rotation)).toBe(true);
      });
    }
  });

  it('gives up on an object that will not settle', () => {
    const { sim } = simWith([node('a', { x: 200, y: 0, material: 'stone' })]);
    sim.applyForce(0, 0, 'shockwave', { scale: 2 });
    const { settled } = runToRest(sim, 2000);
    // Either it slows to a stop or the timeout claims it; either way it must
    // stop being simulated and must be committed exactly once.
    expect(sim.activeCount).toBe(0);
    expect(settled.has('a')).toBe(true);
  });

  it('reports both coordinate spaces, and does not confuse them', () => {
    // Conflating these shipped once: the renderer was handed the document's
    // top-left, so a flying object drew half its own size off and visibly
    // jumped when it landed and React took the position back over.
    const { sim } = simWith([node('a', { x: 200, y: 0 })]);
    sim.applyForce(0, 0, 'shockwave');
    const { moving } = sim.advance(FIXED_DT);
    const t = moving.find(m => m.id === 'a')!;
    const body = sim.getBody('a')!;

    // Konva groups are positioned by their centre, which is the body position.
    expect(t.centerX).toBeCloseTo(body.position.x, 5);
    expect(t.centerY).toBeCloseTo(body.position.y, 5);
    // Nodes store their top-left corner, half the size back from the centre.
    expect(t.x).toBeCloseTo(t.centerX - 60, 5);
    expect(t.y).toBeCloseTo(t.centerY - 60, 5);
  });

  it('keeps both spaces consistent on the settled transform too', () => {
    const { sim } = simWith([node('a', { x: 200, y: 0 })]);
    sim.applyForce(0, 0, 'shockwave');
    const { settled } = runToRestTransforms(sim);
    const t = settled.get('a')!;
    expect(t.x).toBeCloseTo(t.centerX - 60, 5);
    expect(t.y).toBeCloseTo(t.centerY - 60, 5);
  });
});

describe('PhysicsSimulation - collisions', () => {
  it('knocks a resting object out of the way instead of bouncing off it', () => {
    // Objects rest as static bodies, and a static body has infinite mass — so
    // a thrown object collided with what it hit, but the target behaved like a
    // wall and never moved. Contact has to promote the target to dynamic.
    const { sim } = simWith([node('thrown'), node('target', { x: 130, y: 0 })]);
    const targetStart = sim.getBody('target')!.position.x;

    sim.launch('thrown', 60, 60, 12, 0); // centre of 'thrown', heading right
    const { woken } = runToRestTransforms(sim);

    expect(woken).toContain('target');
    expect(sim.getBody('target')!.position.x).toBeGreaterThan(targetStart);
  });

  it('reports a collision-woken object so the caller can claim it', () => {
    const { sim } = simWith([node('thrown'), node('target', { x: 130, y: 0 })]);
    sim.launch('thrown', 60, 60, 12, 0);

    let reported: string[] = [];
    for (let i = 0; i < 200 && sim.activeCount > 0; i++) {
      reported = reported.concat(sim.advance(FIXED_DT).woken);
    }
    // Reported once, not on every frame it remains in motion.
    expect(reported.filter(id => id === 'target')).toHaveLength(1);
  });

  it('commits the object that was hit, not just the one thrown', () => {
    const { sim } = simWith([node('thrown'), node('target', { x: 130, y: 0 })]);
    sim.launch('thrown', 60, 60, 12, 0);
    const { settled } = runToRestTransforms(sim);
    expect(settled.has('thrown')).toBe(true);
    expect(settled.has('target')).toBe(true);
  });

  it('leaves objects nowhere near the action alone', () => {
    const { sim } = simWith([node('thrown'), node('far', { x: 5000, y: 5000 })]);
    sim.launch('thrown', 60, 60, 12, 0);
    const { woken, settled } = runToRestTransforms(sim);
    expect(woken).not.toContain('far');
    expect(settled.has('far')).toBe(false);
  });
});

describe('PhysicsSimulation - throwing', () => {
  it('launches from the release point rather than the pre-drag position', () => {
    const { sim } = simWith([node('a')]);
    expect(sim.launch('a', 500, 500, 5, 0)).toBe(true);
    const body = sim.getBody('a')!;
    expect(body.position.x).toBeCloseTo(500, 5);
    expect(body.position.y).toBeCloseTo(500, 5);
    expect(sim.isActive('a')).toBe(true);
  });

  it('travels in the direction it was thrown and settles', () => {
    const { sim } = simWith([node('a')]);
    // Launched by body *centre*; transforms come back as the node's top-left,
    // so the comparison has to be against the launch point in the same space.
    sim.launch('a', 0, 0, 8, 0);
    const launchedTopLeftX = 0 - 120 / 2;

    const { settled } = runToRest(sim);
    const rest = settled.get('a')!;

    expect(rest.x).toBeGreaterThan(launchedTopLeftX);
    expect(Number.isFinite(rest.x)).toBe(true);
  });

  it('reports failure for an object with no body', () => {
    const { sim } = simWith([node('a')]);
    expect(sim.launch('nope', 0, 0, 1, 1)).toBe(false);
  });
});

describe('PhysicsSimulation - freezing', () => {
  it('stops everything and hands back where each object stopped', () => {
    const { sim } = simWith([node('a', { x: 150, y: 0 }), node('b', { x: -150, y: 0 })]);
    sim.applyForce(0, 0, 'shockwave');
    sim.advance(FIXED_DT);

    const frozen = sim.freezeAll();
    expect(frozen.map(f => f.id).sort()).toEqual(['a', 'b']);
    expect(sim.activeCount).toBe(0);
    frozen.forEach(f => expect(Number.isFinite(f.x)).toBe(true));
  });
});
