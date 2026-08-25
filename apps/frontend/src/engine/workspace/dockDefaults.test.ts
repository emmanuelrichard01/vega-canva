import { beforeEach, describe, expect, it } from 'vitest';
import { dockDefaults } from './dockDefaults';
import { DEFAULT_LAYOUT, SEPARATOR, type DockLayout } from './dockLayout';

/** An arrangement somebody put work into, for reset to destroy. */
const custom: DockLayout = {
  order: ['forces', 'select', SEPARATOR, 'hand', 'draw'],
  hidden: ['type', 'eraser'],
};

beforeEach(() => {
  // Back to a known state without going through `reset`, which is what several
  // of these are testing.
  dockDefaults.set(DEFAULT_LAYOUT);
});

describe('dockDefaults', () => {
  it('normalises whatever it is handed', () => {
    dockDefaults.set({ order: ['select', 'select', 'nonsense'] as never, hidden: [] });
    const { order } = dockDefaults.getSnapshot();
    expect(order.filter((i) => i === 'select')).toHaveLength(1);
    expect(order).not.toContain('nonsense');
  });

  it('hands back the same reference until something changes', () => {
    // The `useSyncExternalStore` contract: a fresh object for an unchanged
    // value is a render for a change that did not happen.
    expect(dockDefaults.getSnapshot()).toBe(dockDefaults.getSnapshot());
  });
});

describe('undoing a reset', () => {
  it('offers nothing to undo until a reset happens', () => {
    dockDefaults.set(custom);
    expect(dockDefaults.canUndo()).toBe(false);
  });

  it('puts back exactly what the reset threw away', () => {
    dockDefaults.set(custom);
    const before = dockDefaults.getSnapshot();

    dockDefaults.reset();
    expect(dockDefaults.getSnapshot().order).toEqual(DEFAULT_LAYOUT.order);
    expect(dockDefaults.canUndo()).toBe(true);

    dockDefaults.undoReset();
    expect(dockDefaults.getSnapshot()).toEqual(before);
  });

  /**
   * The rule that keeps the offer honest.
   *
   * Once you have started rearranging again, "undo the reset" has no single
   * meaning — taking it would restore a layout you had already moved on from,
   * discarding the newer edit to recover an older one. Better to stop offering.
   */
  it('withdraws the offer as soon as you edit again', () => {
    dockDefaults.set(custom);
    dockDefaults.reset();
    expect(dockDefaults.canUndo()).toBe(true);

    dockDefaults.set({ order: ['hand', 'select'] as never, hidden: [] });
    expect(dockDefaults.canUndo()).toBe(false);
  });

  it('is spent once used, so a second undo cannot re-apply it', () => {
    dockDefaults.set(custom);
    dockDefaults.reset();
    dockDefaults.undoReset();
    expect(dockDefaults.canUndo()).toBe(false);

    const settled = dockDefaults.getSnapshot();
    dockDefaults.undoReset();
    expect(dockDefaults.getSnapshot()).toBe(settled);
  });

  it('does nothing when there is nothing stashed', () => {
    const before = dockDefaults.getSnapshot();
    dockDefaults.undoReset();
    expect(dockDefaults.getSnapshot()).toBe(before);
  });
});
