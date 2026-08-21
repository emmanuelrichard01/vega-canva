import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react', () => {
  return {
    default: {
      useRef: (init: any) => ({ current: init }),
      useEffect: (fn: () => any) => fn?.(),
      useCallback: (fn: any) => fn,
    },
    useRef: (init: any) => ({ current: init }),
    useEffect: (fn: () => any) => fn?.(),
    useCallback: (fn: any) => fn,
  };
});

import { useCanvasSelection } from './useCanvasSelection';
import { useStore } from './useStore';

describe('useCanvasSelection', () => {
  let setSelectedIdsMock: any;
  let listeners: Record<string, ((e: any) => void)[]> = {};

  beforeEach(() => {
    listeners = {};
    setSelectedIdsMock = vi.fn();

    const mockAddListener = (event: string, cb: (e: any) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    };

    const mockRemoveListener = (event: string, cb: (e: any) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((fn) => fn !== cb);
      }
    };

    const mockDispatch = (event: any) => {
      const cbs = listeners[event.type] || [];
      cbs.forEach((cb) => cb(event));
      return true;
    };

    (globalThis as any).document = {
      addEventListener: vi.fn(mockAddListener),
      removeEventListener: vi.fn(mockRemoveListener),
      dispatchEvent: vi.fn(mockDispatch),
    };

    (globalThis as any).window = {
      addEventListener: vi.fn(mockAddListener),
      removeEventListener: vi.fn(mockRemoveListener),
      dispatchEvent: vi.fn(mockDispatch),
    };

    useStore.setState({
      objects: {
        node1: { id: 'node1', x: 10, y: 10, width: 50, height: 50 } as any,
        node2: { id: 'node2', x: 200, y: 200, width: 50, height: 50 } as any,
      },
      groups: {},
    });
  });

  it('selects intersecting objects on marqueeSelect event', () => {
    useCanvasSelection({
      activeTool: 'select',
      selectedIds: [],
      setSelectedIds: setSelectedIdsMock,
    });

    const event = {
      type: 'marqueeSelect',
      detail: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        additive: false,
      },
    };

    document.dispatchEvent(event as any);
    expect(setSelectedIdsMock).toHaveBeenCalledWith(['node1']);
  });

  it('selects single object on requestSelectNode event', () => {
    useCanvasSelection({
      activeTool: 'select',
      selectedIds: [],
      setSelectedIds: setSelectedIdsMock,
    });

    const event = {
      type: 'requestSelectNode',
      detail: {
        id: 'node2',
      },
    };

    document.dispatchEvent(event as any);
    expect(setSelectedIdsMock).toHaveBeenCalledWith(['node2']);
  });

  it('clears selection when requestSelectNode has no id', () => {
    useCanvasSelection({
      activeTool: 'select',
      selectedIds: ['node1'],
      setSelectedIds: setSelectedIdsMock,
    });

    const event = {
      type: 'requestSelectNode',
      detail: {},
    };

    document.dispatchEvent(event as any);
    expect(setSelectedIdsMock).toHaveBeenCalledWith([]);
  });
});
