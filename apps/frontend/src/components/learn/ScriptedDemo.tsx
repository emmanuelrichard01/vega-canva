import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { ARROW_D, ARROW_SCALE, ARROW_TIP } from '../../engine/cursor/cursorVisual';
import { ToolBadge } from '../../engine/cursor/cursorArt';
import {
  clamp01,
  keyPresence,
  loopEnvelope,
  sampleCursor,
  SCRIPTS,
  settle,
  type CursorSample,
  type ScriptedId,
} from '../../engine/learn/demoScript';
import { SCENES } from './scenes';
import './learn.css';

/**
 * A lesson's film: one gesture, played from a script, that you can pause and scrub.
 *
 * ## One clock, no animation state
 *
 * The component owns a single number, the time. The scene, the ghost pointer and
 * the keycaps are all pure functions of it (`engine/learn/demoScript` and
 * `scenes`), so pausing is "stop advancing" and scrubbing is "set the number".
 * Nothing has to be rewound, and a frame looks the same however it was reached.
 *
 * ## Why the loop is allowed to run in JS
 *
 * The CSS demos this replaces cost nothing while idle, which mattered for a hint
 * that can sit over the board for minutes. A script cannot be scrubbed from CSS,
 * so the cost is managed instead of ignored: the clock stops when the demo is
 * off screen or the tab is hidden, and a coach mark stops it altogether after a
 * few loops (`maxLoops`), resting on the frame that shows the result. What is
 * left is one small SVG updated while it is actually being looked at.
 *
 * ## Reduced motion
 *
 * Under `prefers-reduced-motion` nothing plays. The same scene is drawn at the
 * script's three storyboard times, each with its caption, which is the lesson
 * told as stills rather than the lesson with the motion removed.
 */

const W = 224;
const H = 128;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(query.matches);
    query.addEventListener?.('change', on);
    return () => query.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** The ghost pointer: the real arrow and the real tool badge, so it reads as the product's own. */
const Ghost: React.FC<{ cur: CursorSample; tool?: string; o: number }> = ({ cur, tool, o }) => {
  const press = cur.down ? 0.92 : 1;
  const ring = cur.pressAge !== null && cur.pressAge < 520 ? settle(cur.pressAge / 520) : null;
  return (
    <g opacity={o} pointerEvents="none">
      {ring !== null && (
        <circle className="sd-press" cx={cur.x} cy={cur.y} r={3 + 14 * ring} opacity={0.7 * (1 - ring)} fill="none" />
      )}
      <g transform={`translate(${cur.x} ${cur.y}) scale(${press}) translate(${-ARROW_TIP.x} ${-ARROW_TIP.y})`}>
        <g transform={`scale(${ARROW_SCALE})`}>
          <path
            d={ARROW_D}
            fill="var(--text-primary)"
            stroke="var(--surface-primary)"
            strokeWidth={1.7}
            strokeLinejoin="round"
          />
        </g>
        <ToolBadge tool={tool} fill="var(--surface-primary)" ink="var(--text-primary)" ring="var(--text-primary)" />
      </g>
    </g>
  );
};

/** The keys held while this happens, in step with the press they belong to. */
const Keys: React.FC<{ id: ScriptedId; t: number }> = ({ id, t }) => {
  const { keys } = SCRIPTS[id];
  return (
    <div className="sd-keys" aria-hidden="true">
      {keys.map((beat, i) => {
        const p = keyPresence(beat, t);
        if (p <= 0.01) return null;
        // A key is pressed down for a moment as it arrives, then rests.
        const sinceDown = t - (beat.at + 150);
        const pressed = sinceDown > 0 && sinceDown < 200;
        return (
          <span
            key={i}
            className="sd-keys__chip"
            data-pressed={pressed || undefined}
            style={{ opacity: p, transform: `translateY(${(1 - p) * 6}px)` }}
          >
            {beat.caps.map((cap, j) => (
              <kbd key={j}>{cap}</kbd>
            ))}
          </span>
        );
      })}
    </div>
  );
};

/** One frame of a scene, with its pointer: the moving demo and the storyboard share it. */
const Frame: React.FC<{ id: ScriptedId; t: number; uid: string; envelope?: boolean }> = ({ id, t, uid, envelope = true }) => {
  const script = SCRIPTS[id];
  const Scene = SCENES[id];
  const cur = useMemo(() => sampleCursor(script.cursor, t), [script, t]);
  const o = envelope ? loopEnvelope(t, script.duration) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sd-svg" aria-hidden="true">
      <g opacity={o}>
        <Scene t={t} cur={cur} uid={uid} />
      </g>
      {script.ghost !== false && <Ghost cur={cur} tool={script.tool} o={o} />}
    </svg>
  );
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;

interface Props {
  id: ScriptedId;
  /**
   * Stop on the result after this many loops. A coach mark over somebody's work
   * should not run for ever; the reference leaves it unset.
   */
  maxLoops?: number;
}

export const ScriptedDemo: React.FC<Props> = ({ id, maxLoops }) => {
  const script = SCRIPTS[id];
  const reduced = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rest = script.frames[2].at;

  const [t, setT] = useState(reduced ? rest : 0);
  const [playing, setPlaying] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const clock = useRef(0);
  const loops = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  /** Off screen and on a hidden tab, the clock simply does not run. */
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const running = playing && onScreen && tabVisible && !reduced;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Clamped, so a stalled tab does not skip a whole beat when it resumes.
      const dt = Math.min(64, now - last);
      last = now;
      let next = clock.current + dt;
      if (next >= script.duration) {
        next -= script.duration;
        loops.current += 1;
        if (maxLoops !== undefined && loops.current >= maxLoops) {
          clock.current = rest;
          setT(rest);
          setPlaying(false);
          return;
        }
      }
      clock.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, script.duration, maxLoops, rest]);

  const scrub = useCallback((value: number) => {
    // Taking hold of the time is taking it over: stay where it was put.
    clock.current = value;
    setPlaying(false);
    setT(value);
  }, []);

  const toggle = () => {
    if (!playing) {
      loops.current = 0;
      // Resting on the result, play restarts the film rather than the last second of it.
      if (clock.current >= script.duration - 600 || clock.current === rest) clock.current = 0;
      setT(clock.current);
    }
    setPlaying(!playing);
  };

  const label = script.frames.map((f) => f.caption).join('. ');

  if (reduced) {
    return (
      <div className="sd sd--storyboard" ref={root}>
        <ol className="sd-board" aria-label="The gesture in three steps">
          {script.frames.map((frame, i) => (
            <li key={i} className="sd-board__frame">
              <div className="sd-board__thumb">
                <Frame id={id} t={frame.at} uid={`${uid}b${i}`} envelope={false} />
              </div>
              <p className="sd-board__caption">
                <span className="sd-board__n" aria-hidden="true">
                  {i + 1}
                </span>
                {frame.caption}
              </p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="sd" ref={root}>
      <div className="sd-stage" role="img" aria-label={label}>
        <Frame id={id} t={t} uid={uid} />
        <Keys id={id} t={t} />
      </div>
      <div className="sd-bar">
        <button
          type="button"
          className="sd-bar__play"
          onClick={toggle}
          aria-label={playing ? 'Pause the demo' : 'Play the demo'}
        >
          {playing ? <Pause size={11} strokeWidth={2.4} aria-hidden /> : <Play size={11} strokeWidth={2.4} aria-hidden />}
        </button>
        <input
          type="range"
          className="sd-bar__scrub"
          min={0}
          max={script.duration}
          step={20}
          value={Math.round(t)}
          onChange={(e) => scrub(Number(e.target.value))}
          aria-label="Position in the demo"
          aria-valuetext={`${seconds(t)} of ${seconds(script.duration)}`}
          style={{ '--sd-fill': `${clamp01(t / script.duration) * 100}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
};
