import { describe, expect, it } from 'vitest';
import { RouteStore, type RouteEnv } from './routeStore';
import type { AnyNode } from '../schema';
import type { LiveTransform } from '../liveTransformStore';
import { nodeRect } from './obstacles';
import { intersects, type Rect } from './geometry';
import { routeBoard } from './routeBoard';
import { attachLookup, boxLookup } from '../connectorTargets';
import { routeOrthogonalAvoiding, scratchSizes, OBSTACLE_MARGIN, type Obstacle } from './router';
import { inflate } from './geometry';

function shape(id: string, x: number, y: number, w = 100, h = 60): AnyNode {
  return {
    id, type: 'shape', x, y, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1,
    zIndex: 0, hidden: false, locked: false, opacity: 1,
    geometry: { kind: 'rect' },
  } as unknown as AnyNode;
}

function connector(id: string, from: string, to: string, extra: Record<string, unknown> = {}): AnyNode {
  return {
    id, type: 'connector', x: 0, y: 0, width: 1, height: 1, rotation: 0, scaleX: 1, scaleY: 1,
    zIndex: 1, hidden: false, locked: false, opacity: 1,
    from: { nodeId: from, port: 'right' }, to: { nodeId: to, port: 'left' },
    routing: 'orthogonal', avoid: true, ...extra,
  } as unknown as AnyNode;
}

class FakeBoard {
  objects: Record<string, AnyNode> = {};
  changes: { changed: string[]; removed: string[] } | null = null;
  live = new Map<string, LiveTransform>();
  private objectListeners = new Set<() => void>();
  private liveListeners = new Set<() => void>();
  frames: Array<() => void> = [];
  clock = 0;

  env(): RouteEnv {
    return {
      getObjects: () => this.objects,
      getChanges: () => this.changes,
      subscribeObjects: (fn) => (this.objectListeners.add(fn), () => this.objectListeners.delete(fn)),
      getLive: (id) => this.live.get(id),
      liveIds: () => Array.from(this.live.keys()),
      subscribeLive: (fn) => (this.liveListeners.add(fn), () => this.liveListeners.delete(fn)),
      query: (rect: Rect) => Object.values(this.objects).filter((n) => intersects(nodeRect(n), rect)),
      now: () => this.clock,
      frame: (fn) => {
        this.frames.push(fn);
        return () => {
          this.frames = this.frames.filter((f) => f !== fn);
        };
      },
      boardJumps: () => null,
    };
  }

  set(objects: Record<string, AnyNode>, changed: string[] | null, removed: string[] = []) {
    this.objects = objects;
    this.changes = changed ? { changed, removed } : null;
    this.objectListeners.forEach((f) => f());
  }

  move(id: string, live: LiveTransform | null) {
    if (live) this.live.set(id, live);
    else this.live.delete(id);
    this.liveListeners.forEach((f) => f());
  }

  tick() {
    const run = this.frames;
    this.frames = [];
    run.forEach((f) => f());
  }
}

const crosses = (flat: number[], r: Rect) => {
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const [x1, y1, x2, y2] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
    for (let s = 1; s < 32; s += 1) {
      const x = x1 + ((x2 - x1) * s) / 32;
      const y = y1 + ((y2 - y1) * s) / 32;
      if (x > r.minX && x < r.maxX && y > r.minY && y < r.maxY) return true;
    }
  }
  return false;
};

describe('RouteStore', () => {
  it('routes around an obstacle and reroutes when the obstacle moves away', () => {
    const board = new FakeBoard();
    const store = new RouteStore(board.env());
    board.objects = {
      a: shape('a', 0, 0),
      b: shape('b', 400, 0),
      block: shape('block', 200, -20, 100, 100),
      c: connector('c', 'a', 'b'),
    };
    store.subscribe('c', () => {});
    board.tick();
    const first = store.get('c')!;
    expect(crosses(first.flat, nodeRect(board.objects.block))).toBe(false);
    expect(first.points.length).toBeGreaterThan(2);

    // Move the block far away: the connector straightens.
    const moved = { ...board.objects, block: shape('block', 200, 600, 100, 100) };
    board.set(moved, ['block']);
    board.tick();
    expect(store.get('c')!.flat).toEqual([100, 30, 400, 30]);
  });

  it('follows a live drag of an endpoint before anything is committed', () => {
    const board = new FakeBoard();
    const store = new RouteStore(board.env());
    board.objects = { a: shape('a', 0, 0), b: shape('b', 400, 0), c: connector('c', 'a', 'b', { avoid: false }) };
    store.subscribe('c', () => {});
    board.tick();
    board.move('b', { x: 400, y: 200 });
    board.tick();
    const flat = store.get('c')!.flat;
    expect(flat.slice(-2)).toEqual([400, 230]);
  });

  it('notifies only the connectors whose drawing changed', () => {
    const board = new FakeBoard();
    const store = new RouteStore(board.env());
    board.objects = {
      a: shape('a', 0, 0),
      b: shape('b', 400, 0),
      d: shape('d', 0, 800),
      e: shape('e', 400, 800),
      c1: connector('c1', 'a', 'b'),
      c2: connector('c2', 'd', 'e'),
    };
    let n1 = 0;
    let n2 = 0;
    store.subscribe('c1', () => (n1 += 1));
    store.subscribe('c2', () => (n2 += 1));
    board.tick();
    n1 = 0;
    n2 = 0;
    board.move('b', { x: 400, y: 100 });
    board.tick();
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(0);
  });

  it('stops at the frame budget and finishes on later frames', () => {
    const board = new FakeBoard();
    const store = new RouteStore(board.env());
    const objects: Record<string, AnyNode> = {};
    for (let i = 0; i < 20; i += 1) {
      objects[`s${i}`] = shape(`s${i}`, 0, i * 100);
      objects[`t${i}`] = shape(`t${i}`, 400, i * 100);
      objects[`c${i}`] = connector(`c${i}`, `s${i}`, `t${i}`);
    }
    board.objects = objects;
    // The fake clock advances a millisecond every time it is read, so each
    // route costs about a millisecond and a frame fits about three.
    let clock = 0;
    const slow = new RouteStore({ ...board.env(), now: () => (clock += 1) });
    slow.subscribe('c0', () => {});
    board.tick();
    expect(board.frames.length).toBe(1);
    let frames = 1;
    while (board.frames.length > 0 && frames < 40) {
      board.tick();
      frames += 1;
    }
    expect(frames).toBeGreaterThan(3);
    for (let i = 0; i < 20; i += 1) expect(slow.get(`c${i}`)!.flat.slice(0, 2)).toEqual([100, i * 100 + 30]);
    void store;
  });

  it('agrees with routing the whole board from a snapshot', () => {
    const board = new FakeBoard();
    const store = new RouteStore(board.env());
    board.objects = {
      a: shape('a', 0, 0),
      b: shape('b', 500, 40),
      x: shape('x', 220, -40, 80, 160),
      p: shape('p', 0, 200),
      q: shape('q', 500, -100),
      c1: connector('c1', 'a', 'b'),
      c2: connector('c2', 'p', 'q', { from: { nodeId: 'p', port: 'right' }, to: { nodeId: 'q', port: 'left' } }),
    };
    store.subscribe('c1', () => {});
    store.subscribe('c2', () => {});
    store.flush();
    const snapshot = routeBoard(board.objects, {
      boxOf: boxLookup(board.objects),
      attachOf: attachLookup(board.objects),
    });
    for (const id of ['c1', 'c2']) {
      expect(store.get(id)!.flat).toEqual(snapshot.get(id)!.points.flatMap((p) => [p.x, p.y]));
    }
  });
});

describe('RouteStore determinism', () => {
  function crowd(): Record<string, AnyNode> {
    const objects: Record<string, AnyNode> = {};
    for (let i = 0; i < 24; i += 1) objects[`n${i}`] = shape(`n${i}`, (i % 6) * 170, Math.floor(i / 6) * 150);
    for (let i = 0; i < 14; i += 1) {
      const from = `n${(i * 5) % 24}`;
      const to = `n${(i * 7 + 11) % 24}`;
      if (from === to) continue;
      objects[`k${i}`] = connector(`k${i}`, from, to, {
        from: { nodeId: from, port: 'auto' },
        to: { nodeId: to, port: 'auto' },
        routing: i % 4 === 3 ? 'curved' : 'orthogonal',
        zIndex: i,
      });
    }
    return objects;
  }

  function settle(objects: Record<string, AnyNode>) {
    const board = new FakeBoard();
    board.objects = objects;
    const store = new RouteStore(board.env());
    const ids = Object.keys(objects).filter((id) => id.startsWith('k'));
    for (const id of ids) store.subscribe(id, () => {});
    store.flush();
    return { board, store, ids };
  }

  it('draws the same board whatever order the document lists objects in', () => {
    const objects = crowd();
    const shuffled: Record<string, AnyNode> = {};
    const keys = Object.keys(objects);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[(i * 7) % keys.length];
      shuffled[k] = objects[k];
    }
    const a = settle(objects);
    const b = settle(shuffled);
    for (const id of a.ids) {
      expect(JSON.stringify(b.store.get(id)), id).toBe(JSON.stringify(a.store.get(id)));
    }
  });

  it('after a drag, matches routing the final board from scratch', () => {
    const { board, store, ids } = settle(crowd());
    for (let f = 0; f < 8; f += 1) {
      board.move('n8', { x: 2 * 170 + f * 14, y: 150 + f * 9 });
      board.tick();
    }
    // Commit where the drag ended, as the canvas does on release.
    const committed = { ...board.objects, n8: shape('n8', 2 * 170 + 7 * 14, 150 + 7 * 9) };
    board.set(committed, ['n8']);
    board.move('n8', null);
    store.flush();
    const snapshot = routeBoard(committed, { boxOf: boxLookup(committed), attachOf: attachLookup(committed) });
    for (const id of ids) {
      const live = store.get(id)!;
      const fresh = snapshot.get(id)!;
      expect(live.flat, id).toEqual(fresh.points.flatMap((p) => [p.x, p.y]));
      expect(live.hops.map((h) => [h.seg, Math.round(h.at * 100), h.kind]), id).toEqual(
        fresh.hops.map((h) => [h.seg, Math.round(h.at * 100), h.kind])
      );
    }
  });
});

describe('routing cost', () => {
  // Wall-clock limits are not asserted: CI machines share cores. The search
  // size is what the time budget depends on, and it is deterministic.
  it('routes a 30-obstacle maze in a bounded number of expansions', () => {
    const obstacles: Obstacle[] = [];
    for (let i = 0; i < 30; i += 1) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = 180 + col * 200;
      const y = row * 140 + (col % 2) * 50;
      obstacles.push({ id: 'o' + i, rect: inflate({ minX: x, minY: y, maxX: x + 90, maxY: y + 70 }, OBSTACLE_MARGIN) });
    }
    const t0 = performance.now();
    const r = routeOrthogonalAvoiding({
      a: { x: 100, y: 330 },
      dirA: 0,
      b: { x: 1400, y: 330 },
      dirB: 1,
      ownA: inflate({ minX: 0, minY: 300, maxX: 100, maxY: 360 }, OBSTACLE_MARGIN),
      ownB: inflate({ minX: 1400, minY: 300, maxX: 1500, maxY: 360 }, OBSTACLE_MARGIN),
      obstaclesIn: () => obstacles,
    });
    console.info(`maze route: ${(performance.now() - t0).toFixed(2)}ms, ${r.expansions} expansions`);
    expect(r.degraded).toBe(false);
    expect(r.expansions).toBeLessThan(400);
    for (const o of obstacles) expect(crosses(r.points.flatMap((p) => [p.x, p.y]), o.rect)).toBe(false);
  });

  it('reroutes only what a drag touches, and leaves the rest of the board alone', () => {
    const big: Record<string, AnyNode> = {};
    for (let i = 0; i < 200; i += 1) big[`n${i}`] = shape(`n${i}`, (i % 20) * 160, Math.floor(i / 20) * 140);
    for (let i = 0; i < 80; i += 1) {
      const from = `n${(i * 7) % 200}`;
      const to = `n${(i * 13 + 41) % 200}`;
      if (from === to) continue;
      big[`k${i}`] = connector(`k${i}`, from, to, { from: { nodeId: from, port: 'auto' }, to: { nodeId: to, port: 'auto' } });
    }
    const board = new FakeBoard();
    board.objects = big;
    let routed = 0;
    const store = new RouteStore(board.env());
    const s = store as unknown as { routeOne: (...a: unknown[]) => boolean };
    const original = s.routeOne.bind(store);
    s.routeOne = (...a: unknown[]) => {
      routed += 1;
      return original(...a);
    };
    for (const id of Object.keys(big)) if (id.startsWith('k')) store.subscribe(id, () => {});
    store.flush();
    const bound = Object.values(big).filter(
      (n) => n.type === 'connector' && ((n as never as { from: { nodeId: string } }).from.nodeId === 'n85' || (n as never as { to: { nodeId: string } }).to.nodeId === 'n85')
    ).length;
    routed = 0;
    for (let f = 0; f < 10; f += 1) {
      board.move('n85', { x: 5 * 160 + f * 6, y: 4 * 140 + f * 3 });
      board.tick();
    }
    // Ten frames of a drag reroute a small slice of the 80, not the board.
    console.info(`drag: ${routed} reroutes over 10 frames (${bound} bound to the dragged shape)`);
    expect(routed).toBeLessThan(10 * 12);
  });
});

describe('RouteStore and routeBoard agree', () => {
  function crowd(): Record<string, AnyNode> {
    const objects: Record<string, AnyNode> = {};
    for (let i = 0; i < 24; i += 1) objects[`n${i}`] = shape(`n${i}`, (i % 6) * 170, Math.floor(i / 6) * 150);
    for (let i = 0; i < 16; i += 1) {
      const from = `n${(i * 5) % 24}`;
      const to = `n${(i * 7 + 11) % 24}`;
      if (from === to) continue;
      const id = `k${String(i).padStart(2, '0')}`;
      objects[id] = connector(id, from, to, {
        from: { nodeId: from, port: 'auto' },
        to: { nodeId: to, port: 'auto' },
        routing: i % 5 === 4 ? 'curved' : 'orthogonal',
        zIndex: i,
        // Every third one hidden: neither drawn nor read by the others.
        hidden: i % 3 === 0,
      });
    }
    return objects;
  }

  function expectParity(store: RouteStore, objects: Record<string, AnyNode>) {
    const snapshot = routeBoard(objects, { boxOf: boxLookup(objects), attachOf: attachLookup(objects) });
    for (const node of Object.values(objects)) {
      if (node.type !== 'connector') continue;
      if (node.hidden) {
        expect(store.get(node.id), node.id).toBeNull();
        expect(snapshot.has(node.id), node.id).toBe(false);
        continue;
      }
      const live = store.get(node.id)!;
      const fresh = snapshot.get(node.id)!;
      expect(live.flat, node.id).toEqual(fresh.points.flatMap((p) => [p.x, p.y]));
      expect(live.hops.map((h) => [h.seg, Math.round(h.at * 100), h.kind]), node.id).toEqual(
        fresh.hops.map((h) => [h.seg, Math.round(h.at * 100), h.kind])
      );
    }
  }

  function settled(objects: Record<string, AnyNode>) {
    const board = new FakeBoard();
    board.objects = objects;
    const store = new RouteStore(board.env());
    for (const id of Object.keys(objects)) if (objects[id].type === 'connector') store.subscribe(id, () => {});
    store.flush();
    return { board, store };
  }

  it('skips hidden connectors exactly as the export does', () => {
    const { board, store } = settled(crowd());
    expectParity(store, board.objects);
  });

  it('still agrees after connectors are hidden and shown again', () => {
    const { board, store } = settled(crowd());
    const flipped = { ...board.objects };
    const ids = ['k00', 'k01', 'k04', 'k07'].filter((id) => flipped[id]);
    for (const id of ids) flipped[id] = { ...flipped[id], hidden: !flipped[id].hidden } as AnyNode;
    board.set(flipped, ids);
    store.flush();
    expectParity(store, flipped);
  });

  it('drops a deleted connector even when the change list leaves it out', () => {
    const { board, store } = settled(crowd());
    const victim = Object.keys(board.objects).find((id) => id.startsWith('k') && !board.objects[id].hidden)!;
    const rest = { ...board.objects };
    delete rest[victim];
    // A removal reported with `removed: []` and nothing changed.
    board.set(rest, [], []);
    store.flush();
    expect(store.get(victim)).toBeNull();
    const internals = store as unknown as { entries: Map<string, unknown>; outputs: Map<string, unknown> };
    expect(internals.entries.has(victim)).toBe(false);
    expect(internals.outputs.has(victim)).toBe(false);
    expectParity(store, rest);
  });
});

describe('self connectors', () => {
  const inBox = { minX: 1, minY: 1, maxX: 99, maxY: 59 };

  function routeOf(objects: Record<string, AnyNode>) {
    const board = new FakeBoard();
    board.objects = objects;
    const store = new RouteStore(board.env());
    store.subscribe('c', () => {});
    store.flush();
    return store.get('c')!.points;
  }

  it('loops out of one side and back into the next one round', () => {
    const pts = routeOf({
      a: shape('a', 0, 0),
      c: connector('c', 'a', 'a', { from: { nodeId: 'a', port: 'auto' }, to: { nodeId: 'a', port: 'auto' } }),
    });
    // Out of the right side's middle, heading right; into the top's middle, heading down.
    expect(pts[0]).toEqual({ x: 100, y: 30 });
    expect(pts[1].x).toBeGreaterThan(100);
    expect(pts[pts.length - 1]).toEqual({ x: 50, y: 0 });
    expect(pts[pts.length - 2].y).toBeLessThan(0);
    // Never through the box itself.
    expect(crosses(pts.flatMap((p) => [p.x, p.y]), inBox)).toBe(false);
  });

  it('draws a loop for a zero-size object too', () => {
    const pts = routeOf({
      dot: shape('dot', 40, 40, 0, 0),
      c: connector('c', 'dot', 'dot', { from: { nodeId: 'dot', port: 'auto' }, to: { nodeId: 'dot', port: 'auto' } }),
    });
    expect(pts.length).toBeGreaterThanOrEqual(4);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // A real loop with some size, not a stub out and back on itself.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(8);
  });

  it('keeps a named start side and comes back into the side after it, curved as well', () => {
    const pts = routeOf({
      a: shape('a', 0, 0),
      c: connector('c', 'a', 'a', {
        from: { nodeId: 'a', port: 'bottom' },
        to: { nodeId: 'a', port: 'auto' },
        routing: 'curved',
      }),
    });
    expect(pts[0]).toEqual({ x: 50, y: 60 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 30 });
    expect(crosses(pts.flatMap((p) => [p.x, p.y]), inBox)).toBe(false);
  });

  it('draws a straight self connector as the loop, not a line across the box', () => {
    const pts = routeOf({
      a: shape('a', 0, 0),
      c: connector('c', 'a', 'a', { from: { nodeId: 'a', port: 'auto' }, to: { nodeId: 'a', port: 'auto' }, routing: 'straight' }),
    });
    expect(pts.length).toBeGreaterThan(2);
    expect(crosses(pts.flatMap((p) => [p.x, p.y]), inBox)).toBe(false);
  });
});

describe('router scratch buffers', () => {
  it('lets go of buffers an oversized search grew', () => {
    // 8100 small boxes: about 270 candidate lines each way, so the search
    // state (lines x lines x 4 headings) passes what the buffers keep.
    const obstacles: Obstacle[] = [];
    for (let i = 0; i < 8100; i += 1) {
      const x = (i % 90) * 22 + 30;
      const y = Math.floor(i / 90) * 22 + 30;
      obstacles.push({ id: `o${i}`, rect: { minX: x, minY: y, maxX: x + 8, maxY: y + 8 } });
    }
    routeOrthogonalAvoiding({
      a: { x: 0, y: 0 },
      dirA: 0,
      b: { x: 2040, y: 2040 },
      dirB: 0,
      obstaclesIn: () => obstacles,
      maxExpansions: 200_000,
    });
    const sizes = scratchSizes();
    expect(sizes.states).toBeLessThanOrEqual(1 << 18);
    expect(sizes.intervals).toBeLessThanOrEqual(1 << 18);
    expect(sizes.heap).toBeLessThanOrEqual(1 << 18);
  });
});
