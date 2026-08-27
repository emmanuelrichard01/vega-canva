import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyNode } from '../engine/model/schema';
import type { ClipboardPayload } from '../engine/clipboard/clipboard';
import { CLIPBOARD_MAGIC } from '../engine/clipboard/clipboard';

vi.mock('react', () => {
  let stateVal: any = null;
  return {
    default: {
      useState: (init: any) => [stateVal ?? init, (v: any) => { stateVal = typeof v === 'function' ? v(stateVal) : v; }],
      useRef: (init: any) => ({ current: init }),
      useEffect: (fn: () => any) => fn?.(),
      useCallback: (fn: any) => fn,
    },
    useState: (init: any) => [stateVal ?? init, (v: any) => { stateVal = typeof v === 'function' ? v(stateVal) : v; }],
    useRef: (init: any) => ({ current: init }),
    useEffect: (fn: () => any) => fn?.(),
    useCallback: (fn: any) => fn,
  };
});

// Mock dependencies
const mockCreatedNodes: any[] = [];
vi.mock('../engine/api/EditorAPI', () => ({
  editor: {
    createNode: vi.fn((node) => {
      mockCreatedNodes.push(node);
      return node.id || 'mock-id';
    }),
  },
}));

vi.mock('../engine/document', () => ({
  doc: {
    transact: (fn: () => void) => fn(),
  },
  applyGroupPlan: vi.fn(),
}));

vi.mock('../engine/CameraSystem', () => ({
  cameraSystem: {
    screenToWorld: (x: number, y: number) => ({ x: x * 2, y: y * 2 }),
  },
}));

const mockGroups: Record<string, any> = {};
vi.mock('./useStore', () => ({
  useStore: {
    getState: () => ({ groups: mockGroups }),
  },
}));

const { useRoomClipboard } = await import('./useRoomClipboard');

describe('useRoomClipboard', () => {
  beforeEach(() => {
    mockCreatedNodes.length = 0;
    vi.clearAllMocks();
    (globalThis as any).window = {
      innerWidth: 1000,
      innerHeight: 800,
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(),
    };
  });

  it('initializes with null notice and writes to clipboard on copySelection', () => {
    const selectionRef = { current: ['node1'] };
    const setSelectedIds = vi.fn();
    const diagramObjects: Record<string, AnyNode> = {
      node1: {
        id: 'node1',
        type: 'shape',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        geometry: { kind: 'rect' },
      } as AnyNode,
    };

    const clipboard = useRoomClipboard({
      diagramObjects,
      selectionRef,
      setSelectedIds,
    });

    const copied = clipboard.copySelection();
    expect(copied).toBe(true);
    expect(clipboard.clipboardRef.current).not.toBeNull();
    expect(clipboard.clipboardRef.current?.nodes.length).toBe(1);
  });

  it('pastes clipboard payload with remapped ids and updates selection', () => {
    const selectionRef = { current: [] };
    const setSelectedIds = vi.fn();
    const diagramObjects: Record<string, AnyNode> = {};

    const clipboard = useRoomClipboard({
      diagramObjects,
      selectionRef,
      setSelectedIds,
    });

    const payload: ClipboardPayload = {
      kind: CLIPBOARD_MAGIC,
      nodes: [
        {
          id: 'orig1',
          type: 'shape',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
        },
      ],
      origin: { x: 0, y: 0 },
    };

    clipboard.pasteObjects(payload, { x: 100, y: 100 });
    expect(setSelectedIds).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]));
    expect(mockCreatedNodes.length).toBe(1);
  });

  it('pastes raw text into a text node', () => {
    const selectionRef = { current: [] };
    const setSelectedIds = vi.fn();
    const diagramObjects: Record<string, AnyNode> = {};

    const clipboard = useRoomClipboard({
      diagramObjects,
      selectionRef,
      setSelectedIds,
    });

    clipboard.pasteText('Hello World', { x: 200, y: 200 });
    expect(setSelectedIds).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]));
    expect(mockCreatedNodes.length).toBe(1);
    expect(mockCreatedNodes[0].text).toBe('Hello World');
  });
});
