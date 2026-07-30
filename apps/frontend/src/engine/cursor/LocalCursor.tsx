import React, { useEffect, useRef, useState } from 'react';
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
  const native = useNativePointer();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || native) return;

    // Tells `index.css` to drop the native cursor for this surface. Set from
    // here rather than in the markup so that if this component is not mounted
    // — or bails out above — the native cursors are still in force and the
    // canvas is never left with no pointer at all.
    container.dataset.customCursor = 'on';

    const move = (e: PointerEvent) => {
      const node = nodeRef.current;
      if (!node) return;
      // Written now, in the event, not in a later frame. This is the whole
      // reason the old implementation felt laggy and this one does not.
      node.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };

    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      move(e);
      setInside(true);
    };
    const leave = () => setInside(false);

    // Not coalesced, so it reports positions `pointermove` skips. Chromium and
    // Firefox have it; Safari does not, hence the pair.
    const RAW = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    container.addEventListener(RAW, move as EventListener, { passive: true });
    container.addEventListener('pointerenter', enter, { passive: true });
    container.addEventListener('pointerleave', leave, { passive: true });
    // A drag can carry the pointer outside the canvas; keep drawing it there
    // rather than having it wink out mid-gesture.
    window.addEventListener('pointerup', move as EventListener, { passive: true });

    return () => {
      delete container.dataset.customCursor;
      container.removeEventListener(RAW, move as EventListener);
      container.removeEventListener('pointerenter', enter);
      container.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerup', move as EventListener);
    };
  }, [containerRef, native]);

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
