import { describe, it, expect, beforeEach, vi } from 'vitest';
import { finishCreation, isLockable, isSpringable, SPRING_MS, toolModes } from './toolModes';

describe('toolModes', () => {
  let dispatched: string[] = [];

  beforeEach(() => {
    toolModes.reset();
    dispatched = [];
    (globalThis as any).window = {
      dispatchEvent: vi.fn((event: CustomEvent<string>) => {
        dispatched.push(event.detail);
        return true;
      }),
    };
    (globalThis as any).CustomEvent = class<T> {
      type: string;
      detail: T;
      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  });

  describe('keeping a tool armed', () => {
    it('hands the board back to Select when nothing is kept', () => {
      toolModes.syncActive('sticky');
      finishCreation();
      expect(dispatched).toEqual(['select']);
    });

    it('keeps a locked tool armed after it places something', () => {
      toolModes.syncActive('shape-rect');
      expect(toolModes.toggleLock()).toBe(true);
      finishCreation();
      finishCreation();
      expect(dispatched).toEqual([]);
      expect(toolModes.getSnapshot().locked).toBe('shape');
    });

    it('keeps the Shape seat through a change of shape', () => {
      toolModes.syncActive('shape-rect');
      toolModes.toggleLock();
      toolModes.syncActive('shape-diamond');
      finishCreation();
      toolModes.syncActive('shape-ellipse');
      finishCreation();
      expect(dispatched).toEqual([]);
      expect(toolModes.isLocked('shape-ellipse')).toBe(true);
    });

    it('treats the bare id R arms as the same seat', () => {
      toolModes.syncActive('shape');
      toolModes.toggleLock();
      toolModes.syncActive('shape-star');
      finishCreation();
      expect(dispatched).toEqual([]);
    });

    it('ends when a shape run turns into a line', () => {
      toolModes.syncActive('shape-rect');
      toolModes.toggleLock();
      toolModes.syncActive('shape-arrow');
      expect(toolModes.getSnapshot().locked).toBeNull();
      finishCreation();
      expect(dispatched).toEqual(['select']);
    });

    it('keeps a seat pressed before it is armed', () => {
      toolModes.syncActive('select');
      toolModes.keep('shape-diamond', true);
      toolModes.syncActive('shape-diamond');
      expect(toolModes.getSnapshot().locked).toBe('shape');
      finishCreation();
      expect(dispatched).toEqual([]);
      toolModes.keep('shape-diamond', false);
      expect(toolModes.getSnapshot().locked).toBeNull();
    });

    it('keeps a frame through a change of size', () => {
      toolModes.syncActive('frame');
      toolModes.toggleLock();
      toolModes.syncActive('frame-a4');
      finishCreation();
      expect(dispatched).toEqual([]);
    });

    it('is its own inverse', () => {
      toolModes.syncActive('text');
      toolModes.toggleLock();
      toolModes.toggleLock();
      expect(toolModes.getSnapshot().locked).toBeNull();
      finishCreation();
      expect(dispatched).toEqual(['select']);
    });

    it('belongs to one tool, and arming any other ends it', () => {
      toolModes.syncActive('sticky');
      toolModes.toggleLock();
      toolModes.syncActive('select');
      expect(toolModes.getSnapshot().locked).toBeNull();
      toolModes.syncActive('sticky');
      finishCreation();
      expect(dispatched).toEqual(['select']);
    });

    it('refuses tools that already stay armed', () => {
      for (const id of ['pen', 'eraser', 'hand', 'connector', 'select']) {
        toolModes.syncActive(id);
        expect(toolModes.toggleLock()).toBe(false);
        expect(toolModes.getSnapshot().locked).toBeNull();
      }
    });

    it('covers every tool that places one object', () => {
      for (const id of ['shape-rect', 'shape-arrow', 'frame', 'frame-a4', 'text', 'sticky', 'chart', 'grid', 'table']) {
        expect(isLockable(id)).toBe(true);
      }
    });
  });

  describe('holding a tool on its key', () => {
    it('a tap arms the tool and leaves it armed', () => {
      toolModes.syncActive('pen');
      toolModes.beginHold('e', 'eraser', 'pen', 0);
      toolModes.syncActive('eraser');
      expect(toolModes.endHold('e', SPRING_MS - 1)).toBeNull();
    });

    it('a hold goes back to the tool it interrupted', () => {
      toolModes.syncActive('pen');
      toolModes.beginHold('e', 'eraser', 'pen', 0);
      toolModes.syncActive('eraser');
      expect(toolModes.endHold('e', SPRING_MS + 50)).toBe('pen');
    });

    it('keeps the interrupted tool locked through the round trip', () => {
      toolModes.syncActive('sticky');
      toolModes.toggleLock();
      toolModes.beginHold('h', 'hand', 'sticky', 0);
      toolModes.syncActive('hand');
      expect(toolModes.getSnapshot().locked).toBeNull();
      expect(toolModes.endHold('h', SPRING_MS * 2)).toBe('sticky');
      toolModes.syncActive('sticky');
      expect(toolModes.getSnapshot().locked).toBe('sticky');
    });

    it('drops the hold when another tool is chosen while the key is down', () => {
      toolModes.syncActive('pen');
      toolModes.beginHold('e', 'eraser', 'pen', 0);
      toolModes.syncActive('eraser');
      toolModes.syncActive('shape-rect');
      expect(toolModes.endHold('e', SPRING_MS * 3)).toBeNull();
    });

    it('ignores a release of a different key', () => {
      toolModes.syncActive('pen');
      toolModes.beginHold('e', 'eraser', 'pen', 0);
      toolModes.syncActive('eraser');
      expect(toolModes.endHold('v', SPRING_MS * 3)).toBeNull();
      expect(toolModes.endHold('e', SPRING_MS * 3)).toBe('pen');
    });

    it('does not hold tools that open something when used', () => {
      for (const id of ['text', 'sticky', 'image', 'audio', 'comment', 'chart', 'table']) {
        expect(isSpringable(id)).toBe(false);
      }
      toolModes.syncActive('pen');
      toolModes.beginHold('t', 'text', 'pen', 0);
      toolModes.syncActive('text');
      expect(toolModes.endHold('t', SPRING_MS * 3)).toBeNull();
    });

    it('treats leaving the window as letting go', () => {
      toolModes.syncActive('pen');
      toolModes.beginHold('h', 'hand', 'pen', 0);
      toolModes.syncActive('hand');
      expect(toolModes.releaseAll(SPRING_MS * 2)).toBe('pen');
      expect(toolModes.releaseAll(SPRING_MS * 3)).toBeNull();
    });
  });
});
