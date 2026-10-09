import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryError, loadHistoryCached, type HistoryPage } from '../../engine/history/historyApi';
import { ReplayEngine } from '../../engine/history/frames';
import {
  TimelineBuilder,
  buildTimelineSliced,
  decodeBase64Update,
  type RawUpdate,
  type SessionTimeline,
} from '../../engine/history/sessionTimeline';

export type HistoryStatus = 'loading' | 'ready' | 'error';

export interface ReplayHistory {
  status: HistoryStatus;
  error: string | null;
  timeline: SessionTimeline | null;
  engine: ReplayEngine | null;
  /** Rows downloaded and rows folded into the timeline, against the total. */
  progress: { loaded: number; processed: number; total: number };
  /** Rows retention has folded into the baseline and autosaves. */
  trimmedCount: number;
  /** True while rows newer than a cached copy are still being fetched. */
  refreshing: boolean;
  retry: () => void;
}

/**
 * Load the room's update log and build its timeline without blocking the tab.
 *
 * The log is kept in IndexedDB between visits (`loadHistoryCached`): a second
 * open builds from that copy at once and is ready before the network answers,
 * then folds in only the rows written since. Pages download while earlier
 * ones are being folded, in slices of a few milliseconds with a yield between
 * each, so neither a long log nor a slow network ever holds a frame.
 *
 * The builder records a frame track as it goes, so the replay engine seeks by
 * plain patches from the nearest checkpoint and never rebuilds a document.
 * A new engine and timeline are published each time the build catches up:
 * once for a cached copy, again if newer rows arrive.
 */
export function useReplayHistory(roomId: string): ReplayHistory {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<HistoryStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<SessionTimeline | null>(null);
  const [engine, setEngine] = useState<ReplayEngine | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, processed: 0, total: 0 });
  const [trimmedCount, setTrimmedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const engineRef = useRef<ReplayEngine | null>(null);
  /** Automatic restarts spent; capped so a log that keeps moving still settles on an error. */
  const autoRestarts = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    let builder: TimelineBuilder | null = null;
    let baseline: Uint8Array | null = null;
    let total = 0;
    /** Every row that will arrive has been pushed (network done, or a cached copy in hand). */
    let haveAll = false;
    let networkDone = false;
    /** Rows covered by the engine last published, so an unchanged rebuild is not republished. */
    let published = -1;
    let pumping: Promise<void> | null = null;
    let lastReport = 0;

    setStatus('loading');
    setError(null);
    setTimeline(null);
    setRefreshing(false);
    setProgress({ loaded: 0, processed: 0, total: 0 });

    const report = (force = false) => {
      if (!builder) return;
      const t = performance.now();
      if (!force && t - lastReport < 120) return;
      lastReport = t;
      setProgress({ loaded: builder.log.length, processed: builder.processed, total: Math.max(total, builder.log.length) });
    };

    /** Publish what the builder has; tear it down once nothing more can arrive. */
    const publish = () => {
      if (!builder || abort.signal.aborted) return;
      const rows: RawUpdate[] = builder.log;
      if (rows.length !== published) {
        published = rows.length;
        const built = builder.snapshot();
        const next = new ReplayEngine({
          log: () => rows,
          keyframes: () => built.keyframes,
          baseline,
          track: builder.frameTrack,
        });
        engineRef.current?.destroy();
        engineRef.current = next;
        setEngine(next);
        setTimeline(built);
        setProgress({ loaded: rows.length, processed: rows.length, total: rows.length });
        setStatus('ready');
      }
      if (networkDone) {
        setRefreshing(false);
        builder.destroy();
        builder = null;
      }
    };

    const pump = () => {
      if (pumping || !builder) return;
      const current = builder;
      pumping = buildTimelineSliced(current, { signal: abort.signal, onProgress: () => report() }).then(() => {
        pumping = null;
        if (abort.signal.aborted) return;
        if (!current.done) pump();
        else if (haveAll) publish();
      });
    };

    loadHistoryCached(
      roomId,
      {
        onFirst: (page: HistoryPage, info) => {
          baseline = typeof page.baseline === 'string' ? decodeBase64Update(page.baseline) : null;
          total = Number(page.total ?? page.updates?.length ?? 0);
          setTrimmedCount(page.trimmed ? Number(page.trimmedCount ?? 0) : 0);
          setRefreshing(info.fromCache);
          builder = new TimelineBuilder({ baseline, track: true });
        },
        onRows: (rows) => {
          if (rows.length === 0) return;
          builder?.push(rows);
          report(true);
          pump();
        },
        onCached: () => {
          // A cached copy is a whole log as of when it was saved: show it as
          // soon as it is built, while newer rows are fetched.
          haveAll = true;
          if (!pumping) publish();
        },
      },
      abort.signal
    )
      .then(() => {
        if (abort.signal.aborted) return;
        haveAll = true;
        networkDone = true;
        if (!pumping) publish();
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        // The log moved under a partial load (or since the cached copy); start over once, quietly.
        if (err instanceof HistoryError && err.status === 409 && autoRestarts.current < 2) {
          autoRestarts.current += 1;
          setAttempt((n) => n + 1);
          return;
        }
        // A cached copy already on screen stays usable when the refresh fails.
        if (published >= 0) {
          networkDone = true;
          if (!pumping) publish();
          else setRefreshing(false);
          return;
        }
        const message =
          err instanceof HistoryError
            ? err.message
            : 'The history server could not be reached. Check your connection and try again.';
        setError(message);
        setStatus('error');
      });

    return () => {
      abort.abort();
      builder?.destroy();
      builder = null;
      engineRef.current?.destroy();
      engineRef.current = null;
      setEngine(null);
    };
  }, [roomId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, error, timeline, engine, progress, trimmedCount, refreshing, retry };
}
