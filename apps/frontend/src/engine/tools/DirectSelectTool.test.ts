import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectSelectTool } from './DirectSelectTool';
import { pathEdit } from '../interaction/pathEdit';
import { useStore } from '../../hooks/useStore';

describe('DirectSelectTool', () => {
  beforeEach(() => {
    pathEdit.exit();
    useStore.setState({
      objects: {
        'path-1': {
          id: 'path-1',
          type: 'path',
          x: 10,
          y: 20,
          width: 100,
          height: 100,
          geometry: {
            kind: 'bezier',
            closed: false,
            segments: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
          },
        } as any,
        'shape-1': {
          id: 'shape-1',
          type: 'shape',
          x: 50,
          y: 50,
          width: 80,
          height: 80,
          geometry: { kind: 'rect' },
          appearance: { fill: [{ type: 'solid', color: '#ff0000' }] },
        } as any,
        'freehand-1': {
          id: 'freehand-1',
          type: 'path',
          x: 0,
          y: 0,
          geometry: { kind: 'freehand', points: [] },
        } as any,
      },
    });
  });

  afterEach(() => {
    pathEdit.exit();
    vi.restoreAllMocks();
  });

  it('has correct tool id and cursor', () => {
    const tool = new DirectSelectTool();
    expect(tool.id).toBe('direct-select');
    expect(tool.cursor).toBe('crosshair');
  });

  it('opens an existing Bezier path for anchor editing', () => {
    const openedId = DirectSelectTool.open('path-1');
    expect(openedId).toBe('path-1');
    expect(pathEdit.isEditing('path-1')).toBe(true);
  });

  it('prompts confirmation for primitive shapes instead of silently auto-flattening', () => {
    const openedId = DirectSelectTool.open('shape-1');

    expect(openedId).toBeNull();
    expect(useStore.getState().flattenConfirmNodeId).toBe('shape-1');
    expect(pathEdit.getSnapshot()).toBeNull();
  });

  it('returns null and does not open freehand paths', () => {
    const openedId = DirectSelectTool.open('freehand-1');
    expect(openedId).toBeNull();
    expect(pathEdit.getSnapshot()).toBeNull();
  });

  it('exits path editing and clears selection on stage pointer click with no drag', () => {
    pathEdit.enter('path-1');
    const tool = new DirectSelectTool();
    const mockStage: any = {
      getPointerPosition: () => ({ x: 5, y: 5 }),
    };
    mockStage.getStage = () => mockStage;

    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 1 },
      editor: {
        select: vi.fn(),
      },
    } as any;

    tool.onPointerDown(mockCtx, {
      target: mockStage,
      evt: {},
    } as any);

    tool.onPointerUp(mockCtx);

    expect(pathEdit.getSnapshot()).toBeNull();
    expect(mockCtx.editor.select).toHaveBeenCalledWith(null);
  });

  it('selects multiple anchors on click-hold-and-drag marquee', () => {
    pathEdit.enter('path-1');
    const tool = new DirectSelectTool();
    let currentPtr = { x: 0, y: 0 };
    const mockStage: any = {
      getPointerPosition: () => currentPtr,
    };
    mockStage.getStage = () => mockStage;

    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 1 },
      setOverlayState: vi.fn(),
      editor: {
        select: vi.fn(),
      },
    } as any;

    const evt = {
      target: mockStage,
      evt: {},
    };

    tool.onPointerDown(mockCtx, evt);

    currentPtr = { x: 120, y: 150 };
    tool.onPointerMove(mockCtx, evt);

    expect(mockCtx.setOverlayState).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'marquee' })
    );
    expect(pathEdit.getSnapshot()?.anchors.length).toBeGreaterThan(0);

    tool.onPointerUp(mockCtx);
    expect(mockCtx.setOverlayState).toHaveBeenCalledWith(null);
  });

  it('auto-opens unselected path and captures anchors when dragging marquee from empty space', () => {
    // pathEdit starts empty (no path open)
    expect(pathEdit.getSnapshot()).toBeNull();

    const tool = new DirectSelectTool();
    let currentPtr = { x: 0, y: 0 };
    const mockStage: any = {
      getPointerPosition: () => currentPtr,
    };
    mockStage.getStage = () => mockStage;

    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 1 },
      setOverlayState: vi.fn(),
      editor: {
        select: vi.fn(),
      },
    } as any;

    const evt = {
      target: mockStage,
      evt: {},
    };

    tool.onPointerDown(mockCtx, evt);

    // Drag marquee across path-1 (x: 10..110, y: 20..120)
    currentPtr = { x: 150, y: 150 };
    tool.onPointerMove(mockCtx, evt);

    expect(pathEdit.getSnapshot()).not.toBeNull();
    expect(pathEdit.getSnapshot()?.nodeId).toBe('path-1');
    expect(pathEdit.getSnapshot()?.anchors.length).toBeGreaterThan(0);

    tool.onPointerUp(mockCtx);
    expect(mockCtx.setOverlayState).toHaveBeenCalledWith(null);
  });

  it('renders marquee highlight overlay element with light blue translucent fill and blue border', () => {
    const tool = new DirectSelectTool();
    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 2 },
    } as any;

    const overlay = tool.renderOverlay(mockCtx, {
      type: 'marquee',
      startX: 10,
      startY: 20,
      currentX: 110,
      currentY: 120,
    });

    expect(overlay).not.toBeNull();
    expect((overlay as any).props.x).toBe(10);
    expect((overlay as any).props.y).toBe(20);
    expect((overlay as any).props.width).toBe(100);
    expect((overlay as any).props.height).toBe(100);
    expect((overlay as any).props.fill).toBe('rgba(37, 99, 235, 0.12)');
    expect((overlay as any).props.stroke).toBe('#2563EB');
  });
});

describe('Dynamic Anchor Conversion Functions', () => {
  beforeEach(() => {
    pathEdit.exit();
    useStore.setState({
      objects: {
        'path-1': {
          id: 'path-1',
          type: 'path',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          geometry: {
            kind: 'bezier',
            closed: false,
            segments: [
              { x: 0, y: 0 },
              { x: 50, y: 50, cp1x: 40, cp1y: 40, cp2x: 60, cp2y: 60 },
              { x: 100, y: 100 },
            ],
          },
        } as any,
        'path-2': {
          id: 'path-2',
          type: 'path',
          x: 10,
          y: 10,
          width: 100,
          height: 100,
          geometry: {
            kind: 'bezier',
            closed: true,
            segments: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
          },
        } as any,
      },
    });
  });

  afterEach(() => {
    pathEdit.exit();
  });

  it('setPickedAnchorMode converts all anchors when none are explicitly picked', async () => {
    const { setPickedAnchorMode } = await import('../interaction/pathAnchorActions');
    pathEdit.enter('path-1');
    expect(pathEdit.getSnapshot()?.anchors.length).toBe(0);

    const result = setPickedAnchorMode('smooth');
    expect(result).toBe(true);
  }, 15000);

  it('setMultiplePathsAnchorMode applies corner/smooth across multiple selected paths', async () => {
    const { setMultiplePathsAnchorMode } = await import('../interaction/pathAnchorActions');
    const result = setMultiplePathsAnchorMode(['path-1', 'path-2'], 'smooth');
    expect(result).toBe(true);
  }, 15000);
});
