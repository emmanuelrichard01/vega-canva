import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SelectTool } from './SelectTool';

if (typeof document === 'undefined') {
  (globalThis as any).document = new EventTarget();
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
}

describe('SelectTool', () => {
  let dispatchSpy: any;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(document, 'dispatchEvent').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct tool id and cursor', () => {
    const tool = new SelectTool();
    expect(tool.id).toBe('select');
    expect(tool.cursor).toBe('default');
  });

  it('starts marquee on stage pointer down and sets overlay', () => {
    const tool = new SelectTool();
    const mockStage: any = {
      getPointerPosition: () => ({ x: 100, y: 150 }),
    };
    mockStage.getStage = () => mockStage;

    const setOverlayState = vi.fn();
    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 1 },
      setOverlayState,
    } as any;

    tool.onPointerDown(mockCtx, {
      target: mockStage,
      evt: { shiftKey: false },
    });

    expect(setOverlayState).toHaveBeenCalledWith({
      type: 'marquee',
      startX: 100,
      startY: 150,
      currentX: 100,
      currentY: 150,
    });
  });

  it('detects additive modifier keys (Shift, Ctrl, Meta)', () => {
    const tool = new SelectTool();
    const mockStage: any = {
      getPointerPosition: () => ({ x: 0, y: 0 }),
    };
    mockStage.getStage = () => mockStage;

    const setOverlayState = vi.fn();
    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 1 },
      setOverlayState,
    } as any;

    // Test with Ctrl key
    tool.onPointerDown(mockCtx, {
      target: mockStage,
      evt: { ctrlKey: true },
    });

    mockStage.getPointerPosition = () => ({ x: 50, y: 60 });
    tool.onPointerMove(mockCtx, {
      target: mockStage,
      evt: { ctrlKey: true },
    });

    tool.onPointerUp(mockCtx);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'marqueeSelect',
        detail: {
          minX: 0,
          minY: 0,
          maxX: 50,
          maxY: 60,
          additive: true,
        },
      })
    );
  });

  it('clears selection on bare click in empty space without additive modifier', () => {
    const tool = new SelectTool();
    const mockStage: any = {
      getPointerPosition: () => ({ x: 10, y: 10 }),
    };
    mockStage.getStage = () => mockStage;

    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 1 },
      setOverlayState: vi.fn(),
    } as any;

    tool.onPointerDown(mockCtx, {
      target: mockStage,
      evt: {},
    });

    tool.onPointerUp(mockCtx);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'requestSelectNode',
        detail: { id: null },
      })
    );
  });

  it('does not clear selection on Shift-click on empty background', () => {
    const tool = new SelectTool();
    const mockStage: any = {
      getPointerPosition: () => ({ x: 10, y: 10 }),
    };
    mockStage.getStage = () => mockStage;

    const mockCtx = {
      camera: { x: 0, y: 0, zoom: 1 },
      setOverlayState: vi.fn(),
    } as any;

    tool.onPointerDown(mockCtx, {
      target: mockStage,
      evt: { shiftKey: true },
    });

    tool.onPointerUp(mockCtx);

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'requestSelectNode',
      })
    );
  });

  it('renders zoom-scaled marquee overlay rect', () => {
    const tool = new SelectTool();
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
    expect(overlay?.props.x).toBe(10);
    expect(overlay?.props.y).toBe(20);
    expect(overlay?.props.width).toBe(100);
    expect(overlay?.props.height).toBe(100);
    expect(overlay?.props.strokeWidth).toBe(0.5); // 1 / zoom = 1 / 2 = 0.5
  });
});
