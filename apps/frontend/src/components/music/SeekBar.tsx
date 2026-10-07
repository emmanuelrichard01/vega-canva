import React, { useEffect, useRef, useState } from 'react';
import { clampSeek, clock, fractionOf, seekFromKey, seekFromPointer } from '../../engine/music/playerMath';

/** How long arrow-key presses gather before one seek is sent. */
const KEY_COMMIT_MS = 220;

/**
 * The seek bar: a thin track that thickens on hover, the played part over the
 * buffered part, a time bubble under the pointer, elapsed and remaining times
 * in tabular figures. Drag or click to seek; Left and Right move 5 seconds
 * (Shift: 15), Home and End jump to the ends.
 *
 * Disabled with a stated reason, never silently.
 */
export const SeekBar: React.FC<{
  /** Seconds. */
  position: number;
  duration: number;
  /** Seconds ready to play; omit when the source cannot say. */
  buffered?: number;
  onSeek: (seconds: number) => void;
  /** Why seeking is unavailable; the bar stays visible and says so. */
  disabledReason?: string | null;
}> = ({ position, duration, buffered, onSeek, disabledReason = null }) => {
  const track = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [keyed, setKeyed] = useState<number | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyValue = useRef(0);
  const disabled = disabledReason !== null || duration <= 0;

  useEffect(
    () => () => {
      if (keyTimer.current) clearTimeout(keyTimer.current);
    },
    []
  );

  const shown = scrub ?? keyed ?? clampSeek(position, duration);
  const played = fractionOf(shown, duration);
  const ready = buffered === undefined ? 0 : fractionOf(buffered, duration);

  const at = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return { x: Math.min(r.width, Math.max(0, e.clientX - r.left)), t: seekFromPointer(e.clientX, r.left, r.width, duration) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(at(e).t);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (disabled) return;
    const p = at(e);
    setHover(p);
    if (scrub !== null) setScrub(p.t);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (scrub === null) return;
    const t = at(e).t;
    setScrub(null);
    onSeek(t);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
    const base = keyed ?? position;
    const next = seekFromKey(e.key, base, duration, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    keyValue.current = next;
    setKeyed(next);
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => {
      keyTimer.current = null;
      setKeyed(null);
      onSeek(keyValue.current);
    }, KEY_COMMIT_MS);
  };

  const bubble = scrub !== null ? { x: (scrub / duration) * (track.current?.clientWidth ?? 0), t: scrub } : hover;

  return (
    <div className={`seek${disabled ? ' is-disabled' : ''}${scrub !== null ? ' is-scrubbing' : ''}`}>
      <span className="seek__time">{clock(shown)}</span>
      <div
        ref={track}
        className="seek__hit"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(duration))}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
        aria-disabled={disabled || undefined}
        data-tooltip={disabledReason ?? undefined}
        data-tooltip-pos="top"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrub(null)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        style={{ '--played': `${played * 100}%`, '--ready': `${ready * 100}%` } as React.CSSProperties}
      >
        <div className="seek__track">
          <div className="seek__ready" />
          <div className="seek__played" />
        </div>
        <div className="seek__thumb" />
        {bubble && !disabled && (
          <div className="seek__bubble" aria-hidden="true" style={{ '--x': `${bubble.x}px` } as React.CSSProperties}>
            {clock(bubble.t)}
          </div>
        )}
      </div>
      <span className="seek__time seek__time--end">{duration > 0 ? `−${clock(Math.max(0, duration - shown))}` : '−:−−'}</span>
    </div>
  );
};
