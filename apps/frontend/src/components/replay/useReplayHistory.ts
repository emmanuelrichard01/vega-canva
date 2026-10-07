import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryError, loadHistory, type HistoryPage } from '../../engine/history/historyApi';
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
  retry: () => void;
}

/**
 * Load the room's update log and build its timeline without blocking the tab.
 *
 * Pages download while earlier ones are being folded, in slices of a few
 * milliseconds with a yield between each, so neither a long log nor a slow
 * network ever holds a frame. The replay engine is created once the build is
 * complete, from the builder's rows and keyframes.
 */
export function useReplayHistory(roomId: string): ReplayHistory {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<HistoryStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<SessionTimeline | null>(null);
  const [engine, setEngine] = useState<ReplayEngine | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, processed: 0, total: 0 });
  const [trimmedCount, setTrimmedCount] = useState(0);
  const engineRef = useRef<ReplayEngine | null>(null);
  /** Automatic restarts spent; capped so a log that keeps moving still settles on an error. */
  const autoRestarts = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    let builder: TimelineBuilder | null = null;
    let baseline: Uint8Array | null = null;
    let total = 0;
    let loadedAll = false;
    let pumping: Promise<void> | null = null;
    let lastReport = 0;

    setStatus('loading');
    setError(null);
    setTimeline(null);
    setProgress({ loaded: 0, processed: 0, total: 0 });

    const report = (force = false) => {
      if (!builder) return;
      const t = performance.now();
      if (!force && t - lastReport < 120) return;
      lastReport = t;
      setProgress({ loaded: builder.log.length, processed: builder.processed, total: Math.max(total, builder.log.length) });
    };

    const finish = () => {
      if (!builder || abort.signal.aborted) return;
      const built = builder.snapshot();
      const rows: RawUpdate[] = builder.log;
      builder.destroy();
      builder = null;
      const next = new ReplayEngine({ log: () => rows, keyframes: () => built.keyframes, baseline });
      engineRef.current?.destroy();
      engineRef.current = next;
      setEngine(next);
      setTimeline(built);
      setProgress({ loaded: rows.length, processed: rows.length, total: rows.length });
      setStatus('ready');
    };

    const pump = () => {
      if (pumping || !builder) return;
      const current = builder;
      pumping = buildTimelineSliced(current, { signal: abort.signal, onProgress: () => report() }).then(() => {
        pumping = null;
        if (abort.signal.aborted) return;
        if (!current.done) pump();
        else if (loadedAll) finish();
      });
    };

    loadHistory(
      roomId,
      {
        onFirst: (page: HistoryPage) => {
          baseline = typeof page.baseline === 'string' ? decodeBase64Update(page.baseline) : null;
          total = Number(page.total ?? page.updates?.length ?? 0);
          setTrimmedCount(page.trimmed ? Number(page.trimmedCount ?? 0) : 0);
          builder = new TimelineBuilder({ baseline });
        },
        onRows: (rows) => {
          builder?.push(rows);
          report(true);
          pump();
        },
      },
      abort.signal
    )
      .then(() => {
        if (abort.signal.aborted) return;
        loadedAll = true;
        if (!pumping) finish();
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        // The log moved under a partial load; start over once, quietly.
        if (err instanceof HistoryError && err.status === 409 && autoRestarts.current < 2) {
          autoRestarts.current += 1;
          setAttempt((n) => n + 1);
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

  return { status, error, timeline, engine, progress, trimmedCount, retry };
}
