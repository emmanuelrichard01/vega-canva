import { describe, expect, it } from 'vitest';
import { normalizeNode } from '../document/normalize';
import type { AnyNode } from '../model/schema';
import type { NodePatch } from '../model/selection';
import { distributeSpacing, measureSpacing } from '../model/align';
import { arrangeUnits } from './units';
import {
  alignSelectionPatches,
  combineAvailability,
  currentSpacing,
  planAlign,
  planDistribute,
  planMatchSize,
  planSpacing,
  planTidy,
  sharedFrame,
  summarizeStyle,
  tidyShape,
  isPlan,
  type Plan,
} from './plans';
import { guessGrid, layoutGrid, moveInOrder, slotAt } from './grid';

const box = (id: string, x: number, y: number, w = 100, h = 60, extra: Record<string, unknown> = {}): AnyNode =>
  normalizeNode({ id, type: 'shape', x, y, width: w, height: h, geometry: { kind: 'rect' }, ...extra });

const table = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n]));

/** Positions after a plan, by id. */
function after(nodes: AnyNode[], plan: Plan | NodePatch[]): Map<string, AnyNode> {
  const patches = Array.isArray(plan) ? plan : isPlan(plan) ? plan.patches : [];
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));
  for (const p of patches) Object.assign(byId.get(p.id)!, p.changes);
  return byId as Map<string, AnyNode>;
}

const unitsOf = (nodes: AnyNode[], groups = {}) => arrangeUnits(nodes, table(nodes), groups).units;

describe('align', () => {
  const nodes = [box('a', 0, 0, 100), box('b', 40, 100, 50), box('c', 300, 220, 80)];

  it('lines up with the selection: left edges meet the leftmost', () => {
    const moved = after(nodes, planAlign({ units: unitsOf(nodes), target: 'selection' }, 'left'));
    expect([...moved.values()].map((n) => n.x)).toEqual([0, 0, 0]);
  });

  it('lines up with a key object, which holds still', () => {
    const plan = planAlign({ units: unitsOf(nodes), target: 'key', keyKey: 'b' }, 'right');
    const moved = after(nodes, plan);
    expect(moved.get('b')!.x).toBe(40);
    // Right edges at b's right edge, 90.
    expect(moved.get('a')!.x + 100).toBe(90);
    expect(moved.get('c')!.x + 80).toBe(90);
    expect(isPlan(plan) && plan.patches.some((p) => p.id === 'b')).toBe(false);
  });

  it('lines up with the frame they share, even for one object', () => {
    const frame = normalizeNode({ id: 'f', type: 'frame', x: -50, y: -50, width: 800, height: 600 });
    const inside = [box('a', 0, 0, 100, 60, { frameId: 'f' })];
    const all = { ...table(inside), f: frame };
    const units = arrangeUnits(inside, all).units;
    const plan = planAlign({ units, target: 'frame', frame: sharedFrame(units, all) }, 'bottom');
    expect(after(inside, plan).get('a')!.y).toBe(-50 + 600 - 60);
  });

  it('refuses the frame target when they are not in one frame, and says so', () => {
    const units = unitsOf(nodes);
    const plan = planAlign({ units, target: 'frame', frame: sharedFrame(units, table(nodes)) }, 'left');
    expect(isPlan(plan)).toBe(false);
    expect('reason' in plan && plan.reason).toMatch(/frame/);
  });

  it('moves a whole group as one: its members keep their layout', () => {
    const groups = { g: { id: 'g' } };
    const members = [box('m1', 200, 0, 40, 40, { parentId: 'g' }), box('m2', 260, 30, 40, 40, { parentId: 'g' })];
    const loose = box('z', 0, 300, 100, 60);
    const all = [...members, loose];
    const units = arrangeUnits(all, table(all), groups).units;
    expect(units.map((u) => u.key).sort()).toEqual(['g', 'z']);
    const moved = after(all, planAlign({ units, target: 'selection' }, 'left'));
    expect(moved.get('m1')!.x).toBe(0);
    expect(moved.get('m2')!.x).toBe(60);
    expect(moved.get('z')!.x).toBe(0);
  });

  it('gives the context menu the same group-aware answer', () => {
    const groups = { g: { id: 'g' } };
    const members = [box('m1', 200, 0, 40, 40, { parentId: 'g' }), box('m2', 260, 30, 40, 40, { parentId: 'g' })];
    const all = [...members, box('z', 0, 300)];
    const moved = after(all, alignSelectionPatches(all, table(all), groups, 'left'));
    expect(moved.get('m2')!.x - moved.get('m1')!.x).toBe(60);
  });

  it('treats part of a group as loose objects', () => {
    const groups = { g: { id: 'g' } };
    const a = box('a', 0, 0, 40, 40, { parentId: 'g' });
    const b = box('b', 100, 0, 40, 40, { parentId: 'g' });
    const c = box('c', 200, 0, 40, 40, { parentId: 'g' });
    const units = arrangeUnits([a, b], table([a, b, c]), groups).units;
    expect(units.map((u) => u.key)).toEqual(['a', 'b']);
  });

  it('leaves locked objects and connectors out, and counts the locked', () => {
    const locked = box('l', 500, 500, 10, 10, { locked: true });
    const wire = normalizeNode({ id: 'w', type: 'connector', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    const set = arrangeUnits([...nodes, locked, wire], table([...nodes, locked, wire]));
    expect(set.units.map((u) => u.key)).toEqual(['a', 'b', 'c']);
    expect(set.locked).toBe(1);
  });
});

describe('distribute', () => {
  it('evens the gaps between the outermost two, which hold still', () => {
    const nodes = [box('a', 0, 0, 100), box('b', 130, 0, 100), box('c', 400, 0, 100)];
    const moved = after(nodes, planDistribute(unitsOf(nodes), 'horizontal'));
    expect(moved.get('a')!.x).toBe(0);
    expect(moved.get('c')!.x).toBe(400);
    expect(moved.get('b')!.x).toBe(200);
  });

  it('needs three objects', () => {
    const nodes = [box('a', 0, 0), box('b', 300, 0)];
    expect(isPlan(planDistribute(unitsOf(nodes), 'horizontal'))).toBe(false);
  });

  it('sets one exact gap, laid out from the first', () => {
    const nodes = [box('a', 0, 0, 100), box('b', 130, 20, 50), box('c', 400, 0, 100)];
    const moved = after(nodes, planSpacing(unitsOf(nodes), 'horizontal', 16));
    expect(moved.get('a')!.x).toBe(0);
    expect(moved.get('b')!.x).toBe(116);
    expect(moved.get('c')!.x).toBe(182);
    // The cross axis is left alone.
    expect(moved.get('b')!.y).toBe(20);
  });

  it('spaces off the key object when one is the anchor', () => {
    const nodes = [box('a', 0, 0, 100), box('b', 300, 0, 100), box('c', 600, 0, 100)];
    const moved = after(nodes, distributeSpacing(nodes, 'horizontal', 10, 'b'));
    expect(moved.get('b')!.x).toBe(300);
    expect(moved.get('a')!.x).toBe(190);
    expect(moved.get('c')!.x).toBe(410);
  });

  it('reads the shared gap, and Mixed when it differs', () => {
    const even = [box('a', 0, 0, 100), box('b', 124, 0, 100), box('c', 248, 0, 100)];
    expect(currentSpacing(unitsOf(even), 'horizontal')).toBe(24);
    const uneven = [box('a', 0, 0, 100), box('b', 124, 0, 100), box('c', 300, 0, 100)];
    expect(measureSpacing(uneven, 'horizontal')).toBeNull();
  });
});

describe('tidy', () => {
  it('reads a row, a column and a grid', () => {
    expect(tidyShape(unitsOf([box('a', 0, 0), box('b', 130, 6), box('c', 270, -4)])).kind).toBe('row');
    expect(tidyShape(unitsOf([box('a', 0, 0), box('b', 4, 90), box('c', -3, 190)])).kind).toBe('column');
    const grid = tidyShape(unitsOf([box('a', 0, 0), box('b', 130, 0), box('c', 0, 100), box('d', 130, 100)]));
    expect(grid).toEqual({ kind: 'grid', rows: 2, columns: 2 });
  });

  it('is a no-op on a selection that is already tidy', () => {
    const tidy = [box('a', 0, 0), box('b', 124, 0), box('c', 248, 0)];
    const plan = planTidy(unitsOf(tidy));
    expect(isPlan(plan) && plan.patches).toEqual([]);
  });
});

describe('live grid layout', () => {
  const items = [
    { key: 'a', width: 100, height: 50 },
    { key: 'b', width: 60, height: 80 },
    { key: 'c', width: 120, height: 40 },
    { key: 'd', width: 40, height: 40 },
  ];

  it('sizes each column to its widest and each row to its tallest', () => {
    const layout = layoutGrid(items, { columns: 2, colGap: 10, rowGap: 20, alignX: 'start', alignY: 'start' }, { x: 0, y: 0 });
    expect(layout.colWidths).toEqual([120, 60]);
    expect(layout.rowHeights).toEqual([80, 40]);
    expect(layout.colX).toEqual([0, 130]);
    expect(layout.rowY).toEqual([0, 100]);
    expect(layout.cells.map((c) => [c.place.x, c.place.y])).toEqual([[0, 0], [130, 0], [0, 100], [130, 100]]);
  });

  it('places each item inside its cell by the chosen alignment', () => {
    const layout = layoutGrid(items, { columns: 2, colGap: 0, rowGap: 0, alignX: 'center', alignY: 'end' }, { x: 0, y: 0 });
    // a: 100 wide in a 120 column, 50 tall in an 80 row.
    expect(layout.cells[0].place).toMatchObject({ x: 10, y: 30 });
  });

  it('keeps columns between one and the item count', () => {
    expect(layoutGrid(items, { columns: 99, colGap: 0, rowGap: 0, alignX: 'start', alignY: 'start' }, { x: 0, y: 0 }).columns).toBe(4);
    expect(layoutGrid(items, { columns: 0, colGap: -5, rowGap: 0, alignX: 'start', alignY: 'start' }, { x: 0, y: 0 }).columns).toBe(1);
  });

  it('reads the grid a selection is already trying to be', () => {
    const boxes = [
      { key: 'd', box: { x: 132, y: 98, width: 100, height: 60 } },
      { key: 'a', box: { x: 0, y: 0, width: 100, height: 60 } },
      { key: 'c', box: { x: 2, y: 100, width: 100, height: 60 } },
      { key: 'b', box: { x: 130, y: 3, width: 100, height: 60 } },
    ];
    const guess = guessGrid(boxes);
    expect(guess.spec.columns).toBe(2);
    expect(guess.order).toEqual(['a', 'b', 'c', 'd']);
    expect(guess.spec.colGap).toBe(30);
    expect(guess.origin).toEqual({ x: 0, y: 0 });
  });

  it('reorders by moving one item, the rest closing up', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInOrder(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });

  it('finds the slot under a point, or the nearest one', () => {
    const layout = layoutGrid(items, { columns: 2, colGap: 10, rowGap: 20, alignX: 'start', alignY: 'start' }, { x: 0, y: 0 });
    expect(slotAt(layout, { x: 140, y: 110 })).toBe(3);
    expect(slotAt(layout, { x: -500, y: -500 })).toBe(0);
  });
});

describe('match size', () => {
  it('matches the largest, keeping each top-left', () => {
    const nodes = [box('a', 0, 0, 100, 40), box('b', 200, 0, 60, 90)];
    const moved = after(nodes, planMatchSize(unitsOf(nodes), 'width'));
    expect(moved.get('b')!.width).toBe(100);
    expect(moved.get('b')!.height).toBe(90);
    expect(moved.get('b')!.x).toBe(200);
  });

  it('matches the key when there is one, through the scale', () => {
    const nodes = [box('a', 0, 0, 100, 40), box('b', 200, 0, 50, 90, { scaleX: 2 })];
    const moved = after(nodes, planMatchSize(unitsOf(nodes), 'both', 'a'));
    expect(moved.get('b')!.width).toBe(50);
    expect(moved.get('b')!.height).toBe(40);
  });

  it('leaves groups out and says why when nothing is left', () => {
    const groups = { g: { id: 'g' } };
    const members = [box('m1', 0, 0, 40, 40, { parentId: 'g' }), box('m2', 60, 0, 40, 40, { parentId: 'g' })];
    const one = box('z', 200, 0);
    const units = arrangeUnits([...members, one], table([...members, one]), groups).units;
    const plan = planMatchSize(units, 'width');
    expect(isPlan(plan)).toBe(false);
    expect('reason' in plan && plan.reason).toMatch(/Groups/);
  });
});

describe('combine availability', () => {
  it('offers Combine for shapes and paths alone', () => {
    expect(combineAvailability([box('a', 0, 0), box('b', 50, 0)])).toEqual({ offer: true, reason: null });
  });

  it('shows it off with the reason when a note is in the selection', () => {
    const note = normalizeNode({ id: 'n', type: 'sticky', text: 'Idea' });
    const result = combineAvailability([box('a', 0, 0), box('b', 50, 0), note]);
    expect(result.offer).toBe(true);
    expect(result.reason).toBe("The note can't be combined. Select only shapes and paths.");
    const two = combineAvailability([box('a', 0, 0), box('b', 50, 0), note, { ...note, id: 'n2' } as AnyNode]);
    expect(two.reason).toBe("Notes can't be combined. Select only shapes and paths.");
  });

  it('is not offered without two shapes to combine', () => {
    const note = normalizeNode({ id: 'n', type: 'sticky', text: 'Idea' });
    expect(combineAvailability([box('a', 0, 0), note]).offer).toBe(false);
  });
});

describe('style summary', () => {
  it('says one value, Mixed, or nothing', () => {
    const red = { appearance: { fill: [{ type: 'solid', color: '#ff0000' }], stroke: { color: '#000', width: 2 } } };
    const same = summarizeStyle([box('a', 0, 0, 10, 10, red), box('b', 0, 0, 10, 10, red)]);
    expect(same.fill).toEqual({ state: 'one', color: '#ff0000' });
    expect(same.stroke).toMatchObject({ state: 'one', width: 2 });
    const blue = { appearance: { fill: [{ type: 'solid', color: '#0000ff' }] }, opacity: 0.5 };
    const mixed = summarizeStyle([box('a', 0, 0, 10, 10, red), box('b', 0, 0, 10, 10, blue)]);
    expect(mixed.fill.state).toBe('mixed');
    expect(mixed.opacity.state).toBe('mixed');
    const note = normalizeNode({ id: 'n', type: 'sticky', text: 'Idea' });
    expect(summarizeStyle([note]).fill.state).toBe('na');
  });
});
