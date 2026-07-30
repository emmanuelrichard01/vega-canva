import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Play, Pause, SkipBack, X, Gauge, History, Loader2, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { roomHistoryUrl } from '../utils/endpoints';
import {
  buildTimeline,
  materialiseAt,
  type Moment,
  type RawUpdate,
  type SessionTimeline,
} from '../engine/history/sessionTimeline';

interface TimeTravelBarProps {
  roomId: string;
  onClose: () => void;
  onApplySnapshot: (objects: Record<string, any> | null) => void;
}

const SPEEDS = [1, 2, 4, 8];

/**
 * Time Travel — replays the room's authoring history as a sequence of moments.
 *
 * ## What changed, and why
 *
 * The previous version scrubbed the raw update log and labelled the playhead
 * "Change 5 of 8". That number counted Yjs transactions, which is a storage
 * detail: one drag produces dozens, one rename produces one. So the scrubber's
 * steps were uneven, nothing attributed a change to a person, and there was no
 * way to seek to a moment you remembered. `engine/history/sessionTimeline`
 * now derives described, attributed moments from that same stream — replay
 * fidelity is untouched, but the unit is something a person authored.
 *
 * Two other things were wrong beneath the surface:
 *
 *  - **Replay never reached the canvas.** The snapshot went only to the Layers
 *    and Properties panels as `overrideObjects`; `isReplaying` existed, and the
 *    live observer already deferred to it, but nothing ever set it. Scrubbing
 *    moved two side panels while the canvas kept drawing the live document.
 *    The store's `applyReplaySnapshot` owns that transition now.
 *  - **Rewinding rebuilt the document from index 0**, so scrubbing backwards got
 *    slower the further into a session you were. The timeline carries periodic
 *    keyframes and `materialiseAt` seeks from the nearest one.
 */
export const TimeTravelBar: React.FC<TimeTravelBarProps> = ({ roomId, onClose, onApplySnapshot }) => {
  const [updates, setUpdates] = useState<RawUpdate[]>([]);
  const [timeline, setTimeline] = useState<SessionTimeline | null>(null);
  const [momentIndex, setMomentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Updates retention has discarded, as reported by the server. */
  const [trimmedCount, setTrimmedCount] = useState(0);

  const playbackTimerRef = useRef<any>(null);
  const replayRef = useRef<{ doc: Y.Doc; appliedThrough: number } | null>(null);

  /**
   * Latest `onApplySnapshot`, for the unmount cleanup that restores live state.
   *
   * `Room` passes this as an inline arrow, so its identity changes on every one
   * of `Room`'s renders. Naming it as a dependency of the fetch effect would
   * re-run that effect constantly — refetching the log, resetting the playhead
   * and destroying the replay doc mid playback.
   */
  const onApplySnapshotRef = useRef(onApplySnapshot);
  useEffect(() => {
    onApplySnapshotRef.current = onApplySnapshot;
  }, [onApplySnapshot]);

  useEffect(() => {
    let cancelled = false;
    async function fetchHistory() {
      try {
        const res = await fetch(roomHistoryUrl(roomId));
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const rows: RawUpdate[] = data.updates ?? [];
        setTrimmedCount(data.trimmed ? Number(data.trimmedCount ?? 0) : 0);
        if (rows.length > 0) {
          const built = buildTimeline(rows);
          setUpdates(rows);
          setTimeline(built);
          setMomentIndex(Math.max(0, built.moments.length - 1));
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load session history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchHistory();

    return () => {
      cancelled = true;
      onApplySnapshotRef.current(null); // hand the canvas back to the live document
      replayRef.current?.doc.destroy();
      replayRef.current = null;
    };
  }, [roomId]);

  const moments = timeline?.moments ?? [];
  const current: Moment | undefined = moments[momentIndex];

  const emit = useCallback((doc: Y.Doc) => {
    const objectsMap = doc.getMap<Y.Map<any>>('objects');
    const snapshot: Record<string, any> = {};
    objectsMap.forEach((objMap, id) => {
      snapshot[id] = objMap.toJSON();
    });
    onApplySnapshotRef.current(snapshot);
  }, []);

  // Materialise whatever moment the playhead is on.
  useEffect(() => {
    if (!timeline || moments.length === 0 || !current) return;
    const next = materialiseAt(updates, current.index, timeline.keyframes, replayRef.current);
    // materialiseAt returns a fresh doc when it had to rewind; drop the old one.
    if (replayRef.current && replayRef.current.doc !== next.doc) {
      replayRef.current.doc.destroy();
    }
    replayRef.current = next;
    emit(next.doc);
  }, [momentIndex, timeline, updates, current, moments.length, emit]);

  useEffect(() => {
    if (isPlaying && moments.length > 0) {
      playbackTimerRef.current = setInterval(() => {
        setMomentIndex(prev => {
          if (prev >= moments.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 900 / speed);
    } else {
      clearInterval(playbackTimerRef.current);
    }
    return () => clearInterval(playbackTimerRef.current);
  }, [isPlaying, speed, moments.length]);

  // Keyboard scrubbing. Arrow keys step a moment at a time, Space toggles
  // playback, Home/End jump to the ends — the shortcuts anyone who has used a
  // video scrubber will try first.
  useEffect(() => {
    if (moments.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setMomentIndex(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setMomentIndex(i => Math.min(moments.length - 1, i + 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying(p => !p);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setIsPlaying(false);
        setMomentIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setIsPlaying(false);
        setMomentIndex(moments.length - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moments.length]);

  const shellStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 96,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    boxShadow: 'var(--shadow-float)',
    borderRadius: 'var(--radius-xl)',
    animation: 'popIn 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  };

  if (loading) {
    return (
      <div
        className="panel-surface"
        style={{ ...shellStyle, display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)' as any }}
      >
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
        Reading this room’s history…
      </div>
    );
  }

  if (error || moments.length === 0) {
    return (
      <div
        className="panel-surface"
        style={{ ...shellStyle, display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', fontSize: 'var(--text-base)', maxWidth: 520 }}
      >
        <History size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <span style={{ color: 'var(--text-secondary)' }}>
          {error
            ? `Time Travel can’t reach the history log — ${error}`
            : 'Nothing to replay yet. Once people start building here, their edits appear on this timeline.'}
        </span>
        <button
          onClick={onClose}
          aria-label="Close Time Travel"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex', marginLeft: 'auto' }}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const atStart = momentIndex === 0;
  const atEnd = momentIndex === moments.length - 1;
  const progressPct = moments.length > 1 ? (momentIndex / (moments.length - 1)) * 100 : 100;
  const stamp = current ? new Date(current.at) : null;
  const timeLabel = stamp
    ? stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  // Reported by the server rather than guessed from the row count. Inferring it
  // was wrong both ways: an untrimmed room sitting exactly at the cap read as
  // partial, and a trimmed room that had since fallen below it read as complete.
  const isTrimmed = trimmedCount > 0;

  const iconButton = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: 'var(--space-1)',
    borderRadius: 'var(--radius-sm)',
    flexShrink: 0,
    transition: 'var(--motion-hover)',
    ...extra,
  });

  return (
    <div
      className="panel-surface"
      style={{ ...shellStyle, width: 680, padding: 'var(--space-4) var(--space-5) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      role="group"
      aria-label="Time Travel session replay"
    >
      {/* Row 1: what you are looking at. The description leads, because it is
          the thing a person is actually navigating by. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
            fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)' as any,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--history-accent)', flexShrink: 0,
          }}
        >
          <History size={13} /> History
        </span>

        {current && (
          <span
            aria-hidden
            title={current.authorName}
            style={{
              width: 8, height: 8, borderRadius: 'var(--radius-pill)',
              background: current.authorColor, flexShrink: 0,
              boxShadow: '0 0 0 2px var(--surface-primary)',
            }}
          />
        )}
        <span
          style={{
            fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)' as any,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
          }}
        >
          {current?.label ?? 'Start of session'}
        </span>
        {current && current.updateCount > 1 && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
            {current.updateCount} edits
          </span>
        )}

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {timeLabel}
          </span>
          <button onClick={onClose} aria-label="Exit Time Travel" title="Exit Time Travel" style={iconButton({ color: 'var(--text-tertiary)' })}>
            <X size={16} />
          </button>
        </span>
      </div>

      {/* Row 2: the track. Ticks are authored moments, so the timeline shows
          where the session was busy instead of spacing steps evenly. */}
      <div style={{ position: 'relative', height: 22, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 'var(--radius-pill)', background: 'var(--history-track)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${progressPct}%`, height: 4, borderRadius: 'var(--radius-pill)', background: 'var(--history-elapsed)', transition: 'width 90ms linear' }} />

        {moments.map((moment, i) => (
          <button
            key={`${moment.index}-${i}`}
            onClick={() => { setIsPlaying(false); setMomentIndex(i); }}
            title={`${moment.label} · ${new Date(moment.at).toLocaleTimeString()}`}
            aria-label={moment.label}
            style={{
              position: 'absolute',
              left: `${moments.length > 1 ? (i / (moments.length - 1)) * 100 : 0}%`,
              transform: 'translateX(-50%)',
              width: 9, height: 9, padding: 0,
              borderRadius: 'var(--radius-pill)',
              border: 'none',
              cursor: 'pointer',
              // Author colour, so a session with several people reads as lanes
              // of activity rather than an anonymous row of dots.
              background: i <= momentIndex ? moment.authorColor : 'var(--history-tick)',
              opacity: i === momentIndex ? 1 : 0.55,
              transition: 'var(--motion-hover)',
            }}
          />
        ))}

        <div
          aria-hidden
          style={{
            position: 'absolute', left: `${progressPct}%`, transform: 'translateX(-50%)',
            width: 3, height: 18, borderRadius: 'var(--radius-pill)',
            background: 'var(--history-playhead)', transition: 'left 90ms linear',
            pointerEvents: 'none',
          }}
        />

        <input
          type="range"
          min={0}
          max={moments.length - 1}
          value={momentIndex}
          aria-label="Scrub through session history"
          onChange={e => { setIsPlaying(false); setMomentIndex(Number(e.target.value)); }}
          style={{ width: '100%', opacity: 0, cursor: 'pointer', position: 'relative', zIndex: 2, height: 22, margin: 0 }}
        />
      </div>

      {/* Row 3: transport + context. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          onClick={() => { setMomentIndex(0); setIsPlaying(false); }}
          disabled={atStart}
          title="Back to the first moment"
          aria-label="Back to the first moment"
          style={iconButton({ opacity: atStart ? 0.4 : 1, cursor: atStart ? 'default' : 'pointer' })}
        >
          <SkipBack size={15} />
        </button>
        <button
          onClick={() => { setIsPlaying(false); setMomentIndex(i => Math.max(0, i - 1)); }}
          disabled={atStart}
          title="Previous moment (←)"
          aria-label="Previous moment"
          style={iconButton({ opacity: atStart ? 0.4 : 1, cursor: atStart ? 'default' : 'pointer' })}
        >
          <ChevronLeft size={17} />
        </button>

        <button
          onClick={() => {
            // Replaying from the end has nowhere to go; rewind first so the
            // button always does what it says.
            if (atEnd) setMomentIndex(0);
            setIsPlaying(p => !p);
          }}
          title={isPlaying ? 'Pause (Space)' : 'Play session (Space)'}
          aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
          style={{
            width: 34, height: 34, borderRadius: 'var(--radius-pill)',
            background: 'var(--text-primary)', color: 'var(--surface-primary)',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, transition: 'var(--motion-hover)',
          }}
        >
          {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" style={{ marginLeft: 2 }} />}
        </button>

        <button
          onClick={() => { setIsPlaying(false); setMomentIndex(i => Math.min(moments.length - 1, i + 1)); }}
          disabled={atEnd}
          title="Next moment (→)"
          aria-label="Next moment"
          style={iconButton({ opacity: atEnd ? 0.4 : 1, cursor: atEnd ? 'default' : 'pointer' })}
        >
          <ChevronRight size={17} />
        </button>

        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', marginLeft: 'var(--space-2)' }}>
          Moment {momentIndex + 1} of {moments.length}
        </span>

        {timeline && timeline.authors.length > 1 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginLeft: 'var(--space-3)' }}>
            {timeline.authors.slice(0, 5).map(author => (
              <span
                key={author.id}
                title={author.name}
                style={{ width: 7, height: 7, borderRadius: 'var(--radius-pill)', background: author.color }}
              />
            ))}
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 'var(--space-1)' }}>
              {timeline.authors.length} people
            </span>
          </span>
        )}

        {isTrimmed && (
          <span
            title={`Retention has discarded the ${trimmedCount.toLocaleString()} oldest changes in this room, so the replay starts partway through the session.`}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginLeft: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}
          >
            <AlertTriangle size={12} /> Starts partway
          </span>
        )}

        <button
          onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          title="Playback speed"
          aria-label={`Playback speed ${speed}×`}
          style={{
            marginLeft: 'auto',
            background: 'var(--surface-hover)', border: 'none', color: 'var(--text-primary)',
            borderRadius: 'var(--radius-md)', padding: '5px 9px',
            fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' as any,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
            flexShrink: 0, fontVariantNumeric: 'tabular-nums', transition: 'var(--motion-hover)',
          }}
        >
          <Gauge size={13} /> {speed}×
        </button>
      </div>
    </div>
  );
};
