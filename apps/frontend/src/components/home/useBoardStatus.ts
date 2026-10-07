import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../../utils/endpoints';
import { batchIds, type BoardStatus } from './library';

/** How often the dashboard asks again while it is in front of somebody. */
export const STATUS_INTERVAL_MS = 60_000;

export interface LibraryStatus {
  boards: Map<string, BoardStatus>;
  /** The deployment requires signed invites, so it says nothing about bare ids. */
  restricted: boolean;
}

const EMPTY: LibraryStatus = { boards: new Map(), restricted: false };

/**
 * What the server knows about the boards on this page: whether each still
 * exists, its current name, and how many people have it open.
 *
 * Asked on mount and then every minute while the tab is visible, in batches
 * the route accepts, so a library of any size is covered. Any failure yields
 * an empty answer, so a card shows nothing rather than a guess.
 */
export function useBoardStatus(ids: readonly string[]): LibraryStatus {
  const [status, setStatus] = useState<LibraryStatus>(EMPTY);
  const key = useMemo(() => [...new Set(ids)].sort().join(','), [ids]);

  useEffect(() => {
    if (!key) {
      setStatus(EMPTY);
      return;
    }
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const answers = await Promise.all(batchIds(key.split(',')).map(async (batch) => {
          const res = await fetch(`${API_BASE}/api/rooms/status?ids=${encodeURIComponent(batch.join(','))}`, {
            signal,
            credentials: 'omit',
          });
          if (!res.ok) throw new Error(String(res.status));
          return (await res.json()) as { restricted?: boolean; rooms?: BoardStatus[] };
        }));
        if (cancelled) return;
        const boards = new Map<string, BoardStatus>();
        const restricted = answers.some((a) => a.restricted);
        if (!restricted) for (const answer of answers) for (const room of answer.rooms ?? []) boards.set(room.id, room);
        setStatus({ boards, restricted });
      } catch (err) {
        if (cancelled || (err as { name?: string })?.name === 'AbortError') return;
        setStatus(EMPTY);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), STATUS_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    const onOnline = () => void load();
    const onOffline = () => setStatus(EMPTY);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [key]);

  return status;
}
