import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HistoryError,
  createVersion,
  deleteVersion,
  fetchVersionState,
  listVersions,
  renameVersion,
  type VersionMeta,
} from '../../engine/history/historyApi';
import { frameFromState, type FrameState } from '../../engine/history/frames';

export interface Versions {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  versions: VersionMeta[];
  reload: () => void;
  /** The board as a version recorded it; cached once loaded. */
  stateOf: (id: number) => Promise<FrameState>;
  save: (input: { name: string; description: string; atUpdateId?: number | null; createdByName?: string }) => Promise<VersionMeta>;
  rename: (id: number, input: { name: string; description: string }) => Promise<VersionMeta>;
  remove: (id: number) => Promise<void>;
}

const MAX_CACHED_STATES = 8;

const message = (err: unknown, fallback: string) => (err instanceof HistoryError ? err.message : fallback);

/** Autosaved and named versions, newest first. */
export function useVersions(roomId: string): Versions {
  const [status, setStatus] = useState<Versions['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [attempt, setAttempt] = useState(0);
  const states = useRef(new Map<number, Promise<FrameState>>());

  useEffect(() => {
    const abort = new AbortController();
    setStatus('loading');
    listVersions(roomId, abort.signal)
      .then((list) => {
        setVersions(list);
        setStatus('ready');
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setError(message(err, 'Saved versions could not be loaded.'));
        setStatus('error');
      });
    return () => abort.abort();
  }, [roomId, attempt]);

  const stateOf = useCallback(
    (id: number) => {
      let pending = states.current.get(id);
      if (!pending) {
        pending = fetchVersionState(roomId, id).then((state) => frameFromState(state));
        // A failed load is not cached, so the next attempt asks again.
        pending.catch(() => states.current.delete(id));
        states.current.set(id, pending);
        // Each state is a whole board; keep the few most recently opened.
        while (states.current.size > MAX_CACHED_STATES) {
          states.current.delete(states.current.keys().next().value as number);
        }
      }
      return pending;
    },
    [roomId]
  );

  const sortIn = (list: VersionMeta[], v: VersionMeta) =>
    [v, ...list.filter((x) => x.id !== v.id)].sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));

  const save: Versions['save'] = useCallback(
    async (input) => {
      const created = await createVersion(roomId, input);
      setVersions((list) => sortIn(list, created));
      return created;
    },
    [roomId]
  );

  const rename: Versions['rename'] = useCallback(
    async (id, input) => {
      const updated = await renameVersion(roomId, id, input);
      setVersions((list) => sortIn(list, updated));
      return updated;
    },
    [roomId]
  );

  const remove: Versions['remove'] = useCallback(
    async (id) => {
      await deleteVersion(roomId, id);
      states.current.delete(id);
      setVersions((list) => list.filter((v) => v.id !== id));
    },
    [roomId]
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, error, versions, reload, stateOf, save, rename, remove };
}
