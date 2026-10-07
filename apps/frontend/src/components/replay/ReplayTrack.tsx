import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Moment } from '../../engine/history/sessionTimeline';
import { clockLabel, clockRange, type ReplaySession } from '../../engine/history/sessions';
import { densityColumns, nearestMoment, sparklinePath, type TrackLayout } from '../../engine/history/trackLayout';
import { AvatarStack } from '../ui/Avatar';

export interface TrackMarker {
  key: string;
  x: number;
  label: string;
}

interface Props {
  moments: readonly Moment[];
  sessions: readonly ReplaySession[];
  layout: TrackLayout;
  /** The moment under the playhead, or -1 while a saved version is shown. */
  current: number;
  /** Per-object history: the only moments that can be landed on. */
  only: readonly number[] | null;
  markers: readonly TrackMarker[];
  onSeek: (index: number) => void;
  onScrub: (active: boolean) => void;
}

/** Drawing units across the track; the SVG stretches to its box. */
const W = 1000;
const H = 40;

/**
 * The timeline: sessions as lanes, each with its edit density drawn to scale,
 * and one playhead.
 *
 * It is a single slider. Pressing anywhere seeks to the nearest moment and
 * dragging scrubs; the keyboard is handled by the timeline as a whole (arrow
 * keys step, Shift steps a session), so this element only has to be
 * focusable and describe itself.
 */
export const ReplayTrack: React.FC<Props> = ({ moments, sessions, layout, current, only, markers, onSeek, onScrub }) => {
  const ref = useRef<HTMLDivElement>(null);
  const clipId = useId().replace(/:/g, '');
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const frame = useRef<number | null>(null);
  const pendingX = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const columns = Math.max(24, Math.min(320, Math.round(width / 3)));
  const path = useMemo(
    () => sparklinePath(densityColumns(moments, layout, columns, only), W, H),
    [moments, layout, columns, only]
  );

  const xOf = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const seekTo = (x: number) => {
    const index = nearestMoment(layout, x, only);
    if (index >= 0) onSeek(index);
  };

  // One seek per frame while dragging; a rewind rebuilds from a keyframe and
  // pointer events arrive faster than frames.
  const scheduleSeek = (x: number) => {
    pendingX.current = x;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      seekTo(pendingX.current);
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    onScrub(true);
    seekTo(xOf(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const x = xOf(e.clientX);
    const nearest = nearestMoment(layout, x, only);
    setHover(nearest >= 0 ? nearest : null);
    if (scrubbing.current) scheduleSeek(x);
  };

  const endScrub = () => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    onScrub(false);
  };

  const playX = current >= 0 ? layout.xs[current] : null;
  const hoverMoment = hover !== null ? moments[hover] : null;
  const total = only ? only.length : moments.length;
  const position = current >= 0 ? (only ? only.indexOf(current) + 1 : current + 1) : 0;

  return (
    <div className="replay-track">
      <div
        ref={ref}
        className="replay-track__lane"
        role="slider"
        tabIndex={0}
        aria-label="Change history"
        aria-valuemin={total > 0 ? 1 : 0}
        aria-valuemax={total}
        aria-valuenow={position}
        aria-valuetext={
          current >= 0 ? `${moments[current].label}, ${clockLabel(moments[current].at)}` : 'A saved version'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onPointerLeave={() => setHover(null)}
      >
        {layout.segments.map((segment, i) => (
          <span
            key={i}
            className="replay-track__session"
            data-current={current >= sessions[i].first && current <= sessions[i].last ? '' : undefined}
            style={{ left: `${segment.x0 * 100}%`, width: `${(segment.x1 - segment.x0) * 100}%` }}
          />
        ))}

        <svg className="replay-track__spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id={`${clipId}-played`}>
              <rect x="0" y="0" width={(playX ?? 0) * W} height={H} />
            </clipPath>
          </defs>
          <path className="replay-track__area" d={path} />
          {playX !== null && <path className="replay-track__area replay-track__area--played" d={path} clipPath={`url(#${clipId}-played)`} />}
        </svg>

        {only?.map((i) => (
          <span key={i} className="replay-track__tick" style={{ left: `${layout.xs[i] * 100}%` }} aria-hidden="true" />
        ))}

        {markers.map((m) => (
          <span
            key={m.key}
            className="replay-track__marker"
            style={{ left: `${m.x * 100}%` }}
            data-tooltip={m.label}
            data-tooltip-pos="top"
          />
        ))}

        {hover !== null && hoverMoment && (
          <>
            <span className="replay-track__hover" style={{ left: `${layout.xs[hover] * 100}%` }} aria-hidden="true" />
            <span
              className="replay-track__bubble"
              style={{ left: `${Math.min(92, Math.max(8, layout.xs[hover] * 100))}%` }}
              aria-hidden="true"
            >
              <span className="replay-track__bubble-label">{hoverMoment.label}</span>
              <span className="replay-track__bubble-time">{clockLabel(hoverMoment.at)}</span>
            </span>
          </>
        )}

        {playX !== null && (
          <span className="replay-track__playhead" style={{ left: `${playX * 100}%` }} aria-hidden="true" />
        )}
      </div>

      <div className="replay-track__labels" aria-hidden="true">
        {layout.segments.map((segment, i) => {
          const px = (segment.x1 - segment.x0) * width;
          if (px < 64) return null;
          const s = sessions[i];
          return (
            <span
              key={i}
              className="replay-track__label"
              style={{ left: `${segment.x0 * 100}%`, width: `${(segment.x1 - segment.x0) * 100}%` }}
            >
              {px >= 120 && (
                <AvatarStack
                  size={14}
                  max={3}
                  people={s.authors.map((a) => ({ key: a.id, name: a.name, color: a.color }))}
                />
              )}
              <span className="replay-track__label-text">{clockRange(s.startAt, s.endAt)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
