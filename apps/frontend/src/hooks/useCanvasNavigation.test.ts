import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockStateValue: any = { width: 800, height: 600 };
const setDimensionsMock = vi.fn((val) => {
  mockStateValue = typeof val === 'function' ? val(mockStateValue) : val;
});

vi.mock('react', () => {
  return {
    default: {
      useState: (init: any) => [
        typeof init === 'function' ? init() : init,
        setDimensionsMock,
      ],
      useRef: (init: any) => ({ current: init }),
      useEffect: (fn: () => any) => {
        fn?.();
      },
      useCallback: (fn: any) => fn,
      useMemo: (fn: any) => fn(),
    },
    useState: (init: any) => [
      typeof init === 'function' ? init() : init,
      setDimensionsMock,
    ],
    useRef: (init: any) => ({ current: init }),
    useEffect: (fn: () => any) => {
      fn?.();
    },
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
  };
});

import { cameraSystem } from '../engine/CameraSystem';
import { useCanvasNavigation } from './useCanvasNavigation';

describe('useCanvasNavigation', () => {
  beforeEach(() => {
    cameraSystem.x = 0;
    cameraSystem.y = 0;
    cameraSystem.zoom = 1;
    setDimensionsMock.mockClear();
  });

  it('initializes default dimensions and sets up handlers', () => {
    const container = {
      current: {
        clientWidth: 1024,
        clientHeight: 768,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLDivElement,
    };
    const stage = { current: null };
    const onCancel = vi.fn();

    const { dimensions, isMultiTouchRef, handleTouchStartNative, handleTouchEndNative } =
      useCanvasNavigation({
        containerRef: container,
        stageRef: stage,
        onCancelInteractions: onCancel,
      });

    expect(dimensions).toEqual({ width: 800, height: 600 });
    expect(isMultiTouchRef.current).toBe(false);
    expect(typeof handleTouchStartNative).toBe('function');
    expect(typeof handleTouchEndNative).toBe('function');
  });

  it('triggers onCancelInteractions when multi-touch pinch starts', () => {
    const container = { current: null };
    const stage = { current: null };
    const onCancel = vi.fn();

    const { isMultiTouchRef, handleTouchStartNative } = useCanvasNavigation({
      containerRef: container,
      stageRef: stage,
      onCancelInteractions: onCancel,
    });

    const mockMultiTouch = {
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 200 },
      ],
    } as unknown as React.TouchEvent;

    handleTouchStartNative(mockMultiTouch);
    expect(isMultiTouchRef.current).toBe(true);
    expect(onCancel).toHaveBeenCalled();
  });

  it('resets multi-touch on finger release', () => {
    const container = { current: null };
    const stage = { current: null };
    const onCancel = vi.fn();

    const { isMultiTouchRef, handleTouchStartNative, handleTouchEndNative } =
      useCanvasNavigation({
        containerRef: container,
        stageRef: stage,
        onCancelInteractions: onCancel,
      });

    handleTouchStartNative({
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 200 },
      ],
    } as unknown as React.TouchEvent);

    expect(isMultiTouchRef.current).toBe(true);

    handleTouchEndNative({
      touches: [],
    } as unknown as React.TouchEvent);

    expect(isMultiTouchRef.current).toBe(false);
  });
});
