import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  GalleryHorizontalEnd,
  Maximize,
  Minimize,
  MonitorPlay,
  Users,
  X,
} from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { slidePose } from '../../engine/model/frames';
import { nodeBounds } from '../../engine/model/selection';
import { keyBelongsToFocus } from '../../engine/interaction/keyTarget';
import { createPresenterKeys, isPresenting, PRESENTER_UI, setPresenterKeys, setPresenting } from '../../engine/tools/presenting';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { provider } from '../../engine/document';
import { presenceManager } from '../../engine/presence/PresenceManager';
import { useCollaborators } from '../../engine/presence/useCollaborators';
import { followersOf } from '../../engine/presence/spotlight';
import { deckOf, playableIds } from '../../engine/slides/deck';
import { transitionSpecOf, type TransitionDirection, type TransitionSpec } from '../../engine/slides/slideMeta';
import { show, type ShowCommand } from '../../engine/slides/show';
import { flyPose, type Pose } from '../../engine/slides/fly';
import { DONE, handle, playableTransition, TransitionRunner, type TransitionHandle } from '../../engine/slides/transitionMath';
import { LASER_DRAG_PX, LASER_HOLD_MS, LaserTrail } from '../../engine/slides/laser';
import { isPlaceholder } from '../../engine/slides/placeholderText';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { WorkspaceCover } from '../WorkspaceCover';
import { Emoji } from '../emoji/Emoji';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { framePreview, reorderSlides } from './FramePresenterThumbs';
import { LaserLayer } from '../slides/LaserLayer';
import { ReactionStream } from '../slides/Reactions';
import { SlidesHost } from '../slides/SlidesHost';
import { openPresenterWindow, type PresenterWindow } from '../slides/presenterWindow';
import { isTypingTarget, type PresentRequest } from '../slides/useSlides';
import './framePresenter.css';

const PresenterView = lazy(() => import('../slides/PresenterView'));

/**
 * Present the board's slides.
 *
 * A slide is a visible top-level frame; the deck's order and its skipped
 * slides come from `engine/slides/deck`. The camera travels to each slide and
 * everything outside it is covered by a letterbox drawn around its on-screen
 * box, chrome included. The show itself (which slide, blanked or not, the
 * laser, the timer, whether the room is invited) lives in `engine/slides/show`,
 * so the keyboard, the controls here and the presenter view all drive one
 * state.
 *
 * Arriving at a slide uses the transition it asks for: a glide (the default:
 * the camera flies across the board, pulling back for long trips), a cut, a
 * dissolve or a smart move. Under reduced motion a glide is a cut, and the
 * others are a short fade.
 *
 * It reads the board and writes nothing, so viewers can present too. While it
 * runs the board is inert: `engine/tools/presenting` swallows every board key,
 * wheel and pointer event, and the selection is cleared on start. Unfilled
 * placeholders are hidden from the stage for the length of the show.
 *
 * Keys: arrows, Space, Page Up/Down, Home/End; a number then Enter to jump; B
 * or W to blank the screen; L for the laser; Escape to leave. Holding the
 * pointer on the slide is a laser too.
 */

/** The way back is the way in, reversed. */
const OPPOSITE: Record<TransitionDirection, TransitionDirection> = { left: 'right', right: 'left', up: 'down', down: 'up' };

/** Screen space kept around a fitted slide. */
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

/** Where a slide sits on screen for the camera's current pose. */
function screenBox(frame: AnyNode): Rect {
  const box = nodeBounds(frame);
  const stage = stageRect();
  return {
    left: stage.left + box.x * cameraSystem.zoom + cameraSystem.x,
    top: stage.top + box.y * cameraSystem.zoom + cameraSystem.y,
    width: box.width * cameraSystem.zoom,
    height: box.height * cameraSystem.zoom,
  };
}

/**
 * Lay the letterbox and the slide's hit area around `slide` on screen. The
 * four masks cover everything that is not the slide, chrome included.
 */
function placeLetterbox(root: HTMLElement | null, slide: Rect): void {
  if (!root) return;
  const [top, bottom, left, right] = Array.from(root.querySelectorAll<HTMLElement>(':scope > .fp-mask'));
  const hit = root.querySelector<HTMLElement>(':scope > .fp-slide');
  const r = slide.left + slide.width;
  const b = slide.top + slide.height;
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  if (top) Object.assign(top.style, { left: '0px', top: '0px', right: '0px', height: px(Math.max(0, slide.top)) });
  if (bottom) Object.assign(bottom.style, { left: '0px', top: px(b), right: '0px', bottom: '0px' });
  if (left) Object.assign(left.style, { left: '0px', top: px(slide.top), width: px(Math.max(0, slide.left)), height: px(slide.height) });
  if (right) Object.assign(right.style, { left: px(r), top: px(slide.top), right: '0px', height: px(slide.height) });
  if (hit) Object.assign(hit.style, { left: px(slide.left), top: px(slide.top), width: px(slide.width), height: px(slide.height) });
}

/** The camera pose that fits a slide. */
function poseFor(frame: AnyNode): Pose {
  return slidePose(nodeBounds(frame), stageRect(), FIT_PADDING);
}

/** Where a slide will sit on screen once the camera has fitted it. */
function fittedBox(frame: AnyNode): Rect {
  const pose = poseFor(frame);
  const box = nodeBounds(frame);
  const stage = stageRect();
  return {
    left: stage.left + box.x * pose.zoom + pose.x,
    top: stage.top + box.y * pose.zoom + pose.y,
    width: box.width * pose.zoom,
    height: box.height * pose.zoom,
  };
}

/**
 * Move a played slide to another played slide's place. The deck also holds
 * the skipped slides, so the move is made in the deck's own terms and a
 * skipped slide keeps its place among the others.
 */
function movePlayed(ids: readonly string[], from: number, to: number): boolean {
  const objects = boardNodes();
  const deckIds = deckOf(objects).map((s) => s.frame.id);
  const a = deckIds.indexOf(ids[from]);
  const b = deckIds.indexOf(ids[to]);
  return a >= 0 && b >= 0 && reorderSlides(objects, a, b);
}

const localTool = (): string | null => {
  const tool = provider.awareness?.getLocalState()?.tool;
  return typeof tool === 'string' ? tool : null;
};

type PresenterMode = { mode: 'window'; target: PresenterWindow } | { mode: 'split' } | null;

export const FramePresenter: React.FC = () => {
  const state = useSyncExternalStore(show.subscribe, show.getSnapshot, show.getSnapshot);
  const active = state.active;
  const currentId = state.ids[state.index];
  const [notice, setNotice] = useState<string | null>(null);
  const [stripOpen, setStripOpen] = useState(false);
  const [digits, setDigits] = useState('');
  const [presenter, setPresenter] = useState<PresenterMode>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [laserHeld, setLaserHeld] = useState(false);
  const savedPose = useRef<Pose | null>(null);
  const enteredFullscreen = useRef(false);
  const toolBefore = useRef<string | null>(null);
  const shownId = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => createPresenterKeys(), []);
  const trail = useMemo(() => new LaserTrail(), []);
  const wakeLaser = useRef<() => void>(() => {});
  const press = useRef<{ x: number; y: number; at: number; timer: number; laser: boolean } | null>(null);
  const suppressClick = useRef(false);
  const collaborators = useCollaborators();
  const me = provider.awareness?.clientID;
  const audience = active ? followersOf(collaborators, me).length : 0;

  const dispatch = useCallback((cmd: ShowCommand) => show.dispatch(cmd), []);

  const frame = useStore((s) => {
    const node = currentId ? (s.objects as Record<string, AnyNode>)[currentId] : undefined;
    return node && node.type === 'frame' ? (node as FrameNode) : undefined;
  });

  const say = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 2800);
  }, []);

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------

  /** One transition at a time; a new one, or the end of the show, finishes the last. */
  const runner = useMemo(() => new TransitionRunner(), []);

  /** Put the camera on `target` at once. */
  const cut = useCallback((target: AnyNode) => {
    const to = poseFor(target);
    cameraSystem.setPose(to.x, to.y, to.zoom);
  }, []);

  /**
   * The camera's flight to `target`, as an interruptible transition: driven
   * from a frame loop straight into the camera, and finished by landing.
   */
  const glide = useCallback((target: AnyNode, ms: number, ease: TransitionSpec['ease']): TransitionHandle => {
    const to = poseFor(target);
    const from: Pose = { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom };
    const stage = stageRect();
    let raf = 0;
    const h = handle(() => {
      cancelAnimationFrame(raf);
      cameraSystem.setPose(to.x, to.y, to.zoom);
    });
    if (ms <= 0) {
      h.complete();
      return h;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const p = flyPose(from, to, stage, t, ease);
      cameraSystem.setPose(p.x, p.y, p.zoom);
      if (t < 1) raf = requestAnimationFrame(step);
      else h.complete();
    };
    raf = requestAnimationFrame(step);
    return h;
  }, []);

  // ---------------------------------------------------------------------
  // Starting and stopping
  // ---------------------------------------------------------------------

  useEffect(() => {
    const onStart = (e: Event) => {
      // Already presenting: the saved pose is the board's, not this slide's.
      if (isPresenting()) return;
      const request = ((e as CustomEvent<PresentRequest>).detail ?? {}) as PresentRequest;
      const deck = deckOf(boardNodes());
      const ids = playableIds(deck);
      if (ids.length === 0) {
        say(deck.length > 0 ? 'Every slide is skipped. Show one in the slide view to present.' : 'Add a frame to present this board.');
        return;
      }
      // Start from the asked-for slide, or the next one played after it when it is skipped.
      const startId = topLevelFrameId(request.startId);
      const at = startId ? deck.findIndex((s) => s.frame.id === startId) : -1;
      const startAt = at < 0 ? 0 : Math.max(0, ids.indexOf(deck.slice(at).find((s) => !s.hidden)?.frame.id ?? ids[0]));

      savedPose.current = { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom };
      // Synchronous, so no board key can slip in before the first render.
      setPresenting(true);
      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [] } }));
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused !== document.body) focused.blur?.();

      // The second window first: a browser lets the click open it only while the click is current.
      if (request.presenterView === 'window') {
        const target = openPresenterWindow(document.title);
        if (target) setPresenter({ mode: 'window', target });
        else {
          setPresenter({ mode: 'split' });
          say('The browser blocked the presenter window, so it is on this screen instead.');
        }
      } else if (request.presenterView === 'split') {
        setPresenter({ mode: 'split' });
      }

      if (request.presenterView !== 'split' && !document.fullscreenElement && document.documentElement.requestFullscreen) {
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

      toolBefore.current = localTool();
      presenceManager.updateTool('present');
      shownId.current = null;
      dispatch({ type: 'start', ids, index: startAt, now: Date.now(), everyone: request.everyone });
    };
    window.addEventListener('presentFrames', onStart);
    return () => window.removeEventListener('presentFrames', onStart);
  }, [dispatch, say]);

  // Leaving: put back the camera, the screen, the tool and the invitation.
  const wasActive = useRef(false);
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    runner.settle();
    rootRef.current?.querySelectorAll('.fp-transition').forEach((n) => n.remove());
    setPresenting(false);
    setStripOpen(false);
    setDigits('');
    keys.reset();
    trail.on = false;
    trail.points = [];
    presenceManager.clearCursor();
    presenceManager.updateTool(toolBefore.current ?? 'select');
    presenceManager.setSpotlight(false);
    setPresenter((p) => {
      if (p?.mode === 'window') p.target.close();
      return null;
    });
    const pose = savedPose.current;
    savedPose.current = null;
    if (pose) cameraSystem.animateTo(pose.x, pose.y, pose.zoom, { duration: prefersReducedMotion() ? 0 : 320 });
    const wasFullscreen = enteredFullscreen.current;
    enteredFullscreen.current = false;
    if (wasFullscreen && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [active, keys, trail, runner]);

  // The board is never left locked if the presenter unmounts mid-show.
  useEffect(
    () => () => {
      if (show.getSnapshot().active) show.dispatch({ type: 'stop' });
      setPresenting(false);
    },
    []
  );

  // ---------------------------------------------------------------------
  // Moving between slides
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!active || !currentId) return;
    const target = boardNodes()[currentId];
    if (!target) return;
    const previous = shownId.current;
    shownId.current = currentId;
    const reduced = prefersReducedMotion();
    if (!previous || previous === currentId) {
      // The first slide: the camera flies in from wherever the board was.
      runner.start(() => {
        if (!reduced) return glide(target, previous ? 240 : 620, 'standard');
        cut(target);
        return DONE;
      });
      return;
    }
    const from = boardNodes()[previous];
    const host = rootRef.current;
    if (!from || !host) {
      runner.start(() => {
        cut(target);
        return DONE;
      });
      return;
    }
    // Going back plays the way in to the slide being left, in reverse: a push
    // to the left comes back to the right, and a zoom rises out again.
    const order = show.getSnapshot().ids;
    const back = order.indexOf(currentId) < order.indexOf(previous);
    const leaving = transitionSpecOf(from as FrameNode);
    const arriving = transitionSpecOf(target as FrameNode);
    const zoomOut = back && leaving.kind === 'zoom';
    const spec = playableTransition(back ? { ...leaving, direction: OPPOSITE[leaving.direction] } : arriving, reduced);

    if (spec.kind === 'none') {
      runner.start(() => {
        cut(target);
        return DONE;
      });
      return;
    }
    if (spec.kind === 'glide') {
      runner.start(() => glide(target, spec.ms, spec.ease));
      return;
    }
    runner.start(() => {
      // The player loads on first use; until it does, the old slide stays put.
      let inner: TransitionHandle | null = null;
      const outer = handle(() => {
        if (inner) inner.finish();
        else cut(target);
      });
      const stage = stageRect();
      void import('../slides/transitionPlayer')
        .then(({ playTransition }) => {
          if (outer.settled()) return;
          inner = playTransition({
            spec,
            back: zoomOut,
            fromId: previous,
            toId: currentId,
            from: screenBox(from),
            to: fittedBox(target),
            screen: stage,
            host,
            cut: () => cut(target),
            poses: {
              from: { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom },
              to: poseFor(target),
              stage,
              fit: (box) => slidePose(box, stage, 0),
              set: (p) => cameraSystem.setPose(p.x, p.y, p.zoom),
            },
          });
          void inner.done.then(outer.complete);
        })
        .catch(() => outer.complete());
      return outer;
    });
  }, [active, currentId, cut, glide, runner]);

  // Follow the slide when a collaborator moves or resizes it.
  // Keyed by the slide, so arriving at another slide is not mistaken for this one moving.
  const geometry = frame ? `${frame.id}|${frame.x}|${frame.y}|${frame.width}|${frame.height}|${frame.rotation}|${frame.scaleX}|${frame.scaleY}` : '';
  const lastGeometry = useRef('');
  useEffect(() => {
    if (!active || !frame) return;
    const before = lastGeometry.current;
    lastGeometry.current = geometry;
    const sameSlide = before.startsWith(`${frame.id}|`);
    if (sameSlide && before !== geometry && shownId.current === frame.id) runner.start(() => glide(frame, 240, 'snappy'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, active]);

  // The deck changed while presenting: slides added, removed, skipped or reordered.
  const objects = useStore((s) => (active ? s.objects : null));
  useEffect(() => {
    if (!active || !objects) return;
    dispatch({ type: 'deck', ids: playableIds(deckOf(objects as Record<string, AnyNode>)) });
  }, [active, objects, dispatch]);

  // Keep the letterbox on the slide while the camera moves, written straight
  // to the DOM: the camera moves every frame and React has no part in that.
  // A resize refits the slide.
  useEffect(() => {
    if (!active) return;
    const onCamera = () => {
      const current = currentId ? boardNodes()[currentId] : undefined;
      if (current) placeLetterbox(rootRef.current, screenBox(current));
    };
    const onResize = () => {
      const current = currentId ? boardNodes()[currentId] : undefined;
      if (!current) return;
      runner.settle();
      cut(current);
    };
    engineEvents.on('CameraChanged', onCamera);
    window.addEventListener('resize', onResize);
    return () => {
      engineEvents.off('CameraChanged', onCamera);
      window.removeEventListener('resize', onResize);
    };
  }, [active, currentId, cut, runner]);

  // Leaving fullscreen with the browser's own Escape also ends the show.
  useEffect(() => {
    if (!active) return;
    const onFs = () => {
      setFullscreen(!!document.fullscreenElement);
      if (enteredFullscreen.current && !document.fullscreenElement) {
        enteredFullscreen.current = false;
        dispatch({ type: 'stop' });
      }
    };
    setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [active, dispatch]);

  // The presenter window closed by hand: the show goes on without it.
  useEffect(() => {
    if (presenter?.mode !== 'window') return;
    const t = window.setInterval(() => {
      if (presenter.target.win.closed) setPresenter(null);
    }, 600);
    return () => window.clearInterval(t);
  }, [presenter]);

  // ---------------------------------------------------------------------
  // The room: invitation and audience
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!active) return;
    // An invitation lapses on its own (see `SPOTLIGHT_MS`); a new slide renews it.
    if (state.everyone && !presenceManager.isSpotlighting()) presenceManager.setSpotlight(true);
    if (!state.everyone && presenceManager.isSpotlighting()) presenceManager.setSpotlight(false);
  }, [active, state.everyone, currentId]);

  // ---------------------------------------------------------------------
  // Placeholders and drawn guides stay off the stage while presenting
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!active) return;
    const stage = (window as unknown as { _konva_stage?: { find: (s: string) => Array<{ id(): string; visible(v?: boolean): boolean }> } })._konva_stage;
    if (!stage) return;
    const hidden = new Set<{ visible(v?: boolean): boolean }>();
    const sweep = () => {
      const all = boardNodes();
      for (const node of stage.find('.canvas-object')) {
        if (hidden.has(node) || !node.visible()) continue;
        if (isPlaceholder(all[node.id()] as never)) {
          node.visible(false);
          hidden.add(node);
        }
      }
      // Interface drawn with the board (frame names, safe areas, layout
      // guides) is never part of a slide, as it is never part of an export.
      for (const node of stage.find(`.${EXPORT_CHROME}`)) {
        if (hidden.has(node) || !node.visible()) continue;
        node.visible(false);
        hidden.add(node);
      }
    };
    sweep();
    // Nodes mount as the camera reaches them.
    let pending = 0;
    const onCamera = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        sweep();
      });
    };
    engineEvents.on('CameraChanged', onCamera);
    return () => {
      engineEvents.off('CameraChanged', onCamera);
      cancelAnimationFrame(pending);
      hidden.forEach((node) => node.visible(true));
    };
  }, [active, currentId]);

  // ---------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------

  const runKey = useCallback(
    (e: KeyboardEvent) => {
      // Alt+Left/Right on a focused slide thumbnail moves that slide.
      const thumb = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('.fp-strip__thumb');
      if (thumb && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const from = Number(thumb.dataset.index);
        const to = from + (e.key === 'ArrowLeft' ? -1 : 1);
        if (movePlayed(show.getSnapshot().ids, from, to)) {
          requestAnimationFrame(() => document.querySelectorAll<HTMLElement>('.fp-strip__thumb')[to]?.focus());
        }
        return;
      }
      const focused = document.activeElement;
      const onControl = !!focused?.closest?.(PRESENTER_UI) && !isTypingTarget(focused);
      const cmd = keys.interpret(
        e.key,
        {
          focusOwnsKey: isTypingTarget(focused) || (!onControl && keyBelongsToFocus(e.key)),
          onControl,
          mod: e.metaKey || e.ctrlKey,
        },
        Date.now()
      );
      if (!cmd) return;
      e.preventDefault();
      if (cmd.type === 'typing') return setDigits(cmd.digits);
      setDigits('');
      if (cmd.type === 'goto') {
        if (cmd.number > show.getSnapshot().ids.length) say(`There are ${show.getSnapshot().ids.length} slides.`);
        dispatch({ type: 'goto-number', number: cmd.number });
      } else if (cmd.type === 'blank') dispatch({ type: 'blank', blank: cmd.blank });
      else if (cmd.type === 'laser') dispatch({ type: 'laser', on: !show.getSnapshot().laser });
      else dispatch({ type: cmd.type });
    },
    [keys, dispatch, say]
  );

  useEffect(() => {
    if (!active) return;
    setPresenterKeys(runKey);
    return () => setPresenterKeys(null);
  }, [active, runKey]);

  // ---------------------------------------------------------------------
  // Laser
  // ---------------------------------------------------------------------

  const laserOn = state.laser || laserHeld;

  // Say so to the room: followers see a laser where a pointer was.
  useEffect(() => {
    if (!active) return;
    presenceManager.updateTool(laserOn ? 'laser' : 'present');
    if (!laserOn) {
      trail.on = false;
      presenceManager.clearCursor();
    }
  }, [active, laserOn, trail]);

  const feedLaser = (e: React.PointerEvent) => {
    trail.on = true;
    trail.push(e.clientX, e.clientY, performance.now());
    wakeLaser.current();
    const stage = stageRect();
    const world = cameraSystem.screenToWorld(e.clientX - stage.left, e.clientY - stage.top);
    presenceManager.updateCursor(world.x, world.y);
  };

  const onSlidePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    const timer = window.setTimeout(() => {
      if (!press.current) return;
      press.current.laser = true;
      setLaserHeld(true);
      trail.on = true;
      trail.push(x, y, performance.now());
      wakeLaser.current();
    }, LASER_HOLD_MS);
    press.current = { x, y, at: performance.now(), timer, laser: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onSlidePointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (p && !p.laser && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LASER_DRAG_PX) {
      window.clearTimeout(p.timer);
      p.laser = true;
      setLaserHeld(true);
    }
    if (laserOn || p?.laser) feedLaser(e);
  };

  const endPress = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (p.laser) {
      suppressClick.current = true;
      setLaserHeld(false);
    }
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const host = (
    <>
      <SlidesHost />
      {notice && !active && ReactDOM.createPortal(<div className="fp-notice" role="status">{notice}</div>, document.body)}
    </>
  );

  if (!active || !currentId) return host;

  const slideFrame = frame ?? boardNodes()[currentId];
  if (!slideFrame || slideFrame.type !== 'frame') return host;
  const count = state.ids.length;
  const title = (slideFrame as FrameNode).title || 'Untitled slide';
  const slide = screenBox(slideFrame);
  const right = slide.left + slide.width;
  const bottom = slide.top + slide.height;
  const icon = (slideFrame as FrameNode).icon;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      enteredFullscreen.current = false;
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <>
      {host}
      {ReactDOM.createPortal(
        <div ref={rootRef} className="fp-root" role="dialog" aria-modal="true" aria-label="Presenting slides" data-laser={laserOn || undefined}>
          {/* The letterbox: four panels around the slide, so everything that is
              not the slide — board and chrome alike — is covered. */}
          <div className="fp-mask" style={{ left: 0, top: 0, right: 0, height: Math.max(0, slide.top) }} />
          <div className="fp-mask" style={{ left: 0, top: bottom, right: 0, bottom: 0 }} />
          <div className="fp-mask" style={{ left: 0, top: slide.top, width: Math.max(0, slide.left), height: slide.height }} />
          <div className="fp-mask" style={{ left: right, top: slide.top, right: 0, height: slide.height }} />

          {/* The slide itself: a click advances; a press held is the laser. */}
          <button
            type="button"
            className="fp-slide"
            style={{ left: slide.left, top: slide.top, width: slide.width, height: slide.height }}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              dispatch({ type: 'next' });
            }}
            onPointerDown={onSlidePointerDown}
            onPointerMove={onSlidePointerMove}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onPointerLeave={() => {
              if (!press.current) trail.on = false;
            }}
            aria-label={`Slide ${state.index + 1} of ${count}: ${title}. Click for next, hold for the laser.`}
          />

          {state.blank && (
            <button
              type="button"
              className="fp-blank"
              data-blank={state.blank}
              onClick={() => dispatch({ type: 'unblank' })}
              aria-label="Bring the slide back"
            />
          )}

          <LaserLayer trail={trail} wakeRef={wakeLaser} />
          <ReactionStream />

          <div className="fp-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${(state.index + 1) / count})` }} />
          </div>
          <span className="fp-number" aria-hidden="true">
            {state.index + 1}
          </span>

          {digits && (
            <div className="fp-digits" role="status">
              Go to slide <strong>{digits}</strong> <kbd>Enter</kbd>
            </div>
          )}

          <div className="fp-hud" role="toolbar" aria-label="Presentation controls">
            <button type="button" className="fp-btn" onClick={() => dispatch({ type: 'previous' })} disabled={state.index === 0} aria-label="Previous slide">
              <ChevronLeft size={18} />
            </button>
            <span className="fp-count" aria-live="polite">
              <strong>{state.index + 1}</strong> / {count}
              <span className="fp-title">
                {icon && <Emoji native={icon} size={14} />}
                {title}
              </span>
            </span>
            <button type="button" className="fp-btn" onClick={() => dispatch({ type: 'next' })} disabled={state.index === count - 1} aria-label="Next slide">
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
            <button type="button" className="fp-btn" onClick={() => dispatch({ type: 'laser', on: !state.laser })} aria-label="Laser pointer (L)" aria-pressed={state.laser}>
              <Crosshair size={16} />
            </button>
            <button
              type="button"
              className="fp-btn"
              onClick={() => setPresenter((p) => (p ? (p.mode === 'window' && p.target.close(), null) : { mode: 'split' }))}
              aria-label="Presenter view"
              aria-pressed={presenter !== null}
            >
              <MonitorPlay size={16} />
            </button>
            <button
              type="button"
              className="fp-btn fp-btn--wide"
              onClick={() => dispatch({ type: 'everyone', on: !state.everyone })}
              aria-pressed={state.everyone}
              aria-label={state.everyone ? 'Stop inviting the room to follow' : 'Invite everyone to follow'}
            >
              <Users size={16} />
              {audience > 0 && <span className="fp-audience">{audience}</span>}
            </button>
            <button type="button" className="fp-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}>
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
            <button type="button" className="fp-btn" onClick={() => dispatch({ type: 'stop' })} aria-label="Stop presenting">
              <X size={16} />
            </button>
          </div>

          {stripOpen && <SlideStrip ids={state.ids} index={state.index} onGo={(i) => dispatch({ type: 'goto', index: i })} />}
          {notice && (
            <div className="fp-notice fp-notice--show" role="status">
              {notice}
            </div>
          )}
        </div>,
        document.body
      )}
      {presenter && (
        <Suspense fallback={null}>
          <PresenterView
            mode={presenter.mode}
            target={presenter.mode === 'window' ? presenter.target : undefined}
            audience={audience}
            onDismiss={() => setPresenter(null)}
          />
        </Suspense>
      )}
    </>
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
}> = ({ ids, index, onGo }) => {
  const objects = useStore((s) => s.objects) as Record<string, AnyNode>;
  const { canEdit } = useRoomPermissions();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const previews = useMemo(() => new Map(ids.map((id) => [id, framePreview(id, objects)])), [ids, objects]);

  const move = (from: number, to: number) => movePlayed(ids, from, to);

  return (
    <ol className="fp-strip" aria-label="Slides">
      {ids.map((id, i) => {
        const frame = objects[id];
        if (!frame || frame.type !== 'frame') return null;
        const label = frame.title || 'Untitled slide';
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
              if (dragFrom !== null && dragFrom !== i) move(dragFrom, i);
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
