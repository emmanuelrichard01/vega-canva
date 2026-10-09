import React, { useEffect, useRef } from 'react';
import { engineEvents } from '../../engine/EventBus';
import { cameraSystem } from '../../engine/CameraSystem';
import { hud, type HudEntry } from '../../engine/ui/hud';
import { formatHud, type HudText } from '../../engine/ui/hudFormat';
import { placeHudPill, worldBoxToScreen, worldPointToScreen } from '../../engine/ui/hudPlace';
import { installLineReadout } from './lineReadoutSink';
import './hud.css';

interface Pill {
  el: HTMLDivElement;
  text: string;
  snapCount: number;
}

/** The pill's children: the snap tick, then the value and its quieter separators. */
function fill(el: HTMLDivElement, text: HudText): void {
  const tick = document.createElement('i');
  tick.className = 'hud-pill__tick';
  // One inline run for the text, so its own spaces set the rhythm and the
  // pill's flex gap only separates the tick from it.
  const run = document.createElement('span');
  run.className = 'hud-pill__text';
  for (const part of text.parts) {
    if (part.role === 'value') {
      run.append(part.text);
    } else {
      const span = document.createElement('span');
      span.className = 'hud-pill__muted';
      span.textContent = part.text;
      run.append(span);
    }
  }
  el.replaceChildren(tick, run);
}

/**
 * Draws every readout in `hud` as a screen-space pill over the board.
 *
 * DOM rather than Konva: the text is crisp at every zoom, takes tabular
 * figures and theme tokens, and none of it can end up in an export. The pills
 * are written directly from the store's notification and the camera's, with
 * no React render per pointer move, so a readout costs the same as moving one
 * element.
 *
 * Mounted inside `.canvas-overlays`, whose origin is the stage's, so a board
 * point on screen is `world * zoom + camera`.
 */
export const HudLayer: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const pills = new Map<string, Pill>();
    const reducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const draw = () => {
      const entries = hud.get();
      for (const [source, pill] of pills) {
        if (!entries.has(source)) {
          pill.el.remove();
          pills.delete(source);
        }
      }
      if (entries.size === 0) return;

      const camera = { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom || 1 };
      const viewport = { width: root.clientWidth, height: root.clientHeight };

      // Writes first, then one read of every size, then the positions: a single
      // layout pass however many pills are up.
      const pending: Array<{ pill: Pill; entry: HudEntry }> = [];
      for (const entry of entries.values()) {
        let pill = pills.get(entry.source);
        if (!pill) {
          const el = document.createElement('div');
          el.className = 'hud-pill';
          root.appendChild(el);
          pill = { el, text: '', snapCount: entry.snapCount };
          pills.set(entry.source, pill);
        }
        const text = formatHud(entry.readout, camera.zoom);
        if (text.text !== pill.text) {
          fill(pill.el, text);
          pill.text = text.text;
        }
        pill.el.dataset.tone = entry.tone;
        pill.el.dataset.kind = entry.readout.kind;
        pill.el.dataset.snapped = entry.snapped ? 'true' : 'false';
        if (entry.snapCount > pill.snapCount) {
          pill.snapCount = entry.snapCount;
          if (!reducedMotion?.matches) {
            // Restart the pulse: drop the attribute, let the style settle, set it again.
            pill.el.removeAttribute('data-pulse');
            void pill.el.offsetWidth;
            pill.el.dataset.pulse = 'true';
          }
        }
        pending.push({ pill, entry });
      }

      const sizes = pending.map(({ pill }) => ({ width: pill.el.offsetWidth, height: pill.el.offsetHeight }));

      pending.forEach(({ pill, entry }, i) => {
        const placed = placeHudPill({
          anchor: worldPointToScreen(entry.at, camera),
          box: entry.box ? worldBoxToScreen(entry.box, camera) : null,
          size: sizes[i],
          viewport,
          placement: entry.placement,
        });
        pill.el.dataset.side = placed.side;
        // Whole pixels, so the text never lands on a half pixel and blurs.
        pill.el.style.transform = `translate3d(${Math.round(placed.x)}px, ${Math.round(placed.y)}px, 0)`;
      });
    };

    const onAnimationEnd = (e: AnimationEvent) => {
      if (e.animationName === 'hud-snap') (e.target as HTMLElement).removeAttribute('data-pulse');
    };
    root.addEventListener('animationend', onAnimationEnd);

    const offStore = hud.subscribe(draw);
    const offCamera = engineEvents.on('CameraChanged', draw);
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    resize?.observe(root);
    const uninstallLine = installLineReadout();
    draw();

    return () => {
      offStore();
      offCamera();
      resize?.disconnect();
      uninstallLine();
      root.removeEventListener('animationend', onAnimationEnd);
      pills.forEach((pill) => pill.el.remove());
      pills.clear();
    };
  }, []);

  // Decorative for assistive technology: the same values are in the Properties
  // panel, and announcing a number on every pointer move would drown a screen
  // reader.
  return <div ref={rootRef} className="hud-layer" aria-hidden="true" />;
};
