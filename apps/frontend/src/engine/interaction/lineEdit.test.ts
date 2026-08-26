import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineEdit } from './lineEdit';

afterEach(() => lineEdit.end());

describe('lineEdit', () => {
  it('is closed until something opens it', () => {
    expect(lineEdit.getSnapshot()).toBeNull();
    expect(lineEdit.isEditing('a')).toBe(false);
  });

  it('opens on a line with nothing picked', () => {
    lineEdit.begin('a');
    expect(lineEdit.getSnapshot()).toEqual({ nodeId: 'a', vertex: null });
  });

  it('keeps the picked vertex when the same line is opened again', () => {
    // Double-clicking a line already in the editor must not throw away the
    // vertex the user is working on.
    lineEdit.begin('a');
    lineEdit.pick(2);
    lineEdit.begin('a');
    expect(lineEdit.getSnapshot()?.vertex).toBe(2);
  });

  it('starts fresh on a different line', () => {
    lineEdit.begin('a');
    lineEdit.pick(2);
    lineEdit.begin('b');
    expect(lineEdit.getSnapshot()).toEqual({ nodeId: 'b', vertex: null });
  });

  it('ignores a pick when no line is open', () => {
    /**
     * A stray pick from a handle that has not unmounted yet would otherwise
     * put the editor into a mode nobody asked for, on a node that may not even
     * be selected.
     */
    lineEdit.pick(1);
    expect(lineEdit.getSnapshot()).toBeNull();
  });

  it('does not close an editor a different line has since opened', () => {
    // The same guard, for the same reason, as `textEditing.end`.
    lineEdit.begin('a');
    lineEdit.end('stale');
    expect(lineEdit.isEditing('a')).toBe(true);
    lineEdit.end('a');
    expect(lineEdit.getSnapshot()).toBeNull();
  });

  it('wakes subscribers when something actually changes', () => {
    const seen = vi.fn();
    const stop = lineEdit.subscribe(seen);
    lineEdit.begin('a');
    lineEdit.begin('a');
    lineEdit.pick(1);
    lineEdit.pick(1);
    lineEdit.end();
    expect(seen).toHaveBeenCalledTimes(3);
    stop();
  });

  it('hands back a stable snapshot while nothing changes', () => {
    // `useSyncExternalStore` compares by identity and re-renders the canvas
    // when it differs.
    lineEdit.begin('a');
    expect(lineEdit.getSnapshot()).toBe(lineEdit.getSnapshot());
  });
});
