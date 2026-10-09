import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { ChevronLeft, ChevronRight, Crosshair, Minus, MonitorUp, Pause, Play, Plus, RotateCcw, Square, Users, X } from 'lucide-react';
import type { FrameNode } from '../../engine/model/schema';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { createPresenterKeys } from '../../engine/tools/presenting';
import { elapsed, formatElapsed, show, type ShowCommand, type ShowState } from '../../engine/slides/show';
import { slideFields, MAX_NOTES } from '../../engine/slides/slideMeta';
import { setSlideNotes } from '../../engine/slides/deckEdits';
import { SlideThumb } from './SlideThumb';
import { isTypingTarget, useDarkTheme, useDeck } from './useSlides';
import './slides.css';

/**
 * The presenter view: what the speaker sees while the room sees the slide.
 *
 * The slide on screen and the one after it, the speaker notes (editable by
 * editors, as large as the speaker wants them), a clock and an elapsed timer
 * that can be paused and reset, the deck as a strip to jump around, and the
 * controls: next and previous, blank to black or white, the laser and the
 * invitation to follow. In a second window it has its own keyboard, which
 * speaks the same commands as the presenter's.
 *
 * `split` draws it over this screen instead, for rehearsing on one display;
 * "Audience view" puts it away without ending the show.
 */
export interface PresenterViewProps {
  mode: 'window' | 'split';
  /** The second window to draw into, in `window` mode. */
  target?: { win: Window; root: HTMLElement };
  /** Number of people following the presenter. */
  audience: number;
  /** Put the view away; the show goes on. */
  onDismiss: () => void;
}

const NOTE_SIZES = [16, 18, 21, 24, 28, 32];
const SIZE_KEY = 'vega:presenter-notes-size';

function readSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return NOTE_SIZES.includes(n) ? n : 21;
  } catch {
    return 21;
  }
}

export default function PresenterView({ mode, target, audience, onDismiss }: PresenterViewProps) {
  const state = useSyncExternalStore(show.subscribe, show.getSnapshot, show.getSnapshot);
  const { deck, objects } = useDeck();
  const { canEdit } = useRoomPermissions();
  const dark = useDarkTheme();
  const [now, setNow] = useState(() => Date.now());
  const [noteSize, setNoteSize] = useState(readSize);
  const [digits, setDigits] = useState('');
  const keys = useMemo(() => createPresenterKeys(), []);

  const dispatch = (cmd: ShowCommand) => show.dispatch(cmd);
  const currentId = state.ids[state.index];
  const nextId = state.ids[state.index + 1];
  const current = objects[currentId] as FrameNode | undefined;
  const next = nextId ? (objects[nextId] as FrameNode | undefined) : undefined;
  const slide = deck.find((s) => s.frame.id === currentId);

  // The clock ticks once a second, and only while the view is up.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // The second window's own keyboard. On this screen the presenter already listens.
  useEffect(() => {
    if (mode !== 'window' || !target) return;
    const win = target.win;
    const onKey = (e: KeyboardEvent) => {
      const focused = win.document.activeElement;
      const onControl = focused?.tagName === 'BUTTON';
      const cmd = keys.interpret(
        e.key,
        { focusOwnsKey: isTypingTarget(focused), onControl, mod: e.metaKey || e.ctrlKey },
        Date.now()
      );
      if (!cmd) return;
      e.preventDefault();
      run(cmd, state);
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
    // `state` is read fresh through `show` inside `run`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, target, keys]);

  function run(cmd: ReturnType<typeof keys.interpret>, _s: ShowState) {
    if (!cmd) return;
    if (cmd.type === 'typing') return setDigits(cmd.digits);
    setDigits('');
    if (cmd.type === 'goto') dispatch({ type: 'goto-number', number: cmd.number });
    else if (cmd.type === 'blank') dispatch({ type: 'blank', blank: cmd.blank });
    else if (cmd.type === 'laser') dispatch({ type: 'laser', on: !show.getSnapshot().laser });
    else dispatch({ type: cmd.type } as ShowCommand);
  }

  const resize = (dir: 1 | -1) => {
    const at = NOTE_SIZES.indexOf(noteSize);
    const size = NOTE_SIZES[Math.max(0, Math.min(NOTE_SIZES.length - 1, at + dir))];
    setNoteSize(size);
    try {
      localStorage.setItem(SIZE_KEY, String(size));
    } catch {
      /* the size lasts the session */
    }
  };

  if (!state.active) return null;

  const total = state.ids.length;
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const running = state.timer.runningSince !== null;

  const view = (
    <div className="pv" data-presenter-ui="" data-mode={mode} role="dialog" aria-label="Presenter view">
      <header className="pv-head">
        <div className="pv-timer" role="group" aria-label="Timer">
          <span className="pv-elapsed" aria-label={`Elapsed ${formatElapsed(elapsed(state, now))}`}>
            {formatElapsed(elapsed(state, now))}
          </span>
          <button type="button" className="pv-icon" onClick={() => dispatch({ type: 'timer-toggle', now: Date.now() })} aria-label={running ? 'Pause the timer' : 'Resume the timer'}>
            {running ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" className="pv-icon" onClick={() => dispatch({ type: 'timer-reset', now: Date.now() })} aria-label="Reset the timer">
            <RotateCcw size={15} />
          </button>
          <span className="pv-clock" aria-label={`Time ${clock}`}>
            {clock}
          </span>
        </div>

        <div className="pv-pos" aria-live="polite">
          <strong>{state.index + 1}</strong>
          <span>of {total}</span>
          {slide?.section && <span className="pv-section">{slide.section}</span>}
        </div>

        <div className="pv-tools" role="toolbar" aria-label="Show controls">
          {audience > 0 && (
            <span className="pv-audience" title="People following your slides">
              <Users size={14} aria-hidden="true" />
              {audience} following
            </span>
          )}
          <button
            type="button"
            className="pv-tool"
            aria-pressed={state.everyone}
            onClick={() => dispatch({ type: 'everyone', on: !state.everyone })}
            title="Invite everyone in the room to follow your slides"
          >
            <Users size={15} aria-hidden="true" />
            Everyone
          </button>
          <button type="button" className="pv-tool" aria-pressed={state.laser} onClick={() => dispatch({ type: 'laser', on: !state.laser })} title="Laser pointer (L)">
            <Crosshair size={15} aria-hidden="true" />
            Laser
          </button>
          <button type="button" className="pv-tool" aria-pressed={state.blank === 'black'} onClick={() => dispatch({ type: 'blank', blank: 'black' })} title="Black screen (B)">
            <Square size={15} aria-hidden="true" fill="currentColor" />
            Black
          </button>
          <button type="button" className="pv-tool" aria-pressed={state.blank === 'white'} onClick={() => dispatch({ type: 'blank', blank: 'white' })} title="White screen (W)">
            <Square size={15} aria-hidden="true" />
            White
          </button>
          {mode === 'split' && (
            <button type="button" className="pv-tool" onClick={onDismiss} title="Show the slides full screen; the show goes on">
              <MonitorUp size={15} aria-hidden="true" />
              Audience view
            </button>
          )}
          <button type="button" className="pv-tool pv-tool--end" onClick={() => dispatch({ type: 'stop' })}>
            <X size={15} aria-hidden="true" />
            End show
          </button>
        </div>
      </header>

      <main className="pv-main">
        <section className="pv-current" aria-label={`Current slide: ${current?.title || 'Untitled slide'}`}>
          <div className="pv-stage">
            {current && <SlideThumb frame={current} objects={objects} dark={dark} width={1280} />}
            {state.blank && (
              <span className="pv-blank" data-blank={state.blank}>
                Screen is {state.blank}. Press {state.blank === 'black' ? 'B' : 'W'} or move on to bring the slide back.
              </span>
            )}
          </div>
          <div className="pv-nav">
            <button type="button" className="pv-navbtn" onClick={() => dispatch({ type: 'previous' })} disabled={state.index === 0}>
              <ChevronLeft size={18} aria-hidden="true" />
              Previous
            </button>
            <span className="pv-title">{current?.title || 'Untitled slide'}</span>
            <button type="button" className="pv-navbtn pv-navbtn--next" onClick={() => dispatch({ type: 'next' })} disabled={state.index >= total - 1}>
              Next
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          {digits && (
            <span className="pv-digits" role="status">
              Go to slide {digits} <kbd>Enter</kbd>
            </span>
          )}
        </section>

        <aside className="pv-side">
          <section className="pv-next" aria-label="Next slide">
            <h3 className="pv-heading">Next</h3>
            {next ? (
              <button type="button" className="pv-next__face" onClick={() => dispatch({ type: 'next' })} aria-label={`Go to the next slide: ${next.title || 'Untitled slide'}`}>
                <SlideThumb frame={next} objects={objects} dark={dark} width={720} />
              </button>
            ) : (
              <p className="pv-end">End of the deck</p>
            )}
          </section>

          <section className="pv-notes" aria-label="Speaker notes">
            <div className="pv-notes__head">
              <h3 className="pv-heading">Notes</h3>
              <div className="pv-notes__size" role="group" aria-label="Notes text size">
                <button type="button" className="pv-icon" onClick={() => resize(-1)} aria-label="Smaller notes" disabled={noteSize === NOTE_SIZES[0]}>
                  <Minus size={14} />
                </button>
                <button type="button" className="pv-icon" onClick={() => resize(1)} aria-label="Larger notes" disabled={noteSize === NOTE_SIZES[NOTE_SIZES.length - 1]}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
            {current && <NotesField key={current.id} frame={current} editable={canEdit} size={noteSize} />}
          </section>
        </aside>
      </main>

      <ol className="pv-strip" aria-label="Slides">
        {state.ids.map((id, i) => {
          const frame = objects[id] as FrameNode | undefined;
          if (!frame) return null;
          return (
            <li key={id}>
              <button
                type="button"
                className="pv-strip__item"
                aria-current={i === state.index ? 'true' : undefined}
                onClick={() => dispatch({ type: 'goto', index: i })}
                aria-label={`Slide ${i + 1}: ${frame.title || 'Untitled slide'}`}
              >
                <SlideThumb frame={frame} objects={objects} dark={dark} width={240} capture={Math.abs(i - state.index) < 12} />
                <span className="pv-strip__num">{i + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );

  return ReactDOM.createPortal(view, mode === 'window' && target ? target.root : document.body);
}

/**
 * Speaker notes: a draft while typing, written to the slide when the speaker
 * pauses or leaves the field, so the document gets one edit per thought
 * rather than one per keystroke.
 */
const NotesField: React.FC<{ frame: FrameNode; editable: boolean; size: number }> = ({ frame, editable, size }) => {
  const stored = slideFields(frame).notes ?? '';
  const [draft, setDraft] = useState(stored);
  const dirty = useRef(false);
  const timer = useRef(0);

  useEffect(() => {
    if (!dirty.current) setDraft(stored);
  }, [stored]);

  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    setSlideNotes(frame.id, text);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!editable) {
    return stored ? (
      <div className="pv-notes__text" style={{ fontSize: size }}>
        {stored}
      </div>
    ) : (
      <p className="pv-notes__empty">No notes for this slide.</p>
    );
  }

  return (
    <textarea
      className="pv-notes__text pv-notes__field"
      style={{ fontSize: size }}
      value={draft}
      maxLength={MAX_NOTES}
      placeholder="Write what to say on this slide"
      aria-label="Speaker notes for this slide"
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        dirty.current = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(text), 700);
      }}
      onBlur={() => dirty.current && commit(draft)}
    />
  );
};
