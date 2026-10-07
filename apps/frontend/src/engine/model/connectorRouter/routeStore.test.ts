import { describe, expect, it } from 'vitest';
import { RouteStore, type RouteEnv } from './routeStore';
import type { AnyNode } from '../schema';
import type { LiveTransform } from '../liveTransformStore';
import { nodeRect } from './obstacles';
import { intersects, type Rect } from './geometry';
import { routeBoard } from './routeBoard';
import { attachLookup, boxLookup } from '../connectorTargets';
import { routeOrthogonalAvoiding, OBSTACLE_MARGIN, type Obstacle } from './router';
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
