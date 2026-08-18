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

  it('does not freeze a body while something moving is still landing on it', () => {
    /**
     * The Pachinko case, and the bug that stopped every cascade.
     *
     * A body that has come to rest on a locked obstacle is momentarily below
     * the speed threshold, so it banks settle frames — and freezes — while
     * the objects above it are still falling onto it. It is then immediately
     * re-woken by the next impact. The symptom is a body settling *more than
     * once* in one run: a stutter on screen, and a transform committed to the
     * document every time.
     *
     * It takes a sustained field to reproduce, because without one nothing
     * ever piles up: bodies drift apart and stop independently, and never
     * rest on each other at all.
     */
    const { sim } = simWith([
      node('floor', { x: -400, y: 600, width: 900, height: 60, locked: true }),
      node('a', { x: 0, y: 300 }),
      node('b', { x: 10, y: 120 }),
      node('c', { x: 20, y: -60 }),
    ]);

    const settleCount = new Map<string, number>();
    for (let i = 0; i < 900; i++) {
      // A held Drop over the column — what a latched field will do for you.
      // One press, held — so it carries one gesture id for its whole life.
      sim.applyForce(60, 300, 'gravity', { radiusScale: 3, scale: 2, gesture: 1 });
      for (const t of sim.advance(FIXED_DT).settled) {
        settleCount.set(t.id, (settleCount.get(t.id) ?? 0) + 1);
      }
    }

    // The locked floor never moved.
    expect(sim.getBody('floor')!.isStatic).toBe(true);

    /**
     * A few settles per body is correct: one when it lands, and one more each
     * time something falls onto it afterwards, because an impact deliberately
     * overrides "already rested this press".
     *
     * What is not correct is the freeze/re-wake loop the held field used to
     * drive on its own. Fifteen seconds of held Drop measured eighty-three
     * settles per body before this — roughly five document writes per second,
     * per object, for a pile that was not moving.
     */
    const worst = Math.max(...settleCount.values());
    expect(worst).toBeLessThanOrEqual(6);
  });

  it('does not time out a body while a field is still being driven', () => {
    /**
     * The timeout counted five seconds from *waking*, so a held or latched
     * field longer than that froze everything under it while it was still
     * being pushed — the simulation overruling the person driving it.
     */
    const { sim } = simWith([node('a')]);

    /**
     * Wind, re-aimed at the body every step, so it keeps travelling and never
     * settles on *speed* — which isolates the timeout as the only thing that
     * could retire it. A magnet would not do: the body reaches the attractor
     * and legitimately comes to rest there.
     */
    const push = () => {
      const p = sim.getBody('a')!.position;
      sim.applyForce(p.x, p.y, 'wind', { dx: 1, dy: 0 });
    };

    push();
    expect(sim.activeCount).toBe(1);

    /**
     * Counting *settles*, not `activeCount`.
     *
     * `activeCount` cannot see this bug: the body freezes on the timeout and
     * the very next push wakes it straight back up, so the count reads 1
     * either way. What the timeout actually caused was a freeze/re-wake cycle
     * every five seconds — a visible stutter, and a committed transform to
     * the document on each one, which is write churn for an object that never
     * stopped being pushed.
     */
    let settles = 0;
    for (let i = 0; i < 500; i++) {
      push();
      settles += sim.advance(FIXED_DT).settled.length;
    }
    expect(settles).toBe(0);
    expect(sim.activeCount).toBe(1);

    // Stop driving it, and it is allowed to retire as before.
    runToRest(sim, 2000);
    expect(sim.activeCount).toBe(0);
  });

  it('builds a circle body for a round shape, and a box for an oblong one', () => {
    /**
     * The simulation read no geometry at all, so every body was a rectangle —
     * which is invisible on a scatter and fatal on anything meant to roll. A
     * square ball landing on a square peg balances on its flat top, which is
     * exactly why the Pachinko board jammed.
     */
    const { sim } = simWith([
      node('ball', { type: 'shape', width: 40, height: 40, geometry: { kind: 'ellipse' } }),
      node('petal', { type: 'shape', x: 300, width: 20, height: 60, geometry: { kind: 'ellipse' } }),
      node('box', { type: 'shape', x: 600, width: 40, height: 40, geometry: { kind: 'rect' } }),
    ]);

    expect(sim.getBody('ball')!.plugin.round).toBe(true);
    // Matter approximates a circle with a polygon; a rectangle is always 4.
    expect(sim.getBody('ball')!.vertices.length).toBeGreaterThan(4);

    // Too elongated to be a circle of any single radius.
    expect(sim.getBody('petal')!.plugin.round).toBe(false);
    expect(sim.getBody('box')!.plugin.round).toBe(false);
  });

  it('rebuilds a body when its shape changes', () => {
    const { sim, map } = simWith([
      node('a', { type: 'shape', width: 40, height: 40, geometry: { kind: 'rect' } }),
    ]);
    const before = sim.getBody('a')!;
    expect(before.plugin.round).toBe(false);

    map.a = { ...map.a, geometry: { kind: 'ellipse' } };
    sim.sync(map, ['a'], []);

    expect(sim.getBody('a')).not.toBe(before);
    expect(sim.getBody('a')!.plugin.round).toBe(true);
  });

  it('lets a scoped object travel straight through an unscoped one', () => {
    /**
     * "Just my selection" promises you can tidy a cluster without disturbing
     * its neighbours. Filtering only the *force* does the opposite: the
     * neighbours are asleep, an asleep body is an immovable wall, so the
     * selection ends up pinned against them. Measured before the fix — a
     * shockwave that carried the object 450 units unscoped moved it 4 when
     * scoped, because its neighbour was in the way.
     */
    const { sim } = simWith([
      node('mine', { x: 0, y: 0 }),
      node('theirs', { x: 125, y: 0 }),
    ]);

    const theirsStart = sim.getBody('theirs')!.position.x;
    sim.applyForce(-300, 0, 'shockwave', { scale: 1.5, only: new Set(['mine']) });
    for (let i = 0; i < 300; i++) sim.advance(FIXED_DT);

    // It got well past the neighbour instead of being blocked by it.
    expect(sim.getBody('mine')!.position.x).toBeGreaterThan(300);
    // And the neighbour is exactly where it was.
    expect(Math.round(sim.getBody('theirs')!.position.x)).toBe(Math.round(theirsStart));
    expect(sim.getBody('theirs')!.isStatic).toBe(true);
  });

  it('puts collisions back when the scope is dropped', () => {
    const { sim } = simWith([node('a'), node('b', { x: 125 })]);
    sim.applyForce(-300, 0, 'shockwave', { scale: 1.5, only: new Set(['a']) });
    // An unscoped press afterwards must restore an ordinary world.
    sim.applyForce(-300, 0, 'shockwave', { scale: 0.5 });
    expect(sim.getBody('a')!.collisionFilter.mask).toBe(0xFFFFFFFF);
    expect(sim.getBody('b')!.collisionFilter.mask).toBe(0xFFFFFFFF);
    expect(sim.getBody('b')!.collisionFilter.category).toBe(0x0001);
  });

  it('never sets a locked object in motion, however hard it is hit', () => {
    // The simulation did not read `locked` at all, so the one control whose
    // whole promise is "do not move this" was ignored by the only system that
    // moves things.
    const { sim } = simWith([node('a', { x: 60, y: 0, locked: true })]);

    sim.applyForce(0, 0, 'shockwave');

    const body = sim.getBody('a')!;
    expect(body.isStatic).toBe(true);
    expect(sim.activeCount).toBe(0);
  });

  it('still collides against a locked object', () => {
    // The difference between locking a body and removing it: a peg has to
    // stay in the world to be bounced off.
    const { sim } = simWith([
      node('peg', { x: 220, y: 0, locked: true }),
      node('ball', { x: 0, y: 0 }),
    ]);

    sim.applyForce(-200, 0, 'shockwave');
    expect(sim.getBody('ball')!.isStatic).toBe(false);

    // The peg is present in the world, so Matter can resolve against it.
    expect(sim.getBody('peg')).toBeDefined();
    expect(sim.getBody('peg')!.isStatic).toBe(true);
  });

  it('picks up a lock applied after the body was built', () => {
    // Lockedness is re-read on every sync rather than baked in at creation,
    // so it must not need a rebuild to take effect.
    const { sim, map } = simWith([node('a', { x: 60, y: 0 })]);
    const before = sim.getBody('a')!;

    map.a = { ...map.a, locked: true };
    sim.sync(map, ['a'], []);

    // Same body — locking is not a shape or mass change.
    expect(sim.getBody('a')).toBe(before);
    sim.applyForce(0, 0, 'shockwave');
    expect(sim.getBody('a')!.isStatic).toBe(true);
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

describe('PhysicsSimulation - material feel', () => {
  /** Distance a hard flick carries an object, with nothing in its way. */
  const throwDistance = (material: string) => {
    const { sim } = simWith([node('a', { material })]);
    sim.launch('a', 60, 60, 30, 0);
    runToRestTransforms(sim, 3000);
    return Math.round(sim.getBody('a')!.position.x - 60);
  };

  it('carries a flick far enough to cross a workable stretch of canvas', () => {
    // Air drag was tuned so hard that a full-speed flick died in ~120px, which
    // on an infinite canvas reads as the object refusing to move — and meant
    // thrown objects almost never reached anything to collide with.
    expect(throwDistance('paper')).toBeGreaterThan(300);
  });

  it('orders the materials by how far a flick carries them', () => {
    const feather = throwDistance('feather');
    const paper = throwDistance('paper');
    const wood = throwDistance('wood');
    const rubber = throwDistance('rubber');
    const stone = throwDistance('stone');

    // The ordering is the material identity — it must survive any retuning.
    expect(feather).toBeLessThan(paper);
    expect(paper).toBeLessThan(wood);
    expect(wood).toBeLessThan(rubber);
    expect(rubber).toBeLessThan(stone);
    // And they have to be tellable apart, not clustered within a few pixels.
    expect(stone).toBeGreaterThan(feather * 4);
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
