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

class MockEventTarget {
  listeners: Record<string, Function[]> = {};
  addEventListener(type: string, fn: Function) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: Function) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }
  dispatchEvent(evt: any) {
    (this.listeners[evt.type] || []).forEach((fn) => fn(evt));
    return true;
  }
}

describe('useCanvasNavigation', () => {
  beforeEach(() => {
    (globalThis as any).window = new MockEventTarget();
    (globalThis as any).document = new MockEventTarget();
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

  it('prevents browser tab zooming on Ctrl+Wheel anywhere in window and zooms camera', () => {
    const zoomByWheelSpy = vi.spyOn(cameraSystem, 'zoomByWheel');
    const container = { current: null };
    const stage = { current: null };

    useCanvasNavigation({
      containerRef: container,
      stageRef: stage,
    });

    const mockEvt = {
      type: 'wheel',
      ctrlKey: true,
      deltaY: -100,
      clientX: 500,
      clientY: 300,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    window.dispatchEvent(mockEvt);

    expect(mockEvt.preventDefault).toHaveBeenCalled();
    expect(zoomByWheelSpy).toHaveBeenCalledWith(-100, 500, 300);
    zoomByWheelSpy.mockRestore();
  });

  it('does not zoom twice when the canvas has already handled the wheel', () => {
    const zoomByWheelSpy = vi.spyOn(cameraSystem, 'zoomByWheel');
    useCanvasNavigation({ containerRef: { current: null }, stageRef: { current: null } });

    // What the canvas listener leaves behind after zooming: a cancelled event.
    // The window guard has to read that and stand down, or a pinch over the
    // board zooms once for the element and once for the window.
    const handled = {
      type: 'wheel',
      ctrlKey: true,
      deltaY: -100,
      clientX: 500,
      clientY: 300,
      defaultPrevented: true,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    window.dispatchEvent(handled);

    expect(zoomByWheelSpy).not.toHaveBeenCalled();
    zoomByWheelSpy.mockRestore();
  });

  it('leaves a plain wheel alone, so panels can still scroll', () => {
    const zoomByWheelSpy = vi.spyOn(cameraSystem, 'zoomByWheel');
    useCanvasNavigation({ containerRef: { current: null }, stageRef: { current: null } });

    const plain = {
      type: 'wheel',
      ctrlKey: false,
      metaKey: false,
      deltaY: -100,
      clientX: 500,
      clientY: 300,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    window.dispatchEvent(plain);

    expect(plain.preventDefault).not.toHaveBeenCalled();
    expect(zoomByWheelSpy).not.toHaveBeenCalled();
    zoomByWheelSpy.mockRestore();
  });

  /**
   * The keyboard zoom is `useRoomShortcuts`' job, and asserting that here is
   * the point rather than an omission.
   *
   * This hook grew its own copy of Ctrl/Cmd with =, - and 0, registered in
   * capture phase -- so it ran first, cancelled the event and left the room's
   * implementation dead. The two were not equivalent: the room's checks
   * whether you are typing before acting, and this one did not, so the
   * shortcut fired inside text fields. A test that the duplicate is gone is
   * what stops it coming back.
   */
  it('leaves the keyboard zoom to the room shortcuts', () => {
    const zoomAtSpy = vi.spyOn(cameraSystem, 'zoomAt');
    useCanvasNavigation({ containerRef: { current: null }, stageRef: { current: null } });

    const plus = {
      type: 'keydown',
      ctrlKey: true,
      key: '+',
      code: 'Equal',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    window.dispatchEvent(plus);

    expect(plus.preventDefault).not.toHaveBeenCalled();
    expect(zoomAtSpy).not.toHaveBeenCalled();
    zoomAtSpy.mockRestore();
  });
});
