import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { presentationOrder } from '../../engine/model/frames';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import './framePresenter.css';

/**
 * Present the board's frames as slides.
 *
 * Frames are walked in reading order (`presentationOrder`), so a row of
 * frames laid out left to right is already a deck. The camera flies to each
 * frame and fits it; everything outside the frame is covered, chrome
 * included, by a letterbox drawn around the frame's on-screen box. Clicking
 * the slide advances, as in any presentation app. Leaving puts the camera back
 * where it was.
 *
 * It reads the board and writes nothing, so viewers can present too.
 */

/** Screen space kept around a fitted frame. */
const FIT_PADDING = 48;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function boardFrames(): FrameNode[] {
  const all = Object.values(useStore.getState().objects as Record<string, AnyNode>);
  return presentationOrder(all.filter((n): n is FrameNode => n.type === 'frame' && !n.hidden));
}

/** The stage's box in viewport coordinates. */
function stageRect(): Rect {
  const r = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  return r
    ? { left: r.left, top: r.top, width: r.width, height: r.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

export const FramePresenter: React.FC = () => {
  const [frames, setFrames] = useState<FrameNode[] | null>(null);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const savedPose = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const enteredFullscreen = useRef(false);

  const active = frames !== null && frames.length > 0;

  const fit = useCallback((frame: FrameNode) => {
    const stage = stageRect();
    const zoom = Math.min(
      (stage.width - FIT_PADDING * 2) / frame.width,
      (stage.height - FIT_PADDING * 2) / frame.height
    );
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    const x = cameraSystem.width / 2 - cx * zoom;
    const y = cameraSystem.height / 2 - cy * zoom;
    cameraSystem.animateTo(x, y, zoom, { duration: prefersReducedMotion() ? 0 : 420 });
  }, []);

  const stop = useCallback(() => {
    setFrames(null);
    const pose = savedPose.current;
    savedPose.current = null;
    if (pose) cameraSystem.animateTo(pose.x, pose.y, pose.zoom, { duration: prefersReducedMotion() ? 0 : 320 });
    if (enteredFullscreen.current && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    enteredFullscreen.current = false;
  }, []);

  const go = useCallback(
    (next: number) => {
      // Re-read, so a frame added or removed mid-presentation is respected.
      const list = boardFrames();
      if (list.length === 0) {
        stop();
        return;
      }
      const clamped = Math.max(0, Math.min(list.length - 1, next));
      setFrames(list);
      setIndex(clamped);
      fit(list[clamped]);
    },
    [fit, stop]
  );

  // Start on request.
  useEffect(() => {
    const onStart = (e: Event) => {
      const list = boardFrames();
      if (list.length === 0) {
        setNotice('Add a frame to present this board.');
        window.setTimeout(() => setNotice(null), 2600);
        return;
      }
      const startId = (e as CustomEvent<{ startId?: string }>).detail?.startId;
      const start = Math.max(0, list.findIndex((f) => f.id === startId));
      savedPose.current = { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom };
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement
          .requestFullscreen()
          .then(() => {
            enteredFullscreen.current = true;
          })
          .catch(() => {});
      }
      setFrames(list);
      setIndex(start);
      fit(list[start]);
    };
    window.addEventListener('presentFrames', onStart);
    return () => window.removeEventListener('presentFrames', onStart);
  }, [fit]);

  // Keep the letterbox on the frame while the camera moves, and refit when the
  // window (or fullscreen) changes size.
  useEffect(() => {
    if (!active) return;
    const onCamera = () => setTick((t) => t + 1);
    const onResize = () => frames && fit(frames[index]);
    engineEvents.on('CameraChanged', onCamera);
    window.addEventListener('resize', onResize);
    return () => {
      engineEvents.off('CameraChanged', onCamera);
      window.removeEventListener('resize', onResize);
    };
  }, [active, frames, index, fit]);

  // Leaving fullscreen with the browser's own Escape also ends the show.
  useEffect(() => {
    if (!active) return;
    const onFs = () => {
      if (enteredFullscreen.current && !document.fullscreenElement) {
        enteredFullscreen.current = false;
        stop();
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [active, stop]);

  // Presentation keys, claimed before any board shortcut sees them.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
      let handled = true;
      if (e.key === 'Escape') stop();
      else if (forward.includes(e.key)) go(index + 1);
      else if (back.includes(e.key)) go(index - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(Number.MAX_SAFE_INTEGER);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, index, go, stop]);

  if (!active) {
    return notice
      ? ReactDOM.createPortal(
          <div className="fp-notice" role="status">
            {notice}
          </div>,
          document.body
        )
      : null;
  }

  const frame = frames[index];
  const stage = stageRect();
  const slide: Rect = {
    left: stage.left + frame.x * cameraSystem.zoom + cameraSystem.x,
    top: stage.top + frame.y * cameraSystem.zoom + cameraSystem.y,
    width: frame.width * cameraSystem.zoom,
    height: frame.height * cameraSystem.zoom,
  };
  const right = slide.left + slide.width;
  const bottom = slide.top + slide.height;

  return ReactDOM.createPortal(
    <div className="fp-root" role="dialog" aria-modal="true" aria-label="Presenting frames">
      {/* The letterbox: four panels around the slide, so everything that is
          not the slide — board and chrome alike — is covered. */}
      <div className="fp-mask" style={{ left: 0, top: 0, right: 0, height: Math.max(0, slide.top) }} />
      <div className="fp-mask" style={{ left: 0, top: bottom, right: 0, bottom: 0 }} />
      <div className="fp-mask" style={{ left: 0, top: slide.top, width: Math.max(0, slide.left), height: slide.height }} />
      <div className="fp-mask" style={{ left: right, top: slide.top, right: 0, height: slide.height }} />

      {/* The slide itself: clicking it advances. */}
      <button
        type="button"
        className="fp-slide"
        style={{ left: slide.left, top: slide.top, width: slide.width, height: slide.height }}
        onClick={() => go(index + 1)}
        aria-label={`Slide ${index + 1} of ${frames.length}: ${frame.title || 'Untitled frame'}. Click for next.`}
      />

      <div className="fp-hud" role="toolbar" aria-label="Presentation controls">
        <button type="button" className="fp-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide">
          <ChevronLeft size={18} />
        </button>
        <span className="fp-count" aria-live="polite">
          <strong>{index + 1}</strong> / {frames.length}
          <span className="fp-title">{frame.title || 'Untitled frame'}</span>
        </span>
        <button
          type="button"
          className="fp-btn"
          onClick={() => go(index + 1)}
          disabled={index === frames.length - 1}
          aria-label="Next slide"
        >
          <ChevronRight size={18} />
        </button>
        <span className="fp-sep" aria-hidden="true" />
        <button type="button" className="fp-btn" onClick={stop} aria-label="Stop presenting">
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body
  );
};
