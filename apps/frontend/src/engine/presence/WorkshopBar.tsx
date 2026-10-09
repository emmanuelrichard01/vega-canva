import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Plus, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { cameraSystem } from '../CameraSystem';
import { useStore } from '../../hooks/useStore';
import { usePresenceFrame } from './useCollaborators';
import { MAX_VOTES_PER_PERSON, pickVoteTarget, tallyVotes } from './vote';
import { MINUTE_MS, formatClock, remainingMs } from './workshopTimer';
import { canFacilitate, useWorkshop, workshop } from './workshopStore';
import './presence.css';

/** Open the workshop setup from anywhere (the command palette, the help page). */
export type WorkshopPanel = 'timer' | 'vote';
export const WORKSHOP_EVENT = 'vega:workshop';
export const openWorkshop = (panel: WorkshopPanel) =>
  window.dispatchEvent(new CustomEvent<WorkshopPanel>(WORKSHOP_EVENT, { detail: panel }));

const CHIME_KEY = 'vega.workshop.chime';
const PRESETS = [1, 3, 5, 10];

function chimeOn(): boolean {
  try {
    return localStorage.getItem(CHIME_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Two soft sine tones, under a second. Silent if audio is unavailable or locked. */
function chime() {
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const t0 = ctx.currentTime;
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.65);
    });
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1200);
  } catch {
    /* no sound is a fine outcome */
  }
}

/**
 * The workshop: a shared timer and dot voting, in one strip under the header.
 *
 * The strip exists only while something is running, so an ordinary board has
 * no extra chrome. Facilitators (anyone who can edit) get the controls;
 * everyone else sees the same clock and votes.
 */
export const WorkshopBar: React.FC = () => {
  const w = useWorkshop();
  const [setup, setSetup] = useState<WorkshopPanel | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(chimeOn);
  const [perPerson, setPerPerson] = useState(3);
  const chimed = useRef(0);
  const facilitator = canFacilitate();

  const running = w.timer.status === 'running';
  const left = remainingMs(w.timer, now, w.offset);
  const done = running && left === 0;

  useEffect(() => {
    const open = (e: Event) => setSetup((e as CustomEvent<WorkshopPanel>).detail ?? 'timer');
    window.addEventListener(WORKSHOP_EVENT, open);
    return () => window.removeEventListener(WORKSHOP_EVENT, open);
  }, []);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running, w.timer.endsAt]);

  // One chime per run, and none for a countdown that ended before this tab loaded.
  useEffect(() => {
    if (!done || chimed.current === w.timer.endsAt) return;
    chimed.current = w.timer.endsAt;
    if (sound && Math.abs(Date.now() - w.offset - w.timer.endsAt) < 5000) chime();
  }, [done, sound, w.timer.endsAt, w.offset]);

  useEffect(() => {
    if (!setup) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSetup(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setup]);

  const { session } = w;
  const voting = Boolean(session && !session.revealed);
  const tally = useMemo(
    () => (session ? tallyVotes(w.dotsByVoter, session.perPerson, (id) => Boolean(useStore.getState().objects[id])) : null),
    [session, w.dotsByVoter]
  );

  // While a vote is open, a click on an object places a dot instead of selecting it.
  useEffect(() => {
    if (!voting) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!(e.target instanceof Element) || !e.target.closest('.canvas-container')) return;
      const world = cameraSystem.screenToWorld(e.clientX, e.clientY);
      const id = pickVoteTarget(Object.values(useStore.getState().objects), world);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      workshop.vote(id);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [voting]);

  // Dots follow their objects as the camera moves.
  const dotNodes = useRef(new Map<string, HTMLDivElement>());
  const shownIds = useMemo(() => {
    if (!session || !tally) return [] as string[];
    return session.revealed ? [...tally.counts.keys()] : [...new Set(w.mine)];
  }, [session, tally, w.mine]);
  usePresenceFrame(() => {
    const objects = useStore.getState().objects;
    for (const id of shownIds) {
      const node = dotNodes.current.get(id);
      const o = objects[id];
      if (!node || !o) continue;
      const x = (o.x + o.width * Math.abs(o.scaleX || 1)) * cameraSystem.zoom + cameraSystem.x;
      const y = o.y * cameraSystem.zoom + cameraSystem.y;
      node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, shownIds.length > 0);

  const showTimer = w.timer.status !== 'idle';
  if (!showTimer && !session && !setup) return null;

  const used = w.mine.length;
  const topCount = tally?.ranked[0]?.count ?? 0;

  return (
    <>
      <div className="workshop panel-surface" role="region" aria-label="Workshop">
        {showTimer && (
          <div className="workshop__group" data-done={done || undefined}>
            <span className="workshop__clock" role="timer" aria-label={done ? 'Time is up' : `${formatClock(left)} left`}>
              {formatClock(left)}
            </span>
            {done && <span className="workshop__note" role="status">Time is up</span>}
            {facilitator && (
              <>
                {running && !done && (
                  <button type="button" className="workshop__btn" onClick={workshop.timerPause} aria-label="Pause the timer">
                    <Pause size={14} aria-hidden />
                  </button>
                )}
                {w.timer.status === 'paused' && (
                  <button type="button" className="workshop__btn" onClick={workshop.timerResume} aria-label="Resume the timer">
                    <Play size={14} aria-hidden />
                  </button>
                )}
                <button type="button" className="workshop__btn" onClick={workshop.timerAddMinute} aria-label="Add one minute">
                  <Plus size={14} aria-hidden />
                  <span>1 min</span>
                </button>
                <button type="button" className="workshop__btn" onClick={workshop.timerReset} aria-label="Reset the timer">
                  <RotateCcw size={14} aria-hidden />
                </button>
              </>
            )}
            <button
              type="button"
              className="workshop__btn"
              aria-pressed={sound}
              aria-label={sound ? 'Mute the timer chime' : 'Unmute the timer chime'}
              onClick={() => {
                setSound(!sound);
                try {
                  localStorage.setItem(CHIME_KEY, sound ? 'off' : 'on');
                } catch {
                  /* the preference just will not persist */
                }
              }}
            >
              {sound ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
            </button>
          </div>
        )}

        {showTimer && session && <span className="workshop__rule" aria-hidden="true" />}

        {session && tally && (
          <div className="workshop__group">
            {session.revealed ? (
              <span className="workshop__label" role="status">
                Results: {tally.total} {tally.total === 1 ? 'vote' : 'votes'} from {tally.voters} {tally.voters === 1 ? 'person' : 'people'}
              </span>
            ) : (
              <span className="workshop__label" role="status">
                Dot vote: {session.perPerson - used} of {session.perPerson} left
              </span>
            )}
            {facilitator && !session.revealed && (
              <button type="button" className="workshop__btn workshop__btn--text" onClick={workshop.voteReveal}>
                Reveal results
              </button>
            )}
            {facilitator && (
              <button type="button" className="workshop__btn workshop__btn--text" onClick={workshop.voteEnd}>
                {session.revealed ? 'Done' : 'Cancel'}
              </button>
            )}
          </div>
        )}
      </div>

      {setup && facilitator && (
        <div className="workshop-setup panel-surface" role="dialog" aria-label="Workshop tools">
          <button type="button" className="workshop-setup__close" aria-label="Close" onClick={() => setSetup(null)}>
            <X size={14} aria-hidden />
          </button>
          <div className="workshop-setup__row" data-focus={setup === 'timer' || undefined}>
            <span className="workshop-setup__title">Timer</span>
            <div className="workshop-setup__choices">
              {PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="workshop__btn workshop__btn--text"
                  onClick={() => {
                    workshop.timerStart(m * MINUTE_MS);
                    setSetup(null);
                  }}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
          <div className="workshop-setup__row" data-focus={setup === 'vote' || undefined}>
            <span className="workshop-setup__title">Dot vote</span>
            <div className="workshop-setup__choices">
              <label className="workshop-setup__field">
                <span>Votes each</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_VOTES_PER_PERSON}
                  value={perPerson}
                  onChange={(e) => setPerPerson(Math.max(1, Math.min(MAX_VOTES_PER_PERSON, Number(e.target.value) || 1)))}
                />
              </label>
              <button
                type="button"
                className="workshop__btn workshop__btn--text"
                onClick={() => {
                  workshop.voteStart(perPerson);
                  setSetup(null);
                }}
              >
                Start voting
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="vote-layer" aria-hidden="true">
        {shownIds.map((id) => {
          const total = tally?.counts.get(id) ?? 0;
          const mine = w.mine.filter((m) => m === id).length;
          return (
            <div
              key={id}
              className="vote-badge"
              data-top={session?.revealed && total === topCount ? true : undefined}
              ref={(el) => {
                if (el) dotNodes.current.set(id, el);
                else dotNodes.current.delete(id);
              }}
            >
              <span className="vote-badge__pill">
                {session?.revealed ? (
                  total
                ) : (
                  Array.from({ length: mine }, (_, i) => <i key={i} className="vote-badge__dot" />)
                )}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
};
