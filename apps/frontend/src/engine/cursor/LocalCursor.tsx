import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { CURSOR_ART } from './cursorArt';
import type { CursorMode } from './toolCursor';

/**
 * Our own pointer, drawn over the canvas.
 *
 * The previous attempt at this was removed because it was a frame late, and it
 * was a frame late for one specific reason: it read a stored coordinate inside
 * a `requestAnimationFrame` loop. The pointer had already moved by the time the
 * frame ran, every time, forever. **This writes the transform inside the
 * pointer event itself**, which is the earliest moment the position is known.
 * Nothing here is scheduled.
 *
 * It also subscribes to `pointerrawupdate` where that exists. The browser
 * coalesces `pointermove` to roughly one event per frame; the raw stream is not
 * coalesced, so on a high-polling-rate mouse the cursor lands on intermediate
 * positions the coalesced stream never reports.
 *
 * Scope is deliberately the canvas only. Panels, the header and every other
 * surface keep the real OS pointer, because there is nothing to gain by
 * replacing an arrow with an arrow and a great deal to lose.
 */

interface LocalCursorProps {
  mode: CursorMode;
  /** The canvas surface. The custom pointer exists only over this element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Conditions under which we hand the pointer straight back to the OS.
 *
 * A drawn cursor cannot honour the pointer-size or high-contrast settings a
 * person has chosen at the system level, so where those are in play the native
 * cursor is not a fallback, it is the correct answer. `index.css` still carries
 * a full set of native `[data-cursor-mode]` rules underneath this for exactly
 * that case.
 */
const useNativePointer = () => {
  const [native, setNative] = useState(false);
  useEffect(() => {
    const queries = [
      // No pointer to replace.
      window.matchMedia('(pointer: coarse)'),
      // The OS is driving colour; do not paint over it.
      window.matchMedia('(forced-colors: active)'),
    ];
    const sync = () => setNative(queries.some((q) => q.matches));
    sync();
    queries.forEach((q) => q.addEventListener('change', sync));
    return () => queries.forEach((q) => q.removeEventListener('change', sync));
  }, []);
  return native;
};

export const LocalCursor: React.FC<LocalCursorProps> = ({ mode, containerRef }) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [inside, setInside] = useState(false);
  const insideRef = useRef(false);
  const native = useNativePointer();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || native) return;

    const place = (e: PointerEvent) => {
      const node = nodeRef.current;
      if (!node) return;
      // Written now, in the event, not in a later frame. This is the whole
      // reason the old implementation felt laggy and this one does not.
      node.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };

    /**
     * Any pointer event on the canvas proves the pointer is on the canvas.
     *
     * This used to key off `pointerenter` alone, and that left the canvas with
     * **no pointer at all** in a very ordinary situation: whenever this mounts
     * while the mouse is already over it. Reloading with the cursor on the
     * board does it, and so does signing in, because the auth modal unmounts
     * and the room appears underneath a mouse that never crossed a boundary.
     * No `pointerenter` is ever sent for a pointer that was already there, so
     * the drawn cursor stayed at `opacity: 0` while the native one was hidden,
     * until you moved off the canvas and back on.
     */
    const track = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
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
    };

    // Not coalesced, so it reports positions `pointermove` skips. Chromium and
    // Firefox have it; Safari does not, hence the pair.
    const RAW = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    container.addEventListener(RAW, track as EventListener, { passive: true });
    container.addEventListener('pointerenter', track as EventListener, { passive: true });
    container.addEventListener('pointerleave', leave, { passive: true });
    // A drag can carry the pointer outside the canvas; keep drawing it there
    // rather than having it wink out mid-gesture. Position only — being over a
    // panel is not being on the canvas.
    window.addEventListener('pointerup', place as EventListener, { passive: true });

    return () => {
      container.removeEventListener(RAW, track as EventListener);
      container.removeEventListener('pointerenter', track as EventListener);
      container.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerup', place as EventListener);
    };
  }, [containerRef, native]);

  /**
   * Hand the surface over to the drawn cursor **only while one is being
   * drawn**.
   *
   * `data-custom-cursor` is what makes `index.css` apply `cursor: none`, and
   * it used to be set the moment this mounted — before this component had any
   * idea where the pointer was, or whether it was over the canvas at all. That
   * is a hidden system cursor with nothing in its place, which is the exact
   * failure the previous cursor system was rewritten to eliminate.
   *
   * Tying it to `inside` makes the invariant structural rather than a matter of
   * getting the event bookkeeping right: the attribute cannot be on unless the
   * drawn pointer is visible. A layout effect, so both flip in the same paint
   * and you never see two cursors for a frame.
   */
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || native || !inside) return;
    container.dataset.customCursor = 'on';
    return () => {
      delete container.dataset.customCursor;
    };
  }, [containerRef, native, inside]);

  if (native) return null;

  const art = CURSOR_ART[mode] ?? CURSOR_ART.pointer;

  return ReactDOM.createPortal(
    <div
      ref={nodeRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        // Above every panel, and never a hit-test target — a pointer that can
        // be clicked is a pointer that swallows its own clicks.
        zIndex: 2147483647,
        pointerEvents: 'none',
        willChange: 'transform',
        // Hidden until the pointer has actually been somewhere, so it never
        // flashes at the origin on mount.
        opacity: inside ? 1 : 0,
      }}
    >
      {/* The art is offset so its active point lands exactly on the pointer.
          No transition on this: tools swap instantly by design. */}
      <div style={{ transform: `translate(${art.offsetX}px, ${art.offsetY}px)` }}>
        {art.render()}
      </div>
    </div>,
    document.body
  );
};
