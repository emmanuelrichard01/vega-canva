import { syncFromUrl } from './chartSync';
import { withChartData } from './chartCsv';
import { updateChart } from './chartApply';
import type { ChartSpec } from './chartTypes';

/**
 * Auto-refresh, as session-local state.
 *
 * ## Why this is not on the chart
 *
 * `pollInterval` was a field on `ChartSpec`, which means it was in the CRDT,
 * which means it was replicated -- so "refresh every 5 seconds" would have
 * been an instruction to *every member's browser* to hit a URL one person
 * typed, every five seconds, for as long as the board stayed open. Nobody
 * would have noticed, because the field was read by nothing at all: the
 * dropdown was inert, and turning it into a working feature the obvious way
 * would have turned a dead control into a way to point a room's worth of
 * browsers at an arbitrary endpoint.
 *
 * The interval belongs to the person who set it. It lives here, in module
 * state that syncs to nobody and does not survive a reload -- tier three of
 * this app's three-tier model, the same place tool arming and hover live.
 * What *does* reach the document is the data that came back, written like any
 * other edit. Everyone sees the numbers; only one browser made the request.
 *
 * ## Why a registry rather than a hook in the dialog
 *
 * A chart that stops updating when you close the dialog you set it up in is
 * not live. The registry outlives the dialog and the driver is mounted once,
 * so turning refresh on and getting back to work does what it says.
 *
 * ## The overlap rule
 *
 * A tick that is still in flight when the next one is due is skipped rather
 * than queued. A slow endpoint on a five-second interval would otherwise
 * accumulate requests without bound, and the second answer would race the
 * first into the document -- so the chart would flicker between two versions
 * of the truth for as long as the endpoint stayed slow.
 */

interface Entry {
  /** Seconds. */
  interval: number;
  timer: number;
  /** Cancels the request in flight, if there is one. */
  abort: AbortController | null;
  /** Set while a tick is in flight, so the next one stands down. */
  busy: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** Reported to the UI, so a chart can say when it last succeeded or failed. */
export interface LiveStatus {
  interval: number;
  busy: boolean;
  lastError?: string;
  lastSyncedAt?: number;
}

const status = new Map<string, LiveStatus>();

function announce() {
  for (const fn of listeners) fn();
}

/** Subscribe to changes, for a component that shows the state. */
export function subscribeLive(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function liveStatus(nodeId: string): LiveStatus | undefined {
  return status.get(nodeId);
}

/**
 * One refresh, now.
 *
 * Reads the spec at the moment it runs rather than closing over the one that
 * was current when the interval was set -- otherwise editing the URL would
 * leave the timer fetching the old one forever.
 */
async function tick(nodeId: string, read: (id: string) => ChartSpec | null) {
  const entry = entries.get(nodeId);
  if (!entry || entry.busy) return;

  const spec = read(nodeId);
  if (!spec?.dataSource?.url) return;

  entry.busy = true;
  entry.abort = new AbortController();
  status.set(nodeId, { ...(status.get(nodeId) ?? { interval: entry.interval }), busy: true });
  announce();

  const result = await syncFromUrl(spec.dataSource.url, spec.dataSource.dataPath, {
    signal: entry.abort.signal,
  });

  entry.busy = false;
  entry.abort = null;

  // The chart may have been deleted, or refresh turned off, while the request
  // was out. Writing the answer into a document that has moved on is worse
  // than dropping it.
  if (!entries.has(nodeId)) return;
  const current = read(nodeId);
  if (!current) return;

  if (result.ok) {
    updateChart(nodeId, {
      ...withChartData(current, result.data),
      dataSource: { ...current.dataSource, lastSyncedAt: Date.now(), syncError: undefined },
    });
    status.set(nodeId, { interval: entry.interval, busy: false, lastSyncedAt: Date.now() });
  } else {
    /**
     * A failed tick records the error and does not touch the data.
     *
     * The last good numbers are more useful than an empty chart, and a
     * refresh that blanks a board because a VPN dropped is the kind of thing
     * people stop trusting a feature over.
     */
    status.set(nodeId, {
      interval: entry.interval,
      busy: false,
      lastError: result.error,
      lastSyncedAt: status.get(nodeId)?.lastSyncedAt,
    });
  }
  announce();
}

/**
 * Start, change or stop auto-refresh for one chart.
 *
 * An interval of zero stops it, which is what the "only when I ask" option
 * selects -- so there is one code path rather than a separate teardown that
 * could be forgotten.
 */
export function setLiveInterval(
  nodeId: string,
  seconds: number,
  read: (id: string) => ChartSpec | null
): void {
  stopLive(nodeId);
  if (seconds <= 0) {
    announce();
    return;
  }

  const entry: Entry = {
    interval: seconds,
    timer: window.setInterval(() => void tick(nodeId, read), seconds * 1000),
    abort: null,
    busy: false,
  };
  entries.set(nodeId, entry);
  status.set(nodeId, { interval: seconds, busy: false, ...status.get(nodeId) });
  announce();

  // Once immediately, because somebody who just asked for "every 30 seconds"
  // means "and now", not "in thirty seconds".
  void tick(nodeId, read);
}

export function stopLive(nodeId: string): void {
  const entry = entries.get(nodeId);
  if (!entry) return;
  window.clearInterval(entry.timer);
  entry.abort?.abort();
  entries.delete(nodeId);
  const prev = status.get(nodeId);
  if (prev) status.set(nodeId, { ...prev, interval: 0, busy: false });
}

/** Every chart currently refreshing. For a status readout, and for teardown. */
export function liveNodeIds(): string[] {
  return [...entries.keys()];
}

/** Stops everything. For a room teardown, and for tests. */
export function stopAllLive(): void {
  for (const id of [...entries.keys()]) stopLive(id);
  status.clear();
  announce();
}
