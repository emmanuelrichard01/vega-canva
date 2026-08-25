import { describe, expect, it } from 'vitest';
import {
  addSeparator,
  DEFAULT_LAYOUT,
  DOCK_SEATS,
  hideSeat,
  isDefaultLayout,
  moveItem,
  normalizeLayout,
  removeAt,
  SEPARATOR,
  showSeat,
  type DockLayout,
} from './dockLayout';

const layout = (over: Partial<DockLayout> = {}): DockLayout => ({
  order: ['select', 'hand', SEPARATOR, 'draw'],
  hidden: [],
  ...over,
});

describe('DEFAULT_LAYOUT', () => {
  it('accounts for every tool exactly once, on the dock or in the drawer', () => {
    // Counted across both lists: one seat starts put away, and a tool that
    // appeared in neither would be unreachable rather than merely absent.
    const seats = [...DEFAULT_LAYOUT.order.filter((i) => i !== SEPARATOR), ...DEFAULT_LAYOUT.hidden];
    expect(new Set(seats).size).toBe(seats.length);
    expect(seats.length).toBe(DOCK_SEATS.length);
  });

  it('starts with the text block put away, to keep the dock on one row', () => {
    expect(DEFAULT_LAYOUT.hidden).toEqual(['block']);
    expect(DEFAULT_LAYOUT.order).not.toContain('block');
  });

  it('survives its own normalizer unchanged', () => {
    // If the default needed repairing it would not be a default, it would be a
    // suggestion — and the reset button would produce something else.
    expect(normalizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });
});

describe('normalizeLayout', () => {
  it('gives a full dock for nothing at all', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nonsense')).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout({ order: 'not an array' })).toEqual(DEFAULT_LAYOUT);
  });

  it('drops tools that no longer exist', () => {
    // A layout written by an older build. The seat is gone from the app, and a
    // hole in the dock is worse than a shorter dock.
    const { order } = normalizeLayout({ order: ['select', 'telekinesis', 'hand'], hidden: [] });
    expect(order.slice(0, 2)).toEqual(['select', 'hand']);
    expect(order).not.toContain('telekinesis');
  });

  it('keeps a duplicated seat once, at its first position', () => {
    // Two buttons with one id is two React keys the same and two claims on one
    // keyboard shortcut.
    const { order } = normalizeLayout({ order: ['hand', 'select', 'hand'], hidden: [] });
    expect(order.filter((i) => i === 'hand')).toHaveLength(1);
    expect(order[0]).toBe('hand');
  });

  /**
   * The rule that makes the whole feature safe to keep.
   *
   * Treating an unmentioned seat as hidden would silently withhold every tool
   * added after today from exactly the people most engaged with the app — the
   * ones who rearranged their dock.
   */
  it('appends a seat the stored layout never heard of, visible', () => {
    const { order, hidden } = normalizeLayout({ order: ['select'], hidden: ['hand'] });
    expect(order[0]).toBe('select');
    expect(hidden).toEqual(['hand']);
    for (const seat of DOCK_SEATS) {
      if (seat === 'hand') continue;
      expect(order).toContain(seat);
    }
  });

  it('never leaves a separator with nothing on one side', () => {
    const { order } = normalizeLayout({
      order: [SEPARATOR, 'select', SEPARATOR, SEPARATOR, 'hand'],
      hidden: [],
    });
    expect(order[0]).not.toBe(SEPARATOR);
    expect(order[order.length - 1]).not.toBe(SEPARATOR);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i] === SEPARATOR && order[i - 1] === SEPARATOR).toBe(false);
    }
  });

  it('will not let a seat be visible and hidden at once', () => {
    const { order, hidden } = normalizeLayout({ order: ['select'], hidden: ['select'] });
    expect(order).toContain('select');
    expect(hidden).not.toContain('select');
  });
});

describe('moveItem', () => {
  it('reads the target index against the list without the item in it', () => {
    /**
     * The property that makes a drag land where the indicator was drawn.
     * Splicing in before removing would shift everything after the source by
     * one, so a rightward drag would come up a seat short — the classic
     * off-by-one that makes a reorder feel unpredictable rather than broken.
     */
    expect(moveItem(['a', 'b', 'c', 'd'] as never, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'] as never, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('clamps a target past either end', () => {
    expect(moveItem(['a', 'b'] as never, 0, 99)).toEqual(['b', 'a']);
    expect(moveItem(['a', 'b'] as never, 1, -5)).toEqual(['b', 'a']);
  });

  it('leaves the list alone for an index that is not in it', () => {
    expect(moveItem(['a', 'b'] as never, 7, 0)).toEqual(['a', 'b']);
  });
});

describe('hideSeat and showSeat', () => {
  it('moves a seat into the drawer and back', () => {
    const away = hideSeat(layout(), 'hand');
    expect(away.order).not.toContain('hand');
    expect(away.hidden).toEqual(['hand']);

    const back = showSeat(away, 'hand', 0);
    expect(back.order[0]).toBe('hand');
    expect(back.hidden).toEqual([]);
  });

  it('tidies a separator left stranded by a hide', () => {
    const away = hideSeat({ order: ['select', SEPARATOR, 'draw'], hidden: [] }, 'draw');
    expect(away.order).toEqual(['select']);
  });

  it('is a no-op for a seat already where it is asked to go', () => {
    // Returning the same reference matters: these feed a `useSyncExternalStore`
    // snapshot, and a fresh object for a change that did not happen is a render
    // for a change that did not happen.
    const away = hideSeat(layout(), 'hand');
    expect(hideSeat(away, 'hand')).toBe(away);

    const onDock = layout();
    expect(showSeat(onDock, 'hand')).toBe(onDock);
  });
});

describe('addSeparator and removeAt', () => {
  it('drops a rule in at the index asked for', () => {
    const next = addSeparator({ order: ['select', 'hand'], hidden: [] }, 1);
    expect(next.order).toEqual(['select', SEPARATOR, 'hand']);
  });

  it('refuses to stack two rules together', () => {
    const next = addSeparator({ order: ['select', SEPARATOR, 'hand'], hidden: [] }, 2);
    expect(next.order).toEqual(['select', SEPARATOR, 'hand']);
  });

  it('deletes a separator outright but only puts a seat away', () => {
    // A rule in a drawer is not something anyone would go looking for, and
    // another one is one click away.
    const dropped = removeAt({ order: ['select', SEPARATOR, 'hand'], hidden: [] }, 1);
    expect(dropped.order).toEqual(['select', 'hand']);
    expect(dropped.hidden).toEqual([]);

    const stowed = removeAt({ order: ['select', 'hand'], hidden: [] }, 1);
    expect(stowed.order).toEqual(['select']);
    expect(stowed.hidden).toEqual(['hand']);
  });

  it('ignores an index off the end', () => {
    const start = layout();
    expect(removeAt(start, 99)).toBe(start);
  });
});

describe('isDefaultLayout', () => {
  it('recognises the arrangement everyone starts with', () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
  });

  it('sees a different hidden set, even with the order untouched', () => {
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, hidden: [] })).toBe(false);
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, hidden: ['block', 'hand'] })).toBe(false);
  });

  it('sees a reorder', () => {
    expect(isDefaultLayout(normalizeLayout({ order: ['hand', 'select'], hidden: [] }))).toBe(false);
  });
});
