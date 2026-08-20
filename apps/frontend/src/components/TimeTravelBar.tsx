import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Play, Pause, SkipBack, SkipForward, X, History, Loader2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { roomHistoryUrl } from '../utils/endpoints';
import { cameraSystem } from '../engine/CameraSystem';
import { fitPose, type FitBounds } from '../engine/cameraFit';
import {
  activityBuckets,
  buildTimeline,
  materialiseAt,
  type Moment,
  type RawUpdate,
  type SessionTimeline,
} from '../engine/history/sessionTimeline';

interface TimeTravelBarProps {
  roomId: string;
  onClose: () => void;
  /**
   * @param changedIds Exactly which nodes differ from the previous frame, or
   *   `null` when that is not knowable (a rewind rebuilds the document).
   */
  onApplySnapshot: (objects: Record<string, any> | null, changedIds?: string[] | null) => void;
}

const SPEEDS = [1, 2, 4, 8];

/**
 * The most transactions this will replay, matching the server's own retention
 * cap. Building a timeline is synchronous, so this is the bound on how long
 * opening Time Travel can block the tab.
 */
const MAX_REPLAY_UPDATES = 2000;

/**
 * Room left below the framed session for the bar itself.
 *
 * The instrument sits along the bottom edge and is opaque, so fitting to the
 * bare viewport would tuck the lowest objects underneath it — and on a replay
 * the whole point is that nothing is hidden. Generous rather than exact,
 * because the bar's height changes with its content (the trimmed-history
 * notice adds a line) and a fit that has to be recomputed when a notice
 * appears is a camera that moves for no reason a viewer can see.
 */
const REPLAY_BOTTOM_CLEARANCE = 190;

/**
 * Put the whole session on screen before anything plays.
 *
 * On an infinite canvas the camera is wherever it was left, and the history
 * being replayed is very often somewhere else entirely — so playback ran with
 * most of it outside the viewport, which reads as objects simply never
 * appearing. Framing once on entry, against the union of everywhere the
 * session ever reached, means nothing is clipped at any point along it.
 *
 * Done once rather than per moment on purpose: a camera that re-fits on every
 * step chases the content around and is far harder to follow than a fixed
 * frame you can watch things move within.
 */
function frameSession(bounds: FitBounds | null) {
  if (!bounds) return;
  const pose = fitPose(
    bounds,
    cameraSystem.width,
    Math.max(cameraSystem.height - REPLAY_BOTTOM_CLEARANCE, 200),
    { ...cameraSystem.zoomLimits }
  );
  if (!pose) return;
  /**
   * No further correction: shortening the viewport is the whole adjustment.
   *
   * `fitPose` centres within whatever height it is handed, and it was handed
   * the height *above* the bar — so the content already lands in the middle of
   * the clear strip, measured from the top of the screen. Shifting again would
   * move it up by another half-clearance, out of the space it was just fitted
   * into.
   */
  cameraSystem.setPose(pose.x, pose.y, pose.zoom);
}

/** Columns in the activity strip. Enough to show rhythm, few enough to read. */
const ACTIVITY_COLUMNS = 64;

/**
 * Time Travel — replays the room's authoring history as a sequence of moments.
 *
 * ## What the redesign fixed
 *
 * The previous bar looked busy and behaved worse, for three reasons that were
 * all invisible in the source until you tried to use it:
 *
 *  1. **The moment ticks could not be clicked.** They were absolutely
 *     positioned `<button>`s, and a transparent `<input type="range">` was laid
 *     over the whole track at `z-index: 2` to do the scrubbing. The input ate
 *     every press, so the buttons' tooltips never appeared and clicking a
 *     specific moment quietly did whatever the slider decided instead. Two
 *     interactive layers over the same pixels, one of them a decoy.
 *  2. **The ticks claimed to show something they did not.** They sat at
 *     `i / (count - 1)` — evenly spaced *by index* — under a comment saying
 *     they showed "where the session was busy instead of spacing steps
 *     evenly". Index spacing is precisely what cannot show that: a frantic
 *     minute and a slow afternoon draw the same row of dots.
 *  3. **On a long session they piled into a smear.** One 9px dot per moment
 *     with no lower bound on spacing, so a few hundred moments overlapped into
 *     a grey band — the "messy" part.
 *
 * ## The shape it takes now
 *
 * Two axes, each used for the thing it is good at:
 *
 *  - The **activity strip** is wall-clock time. It answers "when was this
 *     session busy, and who was working", which is the question the old
 *     comment was reaching for, and it stays legible at any number of moments
 *     because it is a fixed number of columns rather than one mark per edit.
 *  - The **scrub track** is index. Every moment is equally reachable however
 *     long the pause before it was, which is what you want when navigating
 *     rather than surveying.
 *
 * One interactive element per row, so nothing is layered over anything else.
 *
 * ## Why play/pause is K and not Space
 *
 * Space is held to pan the canvas, and that binding lives in `Canvas` on the
 * same `window`. Both fired: pressing Space during replay toggled playback
 * *and* armed the hand tool. Panning around the board to look at the replayed
 * state is a thing you genuinely want here, so Space stays with the canvas and
 * transport takes `K` — which is what every video editor uses anyway.
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

  /**
   * Hidden, but still replaying.
   *
   * The same affordance the forces panel has, for the same reason: the
   * instrument sits over the bottom of the board, and the moment you want to
   * *look* at what you have scrubbed to is the moment it is in the way. The
   * preference is remembered, because someone who works this way works this
   * way every time.
   */
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem('vega_timetravel_collapsed') === '1'
  );
  const setCollapsedPref = (val: boolean) => {
    window.localStorage.setItem('vega_timetravel_collapsed', val ? '1' : '0');
    setCollapsed(val);
  };

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
        const all: RawUpdate[] = data.updates ?? [];
        /**
         * A ceiling on what this will attempt, independent of the server.
         *
         * The endpoint bounds its own response now, but it did not always, and
         * a client that trusts a server to hand it a reasonable amount of work
         * has no defence when it does not: building a timeline is synchronous
         * main-thread work, so an oversized log froze the tab outright rather
         * than loading slowly. Keeping the most recent window means an old or
         * misconfigured server degrades to "history starts later than it might"
         * instead of to an unresponsive page.
         */
        const rows = all.length > MAX_REPLAY_UPDATES ? all.slice(-MAX_REPLAY_UPDATES) : all;
        const withheld = all.length - rows.length;
        setTrimmedCount(
          (data.trimmed ? Number(data.trimmedCount ?? 0) : 0) + withheld
        );
        if (rows.length > 0) {
          const built = buildTimeline(rows);
          setUpdates(rows);
          setTimeline(built);
          setMomentIndex(Math.max(0, built.moments.length - 1));
          frameSession(built.bounds);
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

  /**
   * Stable across renders while the timeline itself is unchanged.
   *
   * `timeline?.moments ?? []` built a fresh array every render, so anything
   * downstream keyed on it — the activity buckets in particular — recomputed on
   * every keystroke and every playback tick, memo or no memo.
   */
  const moments = useMemo(() => timeline?.moments ?? [], [timeline]);
  const current: Moment | undefined = moments[momentIndex];

  /**
   * Ids the replay document changed since the last frame we published.
   *
   * Collected by an observer on the replay doc rather than by diffing two
   * snapshots: applying an update already tells Yjs exactly which entries
   * moved, so this costs nothing on top of the seek itself.
   */
  const changedRef = useRef<Set<string>>(new Set());

  /** Watch a replay document so forward steps can report a precise change set. */
  const observeReplayDoc = useCallback((doc: Y.Doc) => {
    doc.getMap<Y.Map<any>>('objects').observeDeep((events) => {
      events.forEach((event) => {
        const path = event.path as (string | number)[];
        if (path.length === 0) {
          event.keys.forEach((_change, id) => changedRef.current.add(String(id)));
        } else {
          changedRef.current.add(String(path[0]));
        }
      });
    });
  }, []);

  /**
   * Publish the document at the playhead.
   *
   * `changedIds` is `null` after a rewind, because that builds a brand new
   * document and there is nothing to have observed. Rewinds are one user
   * action; forward steps are the ones that happen up to eight times a second,
   * and those carry an exact set.
   */
  const emit = useCallback((doc: Y.Doc, changedIds: string[] | null) => {
    const objectsMap = doc.getMap<Y.Map<any>>('objects');
    const snapshot: Record<string, any> = {};
    objectsMap.forEach((objMap, id) => {
      snapshot[id] = objMap.toJSON();
    });
    onApplySnapshotRef.current(snapshot, changedIds);
  }, []);

  // Materialise whatever moment the playhead is on.
  useEffect(() => {
    if (!timeline || moments.length === 0 || !current) return;

    const before = replayRef.current?.doc;
    changedRef.current.clear();
    const next = materialiseAt(updates, current.index, timeline.keyframes, replayRef.current);

    // materialiseAt returns a fresh doc when it had to rewind; drop the old one.
    const rebuilt = next.doc !== before;
    if (before && rebuilt) before.destroy();
    if (rebuilt) observeReplayDoc(next.doc);

    replayRef.current = next;
    emit(next.doc, rebuilt ? null : Array.from(changedRef.current));
  }, [momentIndex, timeline, updates, current, moments.length, emit, observeReplayDoc]);

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

  /**
   * Keyboard transport.
   *
   * Arrows step, Home/End jump to the ends, `K` toggles playback. Space is
   * deliberately absent — see the note on the component.
   */
  useEffect(() => {
    if (moments.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setMomentIndex(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setMomentIndex(i => Math.min(moments.length - 1, i + 1));
      } else if (e.key.toLowerCase() === 'k') {
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

  const buckets = useMemo(() => activityBuckets(moments, ACTIVITY_COLUMNS), [moments]);

  if (loading) {
    return (
      <div className="timetravel timetravel--message panel-surface">
        <Loader2 size={16} className="timetravel__spinner" />
        Reading this room’s history…
      </div>
    );
  }

  if (error || moments.length === 0) {
    return (
      <div className="timetravel timetravel--message panel-surface">
        <History size={16} className="timetravel__muted-icon" />
        <span className="timetravel__muted">
          {error
            ? `Time Travel can’t reach the history log — ${error}`
            : 'Nothing to replay yet. Once people start building here, their edits appear on this timeline.'}
        </span>
        <button type="button" className="timetravel__icon-btn" onClick={onClose} aria-label="Close Time Travel">
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

  /**
   * Where the playhead sits on the *time* axis, so the strip can mark it.
   *
   * Separate from `progressPct`, which is the index axis. Conflating the two is
   * what the old bar did, and it is why nothing on it could show elapsed time.
   */
  const first = moments[0].at;
  const last = moments[moments.length - 1].at;
  const span = last - first;
  const timePct = current && span > 0 ? ((current.at - first) / span) * 100 : progressPct;

  const elapsed = span > 0 ? Math.round(span / 60000) : 0;

  /**
   * The collapsed instrument.
   *
   * Not a bare chevron. The question the panel's absence creates is *where in
   * the session am I* — so the handle answers that, and reopening is the side
   * effect. It keeps playing while hidden, so it also has to say whether it is
   * moving; a still handle over a moving board would read as a bug.
   */
  if (collapsed) {
    return (
      <button
        type="button"
        className="panel-surface timetravel-handle"
        onClick={() => setCollapsedPref(false)}
        data-tooltip="Show the replay controls — Escape leaves Time Travel"
        aria-label={`Replaying, moment ${momentIndex + 1} of ${moments.length}. Show the replay controls`}
      >
        <span
          className="timetravel-handle__dot"
          style={{ background: current?.authorColor ?? 'var(--history-accent)' }}
          aria-hidden="true"
        />
        <span className="timetravel-handle__count">
          {momentIndex + 1}
          <span className="timetravel__count-of"> / {moments.length}</span>
        </span>
        {isPlaying && <Loader2 size={12} className="timetravel-handle__spin" aria-hidden="true" />}
        <ChevronUp size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="timetravel panel-surface" role="group" aria-label="Time Travel session replay">
      {/* Row 1: what you are looking at. The description leads, because it is
          the thing a person is actually navigating by. */}
      <div className="timetravel__head">
        <span className="timetravel__eyebrow">
          <History size={13} /> History
        </span>

        {current && (
          <span
            className="timetravel__author-dot"
            style={{ background: current.authorColor }}
            title={current.authorName}
            aria-hidden
          />
        )}
        <span className="timetravel__label">{current?.label ?? 'Start of session'}</span>
        {current && current.updateCount > 1 && (
          <span className="timetravel__sub">{current.updateCount} edits</span>
        )}

        <span className="timetravel__time">{timeLabel}</span>
        <button
          type="button"
          className="timetravel__icon-btn"
          onClick={() => setCollapsedPref(true)}
          aria-label="Hide the replay controls"
          data-tooltip="Hide these controls and keep replaying"
        >
          <ChevronDown size={16} />
        </button>
        <button type="button" className="timetravel__icon-btn" onClick={onClose} aria-label="Exit Time Travel" data-tooltip="Exit Time Travel">
          <X size={16} />
        </button>
      </div>

      {/* Row 2: the session at a glance, on the wall-clock axis. Purely a
          readout — every interactive thing lives on the track below, so there
          are never two controls stacked over the same pixels.

          It is *captioned* now. Sixty-four bars of varying height, unlabelled,
          are not self-evident — they were read as blocks that must do
          something, and the only clue to what they were was a `title`
          attribute that requires already suspecting there is something to
          learn. The caption names the axis and the ends give it a scale, which
          together is the difference between a chart and decoration. */}
      {span > 0 && (
        <div className="timetravel__strip">
          <div className="timetravel__strip-head" aria-hidden="true">
            <span className="timetravel__strip-title">Activity over the session</span>
            <span className="timetravel__strip-scale">
              {moments.length} moments · {elapsed || '<1'} min
            </span>
          </div>
        <div
          className="timetravel__activity"
          role="img"
          aria-label={`Activity across the session: ${moments.length} moments over ${elapsed || 'less than a'} minute${elapsed === 1 ? '' : 's'}. Taller marks are busier stretches.`}
          title="Taller marks are busier stretches. Colour is who was working."
        >
          {buckets.map((bucket, i) => (
            <span
              key={i}
              className="timetravel__bar"
              style={{
                // A visible floor for empty slices, so the strip reads as one
                // continuous session with quiet stretches rather than breaking
                // into islands that look like missing data.
                //
                // Scaled rather than sized: the bar is full height in CSS and
                // this squashes it from the baseline, so sixty-four columns
                // settling into place is one composited frame instead of
                // sixty-four layouts inside a flex row.
                transform: `scaleY(${bucket.count === 0 ? 0.08 : 0.2 + bucket.weight * 0.8})`,
                background: bucket.color ?? 'var(--history-track)',
                opacity: bucket.count === 0 ? 1 : 0.4 + bucket.weight * 0.6,
              }}
            />
          ))}
          <span className="timetravel__activity-playhead" style={{ left: `${timePct}%` }} />
        </div>
          {/* The scale, which is what turns a row of bars into an axis. Two
              clock times at the ends say "this is time, running left to right"
              in less space than any label could. */}
          <div className="timetravel__strip-axis" aria-hidden="true">
            <span>{new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span>{new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      )}

      {/* Row 3: the track. One control — the range input *is* the scrubber,
          rather than a transparent decoy laid over buttons that could never be
          reached. The marks behind it are decoration and say so. */}
      <div className="timetravel__track">
        <div className="timetravel__rail" />
        {/* Full width in CSS, scaled from the left — see the note on the rule. */}
        <div className="timetravel__elapsed" style={{ transform: `scaleX(${progressPct / 100})` }} />

        {/* Drawn only while they can be told apart. Past that the activity
            strip above is carrying this information properly, and one mark per
            moment is the smear the redesign exists to remove. */}
        {moments.length <= 60 && moments.map((moment, i) => (
          <span
            key={`${moment.index}-${i}`}
            className="timetravel__tick"
            style={{
              left: `${moments.length > 1 ? (i / (moments.length - 1)) * 100 : 0}%`,
              background: i <= momentIndex ? moment.authorColor : 'var(--history-tick)',
              opacity: i === momentIndex ? 1 : 0.55,
            }}
          />
        ))}

        <input
          type="range"
          className="timetravel__range"
          min={0}
          max={moments.length - 1}
          value={momentIndex}
          aria-label="Scrub through session history"
          aria-valuetext={current ? `${current.label}, ${timeLabel}` : undefined}
          onChange={e => { setIsPlaying(false); setMomentIndex(Number(e.target.value)); }}
        />
      </div>

      {/* Row 4: transport + context. */}
      <div className="timetravel__foot">
        <button
          type="button" className="timetravel__icon-btn"
          onClick={() => { setMomentIndex(0); setIsPlaying(false); }}
          disabled={atStart} data-tooltip="First moment (Home)" aria-label="First moment"
        >
          <SkipBack size={15} />
        </button>
        <button
          type="button" className="timetravel__icon-btn"
          onClick={() => { setIsPlaying(false); setMomentIndex(i => Math.max(0, i - 1)); }}
          disabled={atStart} data-tooltip="Previous moment (←)" aria-label="Previous moment"
        >
          <ChevronLeft size={17} />
        </button>

        <button
          type="button"
          className="timetravel__play"
          onClick={() => {
            // Replaying from the end has nowhere to go; rewind first so the
            // button always does what it says.
            if (atEnd) setMomentIndex(0);
            setIsPlaying(p => !p);
          }}
          data-tooltip={isPlaying ? 'Pause (K)' : 'Play session (K)'}
          aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
        >
          {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="timetravel__play-glyph" />}
        </button>

        <button
          type="button" className="timetravel__icon-btn"
          onClick={() => { setIsPlaying(false); setMomentIndex(i => Math.min(moments.length - 1, i + 1)); }}
          disabled={atEnd} data-tooltip="Next moment (→)" aria-label="Next moment"
        >
          <ChevronRight size={17} />
        </button>
        <button
          type="button" className="timetravel__icon-btn"
          onClick={() => { setIsPlaying(false); setMomentIndex(moments.length - 1); }}
          disabled={atEnd} data-tooltip="Latest moment (End)" aria-label="Latest moment"
        >
          <SkipForward size={15} />
        </button>

        <span className="timetravel__count">
          {momentIndex + 1} <span className="timetravel__count-of">of</span> {moments.length}
        </span>

        {timeline && timeline.authors.length > 1 && (
          <span className="timetravel__authors" title={timeline.authors.map(a => a.name).join(', ')}>
            {timeline.authors.slice(0, 5).map(author => (
              <span key={author.id} className="timetravel__author-chip" style={{ background: author.color }} />
            ))}
            <span className="timetravel__sub">{timeline.authors.length} people</span>
          </span>
        )}

        {isTrimmed && (
          <span
            className="timetravel__trimmed"
            title={`Retention has discarded the ${trimmedCount.toLocaleString()} oldest changes in this room, so the replay starts partway through the session.`}
          >
            <AlertTriangle size={12} /> Starts partway
          </span>
        )}

        <button
          type="button"
          className="timetravel__speed"
          onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          data-tooltip="Playback speed"
          aria-label={`Playback speed ${speed}×`}
        >
          {speed}×
        </button>
      </div>
    </div>
  );
};
