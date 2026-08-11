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

  // Tracked on the window so the gesture survives the pointer leaving the
  // 22px ruler, which it does immediately — the whole point is to drag away
  // from it onto the canvas.
  useEffect(() => {
    if (!dragging) return;

    const move = (e: MouseEvent) => {
      const world = cameraSystem.screenToWorld(e.clientX, e.clientY - RULER_SIZE);
      setDragging({ axis: dragging.axis, position: dragging.axis === 'x' ? world.x : world.y });
    };
    const up = (e: MouseEvent) => {
      const world = cameraSystem.screenToWorld(e.clientX, e.clientY - RULER_SIZE);
      const position = dragging.axis === 'x' ? world.x : world.y;
      // Released back over the ruler means "I changed my mind", the same way
      // dragging a guide back onto the ruler removes it.
      const overRuler = dragging.axis === 'x' ? e.clientX < RULER_SIZE : e.clientY < RULER_SIZE * 2;
      if (!overRuler) addGuide(dragging.axis, position);
      setDragging(null);
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);

  const start = (axis: 'x' | 'y') => (e: React.MouseEvent) => {
    e.preventDefault();
    const world = cameraSystem.screenToWorld(e.clientX, e.clientY - RULER_SIZE);
    setDragging({ axis, position: axis === 'x' ? world.x : world.y });
  };

  return (
    <>
      <div className="ruler ruler--corner" aria-hidden />

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
      </div>

      {/* The guide being pulled out, drawn as DOM so it is visible over the
          rulers themselves — a Konva preview would be clipped to the stage and
          disappear under the ruler you are dragging from. */}
      {dragging && (
        <div
          className="ruler__preview"
          style={
            dragging.axis === 'x'
              ? { left: `${dragging.position * zoom + cameraSystem.x}px`, top: 0, bottom: 0, width: 1 }
              : { top: `${dragging.position * zoom + cameraSystem.y}px`, left: 0, right: 0, height: 1 }
          }
        />
      )}
    </>
  );
};
