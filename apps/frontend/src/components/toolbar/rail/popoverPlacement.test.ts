import { describe, expect, it } from 'vitest';
import type { Bounds, Rect } from '../../../engine/interaction/railPlacement';
import { LIVE_HALO, POPOVER_HALO, overlapArea, placeRailPopover, type PopoverPlacementInput } from './popoverPlacement';

/** A 1440 × 900 window, closed columns, the art dock's 211px band at the bottom. */
const ROOM: Bounds = { top: 8, left: 8, right: 1432, bottom: 900 - 211 - 8 };
/** About the Align panel's size. */
const PANEL = { width: 268, height: 330 };

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });
const rectOf = (spot: ReturnType<typeof placeRailPopover>, panel = PANEL): Rect => ({
  x: spot.x,
  y: spot.y,
  width: panel.width,
  height: spot.maxHeight ?? panel.height,
});
const inside = (r: Rect, b: Bounds) => r.x >= b.left && r.y >= b.top && r.x + r.width <= b.right && r.y + r.height <= b.bottom;

/** A rail centred above (or below) the subject, with its first button as the trigger. */
function railFor(subject: Rect, side: 'top' | 'bottom', width = 360): Pick<PopoverPlacementInput, 'rail' | 'trigger' | 'railSide'> {
  const x = subject.x + subject.width / 2 - width / 2;
  const y = side === 'top' ? subject.y - 26 - 40 : subject.y + subject.height + 34;
  return { rail: { x, y, width, height: 40 }, trigger: { x: x + 40, y: y + 4, width: 32, height: 32 }, railSide: side };
}

const place = (subject: Rect, side: 'top' | 'bottom', extra: Partial<PopoverPlacementInput> = {}) =>
  placeRailPopover({ ...railFor(subject, side), align: 'start', panel: PANEL, subject, bounds: ROOM, ...extra });

describe('placeRailPopover', () => {
  it('opens upward when the rail is above the selection', () => {
    const subject = { x: 500, y: 420, width: 400, height: 220 };
    const spot = place(subject, 'top');
    expect(spot.side).toBe('top');
    expect(spot.covers).toBe(0);
    const { rail } = railFor(subject, 'top');
    expect(rectOf(spot).y + PANEL.height).toBeLessThanOrEqual(rail.y);
  });

  it('opens downward when the rail is below the selection', () => {
    const subject = { x: 500, y: 20, width: 400, height: 180 };
    const spot = place(subject, 'bottom');
    expect(spot.side).toBe('bottom');
    expect(overlapArea(rectOf(spot), grow(subject, POPOVER_HALO))).toBe(0);
  });

  it('stands beside the selection, level with the rail, when the far side is full', () => {
    // The rail fits above (66px) but a 330px panel does not.
    const subject = { x: 500, y: 150, width: 400, height: 220 };
    const { rail } = railFor(subject, 'top');
    const spot = place(subject, 'top');
    expect(spot.side).toBe('right');
    expect(spot.y).toBe(rail.y);
    expect(spot.maxHeight).toBeUndefined();
    expect(overlapArea(rectOf(spot), grow(subject, POPOVER_HALO))).toBe(0);
    expect(overlapArea(rectOf(spot), rail)).toBe(0);
  });

  it('takes the left when the right is against the panel', () => {
    const subject = { x: 1000, y: 150, width: 380, height: 220 };
    const spot = place(subject, 'top');
    expect(spot.side).toBe('left');
    expect(spot.covers).toBe(0);
    expect(inside(rectOf(spot), ROOM)).toBe(true);
  });

  it('clears a rail wider than the selection, not only the selection', () => {
    const subject = { x: 600, y: 150, width: 120, height: 120 };
    const { rail } = railFor(subject, 'top', 420);
    const spot = place(subject, 'top', { rail });
    expect(spot.side === 'left' || spot.side === 'right').toBe(true);
    expect(overlapArea(rectOf(spot), rail)).toBe(0);
  });

  it('covers as little as possible when nothing is clear', () => {
    // Fills the board apart from a band on the right.
    const subject = { x: 40, y: 30, width: 1260, height: 640 };
    const rail = { x: 500, y: 16, width: 360, height: 40 };
    const spot = placeRailPopover({
      rail,
      railSide: 'top',
      trigger: { x: 540, y: 20, width: 32, height: 32 },
      align: 'start',
      panel: PANEL,
      subject,
      bounds: ROOM,
    });
    const r = rectOf(spot);
    expect(inside(r, ROOM)).toBe(true);
    expect(spot.side).toBe('right');
    expect(overlapArea(r, rail)).toBe(0);
    // It is over the work, but less of it than hanging off the rail would be.
    expect(spot.covers).toBeGreaterThan(0);
    expect(spot.covers).toBeLessThan(PANEL.width * PANEL.height);
  });

  it('would rather cover a corner of the selection than its own rail', () => {
    // A selection filling the board, the rail under it, the dock close below.
    const subject = { x: 54, y: 34, width: 1272, height: 572 };
    const rail = { x: 508, y: 640, width: 364, height: 40 };
    const spot = placeRailPopover({
      rail,
      railSide: 'bottom',
      trigger: { x: 790, y: 644, width: 32, height: 32 },
      align: 'start',
      panel: { width: 268, height: 235 },
      subject,
      bounds: { top: 30, left: 8, right: 1408, bottom: 724 },
      halo: LIVE_HALO,
    });
    expect(overlapArea(rectOf(spot, { width: 268, height: 235 }), rail)).toBe(0);
    expect(spot.covers).toBeGreaterThan(0);
  });

  it('stays inside the insets and above the dock', () => {
    const room: Bounds = { top: 24, left: 300, right: 1440 - 260 - 8, bottom: 900 - 211 - 8 };
    // Below the selection and close to the dock: no room downward.
    const subject = { x: 320, y: 300, width: 300, height: 260 };
    const spot = place(subject, 'bottom', { bounds: room });
    expect(inside(rectOf(spot), room)).toBe(true);
    expect(spot.covers).toBe(0);
    // A hanging panel whose button is near the right column slides back inside.
    const hang = placeRailPopover({
      rail: { x: 900, y: 400, width: 300, height: 40 },
      railSide: 'top',
      trigger: { x: 1150, y: 404, width: 32, height: 32 },
      align: 'start',
      panel: PANEL,
      subject: { x: 950, y: 466, width: 200, height: 100 },
      bounds: room,
    });
    expect(hang.side).toBe('top');
    expect(hang.x + PANEL.width).toBeLessThanOrEqual(room.right);
  });

  it('keeps off the board pills', () => {
    const subject = { x: 60, y: 420, width: 300, height: 200 };
    const pill = { x: 0, y: 0, width: 420, height: 60 };
    const spot = place(subject, 'top', { obstacles: [pill] });
    expect(overlapArea(rectOf(spot), pill)).toBe(0);
    expect(spot.covers).toBe(0);
  });

  it('keeps the wider halo clear for a panel that previews on the board', () => {
    // The rail stands 18px right of the selection; a panel hung below it is
    // clear of the ordinary halo but inside the live one.
    const subject = { x: 300, y: 200, width: 300, height: 400 };
    const rail = { x: 618, y: 380, width: 300, height: 40 };
    const input: PopoverPlacementInput = {
      rail,
      railSide: 'right',
      trigger: { x: 618, y: 384, width: 32, height: 32 },
      align: 'start',
      panel: PANEL,
      subject,
      bounds: ROOM,
    };
    // Ordinary: it hangs off the rail.
    const plain = placeRailPopover({ ...input, halo: POPOVER_HALO });
    expect(['top', 'bottom']).toContain(plain.side);
    expect(plain.x).toBe(618);
    // Live: hanging would graze the halo, so it goes out past the rail.
    const live = placeRailPopover({ ...input, halo: LIVE_HALO });
    expect(live.side).toBe('right');
    expect(overlapArea(rectOf(live), grow(subject, LIVE_HALO))).toBe(0);
  });

  it('holds a side that still works until the preferred one has room to spare', () => {
    // The space above the rail is 10px more than the panel needs.
    const subject = { x: 500, y: 400, width: 400, height: 200 };
    const { rail } = railFor(subject, 'top');
    const bounds = { ...ROOM, top: rail.y - 6 - PANEL.height - 10 };
    expect(place(subject, 'top', { bounds }).side).toBe('top');
    expect(place(subject, 'top', { bounds, previous: 'right' }).side).toBe('right');
    const roomy = { ...ROOM, top: rail.y - 6 - PANEL.height - 40 };
    expect(place(subject, 'top', { bounds: roomy, previous: 'right' }).side).toBe('top');
  });

  it('leaves a side that no longer works at once', () => {
    const subject = { x: 1000, y: 150, width: 380, height: 220 };
    expect(place(subject, 'top', { previous: 'right' }).side).toBe('left');
  });

  it('hangs off its button when there is no selection', () => {
    const rail = { x: 100, y: 200, width: 200, height: 40 };
    const spot = placeRailPopover({
      rail,
      railSide: 'bottom',
      trigger: { x: 100, y: 204, width: 32, height: 32 },
      align: 'start',
      panel: PANEL,
      subject: null,
      bounds: ROOM,
    });
    expect(spot).toMatchObject({ side: 'bottom', x: 100, y: 246, covers: 0 });
  });
});
