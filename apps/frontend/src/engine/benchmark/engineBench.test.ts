import { describe, it, expect, vi } from 'vitest';
import { mixedBoard, CELL_SIZE } from './boardFixture';

/**
 * Engine micro-benchmarks over the mixed board fixture.
 *
 * The timings print and never assert (see `stressTest.test.ts` for why a
 * wall-clock threshold is a coin flip). Run with
 * `BENCH=1 npx vitest run src/engine/benchmark/engineBench`. What runs by
 * default is the fixture's shape, so the harness stays honest.
 */
vi.mock('../document/doc', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    doc,
    objectsMap: doc.getMap('objects'),
    groupsMap: doc.getMap('groups'),
    identitiesMap: doc.getMap('identities'),
    metadataMap: doc.getMap('metadata'),
    provider: { awareness: { getLocalState: () => ({}), setLocalStateField: () => {}, getStates: () => new Map() } },
  };
});

const BENCH = Boolean(process.env.BENCH);

describe('mixed board fixture', () => {
  it('builds exactly the requested count with unique ids and attached connectors', () => {
    for (const n of [25, 500, 2000]) {
      const nodes = mixedBoard(n);
      expect(nodes).toHaveLength(n);
      const ids = new Set(nodes.map((node) => node.id));
      expect(ids.size).toBe(n);
      for (const node of nodes) {
        if (node.type !== 'connector') continue;
        expect(ids.has((node.from as { nodeId: string }).nodeId)).toBe(true);
        expect(ids.has((node.to as { nodeId: string }).nodeId)).toBe(true);
      }
    }
    expect(new Set(mixedBoard(CELL_SIZE).map((n) => n.type))).toEqual(
      new Set(['frame', 'shape', 'connector', 'text', 'sticky', 'table', 'chart', 'path'])
    );
  });

  it('is deterministic', () => {
    expect(mixedBoard(500)).toEqual(mixedBoard(500));
  });
});

describe.skipIf(!BENCH)('engine benchmarks', () => {
  const time = (fn: () => void) => {
    const t0 = performance.now();
    fn();
    return +(performance.now() - t0).toFixed(1);
  };

  it('creates a board in one transaction', async () => {
    const { createNode } = await import('../document/mutations');
    const { doc, objectsMap } = await import('../document/doc');
    const { normalizeNode } = await import('../document/normalize');
    for (const n of [500, 2000, 5000]) {
      doc.transact(() => objectsMap.clear());
      const nodes = mixedBoard(n);
      const create = time(() => doc.transact(() => nodes.forEach((node) => createNode(node))));
      const normalise = time(() => objectsMap.forEach((m, id) => normalizeNode((m as { toJSON(): Record<string, unknown> }).toJSON(), id)));
      console.log(`[bench] ${n} objects: createNode x${n} in one transaction ${create} ms; read + normalise all ${normalise} ms`);
    }
  }, 300_000);
});
