import { useState, useEffect, useRef } from 'react';
import { cameraSystem } from '../engine/CameraSystem';
import { presenceManager } from '../engine/presence/PresenceManager';
import { engineEvents } from '../engine/EventBus';

export interface CanvasNavigationOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<any>;
  onCancelInteractions?: () => void;
}

export function useCanvasNavigation({
  containerRef,
  onCancelInteractions,
}: CanvasNavigationOptions) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const pinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const isMultiTouchRef = useRef(false);

  // ResizeObserver for canvas dimensions with SSR/Node environment guard
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
      const h = containerRef.current.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
      if (w <= 0 || h <= 0) return;
      setDimensions({ width: w, height: h });
      cameraSystem.resize(w, h);
    };

    if (typeof ResizeObserver === 'undefined') {
      updateSize();
      return;
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    updateSize();

    return () => observer.disconnect();
  }, [containerRef]);

  // Viewport presence broadcast on CameraChanged
  useEffect(() => {
    const publish = () => {
      presenceManager.updateViewport({
        x: -cameraSystem.x / cameraSystem.zoom,
        y: -cameraSystem.y / cameraSystem.zoom,
        width: cameraSystem.width,
        height: cameraSystem.height,
        zoom: cameraSystem.zoom,
      });
    };
    publish();
    engineEvents.on('CameraChanged', publish);
    return () => {
      engineEvents.off('CameraChanged', publish);
    };
  }, []);

  // Wheel and trackpad pan/zoom, bound natively with non-passive listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      if (evt.ctrlKey || evt.metaKey) {
        cameraSystem.zoomByWheel(evt.deltaY, evt.clientX, evt.clientY);
      } else {
        cameraSystem.pan(evt.deltaX, evt.deltaY);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef]);

  /**
   * Ctrl/Cmd + wheel belongs to the board, wherever the pointer is.
   *
   * The canvas listener above already claims it over the canvas. This one
   * catches the rest of the window -- the dock, the panels, the overlays --
   * because a pinch over the toolbar that zooms the *browser* leaves the app
   * at a scale it does not know about and cannot undo. Every canvas tool
   * owns this gesture for the same reason.
   *
   * The two listeners coordinate through `defaultPrevented`, which is what
   * the platform provides for exactly this. They coordinated through a
   * `__vegaZoomHandled` property monkey-patched onto the event and read back
   * through two `as any` casts -- a private protocol between two functions
   * in the same file, reinvented on top of one the browser already has.
   *
   * What is deliberately *not* here any more:
   *
   *   - **The keyboard zoom.** Ctrl/Cmd with =, - and 0 was implemented here
   *     a third time, in capture phase, so it ran before `useRoomShortcuts`'s
   *     own copy and left it dead. That copy checks whether you are typing
   *     first; this one did not, so the shortcut fired inside text fields.
   *     Removing it restores the guarded implementation rather than adding a
   *     guard to the duplicate.
   *   - **Document-wide gesture suppression.** `gesturestart` and friends
   *     were cancelled on the whole document, which takes Safari's pinch-zoom
   *     away from the panels and the dialogs as well as from the board. It is
   *     scoped to the canvas, which is the only place it was ever aimed at.
   */
  useEffect(() => {
    const el = containerRef.current;

    const onWindowWheel = (evt: WheelEvent) => {
      if (!evt.ctrlKey && !evt.metaKey) return;
      // The canvas listener has already zoomed for this event.
      if (evt.defaultPrevented) return;
      evt.preventDefault();
      cameraSystem.zoomByWheel(evt.deltaY, evt.clientX, evt.clientY);
    };

    // Safari's own pinch, over the board only.
    const onGesture = (e: Event) => e.preventDefault();

    window.addEventListener('wheel', onWindowWheel, { passive: false });
    el?.addEventListener('gesturestart', onGesture, { passive: false });
    el?.addEventListener('gesturechange', onGesture, { passive: false });
    el?.addEventListener('gestureend', onGesture, { passive: false });

    return () => {
      window.removeEventListener('wheel', onWindowWheel);
      el?.removeEventListener('gesturestart', onGesture);
      el?.removeEventListener('gesturechange', onGesture);
      el?.removeEventListener('gestureend', onGesture);
    };
  }, [containerRef]);

  const touchMetrics = (touches: TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    return {
      dist: Math.hypot(dx, dy) || 1,
      midX: (a.clientX + b.clientX) / 2,
      midY: (a.clientY + b.clientY) / 2,
    };
  };

  const handleTouchStartNative = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      isMultiTouchRef.current = true;
      pinchRef.current = touchMetrics(e.touches as unknown as TouchList);
      onCancelInteractions?.();
    }
  };

  const handleTouchMoveNative = (e: React.TouchEvent) => {
    if (e.touches.length < 2 || !pinchRef.current) return;
    e.preventDefault();

    const next = touchMetrics(e.touches as unknown as TouchList);
    const prev = pinchRef.current;

    cameraSystem.zoomBy(next.dist / prev.dist, next.midX, next.midY);
    cameraSystem.panBy(next.midX - prev.midX, next.midY - prev.midY);

    pinchRef.current = next;
  };

  const handleTouchEndNative = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchRef.current = null;
      if (e.touches.length === 0) isMultiTouchRef.current = false;
    }
  };

  return {
    dimensions,
    isMultiTouchRef,
    handleTouchStartNative,
    handleTouchMoveNative,
    handleTouchEndNative,
  };
}
