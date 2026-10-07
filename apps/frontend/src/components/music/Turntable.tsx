import React, { useEffect, useMemo, useRef, useState } from 'react';
import { armAngle, isSettled, restingTurntable, stepTurntable, type TurntableState } from '../../engine/music/turntable';

/**
 * A turntable: plinth, platter, a grooved record with the art as its label,
 * and a tonearm.
 *
 * - The record turns and the arm swings by `transform` alone, written straight
 *   to the DOM from a requestAnimationFrame loop, so React never re-renders
 *   per frame and the compositor does the work.
 * - The sheen is a separate layer that does not rotate. Grooves are circles,
 *   so they look identical at every angle; a fixed highlight sliding over the
 *   turning label is what makes the spin read.
 * - The loop runs only while something moves: it stops when the platter has
 *   coasted to rest, while the tab is hidden, and while the deck is off-screen.
 * - Under reduced motion the record is still, the arm simply sits where it
 *   belongs, and a small light shows that music is playing.
 */
export const Turntable: React.FC<{
  playing: boolean;
  /** Track progress 0–1 so the arm tracks inward; null for endless stations. */
  progress: number | null;
  /** The record label: cover art, sized by CSS to fill a circle. */
  label: React.ReactNode;
  size?: number;
}> = ({ playing, progress, label, size = 132 }) => {
  const recordRef = useRef<HTMLDivElement>(null);
  const armRef = useRef<SVGGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const physics = useRef<TurntableState>(restingTurntable());
  const playingRef = useRef(playing);
  const progressRef = useRef(progress);
  const reduced = usePrefersReducedMotion();

  playingRef.current = playing;
  progressRef.current = progress;

  useEffect(() => {
    const record = recordRef.current;
    const arm = armRef.current;
    if (!record || !arm) return;

    const draw = (s: TurntableState) => {
      record.style.transform = `rotate(${s.angle.toFixed(2)}deg)`;
      arm.setAttribute('transform', `rotate(${armAngle(s.arm, progressRef.current).toFixed(2)} ${PIVOT.x} ${PIVOT.y})`);
    };

    if (reduced) {
      physics.current = { angle: 0, rpm: 0, arm: playing ? 1 : 0, armVelocity: 0 };
      draw(physics.current);
      return;
    }

    let frame = 0;
    let last = 0;
    let visible = true;
    const loop = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      physics.current = stepTurntable(physics.current, dt, playingRef.current);
      draw(physics.current);
      if (isSettled(physics.current, playingRef.current) || document.hidden || !visible) {
        frame = 0;
        last = 0;
        return;
      }
      frame = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!frame && !document.hidden && visible) frame = requestAnimationFrame(loop);
    };

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
            kick();
          })
        : null;
    if (hostRef.current) observer?.observe(hostRef.current);
    document.addEventListener('visibilitychange', kick);
    draw(physics.current);
    kick();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', kick);
    };
    // `playing` restarts the loop so a stopped deck wakes up; the loop itself reads the refs.
  }, [playing, reduced]);

  const grooves = useMemo(() => {
    const rings: React.ReactNode[] = [];
    // Fine grooves, with three wider gaps between "tracks".
    const gaps = [0.58, 0.74, 0.88];
    for (let r = LABEL_R + 3; r < RECORD_R - 1.5; r += 1.15) {
      const t = (r - LABEL_R) / (RECORD_R - LABEL_R);
      const gap = gaps.some((g) => Math.abs(t - g) < 0.012);
      rings.push(
        <circle
          key={r}
          cx={50}
          cy={50}
          r={r}
          fill="none"
          stroke={gap ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.045)'}
          strokeWidth={gap ? 0.9 : 0.35}
        />
      );
    }
    return rings;
  }, []);

  return (
    <div
      ref={hostRef}
      className={`tt${playing ? ' is-playing' : ''}${reduced ? ' is-still' : ''}`}
      style={{ '--tt-size': `${size}px` } as React.CSSProperties}
      role="img"
      aria-label={playing ? 'Record playing' : 'Record stopped'}
    >
      <div className="tt__plinth" aria-hidden="true">
        <div className="tt__platter" />
        <div className="tt__record" ref={recordRef}>
          <svg className="tt__grooves" viewBox="0 0 100 100">
            <circle cx={50} cy={50} r={RECORD_R} fill="var(--tt-vinyl)" />
            {grooves}
            <circle cx={50} cy={50} r={RECORD_R - 0.4} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.5} />
          </svg>
          <div className="tt__label">{label}</div>
          {/* A small mark on the label, so the turn is visible even on plain art. */}
          <span className="tt__mark" />
        </div>
        <div className="tt__sheen" />
        <span className="tt__spindle" />
        <svg className="tt__arm" viewBox="0 0 100 100">
          {/* The arm base does not move. */}
          <circle cx={PIVOT.x} cy={PIVOT.y} r={7.5} className="tt__arm-base" />
          <g ref={armRef}>
            <path d={ARM_PATH} className="tt__arm-tube" />
            <rect x={HEAD.x - 2.6} y={HEAD.y - 1} width={5.2} height={8.5} rx={1.2} transform={`rotate(24 ${HEAD.x} ${HEAD.y})`} className="tt__arm-head" />
            <circle cx={PIVOT.x} cy={PIVOT.y} r={3.6} className="tt__arm-hub" />
            <rect x={PIVOT.x - 2} y={PIVOT.y - 11} width={4} height={5} rx={1} className="tt__arm-weight" />
          </g>
        </svg>
        <span className="tt__led" />
        <span className="tt__speed">33⅓</span>
      </div>
    </div>
  );
};

const RECORD_R = 41;
const LABEL_R = 14;
/** Arm geometry in the 100×100 deck box. */
const PIVOT = { x: 89, y: 15 };
const HEAD = { x: 70, y: 66 };
const ARM_PATH = `M ${PIVOT.x} ${PIVOT.y} L ${PIVOT.x - 1} 52 Q ${PIVOT.x - 2} 60 ${HEAD.x + 2} ${HEAD.y - 2}`;

function usePrefersReducedMotion(): boolean {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setReduced(query.matches);
    query.addEventListener?.('change', on);
    return () => query.removeEventListener?.('change', on);
  }, [query]);
  return reduced;
}

/**
 * The header's playing indicator: a 16px record that turns at 33⅓ rpm.
 * A CSS animation, so it costs nothing on the main thread.
 */
export const VinylGlyph: React.FC<{ spinning: boolean }> = ({ spinning }) => (
  <svg className={`vinyl-glyph${spinning ? ' is-spinning' : ''}`} viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
    <circle cx={8} cy={8} r={7.25} fill="currentColor" />
    <circle cx={8} cy={8} r={5.2} fill="none" stroke="var(--vinyl-groove)" strokeWidth={0.6} />
    <circle cx={8} cy={8} r={3.6} fill="none" stroke="var(--vinyl-groove)" strokeWidth={0.6} />
    <circle cx={8} cy={8} r={2.2} fill="var(--vinyl-label)" />
    <rect x={7.6} y={6.1} width={0.8} height={1.1} rx={0.3} fill="currentColor" />
    <circle cx={8} cy={8} r={0.6} fill="currentColor" />
  </svg>
);
