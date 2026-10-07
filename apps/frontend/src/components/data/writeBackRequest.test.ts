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
import { updateTable } from '../../engine/table/tableApply';
import { setRoomRole } from '../../engine/model/permissions';
import { defaultTableSpec, normalizeTableSpec, type TableSpec } from '../../engine/table/tableTypes';
import { setCell } from '../../engine/table/tableModel';
import { anchoredLink } from '../../engine/chart/chartFromTable';
import { ensureTableRegistry } from '../../engine/table/tableRegistry';
import type { AnyNode } from '../../engine/model/schema';
import { cancelWriteBack, confirmWriteBack, pendingWriteBack, proposeWriteBack } from './writeBackRequest';

function table(rows: string[][]): TableSpec {
  let t = normalizeTableSpec(defaultTableSpec(rows.length, rows[0].length));
  rows.forEach((row, r) => row.forEach((text, c) => (t = setCell(t, r, c, text))));
  return t;
}

const months = table([
  ['Month', 'Sales'],
  ['Jan', '10'],
  ['Feb', '=B2*2'],
  ['Mar', '30'],
]);
const box = { x: 0, y: 0, width: 300, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1 };
const link = anchoredLink(months, 'sales', { r0: 0, c0: 0, r1: 3, c1: 1 });

describe('a value dragged on a linked chart', () => {
  beforeEach(() => {
    vi.mocked(updateTable).mockClear();
    cancelWriteBack();
    setRoomRole('editor');
    useStore.setState({ objects: {}, lastChangedIds: [], lastRemovedIds: [] });
    ensureTableRegistry();
    const node = { ...box, id: 'sales', type: 'table', table: months } as unknown as AnyNode;
    useStore.setState({ objects: { sales: node }, lastChangedIds: ['sales'], lastRemovedIds: [] });
  });

  it('asks before writing, and writes the confirmed cell once', () => {
    expect(proposeWriteBack(link, 0, 0, 25)).toBe(true);
    expect(pendingWriteBack()?.plan).toMatchObject({ cell: 'B2', before: '10', after: '25' });
    expect(updateTable).not.toHaveBeenCalled();
    expect(confirmWriteBack()).toBe(true);
    expect(updateTable).toHaveBeenCalledTimes(1);
    expect(pendingWriteBack()).toBeNull();
    expect(confirmWriteBack()).toBe(false);
  });

  it('writes nothing when the question is dismissed', () => {
    proposeWriteBack(link, 0, 0, 25);
    cancelWriteBack();
    expect(pendingWriteBack()).toBeNull();
    expect(updateTable).not.toHaveBeenCalled();
  });

  it('refuses a formula cell without asking', () => {
    expect(proposeWriteBack(link, 0, 1, 99)).toBe(false);
    expect(pendingWriteBack()).toBeNull();
  });

  it('does not ask a viewer or a commenter', () => {
    for (const role of ['viewer', 'commenter'] as const) {
      setRoomRole(role);
      expect(proposeWriteBack(link, 0, 0, 25)).toBe(false);
      expect(pendingWriteBack()).toBeNull();
    }
  });
});
