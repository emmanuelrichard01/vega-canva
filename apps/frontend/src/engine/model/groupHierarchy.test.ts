import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  canonicalGroups,
  escapeTarget,
  groupRepairs,
  groupsToUngroup,
  nodesInGroup,
  planGroup,
  planUngroup,
  selectionWithin,
  type GroupPlan,
  type GroupRecord,
  type Groups,
  type NodeTable,
} from './groupTree';

/**
 * The hierarchy as stored and merged: flat-model documents read as groups,
 * merges that close loops are repaired the same way on every peer, and the
 * keyboard paths (Ungroup, Escape) act on the level the selection names.
 */

type Node = { id: string; parentId?: string };

function world(nodeSpec: [string, string | undefined][], groupSpec: [string, string | undefined][] = []) {
  const objects: Record<string, Node> = {};
  const order: string[] = [];
  for (const [id, parentId] of nodeSpec) {
    objects[id] = parentId ? { id, parentId } : { id };
    order.push(id);
  }
  const groups: Record<string, GroupRecord> = {};
  for (const [id, parentId] of groupSpec) groups[id] = parentId ? { id, parentId } : { id };
  return { objects: objects as NodeTable, order, groups: groups as Groups };
}

const parents = (objects: NodeTable) => Object.values(objects).map((n) => n.parentId);

describe('canonicalGroups: flat-model documents', () => {
  it('reads a bare shared parentId as a top-level group', () => {
    const w = world([['a', 'legacy'], ['b', 'legacy'], ['c', undefined]]);
    const groups = canonicalGroups(w.groups, parents(w.objects));
    expect(groups).toEqual({ legacy: { id: 'legacy' } });
    // Clicking a member selects the whole flat group, as it always did.
    expect(selectionWithin(w.order, w.objects, groups, 'a', null)).toEqual(['a', 'b']);
  });

  it('lets a flat group be nested by Group like any other', () => {
    const w = world([['a', 'legacy'], ['b', 'legacy'], ['c', undefined]]);
    const groups = canonicalGroups(w.groups, parents(w.objects));
    const plan = planGroup(w.order, w.objects, groups, ['a', 'b', 'c'], 'outer')!;
    expect(plan.groups).toEqual([{ id: 'legacy', parentId: 'outer' }]);
    expect(plan.nodes).toEqual([{ id: 'c', parentId: 'outer' }]);
  });

  it('is unchanged, by reference, when nothing needs repair', () => {
    const w = world([['a', 'g']], [['g', undefined]]);
    expect(canonicalGroups(w.groups, parents(w.objects))).toBe(w.groups);
  });

  it('is idempotent', () => {
    const w = world([['a', 'x'], ['b', 'y']], [['y', 'gone'], ['p', 'q'], ['q', 'p']]);
    const once = canonicalGroups(w.groups, parents(w.objects));
    const twice = canonicalGroups(once, parents(w.objects));
    expect(twice).toBe(once);
    expect(groupRepairs(once, twice)).toEqual([]);
  });
});

describe('canonicalGroups: damage a merge can leave', () => {
  it('clears a parent that no longer exists', () => {
    const w = world([['a', 'g']], [['g', 'deleted']]);
    expect(canonicalGroups(w.groups, parents(w.objects)).g).toEqual({ id: 'g' });
  });

  it('breaks a loop at its smallest id, whatever order it is walked in', () => {
    const w = world([['a', 'b2']], [['c3', 'a1'], ['a1', 'b2'], ['b2', 'c3']]);
    const fixed = canonicalGroups(w.groups, parents(w.objects));
    expect(fixed.a1).toEqual({ id: 'a1' });
    expect(fixed.b2.parentId).toBe('c3');
    expect(fixed.c3.parentId).toBe('a1');
  });

  it('writes only what differs', () => {
    const w = world([['a', 'legacy'], ['b', 'g']], [['g', undefined]]);
    const repairs = groupRepairs(w.groups, canonicalGroups(w.groups, parents(w.objects)));
    expect(repairs).toEqual([{ id: 'legacy' }]);
  });
});

/** Two peers on real Yjs documents, writing plans the way `applyGroupPlan` does. */
function peers() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.clientID = 1;
  b.clientID = 2;
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  };
  return { a, b, sync };
}

function write(d: Y.Doc, plan: GroupPlan) {
  const groups = d.getMap<GroupRecord>('groups');
  const objects = d.getMap<Node>('objects');
  d.transact(() => {
    if (plan.create) groups.set(plan.create.id, plan.create);
    for (const { id, parentId } of plan.groups) {
      const rec: GroupRecord = { ...(groups.get(id) ?? { id }) };
      if (parentId) rec.parentId = parentId;
      else delete rec.parentId;
      groups.set(id, rec);
    }
    for (const { id, parentId } of plan.nodes) objects.set(id, parentId ? { id, parentId } : { id });
    for (const id of plan.remove) groups.delete(id);
  });
}

function read(d: Y.Doc) {
  const objects = Object.fromEntries(d.getMap<Node>('objects').entries()) as NodeTable;
  const stored = Object.fromEntries(d.getMap<GroupRecord>('groups').entries()) as Groups;
  return { objects, order: Object.keys(objects).sort(), stored };
}

/** What an editor's upkeep does after a merge: canonicalise and write the difference. */
function repair(d: Y.Doc) {
  const { objects, stored } = read(d);
  const fixes = groupRepairs(stored, canonicalGroups(stored, parents(objects)));
  d.transact(() => fixes.forEach((r) => d.getMap<GroupRecord>('groups').set(r.id, r)));
  return fixes.length;
}

describe('concurrent edits', () => {
  it('converges when two people nest two groups inside each other', () => {
    const { a, b, sync } = peers();
    write(a, {
      create: { id: 'g1' },
      nodes: [{ id: 'n1', parentId: 'g1' }, { id: 'n2', parentId: 'g1' }],
      groups: [],
      remove: [],
    });
    write(a, {
      create: { id: 'g2' },
      nodes: [{ id: 'n3', parentId: 'g2' }, { id: 'n4', parentId: 'g2' }],
      groups: [],
      remove: [],
    });
    sync();

    write(a, { nodes: [], groups: [{ id: 'g1', parentId: 'g2' }], remove: [] });
    write(b, { nodes: [], groups: [{ id: 'g2', parentId: 'g1' }], remove: [] });
    sync();

    // Both repair at once, as two editors might.
    repair(a);
    repair(b);
    sync();

    const ra = read(a);
    const rb = read(b);
    expect(ra.stored).toEqual(rb.stored);
    expect(ra.stored.g1).toEqual({ id: 'g1' });
    expect(ra.stored.g2).toEqual({ id: 'g2', parentId: 'g1' });
    expect(canonicalGroups(ra.stored, parents(ra.objects))).toBe(ra.stored);
    expect(nodesInGroup(ra.order, ra.objects, ra.stored, 'g1')).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('keeps a member that joined a group someone else was ungrouping', () => {
    const { a, b, sync } = peers();
    write(a, {
      create: { id: 'g' },
      nodes: [{ id: 'n1', parentId: 'g' }, { id: 'n2', parentId: 'g' }],
      groups: [],
      remove: [],
    });
    write(a, { nodes: [{ id: 'n3', parentId: undefined }], groups: [], remove: [] });
    sync();

    const ra = read(a);
    write(a, planUngroup(ra.order, ra.objects, ra.stored, 'g')!);
    write(b, { nodes: [{ id: 'n3', parentId: 'g' }], groups: [], remove: [] });
    sync();

    // The record is gone but n3 still names it: it reads as a group of one,
    // rather than n3 pointing at nothing.
    const merged = read(a);
    expect(merged.stored.g).toBeUndefined();
    expect(canonicalGroups(merged.stored, parents(merged.objects)).g).toEqual({ id: 'g' });
    expect(repair(a)).toBe(1);
    expect(repair(a)).toBe(0);
  });

  it('migrates a flat document identically from two editors at once', () => {
    const { a, b, sync } = peers();
    write(a, { nodes: [{ id: 'n1', parentId: 'flat' }, { id: 'n2', parentId: 'flat' }], groups: [], remove: [] });
    sync();
    expect(repair(a)).toBe(1);
    expect(repair(b)).toBe(1);
    sync();
    expect(read(a).stored).toEqual({ flat: { id: 'flat' } });
    expect(read(b).stored).toEqual(read(a).stored);
  });
});

describe('ungroup acts on the level selected', () => {
  // outer > inner > {a, b}; outer > c
  const w = world([['a', 'inner'], ['b', 'inner'], ['c', 'outer']], [['outer', undefined], ['inner', 'outer']]);

  it('opens the outer group when the whole assembly is selected', () => {
    expect(groupsToUngroup(w.order, w.objects, w.groups, ['a', 'b', 'c'])).toEqual(['outer']);
  });

  it('opens only the inner group when that is what is selected', () => {
    expect(groupsToUngroup(w.order, w.objects, w.groups, ['a', 'b'])).toEqual(['inner']);
    const plan = planUngroup(w.order, w.objects, w.groups, 'inner')!;
    expect(plan.nodes).toEqual([{ id: 'a', parentId: 'outer' }, { id: 'b', parentId: 'outer' }]);
  });

  it('opens nothing for one object deep-selected out of a group', () => {
    expect(groupsToUngroup(w.order, w.objects, w.groups, ['a'])).toEqual([]);
  });
});

describe('Escape climbs one level', () => {
  const w = world([['a', 'inner'], ['b', 'inner'], ['c', 'outer'], ['d', undefined]], [['outer', undefined], ['inner', 'outer']]);

  it('selects the group holding a deep-selected object', () => {
    expect(escapeTarget(w.order, w.objects, w.groups, ['a'], null)).toEqual({ select: ['a', 'b'], entered: 'outer' });
  });

  it('selects the parent of a selected child group and steps out to its parent', () => {
    expect(escapeTarget(w.order, w.objects, w.groups, ['a', 'b'], 'outer')).toEqual({
      select: ['a', 'b', 'c'],
      entered: null,
    });
  });

  it('selects the entered group when nothing is selected', () => {
    expect(escapeTarget(w.order, w.objects, w.groups, [], 'inner')).toEqual({ select: ['a', 'b'], entered: 'outer' });
  });

  it('has nowhere to go from a whole top-level group or a loose object', () => {
    expect(escapeTarget(w.order, w.objects, w.groups, ['a', 'b', 'c'], null)).toBeNull();
    expect(escapeTarget(w.order, w.objects, w.groups, ['d'], null)).toBeNull();
  });

  it('round-trips with entering: double-click in, Escape out', () => {
    // Entered "outer", a click on a resolves to the inner group…
    expect(selectionWithin(w.order, w.objects, w.groups, 'a', 'outer')).toEqual(['a', 'b']);
    // …and Escape from there returns the whole assembly at the top.
    expect(escapeTarget(w.order, w.objects, w.groups, ['a', 'b'], 'outer')?.select).toEqual(['a', 'b', 'c']);
  });
});
