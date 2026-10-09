import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../../hooks/useStore';
import { cameraSystem } from '../../../engine/CameraSystem';
import { engineEvents } from '../../../engine/EventBus';
import { railVeil, type VeilKind } from '../../../engine/interaction/railVeil';
import { textEditing } from '../../../engine/interaction/textEditing';
import { inflate, placeRail, selectionHull, type RailSide, type Rect } from '../../../engine/interaction/railPlacement';
import { setRailSubject } from '../railSubject';
import {
  DEFAULT_HEADER_H,
  EDGE_MARGIN,
  chromeFromTokens,
  chromeInset,
  freeStrip,
  popoverStrip,
  POPOVER_MARGIN,
  readFrameTokens,
  subjectInView,
  type ChromeMetrics,
} from './railBounds';

/** The rail's resting height, used before it has been measured. */
const RAIL_HEIGHT = 40;

/**
 * Clearance between the rail and the selection, per side.
 *
 * Larger below than above: `--shadow-float` falls downward, and a rail under
 * an object reads as a caption attached to it, so it wants more air there.
 * `placeRail` widens all four as the subject gets thin.
 */
const STANDOFF = { top: 26, bottom: 34, left: 20, right: 20 };

/** How far the transformer's handles stand proud of the object's box. */
const HANDLE_REACH = 6;

/** The chrome the rail measures, by selector. */
const LEFT_PANEL = '.hierarchy-panel';
const RIGHT_PANEL = '.context-inspector';
const DOCK = '.tool-dock';
/** A closed column's header, floating in its top corner. */
const PILL = '.board-pill';

export interface RailPlacement {
  /** The outer anchor, positioned by writing its transform directly. */
  anchorRef: React.RefObject<HTMLDivElement | null>;
  /** The rail itself, whose measured size is an input to where it goes. */
  railRef: React.RefObject<HTMLDivElement | null>;
  placement: RailSide;
  /** False when the selection left nowhere to stand, so the rail rests veiled. */
  clear: boolean;
  isVisible: boolean;
}

/**
 * Where the rail goes, recomputed only when something that decides it changes.
 *
 * The triggers are the camera, the selection's objects moving or changing,
 * the chrome resizing (side panels, the dock and its shelf, the rail itself),
 * the shell republishing its frame tokens, the window, and the gesture veil.
 * Each burst of them costs at most one placement on the next frame. Nothing
 * runs between them, and nothing runs at all while the rail is hidden, veiled
 * or suspended for an editor that brings its own bar.
 *
 * The free strip comes from the shell's frame tokens (`--inset-top`, falling
 * back to `--header-h`, and `--inset-left` / `--inset-right`), read once per
 * chrome change. Where a side token is absent the panel's edge is measured.
 *
 * Position is written to the anchor's transform, never through React. Only the
 * side, the veiled state and visibility are state, because they decide what is
 * rendered and change a handful of times a session.
 */
export function useRailPlacement(opts: {
  activeId: string | null;
  isBulk: boolean;
  selectedIds: readonly string[] | undefined;
  sidebarsVisible: boolean;
  /** An editor with its own bar is open on the selection: place nothing, listen to nothing. */
  suspended?: boolean;
}): RailPlacement {
  const { activeId, isBulk, selectedIds, sidebarsVisible, suspended = false } = opts;
  const anchorRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<RailSide>('top');
  const [clear, setClear] = useState(true);
  const [isVisible, setIsVisible] = useState(false);

  const bulkIdsRef = useRef<readonly string[]>(selectedIds ?? []);
  bulkIdsRef.current = selectedIds ?? [];
  // A different set of objects is a different placement, even at the same count.
  const bulkKey = isBulk ? (selectedIds ?? []).join(',') : '';

  const lastRef = useRef({ x: -9999, y: -9999, placement: 'top' as RailSide, clear: true, visible: false });
  /** The element the last transform went to: a remounted rail must get its first write. */
  const wroteToRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if ((!activeId && !isBulk) || suspended) {
      lastRef.current.visible = false;
      setIsVisible(false);
      return;
    }
    lastRef.current = { ...lastRef.current, x: -9999, y: -9999, visible: false };

    const chrome: ChromeMetrics = { headerH: DEFAULT_HEADER_H, dockH: 0, insetLeft: EDGE_MARGIN, insetRight: EDGE_MARGIN };
    const stageOrigin = { left: 0, top: 0 };
    /** The shell's raw edges, for the popovers' strip. */
    const popEdges = { top: DEFAULT_HEADER_H, left: 0, right: 0, dock: 0 };
    let pills: Rect[] = [];

    /** Chrome geometry: read when the chrome changes, not on every placement. */
    const measureChrome = () => {
      const left = document.querySelector(LEFT_PANEL)?.getBoundingClientRect() ?? null;
      const right = document.querySelector(RIGHT_PANEL)?.getBoundingClientRect() ?? null;
      const tokens = readFrameTokens();
      const measuredLeft = chromeInset(left, 'left', window.innerWidth);
      const measuredRight = chromeInset(right, 'right', window.innerWidth);
      Object.assign(chrome, chromeFromTokens(tokens, { insetLeft: measuredLeft, insetRight: measuredRight }));
      // The dock's own top edge, shelf included, rather than a token about it.
      const dock = document.querySelector(DOCK)?.getBoundingClientRect();
      chrome.dockH = dock && dock.height > 0 ? Math.max(0, window.innerHeight - dock.top) : 0;
      // A popover keeps off the same chrome, with the tokens taken as published
      // (a closed column is 0, not the rail's 16) and `--dock-h` as a floor.
      popEdges.top = chrome.headerH;
      popEdges.left = tokens.insetLeft ?? (left && left.width > 0 ? measuredLeft : 0);
      popEdges.right = tokens.insetRight ?? (right && right.width > 0 ? measuredRight : 0);
      popEdges.dock = dock && dock.height > 0 ? Math.max(chrome.dockH, tokens.dockH ?? 0) : 0;
      pills = Array.from(document.querySelectorAll(PILL), (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? inflate({ x: r.left, y: r.top, width: r.width, height: r.height }, POPOVER_MARGIN) : null;
      }).filter((r): r is Rect => r !== null);
      const canvas = document.querySelector('.konvajs-content')?.getBoundingClientRect();
      if (canvas) {
        stageOrigin.left = canvas.left;
        stageOrigin.top = canvas.top;
      }
    };

    const hide = () => {
      if (lastRef.current.visible) {
        lastRef.current.visible = false;
        setIsVisible(false);
      }
    };

    const place = () => {
      if (railVeil.held) return hide();
      const ids = isBulk ? bulkIdsRef.current : activeId ? [activeId] : [];
      const store = useStore.getState().objects;
      const hull = selectionHull(ids.map((id) => store[id]).filter(Boolean));
      if (!hull) return hide();

      const zoom = cameraSystem.zoom;
      const onScreen = inflate(
        {
          x: stageOrigin.left + hull.x * zoom + cameraSystem.x,
          y: stageOrigin.top + hull.y * zoom + cameraSystem.y,
          width: hull.width * zoom,
          height: hull.height * zoom,
        },
        HANDLE_REACH
      );
      const bounds = freeStrip(chrome, { width: window.innerWidth, height: window.innerHeight }, sidebarsVisible);
      // Panned out of sight: no rail pinned to the window edge beside nothing.
      if (!subjectInView(onScreen, bounds)) return hide();
      const rail = {
        width: railRef.current?.offsetWidth || 0,
        height: railRef.current?.offsetHeight || RAIL_HEIGHT,
      };
      const spot = placeRail(onScreen, rail, bounds, STANDOFF, lastRef.current.placement);
      // Published for the popovers, which must not open onto the artwork.
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setRailSubject({
        subject: onScreen,
        bounds,
        side: spot.side,
        room: popoverStrip(popEdges, viewport, sidebarsVisible),
        obstacles: sidebarsVisible ? pills : [],
      });
      const rx = Math.round(spot.x);
      const ry = Math.round(spot.y);
      const last = lastRef.current;
      if (anchorRef.current && (wroteToRef.current !== anchorRef.current || last.x !== rx || last.y !== ry)) {
        wroteToRef.current = anchorRef.current;
        last.x = rx;
        last.y = ry;
        anchorRef.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      }
      if (last.placement !== spot.side) {
        last.placement = spot.side;
        setPlacement(spot.side);
      }
      if (last.clear !== spot.clear) {
        last.clear = spot.clear;
        setClear(spot.clear);
      }
      if (!last.visible) {
        last.visible = true;
        setIsVisible(true);
        // The rail mounts on this state change; place again once it has a size.
        schedule();
      }
    };

    // One placement per frame at most, however many triggers arrive in it.
    let frame = 0;
    let chromeDirty = true;
    const schedule = () => {
      // Hidden under a gesture: nothing to place until the veil lifts, which schedules again.
      if (frame || railVeil.held) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (chromeDirty) {
          chromeDirty = false;
          measureChrome();
        }
        place();
        observeRail();
      });
    };
    const scheduleChrome = () => {
      chromeDirty = true;
      schedule();
    };

    const observer = new ResizeObserver(scheduleChrome);
    for (const sel of [LEFT_PANEL, RIGHT_PANEL, DOCK]) {
      const el = document.querySelector(sel);
      if (el) observer.observe(el);
    }
    // The rail's own size decides where it fits; its element changes with the subject.
    let observedRail: HTMLElement | null = null;
    const railObserver = new ResizeObserver(schedule);
    const observeRail = () => {
      const el = railRef.current;
      if (el === observedRail) return;
      if (observedRail) railObserver.unobserve(observedRail);
      observedRail = el;
      if (el) railObserver.observe(el);
    };

    // The shell republishes its frame by toggling attributes on the root.
    const tokenObserver = new MutationObserver(scheduleChrome);
    tokenObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-surface', 'data-left-panel', 'data-right-panel', 'style', 'class'],
    });

    const onVeil = () => {
      if (railVeil.held) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        hide();
      } else schedule();
    };
    const handleDragStart = (e: Event) => {
      railVeil.begin((e as CustomEvent<{ kind?: VeilKind }>).detail?.kind ?? 'gesture');
    };
    const handleDragEnd = () => railVeil.end();
    // A gesture that never announced its end is falsified by the pointer coming
    // up with nothing being typed into.
    const handlePointerRelease = () => {
      railVeil.settle(textEditing.getSnapshot());
    };
    const onObjectChange = (node: { id?: string } | undefined) => {
      if (!node?.id) return schedule();
      const ids = isBulk ? bulkIdsRef.current : activeId ? [activeId] : [];
      if (ids.includes(node.id)) schedule();
    };

    const unsubscribeVeil = railVeil.subscribe(onVeil);
    engineEvents.on('CameraChanged', schedule);
    engineEvents.on('ObjectMoved', onObjectChange);
    engineEvents.on('ObjectModified', onObjectChange);
    window.addEventListener('resize', scheduleChrome);
    window.addEventListener('canvas-drag-start', handleDragStart);
    window.addEventListener('canvas-drag-end', handleDragEnd);
    window.addEventListener('pointerup', handlePointerRelease, true);
    window.addEventListener('pointercancel', handlePointerRelease, true);
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      unsubscribeVeil();
      observer.disconnect();
      railObserver.disconnect();
      tokenObserver.disconnect();
      engineEvents.off('CameraChanged', schedule);
      engineEvents.off('ObjectMoved', onObjectChange);
      engineEvents.off('ObjectModified', onObjectChange);
      window.removeEventListener('resize', scheduleChrome);
      window.removeEventListener('canvas-drag-start', handleDragStart);
      window.removeEventListener('canvas-drag-end', handleDragEnd);
      window.removeEventListener('pointerup', handlePointerRelease, true);
      window.removeEventListener('pointercancel', handlePointerRelease, true);
    };
  }, [activeId, isBulk, bulkKey, sidebarsVisible, suspended]);

  return { anchorRef, railRef, placement, clear, isVisible };
}
