import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { addGuide } from '../../engine/document/guides';
import { tickLabel, tickStep, ticksFor } from '../../engine/interaction/rulerTicks';

/** Ruler thickness, in CSS pixels. Matches the corner square. */
export const RULER_SIZE = 22;

interface Props {
  width: number;
  height: number;
}

/**
 * Subscribe to the camera without owning a frame loop.
 *
 * The engine already publishes `CameraChanged`, and the rulers are the only
 * chrome that has to redraw on every pan. Reading the camera through
 * `useSyncExternalStore` keyed on a monotonic counter re-renders exactly this
 * component and nothing else — a `requestAnimationFrame` loop here would
 * redraw the ruler sixty times a second on a canvas nobody is touching.
 */
function useCameraTick(): number {
  const tick = useRef(0);
  return useSyncExternalStore(
    useCallback((notify: () => void) => {
      const bump = () => {
        tick.current += 1;
        notify();
      };
      engineEvents.on('CameraChanged', bump);
      return () => engineEvents.off('CameraChanged', bump);
    }, []),
    () => tick.current,
    () => tick.current
  );
}

/**
 * The horizontal and vertical rulers, and the corner between them.
 *
 * DOM rather than Konva. The stage is a raster surface with its own transform,
 * and putting the rulers on it would mean either fighting that transform on
 * every tick or drawing text through a canvas rasteriser that has no hinting.
 * The numbers on a ruler are small, dense and read at a glance — which is the
 * one case where the DOM's text rendering is not merely adequate but the whole
 * point.
 *
 * Pressing on a ruler pulls out a guide. There is no separate "add guide"
 * command, because the ruler is the only place the gesture means anything and
 * every tool in this category has taught people to reach for it there.
 */
export const Rulers: React.FC<Props> = ({ width, height }) => {
  useCameraTick();
  const [dragging, setDragging] = useState<{ axis: 'x' | 'y'; position: number } | null>(null);

  const zoom = cameraSystem.zoom;
  const step = tickStep(zoom);

  // The world range each ruler covers. The rulers sit *outside* the stage, so
  // their origin is the stage origin shifted by their own thickness.
  const xTicks = ticksFor(
    -cameraSystem.x / zoom,
    (width - cameraSystem.x) / zoom,
    zoom,
    cameraSystem.x
  );
  const yTicks = ticksFor(
    -cameraSystem.y / zoom,
    (height - cameraSystem.y) / zoom,
    zoom,
    cameraSystem.y
  );

  /**
   * Viewport coordinates to the world, through the stage's own origin.
   *
   * `Canvas` places the Konva stage at `top: RULER_SIZE, left: RULER_SIZE` so
   * the rulers can sit outside it, and `screenToWorld` works in *stage* space.
   * Both axes therefore have to lose the ruler's thickness before conversion.
   *
   * This existed inline and subtracted `RULER_SIZE` from **y only**, three
   * times over — so every vertical guide dragged out of the top ruler landed
   * 22 world-units to the right of the pointer at 100% zoom, and further as you
   * zoomed out. The horizontal ones were correct, which is exactly why it
   * survived: half of the feature worked.
   */
  const cornerRef = useRef<HTMLDivElement>(null);

  const toWorld = (clientX: number, clientY: number) => {
    // Measured, not assumed. This used to subtract a hardcoded `RULER_SIZE`
    // from the raw client coordinate, which silently encoded "the canvas area
    // starts at the top-left of the window" — true until the viewport moved
    // below the header, and never true for the left edge at all.
    //
    // The corner square sits at the canvas area's own origin, so its rect is
    // the one measurement that answers both axes and keeps answering them if
    // the shell moves again.
    const origin = cornerRef.current?.getBoundingClientRect();
    const left = origin ? origin.left : 0;
    const top = origin ? origin.top : 0;
    return cameraSystem.screenToWorld(clientX - left - RULER_SIZE, clientY - top - RULER_SIZE);
  };

  // Tracked on the window so the gesture survives the pointer leaving the
  // 22px ruler, which it does immediately — the whole point is to drag away
  // from it onto the canvas.
  useEffect(() => {
    if (!dragging) return;

    const move = (e: MouseEvent) => {
      const world = toWorld(e.clientX, e.clientY);
      setDragging({ axis: dragging.axis, position: dragging.axis === 'x' ? world.x : world.y });
    };
    const up = (e: MouseEvent) => {
      const world = toWorld(e.clientX, e.clientY);
      const position = dragging.axis === 'x' ? world.x : world.y;
      // Released back over either ruler means "I changed my mind".
      //
      // The axes used to be crossed here: a vertical guide, which is dragged
      // *down* from the top ruler, tested `clientX` against the **left**
      // ruler — so backing out the way you came in placed the guide anyway,
      // and sliding sideways into a ruler you had never touched cancelled a
      // drag you meant to keep. Testing both edges is also simply more
      // forgiving than testing the one you started from.
      const origin = cornerRef.current?.getBoundingClientRect();
      const overRuler = origin
        ? e.clientX < origin.left + RULER_SIZE || e.clientY < origin.top + RULER_SIZE
        : false;
      if (!overRuler) addGuide(dragging.axis, position);
      setDragging(null);
    };
    // Escape abandons the drag, matching every other in-progress gesture in
    // the app. Without it the only way out was to find a ruler to release on.
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDragging(null);
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', key);
    };
  }, [dragging]);

  /**
   * Where the pointer is, marked on both rulers.
   *
   * The thing a ruler is actually *for*, and it was missing: without it the
   * rulers report where the world is but never where **you** are, so reading a
   * position off them means sighting along the screen by eye. Two hairlines
   * turn them from a printed scale into an instrument.
   *
   * Written straight to the DOM rather than through React state. This fires on
   * every mouse move over the canvas, and re-rendering a component holding a
   * few hundred tick elements at pointer rate is precisely the cost the
   * presence layer's frame loop exists to avoid — the same rule, applied here.
   */
  const hMark = useRef<HTMLDivElement>(null);
  const vMark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const h = hMark.current;
      const v = vMark.current;
      if (!h || !v) return;
      // Positioned in each ruler's own space, which already begins at the
      // stage origin — so these take the raw client coordinate minus the
      // ruler thickness, exactly as `toWorld` does.
      const origin = cornerRef.current?.getBoundingClientRect();
      const left = origin ? origin.left : 0;
      const top = origin ? origin.top : 0;
      h.style.transform = `translateX(${e.clientX - left - RULER_SIZE}px)`;
      v.style.transform = `translateY(${e.clientY - top - RULER_SIZE}px)`;
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  const start = (axis: 'x' | 'y') => (e: React.MouseEvent) => {
    e.preventDefault();
    const world = toWorld(e.clientX, e.clientY);
    setDragging({ axis, position: axis === 'x' ? world.x : world.y });
  };

  return (
    <>
      <div ref={cornerRef} className="ruler ruler--corner" aria-hidden />

      <div
        className="ruler ruler--h"
        onMouseDown={start('x')}
        role="presentation"
        // Named for the tooltip rather than as a control: a ruler is a surface
        // you drag from, and announcing it as a button would promise a click
        // that does nothing.
        data-tooltip="Drag down for a vertical guide"
      >
        {xTicks.map((t) => (
          <div
            key={t.value}
            className={`ruler__tick ${t.major ? 'is-major' : ''}`}
            style={{ left: `${t.offset}px` }}
          >
            {t.major && <span className="ruler__label">{tickLabel(t.value, step)}</span>}
          </div>
        ))}
        <div ref={hMark} className="ruler__cursor ruler__cursor--h" aria-hidden="true" />
      </div>

      <div
        className="ruler ruler--v"
        onMouseDown={start('y')}
        role="presentation"
        data-tooltip="Drag right for a horizontal guide"
      >
        {yTicks.map((t) => (
          <div
            key={t.value}
            className={`ruler__tick ${t.major ? 'is-major' : ''}`}
            style={{ top: `${t.offset}px` }}
          >
            {t.major && <span className="ruler__label">{tickLabel(t.value, step)}</span>}
          </div>
        ))}
        <div ref={vMark} className="ruler__cursor ruler__cursor--v" aria-hidden="true" />
      </div>

      {/* The guide being pulled out, drawn as DOM so it is visible over the
          rulers themselves — a Konva preview would be clipped to the stage and
          disappear under the ruler you are dragging from. */}
      {dragging && (
        <div
          className="ruler__preview"
          // `+ RULER_SIZE` because this preview is a sibling of the rulers,
          // whose container starts at the canvas area's corner — while the
          // arithmetic inside the brackets is in *stage* space, which begins
          // one ruler-thickness further in. Without it the preview sat 22px
          // off the guide it was previewing, in both axes.
          style={
            dragging.axis === 'x'
              ? { left: `${dragging.position * zoom + cameraSystem.x + RULER_SIZE}px`, top: 0, bottom: 0, width: 1 }
              : { top: `${dragging.position * zoom + cameraSystem.y + RULER_SIZE}px`, left: 0, right: 0, height: 1 }
          }
        />
      )}
    </>
  );
};
