import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronLeft, ChevronRight, GalleryHorizontalEnd, X } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { presentableFrames, presentationOrder, slidePose } from '../../engine/model/frames';
import { nodeBounds } from '../../engine/model/selection';
import { keyBelongsToFocus } from '../../engine/interaction/keyTarget';
import { isPresenting, presenterKeyAction, setPresenterKeys, setPresenting } from '../../engine/tools/presenting';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { WorkspaceCover } from '../WorkspaceCover';
import { Emoji } from '../emoji/Emoji';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { framePreview, reorderSlides } from './FramePresenterThumbs';
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
 * It reads the board and writes nothing, so viewers can present too. While it
 * runs the board is inert: `engine/tools/presenting` swallows every board key,
 * wheel and pointer event, and the selection is cleared on start. Only
 * top-level frames are slides, and a rotated frame is fitted by its rotated
 * bounds.
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

function boardNodes(): Record<string, AnyNode> {
  return useStore.getState().objects as Record<string, AnyNode>;
}

function boardFrames(): FrameNode[] {
  return presentationOrder(presentableFrames(Object.values(boardNodes())) as FrameNode[]);
}

/** The slide a frame occupies on the board: its rotated bounds. */
function slideBox(frame: FrameNode): { x: number; y: number; width: number; height: number } {
  return nodeBounds(frame);
}

/** The top-level frame that holds `id`, or `id` itself when it is one. */
function topLevelFrameId(id: string | undefined): string | undefined {
  const objects = boardNodes();
  let node = id ? objects[id] : undefined;
  for (let hops = 0; node?.frameId && hops < 32; hops++) node = objects[node.frameId];
  return node?.id;
}

/** The stage's box in viewport coordinates. */
function stageRect(): Rect {
  const r = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  return r
    ? { left: r.left, top: r.top, width: r.width, height: r.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

export const FramePresenter: React.FC = () => {
  const [frameIds, setFrameIds] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [stripOpen, setStripOpen] = useState(false);
  const savedPose = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const enteredFullscreen = useRef(false);

  const active = frameIds !== null && frameIds.length > 0;

  // The current slide is read from the board by id, so a collaborator who
  // moves, resizes or rotates it is followed rather than shown stale.
  const frame = useStore((s) => {
    const id = frameIds?.[index];
    const node = id ? (s.objects as Record<string, AnyNode>)[id] : undefined;
    return node && node.type === 'frame' ? (node as FrameNode) : undefined;
  });

  /** Fit a frame in the stage; sizing and centring both come from `stageRect`. */
  const fit = useCallback((target: FrameNode) => {
    const stage = stageRect();
    const pose = slidePose(slideBox(target), stage, FIT_PADDING);
    cameraSystem.animateTo(pose.x, pose.y, pose.zoom, { duration: prefersReducedMotion() ? 0 : 420 });
  }, []);

  const stop = useCallback(() => {
    setFrameIds(null);
    setPresenting(false);
    const pose = savedPose.current;
    savedPose.current = null;
    if (pose) cameraSystem.animateTo(pose.x, pose.y, pose.zoom, { duration: prefersReducedMotion() ? 0 : 320 });
    const wasFullscreen = enteredFullscreen.current;
    enteredFullscreen.current = false;
    if (wasFullscreen && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
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
      setFrameIds(list.map((f) => f.id));
      setIndex(clamped);
      fit(list[clamped]);
    },
    [fit, stop]
  );

  // Start on request.
  useEffect(() => {
    const onStart = (e: Event) => {
      // Already presenting: the saved pose is the board's, not this slide's.
      if (isPresenting()) return;
      const list = boardFrames();
      if (list.length === 0) {
        setNotice('Add a frame to present this board.');
        window.setTimeout(() => setNotice(null), 2600);
        return;
      }
      const startId = topLevelFrameId((e as CustomEvent<{ startId?: string }>).detail?.startId);
      const start = Math.max(
        0,
        list.findIndex((f) => f.id === startId)
      );
      savedPose.current = { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom };
      // Synchronous, so no board key can slip in before the first render.
      setPresenting(true);
      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [] } }));
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused !== document.body) focused.blur?.();
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        enteredFullscreen.current = true;
        document.documentElement
          .requestFullscreen()
          .then(() => {
            // The show ended while the browser was deciding.
            if (!isPresenting()) {
              enteredFullscreen.current = false;
              document.exitFullscreen?.().catch(() => {});
            }
          })
          .catch(() => {
            enteredFullscreen.current = false;
          });
      }
      setFrameIds(list.map((f) => f.id));
      setIndex(start);
      fit(list[start]);
    };
    window.addEventListener('presentFrames', onStart);
    return () => window.removeEventListener('presentFrames', onStart);
  }, [fit]);

  // The board is never left locked if the presenter unmounts mid-show.
  useEffect(() => () => setPresenting(false), []);

  // Follow the slide when it changes on the board; if it was deleted, move on.
  const frameGeometry = frame
    ? `${frame.x}|${frame.y}|${frame.width}|${frame.height}|${frame.rotation}|${frame.scaleX}|${frame.scaleY}`
    : '';
  useEffect(() => {
    if (!active) return;
    if (frame) fit(frame);
    else go(index);
    // `frame` is read through its geometry: other edits to it do not refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameGeometry, active]);

  // Keep the letterbox on the frame while the camera moves, and refit when the
  // window (or fullscreen) changes size.
  useEffect(() => {
    if (!active) return;
    const onCamera = () => setTick((t) => t + 1);
    const onResize = () => {
      const current = frameIds ? boardNodes()[frameIds[index]] : undefined;
      if (current?.type === 'frame') fit(current as FrameNode);
    };
    engineEvents.on('CameraChanged', onCamera);
    window.addEventListener('resize', onResize);
    return () => {
      engineEvents.off('CameraChanged', onCamera);
      window.removeEventListener('resize', onResize);
    };
  }, [active, frameIds, index, fit]);

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

  // Presentation keys. The presenting gate hands them over before any board
  // shortcut can see them.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // Alt+Left/Right on a focused slide thumbnail moves that slide. Keys
      // never reach the strip itself: the presenting gate claims them all.
      const thumb = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('.fp-strip__thumb');
      if (thumb && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const from = Number(thumb.dataset.index);
        const to = from + (e.key === 'ArrowLeft' ? -1 : 1);
        const currentId = frameIds?.[index];
        if (to >= 0 && frameIds && to < frameIds.length && reorderSlides(boardNodes(), from, to)) {
          const list = boardFrames();
          setFrameIds(list.map((f) => f.id));
          setIndex(Math.max(0, list.findIndex((f) => f.id === currentId)));
          requestAnimationFrame(() => document.querySelectorAll<HTMLElement>('.fp-strip__thumb')[to]?.focus());
        }
        return;
      }
      const onControl = !!document.activeElement?.closest?.('.fp-root');
      const action = presenterKeyAction(e.key, {
        focusOwnsKey: !onControl && keyBelongsToFocus(e.key),
        onControl,
      });
      if (!action) return;
      if (action === 'stop') stop();
      else if (action === 'next') go(index + 1);
      else if (action === 'previous') go(index - 1);
      else if (action === 'first') go(0);
      else go(Number.MAX_SAFE_INTEGER);
      e.preventDefault();
    };
    setPresenterKeys(onKey);
    return () => setPresenterKeys(null);
  }, [active, index, go, stop, frameIds]);

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

  const count = frameIds.length;
  const slideFrame = frame ?? boardNodes()[frameIds[index]];
  if (!slideFrame || slideFrame.type !== 'frame') return null;
  const box = slideBox(slideFrame as FrameNode);
  const title = (slideFrame as FrameNode).title || 'Untitled frame';
  const stage = stageRect();
  const slide: Rect = {
    left: stage.left + box.x * cameraSystem.zoom + cameraSystem.x,
    top: stage.top + box.y * cameraSystem.zoom + cameraSystem.y,
    width: box.width * cameraSystem.zoom,
    height: box.height * cameraSystem.zoom,
  };
  const right = slide.left + slide.width;
  const icon = (slideFrame as FrameNode).icon;
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
        aria-label={`Slide ${index + 1} of ${count}: ${title}. Click for next.`}
      />

      <div className="fp-hud" role="toolbar" aria-label="Presentation controls">
        <button type="button" className="fp-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide">
          <ChevronLeft size={18} />
        </button>
        <span className="fp-count" aria-live="polite">
          <strong>{index + 1}</strong> / {count}
          <span className="fp-title">
            {icon && <Emoji native={icon} size={14} />}
            {title}
          </span>
        </span>
        <button
          type="button"
          className="fp-btn"
          onClick={() => go(index + 1)}
          disabled={index === count - 1}
          aria-label="Next slide"
        >
          <ChevronRight size={18} />
        </button>
        <span className="fp-sep" aria-hidden="true" />
        <button
          type="button"
          className="fp-btn"
          onClick={() => setStripOpen((o) => !o)}
          aria-label="Slides"
          aria-expanded={stripOpen}
          aria-pressed={stripOpen}
        >
          <GalleryHorizontalEnd size={16} />
        </button>
        <button type="button" className="fp-btn" onClick={stop} aria-label="Stop presenting">
          <X size={16} />
        </button>
      </div>

      {stripOpen && (
        <SlideStrip
          ids={frameIds}
          index={index}
          onGo={(i) => go(i)}
          onMoved={(currentId) => {
            const list = boardFrames();
            setFrameIds(list.map((f) => f.id));
            setIndex(Math.max(0, list.findIndex((f) => f.id === currentId)));
          }}
        />
      )}
    </div>,
    document.body
  );
};

/**
 * The deck, as a strip of thumbnails above the controls.
 *
 * Click a slide to go to it. Editors can drag one to a new place, or move the
 * focused one with Alt+Left and Alt+Right; the new order is written to the
 * board as one undoable edit and every presenter follows it. Thumbnails are
 * drawn from the document, so a slide nobody has scrolled to still has one.
 */
const SlideStrip: React.FC<{
  ids: string[];
  index: number;
  onGo: (i: number) => void;
  onMoved: (currentId: string) => void;
}> = ({ ids, index, onGo, onMoved }) => {
  const objects = useStore((s) => s.objects) as Record<string, AnyNode>;
  const { canEdit } = useRoomPermissions();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const currentId = ids[index];

  const move = (from: number, to: number) => {
    if (reorderSlides(objects, from, to)) onMoved(currentId);
  };
  const previews = useMemo(() => new Map(ids.map((id) => [id, framePreview(id, objects)])), [ids, objects]);

  return (
    <ol className="fp-strip" aria-label="Slides">
      {ids.map((id, i) => {
        const frame = objects[id];
        if (!frame || frame.type !== 'frame') return null;
        const label = frame.title || 'Untitled frame';
        return (
          <li
            key={id}
            className="fp-strip__item"
            data-current={i === index || undefined}
            data-drop={dropAt === i && dragFrom !== null && dragFrom !== i ? (dragFrom < i ? 'after' : 'before') : undefined}
            draggable={canEdit}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDropAt(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) move(dragFrom, i);
              setDragFrom(null);
              setDropAt(null);
            }}
          >
            <button
              type="button"
              className="fp-strip__thumb"
              data-index={i}
              aria-current={i === index ? 'true' : undefined}
              aria-label={`Slide ${i + 1}: ${label}${canEdit ? '. Alt+Left or Alt+Right to move it.' : ''}`}
              onClick={() => onGo(i)}
            >
              <WorkspaceCover workspaceId={`slide:${id}`} name={label} preview={previews.get(id) ?? null} />
            </button>
            <span className="fp-strip__label">
              <span className="fp-strip__num">{i + 1}</span>
              {frame.icon && <Emoji native={frame.icon} size={12} />}
              <span className="fp-strip__name">{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
};
