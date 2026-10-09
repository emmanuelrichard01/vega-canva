import { useState, useEffect, useRef } from 'react';
import { cameraSystem } from '../engine/CameraSystem';
import { presenceManager } from '../engine/presence/PresenceManager';
import { engineEvents } from '../engine/EventBus';
import { GestureRecognizer, type GestureEffect, type GestureInput } from '../engine/interaction/gestures';

export interface CanvasNavigationOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<any>;
  /** Abandon the tool's press in progress (a second finger, a long-press). */
  onCancelInteractions?: () => void;
  /** A long-press at this client point: open the context menu there. */
  onLongPress?: (clientX: number, clientY: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function useCanvasNavigation({
  containerRef,
  onCancelInteractions,
  onLongPress,
  onUndo,
  onRedo,
}: CanvasNavigationOptions) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

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
        zoom: cameraSystem.reportedZoom,
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

  /**
   * Touch and pen gestures, through the pure recogniser.
   *
   * Read from the container's pointer events in the capture phase, which the
   * browser fires before the touch events the stage listens to — so by the
   * time the stage hears a `touchstart`, `touchMayDriveTool` already knows
   * whether that contact belongs to the tool, the camera or a resting palm.
   * Mouse pointers are ignored by the recogniser, so none of this runs on a
   * desktop.
   */
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  if (!recognizerRef.current) recognizerRef.current = new GestureRecognizer();
  const lastPointerTypeRef = useRef<string>('mouse');
  const callbacksRef = useRef({ onCancelInteractions, onLongPress, onUndo, onRedo });
  callbacksRef.current = { onCancelInteractions, onLongPress, onUndo, onRedo };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const g = recognizerRef.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Camera anchors are stage-relative; the stage is inset by the rulers and header. */
    const stageOrigin = () => {
      const rect = el.querySelector('.konvajs-content')?.getBoundingClientRect();
      return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
    };

    const apply = (effects: GestureEffect[]) => {
      for (const fx of effects) {
        switch (fx.type) {
          case 'cancel-primary':
            callbacksRef.current.onCancelInteractions?.();
            break;
          case 'camera': {
            const o = stageOrigin();
            if (fx.panX || fx.panY) cameraSystem.panBy(fx.panX, fx.panY);
            if (fx.scale !== 1) cameraSystem.zoomBy(fx.scale, fx.cx - o.left, fx.cy - o.top, true);
            break;
          }
          case 'long-press':
            callbacksRef.current.onLongPress?.(fx.x, fx.y);
            break;
          case 'undo':
            callbacksRef.current.onUndo?.();
            break;
          case 'redo':
            callbacksRef.current.onRedo?.();
            break;
          // Double-tap is served by the stage's own `dbltap` handlers (edit
          // text, a sticky or a label; enter a group). The recogniser only
          // has to keep it from counting as anything else.
          default:
            break;
        }
      }
    };

    const schedule = () => {
      clearTimeout(timer);
      const due = g.nextDeadline();
      if (due === null) return;
      timer = setTimeout(() => {
        apply(g.tick(performance.now()));
      }, Math.max(0, due - performance.now()));
    };

    const feed = (kind: GestureInput['kind']) => (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        lastPointerTypeRef.current = 'mouse';
        return;
      }
      if (kind === 'down') {
        lastPointerTypeRef.current = e.pointerType;
        // Only contacts that land on the board start or join a gesture; a tap
        // on a DOM overlay inside the container is that overlay's.
        const board = el.querySelector('.konvajs-content');
        const onBoard = !!board && !!e.target && board.contains(e.target as Node);
        if (!onBoard && !g.navigating) return;
      }
      const effects = g.handle({ kind, id: e.pointerId, pointerType: e.pointerType, x: e.clientX, y: e.clientY, t: performance.now() });
      if (g.navigating && e.cancelable && kind === 'move') e.preventDefault();
      apply(effects);
      schedule();
    };

    const down = feed('down');
    const move = feed('move');
    const up = feed('up');
    const cancel = feed('cancel');
    el.addEventListener('pointerdown', down, true);
    // Moves and releases are heard on the window: a finger that slides off the
    // board mid-pinch must still lift.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      g.reset();
    };
  }, [containerRef]);

  /**
   * May this stage event reach the active tool?
   *
   * Mouse events always may: that is the desktop, and the pen on platforms
   * that deliver it as a mouse. A touch event may when the recogniser gave the
   * contact to the tool — one finger — or when a stylus is drawing and the
   * event carries it (`touchType === 'stylus'`, which is how iPadOS delivers
   * Apple Pencil). A pinch, a pan and a resting palm never reach the tool.
   */
  const touchMayDriveTool = (evt: Event | undefined): boolean => {
    if (!evt || typeof evt.type !== 'string' || !evt.type.startsWith('touch')) return true;
    const owner = recognizerRef.current!.owner;
    if (owner === 'touch') return true;
    if (owner !== 'pen') return false;
    if (evt.type === 'touchmove' || evt.type === 'touchend' || evt.type === 'touchcancel') return true;
    const changed = (evt as TouchEvent).changedTouches;
    if (!changed) return false;
    for (let i = 0; i < changed.length; i++) {
      if ((changed[i] as Touch & { touchType?: string }).touchType === 'stylus') return true;
    }
    return false;
  };

  return {
    dimensions,
    touchMayDriveTool,
    /** The kind of pointer that last went down: 'mouse', 'touch' or 'pen'. */
    lastPointerTypeRef,
  };
}
