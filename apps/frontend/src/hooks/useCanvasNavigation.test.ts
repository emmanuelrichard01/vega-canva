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

  it('initializes default dimensions and exposes the touch gate', () => {
    const container = {
      current: {
        clientWidth: 1024,
        clientHeight: 768,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelector: () => null,
      } as unknown as HTMLDivElement,
    };
    const { dimensions, touchMayDriveTool, lastPointerTypeRef } = useCanvasNavigation({
      containerRef: container,
      stageRef: { current: null },
    });

    expect(dimensions).toEqual({ width: 800, height: 600 });
    expect(lastPointerTypeRef.current).toBe('mouse');
    // Mouse events are never gated: the desktop path is untouched.
    expect(touchMayDriveTool({ type: 'mousedown' } as Event)).toBe(true);
    // A touch nobody has claimed is not the tool's.
    expect(touchMayDriveTool({ type: 'touchstart' } as Event)).toBe(false);
  });

  /** A container whose board contains every target, with real listener lists. */
  function touchRig() {
    const el = new MockEventTarget() as MockEventTarget & { querySelector: () => unknown; clientWidth: number; clientHeight: number };
    el.clientWidth = 800;
    el.clientHeight = 600;
    el.querySelector = () => ({ contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
    const win = (globalThis as any).window as MockEventTarget;
    const send = (target: MockEventTarget, type: string, id: number, x: number, y: number) =>
      target.dispatchEvent({ type, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, target: {}, cancelable: false });
    return {
      el,
      down: (id: number, x: number, y: number) => send(el, 'pointerdown', id, x, y),
      move: (id: number, x: number, y: number) => send(win, 'pointermove', id, x, y),
      up: (id: number, x: number, y: number) => send(win, 'pointerup', id, x, y),
    };
  }

  it('gives one finger to the tool and cancels it when a second lands', () => {
    const rig = touchRig();
    const onCancel = vi.fn();
    const { touchMayDriveTool } = useCanvasNavigation({
      containerRef: { current: rig.el as unknown as HTMLDivElement },
      stageRef: { current: null },
      onCancelInteractions: onCancel,
    });

    rig.down(1, 100, 100);
    expect(touchMayDriveTool({ type: 'touchstart' } as Event)).toBe(true);
    rig.down(2, 200, 100);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(touchMayDriveTool({ type: 'touchmove' } as Event)).toBe(false);
    rig.up(1, 100, 100);
    rig.up(2, 200, 100);
  });

  it('pinch-zooms the camera around the fingers', () => {
    const rig = touchRig();
    const zoomBy = vi.spyOn(cameraSystem, 'zoomBy');
    useCanvasNavigation({ containerRef: { current: rig.el as unknown as HTMLDivElement }, stageRef: { current: null } });

    rig.down(1, 100, 100);
    rig.down(2, 200, 100);
    rig.move(1, 80, 100);
    rig.move(2, 220, 100);
    rig.move(1, 60, 100);
    rig.move(2, 240, 100);
    expect(zoomBy).toHaveBeenCalled();
    expect(cameraSystem.zoom).toBeGreaterThan(1);
    rig.up(1, 60, 100);
    rig.up(2, 240, 100);
    zoomBy.mockRestore();
  });

  it('turns a quick two-finger tap into undo', () => {
    const rig = touchRig();
    const onUndo = vi.fn();
    useCanvasNavigation({
      containerRef: { current: rig.el as unknown as HTMLDivElement },
      stageRef: { current: null },
      onUndo,
    });
    rig.down(1, 100, 100);
    rig.down(2, 200, 100);
    rig.up(1, 100, 100);
    rig.up(2, 200, 100);
    expect(onUndo).toHaveBeenCalledTimes(1);
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
