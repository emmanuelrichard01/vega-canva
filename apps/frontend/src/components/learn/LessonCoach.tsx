import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { learnState } from '../../engine/learn/learnState';
import { keyFor, lessonForTool, type Lesson } from '../../engine/learn/lessons';
import { coachPlacement2D } from '../../engine/learn/coachAnchor';
import { boardInsets } from '../workspace/boardLayout';
import { DEFAULT_HEADER_H, EDGE_MARGIN, readFrameTokens } from '../toolbar/rail/railBounds';
import { LessonDemo } from './LessonDemo';

/**
 * The thing a tool cannot say about itself, said when you pick it up.
 *
 * ## Why not a tour
 *
 * A tour is the obvious build and it is wrong for the reason `WelcomeSequence`
 * and `DockCoach` both already record: it teaches the furniture, in an order
 * nobody chose, before the board can be touched. It also teaches everything at
 * the moment nothing is relevant, which is the moment least likely to be
 * remembered.
 *
 * This fires on the one signal that means somebody is about to need the answer:
 * they armed the tool. The lesson is about that tool, it is on screen while
 * they are looking for what to do with it, and it is gone the moment they do.
 *
 * ## Why it retires by doing rather than by clicking
 *
 * `FirstRunGuide` established the pattern here and it is the best thing in this
 * product's onboarding: a step completes when you perform it. So this watches
 * the object count and the tool. Make something with the tool the lesson is
 * about and the lesson is learned, permanently, with no button pressed. Glance
 * at it and wander off and it comes back next time, which is the correct
 * behaviour for something you did not read.
 *
 * That distinction is the whole reason `learnState` separates shown from
 * learned. A dismissal that fired on sight would retire the lessons of exactly
 * the people who never read one.
 *
 * ## Why it is above the dock
 *
 * The tool you just pressed is down there, so the eye is already down there.
 * It is also the one band of this screen that is chrome rather than canvas: the
 * top belongs to the board's name, both sides to panels, and the corners to the
 * radar and the zoom control. `NoticeLayer` picked the same place for the same
 * reason, and the two are stacked rather than overlapping.
 *
 * ## Why once, and one mute
 *
 * A tool's tip appears the first time the tool is picked up and not again; the
 * lesson stays in Help with its demo. Closing it retires that lesson. "Don't
 * show tips" turns every tip off, reversible from Help, because somebody who
 * closes the third of these has told you something about all of them.
 *
 * ## Why it points at the seat
 *
 * The card is centred on the dock seat of the tool that raised it, with a tail
 * down to it (`coachAnchor`), so the answer arrives over the thing it is about.
 * It never takes the keyboard or the pointer: it is a note on the board's
 * edge, and Escape puts it away without being consumed.
 */

interface Props {
  /** The armed tool, straight from `Room`. */
  activeTool: string;
  /** Hidden with the rest of the chrome in focus mode. */
  visible: boolean;
}

/**
 * How long a tool must stay armed before its lesson appears.
 *
 * Cycling through the dock with the keyboard passes through four tools in a
 * second, and a coach mark that fired on each would be a strobe. This is long
 * enough that arriving somewhere on purpose is the only thing that raises one,
 * and short enough that it never feels like a wait.
 */
const SETTLE_MS = 550;

/**
 * A tool's tip appears on its first use and not again.
 *
 * `learnState` would allow a second showing; on the canvas that is one more
 * interruption than a first run needs, and the lesson stays in Help with its
 * demo for anybody who wants it back.
 */
const shownBefore = (id: string) => (learnState.getSnapshot().shown[id] ?? 0) >= 1;

export const LessonCoach: React.FC<Props> = ({ activeTool, visible }) => {
  const { muted } = useSyncExternalStore(
    learnState.subscribe,
    learnState.getSnapshot,
    learnState.getSnapshot
  );
  const objectCount = useStore((s) => s.objectCount);

  /** The lesson currently on screen, which lags the tool by `SETTLE_MS`. */
  const [shown, setShown] = useState<Lesson | null>(null);
  /**
   * The board as it was when this lesson appeared.
   *
   * The retirement test is "did anything get made while this was up", and the
   * only honest way to ask it is to remember the count at the moment it went
   * up. A bare `objectCount > 0` would retire every lesson instantly on a board
   * that already has work on it, which is most boards.
   */
  const countAtShow = useRef(0);
  const shownId = useRef<string | null>(null);
  const card = useRef<HTMLElement>(null);
  /** Where the card sits so that its tail reaches the armed seat. */
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    tail: number | null;
    side: 'above' | 'below' | null;
    maxWidth: number;
    maxHeight: number;
    /** Taller than the strip: scrolls, and gives up its tail (overflow would clip it). */
    scroll: boolean;
  } | null>(null);

  /**
   * `learnState` is read during render rather than through the snapshot,
   * because the component is already subscribed for `muted` and `learn()`
   * notifies the same listeners. One subscription, both facts.
   */
  const found = lessonForTool(activeTool);
  /**
   * The card already on screen is never withdrawn by its own appearance
   * counting against it: showing it the second time is what retires it, and a
   * card that vanished the instant it appeared would be a flicker.
   */
  const candidate: Lesson | undefined =
    found && (found.id === shownId.current || (!learnState.isRetired(found.id) && !shownBefore(found.id)))
      ? found
      : undefined;
  const candidateId = candidate?.id ?? null;

  useEffect(() => {
    if (muted || !candidateId) {
      shownId.current = null;
      setShown(null);
      return;
    }
    const t = window.setTimeout(() => {
      countAtShow.current = Object.keys(useStore.getState().objects).length;
      if (candidate && shownId.current !== candidate.id) {
        shownId.current = candidate.id;
        learnState.noteShown(candidate.id);
      }
      setShown(candidate ?? null);
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
    // `candidate` is derived from `candidateId` and would re-run this on every
    // render; the id is the thing that actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId, muted]);

  /**
   * Learned by doing.
   *
   * One new object while the lesson is up is the proof that a *tool* lesson's
   * gesture was performed. It is deliberately loose: the alternative is every
   * tool reporting its own success, which would be sixteen call sites to keep
   * in step for a feature whose worst failure is showing a hint one extra time.
   *
   */
  useEffect(() => {
    if (!shown) return;
    if (objectCount > countAtShow.current) {
      learnState.learn(shown.id);
      setShown(null);
    }
  }, [objectCount, shown]);

  /** Once the card is gone, it is an ordinary candidate again: retired or not as the counts say. */
  useEffect(() => {
    if (!shown) shownId.current = null;
  }, [shown]);

  /** Escape puts it away without teaching anything, and without muting. */
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      setShown(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);

  /**
   * Measured against the real seat, the real chrome and the real parent.
   *
   * The card is positioned inside the board's container while the seat and
   * the panels are measured in the window: the same two-spaces mistake
   * `walkAnchor` exists to prevent, so both axes are converted at the end.
   *
   * It is placed in the free strip (under the header, above the dock, between
   * the panels) by `coachPlacement2D`, so it is never off screen or under a
   * panel: a tool armed from a flyout, a menu or a shortcut (direct select is
   * all three) has no seat in the dock row, and the card then sits centred at
   * the bottom of the strip rather than wherever a hidden seat measured.
   */
  useLayoutEffect(() => {
    const el = card.current;
    if (!shown || !el) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const seat = [...document.querySelectorAll<HTMLElement>('[data-tour="dock"] .dock-btn.active')]
        .map((b) => b.getBoundingClientRect())
        .find((r) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh);
      const dock = document.querySelector<HTMLElement>('[data-tour="dock"]')?.getBoundingClientRect();
      const insets = boardInsets();
      const tokens = readFrameTokens();
      const header = tokens.insetTop ?? tokens.headerH ?? DEFAULT_HEADER_H;
      const dockTop = dock && dock.height > 0 && dock.top < vh ? dock.top : vh;
      const free = {
        left: insets.left + EDGE_MARGIN,
        right: vw - insets.right - EDGE_MARGIN,
        top: header + EDGE_MARGIN,
        bottom: dockTop - EDGE_MARGIN,
      };
      // The card's natural size: measured with its limits lifted, so a card
      // squeezed by a previous placement does not keep its squeezed height.
      const prevMaxW = el.style.maxWidth;
      const prevMaxH = el.style.maxHeight;
      el.style.maxWidth = '';
      el.style.maxHeight = '';
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      el.style.maxWidth = prevMaxW;
      el.style.maxHeight = prevMaxH;

      const p = coachPlacement2D(
        seat ? { left: seat.left, top: seat.top, width: seat.width, height: seat.height } : null,
        size,
        free,
        { width: vw, height: vh }
      );
      const origin = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      setPlace({
        left: p.left - (origin?.left ?? 0),
        top: p.top - (origin?.top ?? 0),
        tail: p.tail,
        side: p.side,
        maxWidth: p.maxWidth,
        maxHeight: p.maxHeight,
        scroll: size.height > p.maxHeight + 0.5,
      });
    };
    measure();
    // The seat that is armed changes with the tool: measure again then, and
    // once more a frame later in case the dock marks its seat after this card.
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    const dockEl = document.querySelector('[data-tour="dock"]');
    if (dockEl) observer?.observe(dockEl);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [shown, visible, activeTool]);

  if (!visible || !shown) return null;

  const key = keyFor(shown);

  return (
    <aside
      ref={card}
      className="coach"
      role="note"
      aria-label={shown.title}
      data-anchored={place?.tail != null && !place.scroll ? '' : undefined}
      data-side={place?.tail != null && !place.scroll ? place.side ?? undefined : undefined}
      style={
        place
          ? ({
              left: place.left,
              top: place.top,
              bottom: 'auto',
              translate: 'none',
              maxWidth: place.maxWidth,
              maxHeight: place.maxHeight,
              overflowY: place.scroll ? 'auto' : undefined,
              '--coach-tail': place.tail != null ? `${place.tail}px` : undefined,
            } as React.CSSProperties)
          : // Unmeasured: kept out of sight for the one frame before it is placed.
            { visibility: 'hidden' }
      }
    >
      {shown.demo && <LessonDemo demo={shown.demo} maxLoops={3} />}

      <div className="coach__body">
        <div className="coach__head">
          <h2 className="coach__title">{shown.title}</h2>
          {/* The binding, from `TOOL_SHORTCUTS` rather than from a string
              here. A lesson that wrote its own key would be the surface a
              confused person reaches for and the one least likely to be
              updated when a key moves. */}
          {key && <kbd className="coach__key">{key}</kbd>}
        </div>

        <p className="coach__gist">{shown.gist}</p>

        {/* Two only, on the canvas. The full list is in the reference, and a
            five-step panel over a board somebody is working on is a dialog
            pretending not to be one. */}
        <ul className="coach__steps">
          {shown.steps.slice(0, 2).map((step) => (
            <li key={step.act} className="coach__step">
              <span className="coach__act">{step.act}</span>
              <span className="coach__gives">{step.gives}</span>
            </li>
          ))}
        </ul>

        <div className="coach__foot">
          <span className="coach__quiet">
            <button type="button" className="coach__mute" onClick={() => learnState.mute()}>
              Don’t show tips
            </button>
          </span>
          <span className="coach__more">
            Press <kbd>?</kbd> for the rest
          </span>
        </div>
      </div>

      <button
        type="button"
        className="coach__close"
        onClick={() => {
          learnState.dismiss(shown.id);
          setShown(null);
        }}
        aria-label="Dismiss this tip"
        data-tooltip="Dismiss"
      >
        <X size={13} />
      </button>
    </aside>
  );
};
