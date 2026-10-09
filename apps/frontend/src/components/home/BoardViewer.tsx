import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { Template } from '../../engine/templates/templates';
import { WorkspaceCover } from '../WorkspaceCover';
import { templateCover } from './templateCover';
import { boardPicture, type BoardPicture } from './templatePicture';
import { BAKED_COVERS } from './bakedCovers';
import './gallery.css';

interface Props {
  template: Template;
  /** Where the picture is shown; two viewers of one board must not share ids. */
  slot: string;
  /** Pan and zoom. Off, the board is a still picture fitted to the box. */
  interactive?: boolean;
  label: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const STEP = 1.5;

interface View { k: number; x: number; y: number }
const FIT: View = { k: 1, x: 0, y: 0 };

/**
 * The real board, read-only, in a window you can move around.
 *
 * Fitted to the box at 100%; zoom goes in from there, never out past the fit,
 * because a board smaller than its window is just less board. Drag to pan,
 * Ctrl or ⌘ with the wheel (or a pinch) to zoom at the pointer, the wheel to
 * pan once zoomed, double-click to zoom in at a point or back out to fit.
 * From the keyboard: + and − zoom, 0 fits, arrows pan once zoomed.
 */
export const BoardViewer: React.FC<Props> = ({ template, slot, interactive = false, label }) => {
  const [picture, setPicture] = useState<BoardPicture | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(FIT);
  const [animate, setAnimate] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let live = true;
    setPicture(null);
    setFailed(false);
    setView(FIT);
    boardPicture(template, slot).then(
      (p) => { if (live) setPicture(p); },
      () => { if (live) setFailed(true); }
    );
    return () => { live = false; };
  }, [template, slot]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** The board's size at 100%: fitted into the box, aspect kept. */
  const fit = useMemo(() => {
    if (!picture || !box.w || !box.h) return null;
    const s = Math.min(box.w / picture.bounds.width, box.h / picture.bounds.height);
    return { w: picture.bounds.width * s, h: picture.bounds.height * s };
  }, [picture, box.w, box.h]);

  /** Keep some of the board in the window whatever the pan. */
  const clamp = useCallback((v: View): View => {
    if (!fit) return v;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k));
    const spanX = Math.max(0, (fit.w * k - box.w) / 2 + box.w * 0.25);
    const spanY = Math.max(0, (fit.h * k - box.h) / 2 + box.h * 0.25);
    if (k === 1) return FIT;
    return { k, x: Math.min(spanX, Math.max(-spanX, v.x)), y: Math.min(spanY, Math.max(-spanY, v.y)) };
  }, [fit, box.w, box.h]);

  /** Zoom by `factor` keeping the point (`px`, `py`, from the box centre) still. */
  const zoomAt = useCallback((factor: number, px = 0, py = 0, smooth = false) => {
    const v = viewRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
    const ratio = k / v.k;
    setAnimate(smooth);
    setView(clamp({ k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }));
  }, [clamp]);

  const fromCentre = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left - r.width / 2, py: e.clientY - r.top - r.height / 2 };
  };

  // Wheel has to be a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const { px, py } = fromCentre(e);
        zoomAt(Math.exp(-e.deltaY * 0.0045), px, py);
      } else if (v.k > 1) {
        e.preventDefault();
        setAnimate(false);
        setView(clamp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [interactive, zoomAt, clamp]);

  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0 || viewRef.current.k === 1) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    setAnimate(false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setView(clamp({ k: viewRef.current.k, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    if (viewRef.current.k >= MAX_ZOOM / 2) { setAnimate(true); setView(FIT); return; }
    const { px, py } = fromCentre(e);
    zoomAt(2, px, py, true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive || e.altKey || e.ctrlKey || e.metaKey) return;
    const v = viewRef.current;
    const pan = 64;
    let next: View | null = null;
    if (e.key === '+' || e.key === '=') { zoomAt(STEP, 0, 0, true); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === '-' || e.key === '_') { zoomAt(1 / STEP, 0, 0, true); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === '0') { setAnimate(true); setView(FIT); e.preventDefault(); e.stopPropagation(); return; }
    // Arrows pan a zoomed board; at fit they belong to whatever holds the viewer.
    if (v.k === 1) return;
    if (e.key === 'ArrowLeft') next = { ...v, x: v.x + pan };
    else if (e.key === 'ArrowRight') next = { ...v, x: v.x - pan };
    else if (e.key === 'ArrowUp') next = { ...v, y: v.y + pan };
    else if (e.key === 'ArrowDown') next = { ...v, y: v.y - pan };
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      setAnimate(true);
      setView(clamp(next));
    }
  };

  const fallback = useMemo(() => (failed ? templateCover(template) : null), [failed, template]);
  const zoomed = view.k > 1;
  // The baked cover stands in while the full picture is drawn, so the window is never empty.
  const still = !picture && !failed ? BAKED_COVERS[template.id] : undefined;

  return (
    <div className="bview" data-interactive={interactive || undefined}>
      <div
        ref={boxRef}
        className="bview__window"
        data-state={failed ? 'failed' : picture ? 'ready' : still ? 'still' : 'waiting'}
        data-zoomed={zoomed || undefined}
        data-dragging={dragging || undefined}
        role={interactive ? 'group' : 'img'}
        aria-label={interactive ? `${label}. Plus and minus zoom, 0 fits, arrows pan.` : label}
        aria-roledescription={interactive ? 'board preview' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        {failed ? (
          <WorkspaceCover workspaceId={template.id} name={template.name} preview={fallback} />
        ) : picture && fit ? (
          <div
            className="bview__board"
            data-animate={animate || undefined}
            style={{
              width: fit.w,
              height: fit.h,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            }}
            // Markup written by `boardSvg` from the template's own nodes; every string in it is escaped there.
            dangerouslySetInnerHTML={{ __html: picture.svg }}
          />
        ) : still ? (
          <img className="bview__still" src={still} alt="" decoding="async" draggable={false} />
        ) : null}
      </div>

      {interactive && picture && (
        <div className="bview__zoom" role="group" aria-label="Zoom">
          <button type="button" className="bview__btn" onClick={() => zoomAt(1 / STEP, 0, 0, true)} disabled={!zoomed} aria-label="Zoom out">
            <Minus size={14} aria-hidden="true" />
          </button>
          <button type="button" className="bview__pct" onClick={() => { setAnimate(true); setView(FIT); }} disabled={!zoomed} aria-label="Fit the board">
            {zoomed ? `${Math.round(view.k * 100)}%` : <Maximize2 size={13} aria-hidden="true" />}
          </button>
          <button type="button" className="bview__btn" onClick={() => zoomAt(STEP, 0, 0, true)} disabled={view.k >= MAX_ZOOM} aria-label="Zoom in">
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};
