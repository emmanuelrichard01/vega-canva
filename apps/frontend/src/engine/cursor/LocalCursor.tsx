import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { CURSOR_ART } from './cursorArt';
import type { CursorMode } from './toolCursor';

/**
 * Our own pointer, drawn over the canvas.
 *
 * ## Senior-Level Cursor Architecture:
 * 1. **Zero Latency**: Transform written synchronously inside pointer events (`pointerrawupdate` / `pointermove`).
 * 2. **Zero Double-Cursor Collision**: Synchronous detection + MutationObserver instantly stands down the custom cursor whenever native handle cursors (resize, rotate, move) are set inline on the container, with 0ms transition delay.
 * 3. **Tactile Micro-Interactions**: Subtle physical scale dip on `pointerdown` for instant tactile click feedback.
 * 4. **Alt/Option Duplication Badge**: Displays a floating `+` duplication badge when holding Alt/Option with the select pointer.
 * 5. **OS Accessibility**: Yields completely to native OS cursors for forced-colors or touch/coarse pointers.
 */

interface LocalCursorProps {
  mode: CursorMode;
  /** The canvas surface. The custom pointer exists only over this element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The currently active tool ID, to suppress duplication badge when using direct-select. */
  activeTool?: string;
}

/**
 * Conditions under which we hand the pointer straight back to the OS.
 */
const useNativePointer = () => {
  const [native, setNative] = useState(false);
  useEffect(() => {
    const queries = [
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(forced-colors: active)'),
    ];
    const sync = () => setNative(queries.some((q) => q.matches));
    sync();
    queries.forEach((q) => q.addEventListener('change', sync));
    return () => queries.forEach((q) => q.removeEventListener('change', sync));
  }, []);
  return native;
};

export const LocalCursor: React.FC<LocalCursorProps> = ({ mode, containerRef, activeTool }) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [inside, setInside] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isAltHeld, setIsAltHeld] = useState(false);
  const [hasInlineCursor, setHasInlineCursor] = useState(false);
  const hasInlineCursorRef = useRef(false);
  const insideRef = useRef(false);
  const native = useNativePointer();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || native) return;

    const checkInline = () => {
      const inline = Boolean(container.style.cursor && container.style.cursor !== 'none');
      if (inline !== hasInlineCursorRef.current) {
        hasInlineCursorRef.current = inline;
        setHasInlineCursor(inline);
      }
      return inline;
    };

    const place = (e: PointerEvent) => {
      const node = nodeRef.current;
      if (!node) return;
      node.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      if (Boolean(e.altKey) !== isAltHeld) {
        setIsAltHeld(Boolean(e.altKey));
      }
    };

    const track = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      checkInline();
      place(e);
      if (!insideRef.current) {
        insideRef.current = true;
        setInside(true);
      }
    };

    const leave = () => {
      if (!insideRef.current) return;
      insideRef.current = false;
      setInside(false);
      setIsPressed(false);
    };

    const handleDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && insideRef.current) {
        setIsPressed(true);
      }
    };

    const handleUp = () => {
      setIsPressed(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltHeld(true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltHeld(false);
    };

    const handleBlur = () => {
      setIsAltHeld(false);
      setIsPressed(false);
    };

    const handleDragStart = () => {
      if (insideRef.current) setIsPressed(true);
    };

    const handleDragEnd = () => {
      setIsPressed(false);
    };

    const RAW = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    container.addEventListener(RAW, track as EventListener, { passive: true });
    container.addEventListener('pointerenter', track as EventListener, { passive: true });
    container.addEventListener('pointerleave', leave, { passive: true });
    container.addEventListener('pointerdown', handleDown as EventListener, { passive: true });
    window.addEventListener('pointerup', handleUp, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('canvas-drag-start', handleDragStart);
    window.addEventListener('canvas-drag-end', handleDragEnd);

    return () => {
      container.removeEventListener(RAW, track as EventListener);
      container.removeEventListener('pointerenter', track as EventListener);
      container.removeEventListener('pointerleave', leave);
      container.removeEventListener('pointerdown', handleDown as EventListener);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('canvas-drag-start', handleDragStart);
      window.removeEventListener('canvas-drag-end', handleDragEnd);
    };
  }, [containerRef, native, isAltHeld]);

  // Observe container.style.cursor so custom cursor gracefully stands down on handles
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const check = () => {
      const inline = Boolean(container.style.cursor && container.style.cursor !== 'none');
      if (inline !== hasInlineCursorRef.current) {
        hasInlineCursorRef.current = inline;
        setHasInlineCursor(inline);
      }
    };

    check();
    const observer = new MutationObserver(check);
    observer.observe(container, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [containerRef]);

  /**
   * Structural dataset synchronization: data-custom-cursor is only present
   * while the custom cursor is actively drawing.
   */
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || native || !inside || hasInlineCursor) {
      if (container) delete container.dataset.customCursor;
      return;
    }
    container.dataset.customCursor = 'on';
    return () => {
      delete container.dataset.customCursor;
    };
  }, [containerRef, native, inside, hasInlineCursor]);

  if (native) return null;

  const art = CURSOR_ART[mode] ?? CURSOR_ART.pointer;
  const isVisible = inside && !hasInlineCursor;

  return ReactDOM.createPortal(
    <div
      ref={nodeRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 2147483647,
        pointerEvents: 'none',
        willChange: 'transform',
        opacity: isVisible ? 1 : 0,
        display: isVisible ? 'block' : 'none',
      }}
    >
      <div
        style={{
          transform: `translate(${art.offsetX}px, ${art.offsetY}px) scale(${isPressed ? 0.92 : 1})`,
          transition: 'transform 80ms cubic-bezier(0.16, 1, 0.3, 1)',
          transformOrigin: `${-art.offsetX}px ${-art.offsetY}px`,
        }}
      >
        {art.render()}

        {/* Duplicate indicator badge when holding Alt/Option with default select pointer */}
        {isAltHeld && mode === 'pointer' && (activeTool === undefined || activeTool === 'select') && (
          <div
            style={{
              position: 'absolute',
              left: 18,
              top: 18,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#2563EB',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              border: '1.5px solid #FFFFFF',
              userSelect: 'none',
              pointerEvents: 'none',
              animation: 'cursorBadgePop 120ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            +
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
