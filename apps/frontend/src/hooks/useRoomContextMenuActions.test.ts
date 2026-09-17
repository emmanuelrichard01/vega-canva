import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyNode } from '../engine/model/schema';

vi.mock('react', () => {
  return {
    default: {
      useCallback: (fn: any) => fn,
      useMemo: (fn: any) => fn(),
    },
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
  };
});

// Mock dependencies
const mockPatches: any[] = [];
vi.mock('../engine/document', () => ({
  applyNodePatches: vi.fn((patches) => mockPatches.push(...patches)),
  nextZIndex: () => 10,
  lowestZIndex: () => -10,
}));

const mockDeleted: any[] = [];
vi.mock('../engine/interaction/frameMembership', () => ({
  deleteNodesWithFrames: vi.fn((ids) => mockDeleted.push(...ids)),
}));

const mockGrouped: any[] = [];
const mockUngrouped: any[] = [];
vi.mock('../engine/api/EditorAPI', () => ({
  editor: {
    groupNodes: vi.fn((ids) => mockGrouped.push(...ids)),
    ungroupNodes: vi.fn((ids) => mockUngrouped.push(...ids)),
  },
}));

vi.mock('../engine/CameraSystem', () => ({
  cameraSystem: {
    screenToWorld: (x: number, y: number) => ({ x, y }),
  },
}));

const { useRoomContextMenuActions } = await import('./useRoomContextMenuActions');

describe('useRoomContextMenuActions', () => {
  beforeEach(() => {
    mockPatches.length = 0;
    mockDeleted.length = 0;
    mockGrouped.length = 0;
    mockUngrouped.length = 0;
    vi.clearAllMocks();
  });

  it('handles remove and clears selection', () => {
    const setSelectedIds = vi.fn();
    const actions = useRoomContextMenuActions({
      selectedIds: ['n1', 'n2'],
      setSelectedIds,
      diagramObjects: {},
      contextTarget: null,
      localTitle: 'Test Board',
      clipboardRef: { current: null },
      copySelection: vi.fn(),
      pasteObjects: vi.fn(),
      pasteSvg: vi.fn(),
      pasteText: vi.fn(),
      showToast: vi.fn(),
      setExportFromSelection: vi.fn(),
      setShowExportMenu: vi.fn(),
      setDiagramSource: vi.fn(),
      setDiagramReplacing: vi.fn(),
      setDiagramReplaceIds: vi.fn(),
      setDiagramOpen: vi.fn(),
    });

    actions.remove();
    expect(mockDeleted).toEqual(['n1', 'n2']);
    expect(setSelectedIds).toHaveBeenCalledWith([]);
  });

  it('restacks by the drawn order, touching only what moves', () => {
    const setSelectedIds = vi.fn();
    const box = { x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1 };
    const diagramObjects = {
      n1: { ...box, id: 'n1', zIndex: 1 },
      n2: { ...box, id: 'n2', zIndex: 2 },
    } as unknown as Record<string, AnyNode>;
    const actions = useRoomContextMenuActions({
      selectedIds: ['n1'],
      setSelectedIds,
      diagramObjects,
      contextTarget: null,
      localTitle: 'Test Board',
      clipboardRef: { current: null },
      copySelection: vi.fn(),
      pasteObjects: vi.fn(),
      pasteSvg: vi.fn(),
      pasteText: vi.fn(),
      showToast: vi.fn(),
      setExportFromSelection: vi.fn(),
      setShowExportMenu: vi.fn(),
      setDiagramSource: vi.fn(),
      setDiagramReplacing: vi.fn(),
      setDiagramReplaceIds: vi.fn(),
      setDiagramOpen: vi.fn(),
    });

    // n1 sits under n2, so to the front means just above n2.
    actions.bringToFront();
    expect(mockPatches.length).toBe(1);
    expect(mockPatches[0]).toEqual({ id: 'n1', changes: { zIndex: 3 } });

    // Already at the back: nothing to write, and no undo step for nothing.
    mockPatches.length = 0;
    actions.sendToBack();
    expect(mockPatches.length).toBe(0);
  });

  it('handles group and ungroup', () => {
    const setSelectedIds = vi.fn();
    const actions = useRoomContextMenuActions({
      selectedIds: ['n1', 'n2'],
      setSelectedIds,
      diagramObjects: {},
      contextTarget: null,
      localTitle: 'Test Board',
      clipboardRef: { current: null },
      copySelection: vi.fn(),
      pasteObjects: vi.fn(),
      pasteSvg: vi.fn(),
      pasteText: vi.fn(),
      showToast: vi.fn(),
      setExportFromSelection: vi.fn(),
      setShowExportMenu: vi.fn(),
      setDiagramSource: vi.fn(),
      setDiagramReplacing: vi.fn(),
      setDiagramReplaceIds: vi.fn(),
      setDiagramOpen: vi.fn(),
    });

    actions.group();
    expect(mockGrouped).toEqual(['n1', 'n2']);

    actions.ungroup();
    expect(mockUngrouped).toEqual(['n1', 'n2']);
  });

  it('handles toggleLock on objects', () => {
    const setSelectedIds = vi.fn();
    const diagramObjects: Record<string, AnyNode> = {
      n1: { id: 'n1', locked: false } as AnyNode,
    };
    const actions = useRoomContextMenuActions({
      selectedIds: ['n1'],
      setSelectedIds,
      diagramObjects,
      contextTarget: null,
      localTitle: 'Test Board',
      clipboardRef: { current: null },
      copySelection: vi.fn(),
      pasteObjects: vi.fn(),
      pasteSvg: vi.fn(),
      pasteText: vi.fn(),
      showToast: vi.fn(),
      setExportFromSelection: vi.fn(),
      setShowExportMenu: vi.fn(),
      setDiagramSource: vi.fn(),
      setDiagramReplacing: vi.fn(),
      setDiagramReplaceIds: vi.fn(),
      setDiagramOpen: vi.fn(),
    });

    actions.toggleLock();
    expect(mockPatches.length).toBe(1);
    expect(mockPatches[0].changes.locked).toBe(true);
  });
});
