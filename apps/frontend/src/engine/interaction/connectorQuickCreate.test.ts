import { describe, expect, it } from 'vitest';
import {
  QUICK_GAP,
  flowSide,
  previousInChain,
  quickCreatePlacement,
  quickCreateTabAllowed,
  trackBoardFocus,
  type TabContext,
} from './connectorQuickCreate';
import type { AnyNode } from '../model/schema';

const rect = (x: number, y: number, w = 100, h = 60) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });

describe('quickCreatePlacement', () => {
  const source = rect(0, 0);

  it('puts the copy a gap away on the chosen side, centred, when that side is free', () => {
    expect(quickCreatePlacement(source, 'right', 100, 60, [])).toEqual({ x: 100 + QUICK_GAP, y: 0 });
    expect(quickCreatePlacement(source, 'bottom', 100, 60, [])).toEqual({ x: 0, y: 60 + QUICK_GAP });
    expect(quickCreatePlacement(source, 'left', 100, 60, [])).toEqual({ x: -QUICK_GAP - 100, y: 0 });
    expect(quickCreatePlacement(source, 'top', 100, 60, [])).toEqual({ x: 0, y: -QUICK_GAP - 60 });
  });

  it('slides sideways to the nearest free spot when the first one is taken', () => {
    const taken = rect(180, 0);
    const p = quickCreatePlacement(source, 'right', 100, 60, [taken]);
    expect(p.x).toBe(180);
    expect(p.y).not.toBe(0);
    const box = rect(p.x, p.y);
    expect(box.minY >= taken.maxY || box.maxY <= taken.minY).toBe(true);
  });

  it('moves a ring further out when the whole column is full', () => {
    const wall = rect(150, -2000, 200, 4000);
    const p = quickCreatePlacement(source, 'right', 100, 60, [wall]);
    expect(p.x).toBeGreaterThan(wall.maxX);
  });
});

describe('the chain Tab builds', () => {
  const shape = (id: string, x: number, y: number) =>
    ({ id, type: 'shape', x, y, width: 100, height: 60, geometry: { kind: 'rect' } }) as unknown as AnyNode;
  const link = (id: string, from: string, to: string) =>
    ({ id, type: 'connector', from: { nodeId: from }, to: { nodeId: to }, routing: 'orthogonal' }) as unknown as AnyNode;

  it('grows away from whatever leads in, and to the right when nothing does', () => {
    const objects = { a: shape('a', 0, 0), b: shape('b', 0, 200), c: link('c', 'a', 'b') };
    expect(flowSide(objects, 'a')).toBe('right');
    expect(flowSide(objects, 'b')).toBe('bottom');
  });

  it('steps back to the object that leads in', () => {
    const objects = { a: shape('a', 0, 0), b: shape('b', 200, 0), c: link('c', 'a', 'b') };
    expect(previousInChain(objects, 'b')).toBe('a');
    expect(previousInChain(objects, 'a')).toBeNull();
  });
});

describe('Tab for quick-create', () => {
  const body = { tag: 'body' } as unknown as Element;
  const board = { tag: 'stage' } as unknown as Element;
  const chrome = { tag: 'button' } as unknown as Element;
  const ctx = (over: Partial<TabContext>): TabContext => ({
    active: body,
    activeInBoard: false,
    boardFocused: false,
    body,
    canEdit: true,
    busy: false,
    ...over,
  });

  it('fires when the stage or canvas holds focus', () => {
    expect(quickCreateTabAllowed(ctx({ active: board, activeInBoard: true }))).toBe(true);
  });

  it('fires on the body only after a press on the board', () => {
    expect(quickCreateTabAllowed(ctx({ boardFocused: true }))).toBe(true);
    // Focus fell to the body after clicking chrome: Tab stays the page's.
    expect(quickCreateTabAllowed(ctx({ boardFocused: false }))).toBe(false);
  });

  it('never takes Tab from a focused control off the board', () => {
    expect(quickCreateTabAllowed(ctx({ active: chrome, boardFocused: true }))).toBe(false);
  });

  it('never fires for someone who cannot edit, or while typing or in a dialog', () => {
    expect(quickCreateTabAllowed(ctx({ active: board, activeInBoard: true, canEdit: false }))).toBe(false);
    expect(quickCreateTabAllowed(ctx({ boardFocused: true, canEdit: false }))).toBe(false);
    expect(quickCreateTabAllowed(ctx({ active: board, activeInBoard: true, busy: true }))).toBe(false);
  });

  it('tracks board focus from presses and focus moves', () => {
    // A window stand-in: capture listeners by type, called with the event's target.
    const listeners = new Map<string, Set<(e: Event) => void>>();
    const target = {
      addEventListener: (type: string, fn: (e: Event) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (e: Event) => void) => listeners.get(type)?.delete(fn),
    } as unknown as EventTarget;
    const stageNode = { name: 'stage' } as unknown as EventTarget;
    const toolbar = { name: 'toolbar' } as unknown as EventTarget;
    const bodyNode = { name: 'body' } as unknown as EventTarget;
    const tracker = trackBoardFocus(target, (n) => n === stageNode, () => bodyNode);
    const fire = (type: string, at: EventTarget) => {
      for (const fn of listeners.get(type) ?? []) fn({ type, target: at } as unknown as Event);
    };
    expect(tracker.focused()).toBe(false);
    fire('pointerdown', stageNode);
    expect(tracker.focused()).toBe(true);
    // Focus landing on the body (the board is not focusable) keeps it.
    fire('focusin', bodyNode);
    expect(tracker.focused()).toBe(true);
    fire('pointerdown', toolbar);
    expect(tracker.focused()).toBe(false);
    fire('pointerdown', stageNode);
    fire('focusin', toolbar);
    expect(tracker.focused()).toBe(false);
    tracker.dispose();
    fire('pointerdown', stageNode);
    expect(tracker.focused()).toBe(false);
  });
});
