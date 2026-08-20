import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  childGroups,
  commonAncestor,
  emptyGroups,
  isDescendantGroup,
  nodesInGroup,
  planGroup,
  planUngroup,
  remapGroups,
  rootGroupOf,
  selectionForNode,
  selectionWithin,
  groupToEnter,
  selectionUnits,
  wouldCycle,
  type GroupRecord,
  type Groups,
  type NodeTable,
} from './groupTree';

/**
 * Groups that contain groups.
 *
 * The behaviour worth pinning hardest is `planGroup`: grouping a selection
 * that happens to *be* a whole group must nest that group rather than scatter
 * its members into a new one. That is the difference between a hierarchy and a
 * flat list with indentation, and it is the thing the previous model could not
 * express at all.
 */

function world(
  nodeSpec: [string, string | undefined][],
  groupSpec: [string, string | undefined][] = []
) {
  const objects: Record<string, { id: string; parentId?: string }> = {};
  const order: string[] = [];
  for (const [id, parentId] of nodeSpec) {
    objects[id] = { id, parentId };
    order.push(id);
  }
  const groups: Record<string, GroupRecord> = {};
  for (const [id, parentId] of groupSpec) groups[id] = { id, parentId };
  return { objects: objects as NodeTable, order, groups: groups as Groups };
}

describe('ancestry', () => {
  it('walks up from a nested group, nearest first', () => {
    const { groups } = world([], [['inner', 'mid'], ['mid', 'outer'], ['outer', undefined]]);
    expect(ancestorsOf(groups, 'inner')).toEqual(['mid', 'outer']);
    expect(rootGroupOf(groups, 'inner')).toBe('outer');
  });

  it('says a top-level group is its own root', () => {
    const { groups } = world([], [['g', undefined]]);
    expect(rootGroupOf(groups, 'g')).toBe('g');
    expect(ancestorsOf(groups, 'g')).toEqual([]);
  });

  it('does not hang on a cycle', () => {
    // Not reachable through the UI, but a concurrently merged document is not
    // bound by that, and a cycle here would freeze the tab.
    const groups = { a: { id: 'a', parentId: 'b' }, b: { id: 'b', parentId: 'a' } } as Groups;
    expect(ancestorsOf(groups, 'a').length).toBeLessThanOrEqual(2);
  });

  it('refuses a reparent that would close a loop', () => {
    const { groups } = world([], [['inner', 'outer'], ['outer', undefined]]);
    expect(wouldCycle(groups, 'outer', 'inner')).toBe(true);
    expect(wouldCycle(groups, 'outer', 'outer')).toBe(true);
    expect(wouldCycle(groups, 'inner', undefined)).toBe(false);
    expect(wouldCycle(groups, 'outer', undefined)).toBe(false);
  });

  it('finds children one level down only', () => {
    const { groups } = world([], [['a', undefined], ['b', 'a'], ['c', 'b']]);
    expect(childGroups(groups, 'a')).toEqual(['b']);
    expect(childGroups(groups, undefined)).toEqual(['a']);
  });
});

describe('nodesInGroup', () => {
  it('reaches every depth', () => {
    const { order, objects, groups } = world(
      [['n1', 'outer'], ['n2', 'inner'], ['n3', undefined]],
      [['outer', undefined], ['inner', 'outer']]
    );
    expect(nodesInGroup(order, objects, groups, 'outer')).toEqual(['n1', 'n2']);
    expect(nodesInGroup(order, objects, groups, 'inner')).toEqual(['n2']);
  });

  it('keeps the order it was given', () => {
    const { order, objects, groups } = world(
      [['a', 'g'], ['b', undefined], ['c', 'g']],
      [['g', undefined]]
    );
    expect(nodesInGroup(order, objects, groups, 'g')).toEqual(['a', 'c']);
  });
});

describe('commonAncestor', () => {
  it('is the shared folder when everything is in one', () => {
    const { groups } = world([], [['g', undefined]]);
    expect(commonAncestor(groups, ['g', 'g'])).toBe('g');
  });

  it('comes out to the level that holds both', () => {
    const { groups } = world([], [['outer', undefined], ['a', 'outer'], ['b', 'outer']]);
    expect(commonAncestor(groups, ['a', 'b'])).toBe('outer');
  });

  it('is the root when one of them is loose', () => {
    const { groups } = world([], [['g', undefined]]);
    expect(commonAncestor(groups, ['g', undefined])).toBeUndefined();
  });
});

describe('selectionUnits', () => {
  it('promotes a wholly selected group to a unit', () => {
    const { order, objects, groups } = world(
      [['a', 'g'], ['b', 'g'], ['loose', undefined]],
      [['g', undefined]]
    );
    const units = selectionUnits(order, objects, groups, ['a', 'b', 'loose']);
    expect(units.groups).toEqual(['g']);
    expect(units.nodes).toEqual(['loose']);
  });

  it('leaves a partly selected group as loose nodes', () => {
    // Selecting some of a folder's contents means exactly what it says.
    const { order, objects, groups } = world(
      [['a', 'g'], ['b', 'g'], ['c', 'g']],
      [['g', undefined]]
    );
    const units = selectionUnits(order, objects, groups, ['a', 'b']);
    expect(units.groups).toEqual([]);
    expect(units.nodes.sort()).toEqual(['a', 'b']);
  });

  it('climbs as far as the selection is whole', () => {
    const { order, objects, groups } = world(
      [['a', 'inner'], ['b', 'outer']],
      [['outer', undefined], ['inner', 'outer']]
    );
    const units = selectionUnits(order, objects, groups, ['a', 'b']);
    expect(units.groups).toEqual(['outer']);
  });

  it('does not report a group its own ancestor already carries', () => {
    const { order, objects, groups } = world(
      [['a', 'inner'], ['b', 'inner']],
      [['outer', undefined], ['inner', 'outer']]
    );
    const units = selectionUnits(order, objects, groups, ['a', 'b']);
    // Both `inner` and `outer` are wholly selected; only the outer is a unit.
    expect(units.groups).toEqual(['outer']);
  });
});

describe('planGroup', () => {
  it('nests a whole group instead of scattering it', () => {
    // The case the flat model destroyed: grouping a group with something else
    // used to rewrite both sets of members to one id and lose the inner one.
    const { order, objects, groups } = world(
      [['a', 'g'], ['b', 'g'], ['loose', undefined]],
      [['g', undefined]]
    );
    const plan = planGroup(order, objects, groups, ['a', 'b', 'loose'], 'new')!;
    expect(plan.create).toEqual({ id: 'new', parentId: undefined });
    expect(plan.groups).toEqual([{ id: 'g', parentId: 'new' }]);
    expect(plan.nodes).toEqual([{ id: 'loose', parentId: 'new' }]);
    // `a` and `b` keep their membership of `g`, which keeps moving with them.
    expect(plan.nodes.some((n) => n.id === 'a' || n.id === 'b')).toBe(false);
  });

  it('puts the new group where the things it holds already lived', () => {
    const { order, objects, groups } = world(
      [['a', 'outer'], ['b', 'outer'], ['c', 'outer']],
      [['outer', undefined]]
    );
    const plan = planGroup(order, objects, groups, ['a', 'b'], 'new')!;
    expect(plan.create?.parentId).toBe('outer');
  });

  it('comes out to the root when the selection crosses two folders', () => {
    const { order, objects, groups } = world(
      [['a', 'g1'], ['b', 'g2']],
      [['g1', undefined], ['g2', undefined]]
    );
    const plan = planGroup(order, objects, groups, ['a', 'b'], 'new')!;
    expect(plan.create?.parentId).toBeUndefined();
  });

  it('declines to wrap a single thing', () => {
    // A folder around one object adds a level and changes nothing.
    const { order, objects, groups } = world([['a', undefined]]);
    expect(planGroup(order, objects, groups, ['a'], 'new')).toBeNull();
  });

  it('declines when the selection is already exactly one group', () => {
    const { order, objects, groups } = world([['a', 'g'], ['b', 'g']], [['g', undefined]]);
    expect(planGroup(order, objects, groups, ['a', 'b'], 'new')).toBeNull();
  });
});

describe('planUngroup', () => {
  it('lifts contents to where the group was', () => {
    const { order, objects, groups } = world(
      [['a', 'inner'], ['b', 'outer']],
      [['outer', undefined], ['inner', 'outer']]
    );
    const plan = planUngroup(order, objects, groups, 'outer')!;
    expect(plan.nodes).toEqual([{ id: 'b', parentId: undefined }]);
    expect(plan.groups).toEqual([{ id: 'inner', parentId: undefined }]);
    expect(plan.remove).toEqual(['outer']);
  });

  it('undoes one level, not all of them', () => {
    // `inner` survives; pressing Ungroup again is what takes it apart.
    const { order, objects, groups } = world(
      [['a', 'inner']],
      [['outer', undefined], ['inner', 'outer']]
    );
    const plan = planUngroup(order, objects, groups, 'outer')!;
    expect(plan.remove).toEqual(['outer']);
    expect(plan.nodes).toEqual([]);
  });
});

describe('emptyGroups', () => {
  it('finds a folder whose last member was deleted', () => {
    const { order, objects, groups } = world([['a', undefined]], [['g', undefined]]);
    expect(emptyGroups(order, objects, groups)).toEqual(['g']);
  });

  it('finds a folder that holds only empty folders', () => {
    // One pass would leave the parent behind, still drawn and still selectable.
    const { order, objects, groups } = world([], [['outer', undefined], ['inner', 'outer']]);
    expect(emptyGroups(order, objects, groups).sort()).toEqual(['inner', 'outer']);
  });

  it('leaves a folder that still holds something', () => {
    const { order, objects, groups } = world([['a', 'inner']], [['outer', undefined], ['inner', 'outer']]);
    expect(emptyGroups(order, objects, groups)).toEqual([]);
  });
});

describe('selectionForNode', () => {
  it('selects the outermost assembly, not the innermost folder', () => {
    const { order, objects, groups } = world(
      [['a', 'inner'], ['b', 'outer'], ['c', undefined]],
      [['outer', undefined], ['inner', 'outer']]
    );
    expect(selectionForNode(order, objects, groups, 'a')).toEqual(['a', 'b']);
  });

  it('resolves one level finer for each step entered', () => {
    const { order, objects, groups } = world(
      [['a', 'inner'], ['b', 'outer']],
      [['outer', undefined], ['inner', 'outer']]
    );
    expect(selectionForNode(order, objects, groups, 'a', 1)).toEqual(['a']);
  });

  it('is just the node when it is in no group', () => {
    const { order, objects, groups } = world([['a', undefined]]);
    expect(selectionForNode(order, objects, groups, 'a')).toEqual(['a']);
  });
});

describe('remapGroups', () => {
  it('keeps the nesting inside a copied fragment', () => {
    const { groups } = world([], [['outer', undefined], ['inner', 'outer']]);
    const { records, mapping } = remapGroups(groups, ['inner'], (id) => `${id}-copy`);
    const inner = records.find((r) => r.id === mapping.get('inner'))!;
    // The copy's inner folder points at the *copy's* outer one, not the
    // original's — otherwise the two fragments would share structure.
    expect(inner.parentId).toBe(mapping.get('outer'));
  });

  it('brings an ancestor along even when only a child was named', () => {
    const { groups } = world([], [['outer', undefined], ['inner', 'outer']]);
    const { records } = remapGroups(groups, ['inner'], (id) => `${id}-copy`);
    expect(records).toHaveLength(2);
  });

  it('drops a parent that was not part of the fragment', () => {
    const groups = { g: { id: 'g', parentId: 'not-copied' } } as Groups;
    const { records } = remapGroups(groups, ['g'], (id) => `${id}-copy`);
    expect(records[0].parentId).toBeUndefined();
  });
});

describe('isDescendantGroup', () => {
  it('answers at any depth', () => {
    const { groups } = world([], [['a', undefined], ['b', 'a'], ['c', 'b']]);
    expect(isDescendantGroup(groups, 'c', 'a')).toBe(true);
    expect(isDescendantGroup(groups, 'a', 'c')).toBe(false);
  });
});

describe('entering a group', () => {
  const nest = () =>
    world(
      [['a', 'inner'], ['b', 'outer'], ['c', undefined]],
      [['outer', undefined], ['inner', 'outer']]
    );

  it('selects the outermost assembly before anything is entered', () => {
    const { order, objects, groups } = nest();
    expect(selectionWithin(order, objects, groups, 'a', null)).toEqual(['a', 'b']);
  });

  it('resolves one level finer once inside', () => {
    const { order, objects, groups } = nest();
    expect(selectionWithin(order, objects, groups, 'a', 'outer')).toEqual(['a']);
  });

  it('starts over when you click something outside what you entered', () => {
    // What keeps the mode from being sticky: you leave by clicking away.
    const { order, objects, groups } = nest();
    expect(selectionWithin(order, objects, groups, 'a', 'somewhere-else')).toEqual(['a', 'b']);
  });

  it('reports where a step would land, and when there is nowhere further', () => {
    const { objects, groups } = nest();
    expect(groupToEnter(objects, groups, 'a', null)).toBe('outer');
    expect(groupToEnter(objects, groups, 'a', 'outer')).toBe('inner');
    expect(groupToEnter(objects, groups, 'a', 'inner')).toBeNull();
    expect(groupToEnter(objects, groups, 'c', null)).toBeNull();
  });
});
