import { describe, expect, it } from 'vitest';
import { diffFrames } from './diff';
import { planRestore, planSize } from './restorePlan';
import {
  groupSessions,
  momentsTouching,
  namesLabel,
  sessionLabel,
  sessionOf,
  stepSession,
} from './sessions';
import { densityColumns, layoutTrack, nearestMoment, sparklinePath } from './trackLayout';
import type { Moment } from './sessionTimeline';

const MIN = 60_000;

function moment(at: number, over: Partial<Moment> = {}): Moment {
  return {
    index: 0,
    firstIndex: 0,
    at,
    firstAt: at,
    kind: 'move',
    ids: ['a'],
    authorId: '1',
    authorName: 'Ana',
    authorColor: '#f00',
    label: 'Ana moved a',
    updateCount: 1,
    ...over,
  };
}

describe('sessions', () => {
  const moments = [
    moment(0),
    moment(1 * MIN, { authorId: '2', authorName: 'Ben' }),
    moment(2 * MIN),
    moment(60 * MIN, { ids: ['b'] }),
    moment(61 * MIN),
  ];

  it('groups moments by pauses, with who worked in each', () => {
    const sessions = groupSessions(moments, 20 * MIN);
    expect(sessions.map((s) => [s.first, s.last])).toEqual([[0, 2], [3, 4]]);
    expect(sessions[0].authors.map((a) => a.name)).toEqual(['Ana', 'Ben']);
    expect(sessionOf(sessions, 4)).toBe(1);
  });

  it('steps a session at a time, going to the start first from midway', () => {
    const sessions = groupSessions(moments, 20 * MIN);
    expect(stepSession(sessions, 0, 1)).toBe(2);
    expect(stepSession(sessions, 2, 1)).toBe(4);
    expect(stepSession(sessions, 4, 1)).toBe(4);
    expect(stepSession(sessions, 4, -1)).toBe(3);
    expect(stepSession(sessions, 3, -1)).toBe(2);
    expect(stepSession(sessions, 0, -1)).toBe(0);
  });

  it('labels a session by day and clock range', () => {
    const now = new Date(2026, 9, 7, 18, 0).getTime();
    const start = new Date(2026, 9, 7, 10, 42).getTime();
    const end = new Date(2026, 9, 7, 11, 30).getTime();
    expect(sessionLabel(start, end, now)).toMatch(/^Today, .*10.42.*11.30/);
    expect(sessionLabel(start - 86_400_000, end - 86_400_000, now)).toMatch(/^Yesterday, /);
    expect(namesLabel([{ name: 'Ana' }, { name: 'Ben' }, { name: 'Cy' }, { name: 'Di' }])).toBe('Ana, Ben and 2 others');
  });

  it('filters the timeline to the moments that touched one object', () => {
    expect(momentsTouching(moments, 'b')).toEqual([3]);
  });
});

describe('track layout', () => {
  const moments = [moment(0), moment(10 * MIN), moment(100 * MIN), moment(101 * MIN)];
  const sessions = groupSessions(moments, 20 * MIN);

  it('draws each session to scale and cuts out the idle gap', () => {
    const layout = layoutTrack(moments, sessions, { gap: 0.02, minShare: 0.05 });
    const [a, b] = layout.segments;
    expect(a.x0).toBe(0);
    expect(b.x1).toBeCloseTo(1);
    expect(b.x0 - a.x1).toBeCloseTo(0.02);
    // The ten-minute session is wider than the one-minute one.
    expect(a.x1 - a.x0).toBeGreaterThan(b.x1 - b.x0);
    // Ascending, so the playhead can binary search.
    for (let i = 1; i < layout.xs.length; i++) expect(layout.xs[i]).toBeGreaterThanOrEqual(layout.xs[i - 1]);
  });

  it('finds the nearest moment, optionally among a filtered set', () => {
    const layout = layoutTrack(moments, sessions);
    expect(nearestMoment(layout, 0)).toBe(0);
    expect(nearestMoment(layout, 1)).toBe(3);
    expect(nearestMoment(layout, 0.99, [0, 1])).toBe(1);
    expect(nearestMoment(layout, 0.5, [])).toBe(-1);
  });

  it('measures density across the track and draws it as a closed area', () => {
    const layout = layoutTrack(moments, sessions);
    const cols = densityColumns(moments, layout, 10);
    expect(Math.max(...cols)).toBe(1);
    expect(sparklinePath(cols, 100, 20)).toMatch(/^M0 20 .* Z$/);
  });
});

describe('diff highlighting', () => {
  const base = { a: { x: 1, updatedAt: 1 }, b: { x: 1 }, c: { x: 1 } };
  const target = { a: { x: 1, updatedAt: 99 }, b: { x: 2 }, d: { x: 1 } };

  it('sorts objects into added, removed and modified, ignoring bookkeeping', () => {
    expect(diffFrames(base, target)).toEqual({ added: ['d'], removed: ['c'], modified: ['b'] });
  });

  it('can be restricted to one object', () => {
    expect(diffFrames(base, target, new Set(['b']))).toEqual({ added: [], removed: [], modified: ['b'] });
  });
});

describe('restore plan', () => {
  it('turns the live board into the version without touching provenance or reactions', () => {
    const live = {
      a: { type: 'sticky', x: 5, createdBy: 'me', reactions: { '👍': ['1'] }, updatedAt: 9 },
      extra: { type: 'sticky', x: 0 },
    };
    const version = {
      objects: {
        a: { type: 'sticky', x: 1, createdBy: 'them', updatedAt: 1, parentId: 'g1' },
        gone: { type: 'text', x: 2, parentId: 'g1' },
      },
      groups: { g1: { id: 'g1', parentId: 'g0' }, g0: { id: 'g0' } },
    };
    const plan = planRestore(live, version, {});
    expect(plan.remove).toEqual(['extra']);
    expect(plan.create).toEqual([{ type: 'text', x: 2, parentId: 'g1', id: 'gone' }]);
    expect(plan.patch).toEqual([{ id: 'a', changes: { x: 1, parentId: 'g1' } }]);
    // Ancestors first, so a child group never points at one not yet created.
    expect(plan.groups.map((g) => g.id)).toEqual(['g0', 'g1']);
  });

  it('restores one object when asked to', () => {
    const plan = planRestore({ a: { x: 5 }, b: { x: 5 } }, { objects: { a: { x: 1 }, b: { x: 1 } }, groups: {} }, {}, new Set(['a']));
    expect(plan.patch).toEqual([{ id: 'a', changes: { x: 1 } }]);
    expect(planSize(plan)).toBe(1);
  });

  it('diffs a table separately from its other fields', () => {
    const plan = planRestore(
      { t: { type: 'table', table: { cells: [['x']] } } },
      { objects: { t: { type: 'table', table: { cells: [['y']] } } }, groups: {} },
      {}
    );
    expect(plan.patch).toEqual([]);
    expect(plan.tables).toHaveLength(1);
  });
});
