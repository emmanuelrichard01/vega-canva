import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../engine/document/mutations', async (load) => ({
  ...(await load<typeof import('../../engine/document/mutations')>()),
  applyNodePatches: vi.fn(),
}));
vi.mock('../../engine/table/tableApply', async (load) => ({
  ...(await load<typeof import('../../engine/table/tableApply')>()),
  updateTable: vi.fn(),
}));

import { useStore } from '../../hooks/useStore';
import { applyNodePatches } from '../../engine/document/mutations';
import { updateTable } from '../../engine/table/tableApply';
import { setRoomRole } from '../../engine/model/permissions';
import { defaultTableSpec, normalizeTableSpec, type TableSpec } from '../../engine/table/tableTypes';
import { setCell } from '../../engine/table/tableModel';
import { anchoredLink, planWriteBack } from '../../engine/chart/chartFromTable';
import type { ChartSpec, ChartTableLink } from '../../engine/chart/chartTypes';
import type { AnyNode } from '../../engine/model/schema';
import {
  chartsReading,
  ensureTableRegistry,
  lastPulse,
  namedRanges,
  orphanedCharts,
  subscribePulses,
} from '../../engine/table/tableRegistry';
import { commitWriteBack, setChartLink } from './dataActions';

function table(rows: string[][]): TableSpec {
  let t = normalizeTableSpec(defaultTableSpec(rows.length, rows[0].length));
  rows.forEach((row, r) => row.forEach((text, c) => (t = setCell(t, r, c, text))));
  return t;
}

const months = table([
  ['Month', 'Sales'],
  ['Jan', '10'],
  ['Feb', '20'],
  ['Mar', '30'],
]);

const box = { x: 0, y: 0, width: 300, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1 };
const tableNodeOf = (id: string, spec: TableSpec, extra: object = {}) => ({ ...box, id, type: 'table', table: spec, ...extra }) as unknown as AnyNode;
const chartNodeOf = (id: string, chart: ChartSpec) => ({ ...box, id, type: 'chart', chart }) as unknown as AnyNode;

/** Write nodes to the store the way the document bridge does: with the change set. */
function put(nodes: AnyNode[], removed: string[] = []): void {
  const objects = { ...useStore.getState().objects };
  removed.forEach((id) => delete objects[id]);
  nodes.forEach((n) => (objects[n.id] = n));
  useStore.setState({ objects, lastChangedIds: nodes.map((n) => n.id), lastRemovedIds: removed });
}

const whole = anchoredLink(months, 'sales', { r0: 0, c0: 0, r1: 3, c1: 1 });
const named = { ...whole, name: 'Sales by month' };
const chart = (link: ChartTableLink = named): ChartSpec => ({ kind: 'bar', categories: [], series: [], link });

describe('the board index of tables and the charts reading them', () => {
  beforeEach(() => {
    useStore.setState({ objects: {}, lastChangedIds: [], lastRemovedIds: [] });
    ensureTableRegistry();
    put([tableNodeOf('sales', months), chartNodeOf('c1', chart()), chartNodeOf('c2', chart()), chartNodeOf('c3', chart(whole))]);
  });

  it('knows which charts read a table, and the named ranges they share', () => {
    expect(chartsReading('sales')).toEqual(['c1', 'c2', 'c3']);
    expect(namedRanges('sales')).toEqual([expect.objectContaining({ name: 'Sales by month', charts: ['c1', 'c2'] })]);
  });

  it('pulses the charts of a table whose cells changed, and not of one that only moved', () => {
    const heard: string[][] = [];
    const stop = subscribePulses((ids) => heard.push(ids));
    put([tableNodeOf('sales', months, { x: 50 })]);
    expect(heard).toEqual([]);
    put([tableNodeOf('sales', setCell(months, 1, 1, '11'))]);
    expect(heard).toEqual([['c1', 'c2', 'c3']]);
    expect(lastPulse('c1')).toBeGreaterThan(0);
    stop();
  });

  it('finds the charts left behind when their table is deleted', () => {
    put([], ['sales']);
    expect(orphanedCharts().sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('moves every chart sharing a named range when one of them moves it', () => {
    setRoomRole('editor');
    vi.mocked(applyNodePatches).mockClear();
    setChartLink('c1', chart(), anchoredLink(months, 'sales', { r0: 0, c0: 0, r1: 2, c1: 1 }, { name: 'Sales by month' }));
    const patches = vi.mocked(applyNodePatches).mock.calls[0][0];
    expect(patches.map((p) => p.id)).toEqual(['c1', 'c2']);
    const moved = (patches[1].changes.chart as ChartSpec).link!;
    expect(moved.r1).toBe(2);
    expect((patches[1].changes.chart as ChartSpec).categories).toEqual(['Jan', 'Feb']);
  });

  it('writes nothing for a viewer', () => {
    setRoomRole('viewer');
    vi.mocked(applyNodePatches).mockClear();
    setChartLink('c1', chart(), whole);
    expect(applyNodePatches).not.toHaveBeenCalled();
    setRoomRole('editor');
  });
});

describe('writing a value back, after confirming', () => {
  beforeEach(() => {
    useStore.setState({ objects: {}, lastChangedIds: [], lastRemovedIds: [] });
    put([tableNodeOf('sales', months)]);
    vi.mocked(updateTable).mockClear();
    setRoomRole('editor');
  });

  it('writes the confirmed cell, as one table edit', () => {
    const plan = planWriteBack(months, whole, 0, 1, 25);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.cell).toBe('B3');
    expect(commitWriteBack('sales', plan)).toBe(true);
    const written = vi.mocked(updateTable).mock.calls[0][1];
    expect(written.cells[2][1]).toBe('25');
  });

  it('writes nothing when the cell changed after the plan was shown', () => {
    const plan = planWriteBack(months, whole, 0, 1, 25);
    if (!plan.ok) throw new Error(plan.reason);
    put([tableNodeOf('sales', setCell(months, 2, 1, '21'))]);
    expect(commitWriteBack('sales', plan)).toBe(false);
    expect(updateTable).not.toHaveBeenCalled();
  });

  it('writes nothing for a commenter', () => {
    const plan = planWriteBack(months, whole, 0, 1, 25);
    if (!plan.ok) throw new Error(plan.reason);
    setRoomRole('commenter');
    expect(commitWriteBack('sales', plan)).toBe(false);
    expect(updateTable).not.toHaveBeenCalled();
    setRoomRole('editor');
  });
});
