// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const updateNodes = vi.fn();
vi.mock('../../engine/document', () => ({
  applyNodePatches: vi.fn(),
  updateNodes: (...args: unknown[]) => updateNodes(...args),
}));
const organise = vi.fn();
vi.mock('../../engine/tools/organiseStickies', () => ({
  applyOrganiseStickies: (...args: unknown[]) => organise(...args),
}));

const { useContentShortcuts } = await import('./useContentShortcuts');
const { setPresenting } = await import('../../engine/tools/presenting');
const { useStore } = await import('../../hooks/useStore');

const sticky = (id: string) => ({ id, type: 'sticky', x: 0, y: 0, width: 100, height: 100, theme: 'yellow' });

function key(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

beforeEach(() => {
  useStore.setState({ objects: { a: sticky('a'), b: sticky('b') } } as never);
  updateNodes.mockClear();
  organise.mockClear();
});
afterEach(() => setPresenting(false));

describe('content shortcuts while presenting', () => {
  it('recolours and organises when the board is live', () => {
    const { unmount } = renderHook(() => useContentShortcuts({ selectedIds: ['a', 'b'] }));
    key({ key: '1', code: 'Digit1' });
    expect(updateNodes).toHaveBeenCalledTimes(1);
    key({ key: 'o', code: 'KeyO', altKey: true, metaKey: true });
    expect(organise).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('changes nothing on the hidden board while a show runs', () => {
    const { unmount } = renderHook(() => useContentShortcuts({ selectedIds: ['a', 'b'] }));
    setPresenting(true);
    key({ key: '1', code: 'Digit1' });
    key({ key: 'o', code: 'KeyO', altKey: true, metaKey: true });
    key({ key: 'Delete', code: 'Delete' });
    key({ key: 'z', code: 'KeyZ', metaKey: true });
    expect(updateNodes).not.toHaveBeenCalled();
    expect(organise).not.toHaveBeenCalled();
    unmount();
  });
});
