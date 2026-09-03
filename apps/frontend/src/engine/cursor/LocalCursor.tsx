import React, { useEffect, useState } from 'react';
import { cursorOverride } from './cursorOverride';
import { chromeVisual, cursorVisual, precisionVisual } from './cursorVisual';
import { cursorCss, FALLBACK } from './cursorCss';
import type { CursorMode } from './toolCursor';

/**
 * Installs our pointer art as real CSS cursors. Draws nothing.
 *
 * ## Why this component no longer renders anything
 *
 * It used to portal a `<div>` to the body and move it inside the pointer
 * event. That was rebuilt once for latency — no React in the hot path, no
 * listener churn, the transform written synchronously — and it still trailed
 * the hand, because the gap was never in the code.
 *
 * A DOM element is composited **with the page**. The write lands in the
 * pointer event, the browser composites on the next frame, and the frame
 * reaches the screen a refresh later. The OS cursor skips all of it: the
 * compositor draws it on its own path, ahead of page paint, and updates it
 * between frames on most platforms. One frame behind is the *floor* for a
 * drawn pointer, and `cursorCss` has the longer version of why.
 *
 * `toolCursor.ts` opens by saying this about the implementation *it* replaced.
 * A drawn pointer was reintroduced anyway, and this is the second time the
 * same lesson has been paid for.
 *
 * So the art stays and the element goes. `cursorVisual` still produces every
 * pointer in this product — the five-fingered hand, the per-tool badges, the
 * theme-aware palette, the eraser with its hotspot at the nib — and each one
 * becomes a `url()` cursor the compositor draws at zero latency.
 *
 * ## What this leaves the component doing
 *
 * Writing custom properties, a handful of times a session. `--cursor-tool`
 * changes when the tool or the theme changes; an attribute swaps in the Alt
 * variant. Everything else — which surface gets which cursor, the hand closing
 * on `:active`, a text field keeping its I-beam — is a static rule in
 * `index.css`, because CSS already resolves "what is under the pointer" for
 * free and correctly. Doing that in JavaScript is what put a per-event target
 * test in the pointer path in the first place.
 *
 * ## What is gone, and what that costs
 *
 * There is no `cursor: none` anywhere any more, so the failure this area kept
 * producing — the suppression outliving the thing meant to replace it, leaving
 * a window with no pointer — is now impossible rather than merely handled. And
 * there is no second pointer to double up with, because there is only ever one
 * cursor.
 *
 * The press *dip* is gone: a CSS cursor cannot animate. It was a 90ms scale on
 * the one element nobody looks at directly, and keeping it cost a frame of
 * latency on every move. Everything with meaning is a swap rather than an
 * animation and survives: the hand closes on press, the badge follows the
 * tool, Alt shows the duplicate badge.
 */

interface Props {
  mode: CursorMode;
  /** The canvas surface, which carries the tool cursor. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The armed tool, which decides the badge. */
  activeTool?: string;
}

/**
 * The theme and accent the art is drawn in, kept live.
 *
 * Read off the document rather than passed down, because the theme is a body
 * class and the accent is a custom property — the two places the design system
 * already keeps them. It fires once per toggle, never at interaction rate.
 */
function useCursorTheme(): { dark: boolean; accent: string } {
  const read = () => {
    if (typeof document === 'undefined') return { dark: false, accent: '#2563EB' };
    return {
      dark: document.body.classList.contains('dark-theme'),
      accent: getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#2563EB',
    };
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const sync = () =>
      setTheme((prev) => {
        const next = read();
        return prev.dark === next.dark && prev.accent === next.accent ? prev : next;
      });
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * Whether to leave the OS pointer entirely alone.
 *
 * A drawn *image* cannot honour the pointer size and contrast the OS was asked
 * for, so under forced colors and on a coarse pointer the keyword cursors are
 * used instead — which is the whole reason `FALLBACK` names a real one for
 * every mode rather than defaulting to an arrow.
 */
function useNativePointer(): boolean {
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
}

const TOOL_VARS = ['--cursor-tool', '--cursor-alt', '--cursor-grab', '--cursor-precise'] as const;
const ROOT_VARS = ['--cursor-arrow', '--cursor-text'] as const;

export const LocalCursor: React.FC<Props> = ({ mode, containerRef, activeTool }) => {
  const { dark, accent } = useCursorTheme();
  const native = useNativePointer();

  /**
   * The cursors, written as custom properties on the container and the root.
   *
   * One effect, running when the tool or the theme changes — a handful of
   * times a session. Nothing here is on any hot path, which is the point of
   * having moved the drawing to the compositor.
   */
  useEffect(() => {
    const container = containerRef.current;
    const root = document.documentElement;
    if (!container) return;

    const clear = () => {
      TOOL_VARS.forEach((v) => container.style.removeProperty(v));
      ROOT_VARS.forEach((v) => root.style.removeProperty(v));
    };

    if (native) {
      // Keyword cursors only. The static rules in `index.css` still map every
      // mode to a real one, so the board keeps a pointer that says what the
      // next press will do.
      clear();
      return;
    }

    const fallback = FALLBACK[mode] ?? 'default';
    container.style.setProperty(
      '--cursor-tool',
      cursorCss(cursorVisual(mode, activeTool, accent, dark), fallback)
    );
    // The closed hand, for `:active` while panning. A swap, not an animation —
    // which is why the one press response worth having survives the move to
    // CSS cursors.
    container.style.setProperty(
      '--cursor-grab',
      cursorCss(cursorVisual('grab', activeTool, accent, dark), 'grabbing')
    );

    /**
     * The Alt variant, pre-built so holding Alt is one property lookup.
     *
     * Only where Alt means something: it duplicates on a *select* drag, and
     * promising that over the pen or the eraser would be a cursor lying about
     * what the next gesture does.
     */
    if (mode === 'pointer' && activeTool !== 'direct-select') {
      container.style.setProperty(
        '--cursor-alt',
        cursorCss(cursorVisual('pointer', 'alt-duplicate', accent, dark), 'copy')
      );
    } else {
      container.style.removeProperty('--cursor-alt');
    }

    /**
     * The precision crosshair, for Caps Lock.
     *
     * Only for the modes that put something at a point. Caps Lock over the
     * *select* tool would trade an arrow for a crosshair and tell the user
     * nothing — the arrow is not in the way of anything when the gesture is
     * "pick the thing under me".
     */
    if (mode !== 'pointer' && mode !== 'pan' && mode !== 'grab') {
      container.style.setProperty(
        '--cursor-precise',
        cursorCss(precisionVisual(dark), 'crosshair')
      );
    } else {
      container.style.removeProperty('--cursor-precise');
    }

    // The chrome pointers live on the root, so every page this app renders has
    // them — the dashboard and the sign-in screen as much as the board.
    root.style.setProperty('--cursor-arrow', cursorCss(chromeVisual('ui', dark), 'default'));
    root.style.setProperty('--cursor-text', cursorCss(chromeVisual('text', dark), 'text'));

    return clear;
  }, [containerRef, mode, activeTool, accent, dark, native]);

  /**
   * Alt held, as an attribute on the root.
   *
   * On the root rather than the container because the key can be pressed while
   * the pointer is anywhere, and a stale "Alt is down" is a cursor claiming the
   * next drag duplicates when it does not. `blur` clears it for the case the
   * key is released while another window has focus — which is what Alt+Tab
   * does every single time, and is the reason this needs a falsifier at all.
   */
  useEffect(() => {
    const root = document.documentElement;
    const set = (on: boolean) => {
      if (on) root.dataset.altHeld = 'on';
      else delete root.dataset.altHeld;
    };
    /**
     * Caps Lock rides along here, because it is read the same way and from the
     * same events.
     *
     * `getModifierState` rather than watching for the key itself: Caps Lock is
     * a *lock*, so the keydown that turns it on and the keydown that turns it
     * off are the same event, and tracking presses would invert the state
     * every time. Reading the lock's actual position on every key means the
     * app also agrees with a Caps Lock that was already on before the page
     * loaded, and with one toggled while another window had focus.
     */
    const set2 = (on: boolean) => {
      if (on) root.dataset.precise = 'on';
      else delete root.dataset.precise;
    };
    const key = (e: KeyboardEvent) => {
      set(e.altKey);
      set2(e.getModifierState?.('CapsLock') === true);
    };
    const clear = () => set(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', clear);
      set(false);
      set2(false);
    };
  }, []);

  /**
   * A claimed cursor, applied to the container.
   *
   * ## Why a custom property, and not `style.cursor`, which is what it was
   *
   * Because that silently did nothing, and it did nothing for the same reason
   * the original double-cursor bug did: **the value was written to one element
   * while the decision was made on another.**
   *
   * The claim was an inline `cursor` on `.canvas-container`. The board's
   * cursor is decided by a rule targeting the Konva `<canvas>` — a *child*. An
   * inline style on a parent only reaches a child with no cursor of its own,
   * and this child has an explicit rule, so the claim lost every time. Every
   * claim-based cursor in the app was dead at once: the resize anchors, the
   * path anchors, the line vertices, the connector ends, the corner radius,
   * the crop and reframe overlays, and the rotate zones — which is where it
   * was noticed, because rotation is the one with no other affordance to fall
   * back on.
   *
   * A custom property is the fix rather than a workaround: custom properties
   * *inherit*, so it reaches the canvas wherever the rule that reads it lives,
   * and every board rule resolves it first. One writer, one name, and the
   * cascade arbitrates instead of a specificity coincidence.
   *
   * Outside the `native` guard, still: a resize arrow is a real OS cursor and
   * has to work on a coarse pointer and under forced colors.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const apply = () => {
      const claimed = cursorOverride.get();
      if (claimed) container.style.setProperty('--cursor-claim', claimed);
      else container.style.removeProperty('--cursor-claim');
    };
    apply();
    return cursorOverride.subscribe(apply);
  }, [containerRef]);

  /**
   * A press ending releases every claim.
   *
   * The falsifier from `cursorOverride`: Konva does not fire `mouseleave` for a
   * node destroyed under the pointer, and every handle that claims is
   * conditionally rendered, so a claim can outlive its owner. A handle still
   * under the pointer re-claims on the next move, so a wrongly-cleared claim
   * costs one frame and a stuck one costs a reload.
   */
  useEffect(() => {
    const up = () => cursorOverride.releaseAll();
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('blur', up);
    };
  }, []);

  return null;
};
