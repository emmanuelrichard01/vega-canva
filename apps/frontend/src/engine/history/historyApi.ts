import { roomHistoryUrl, roomRequestHeaders } from '../../utils/endpoints';
import { decodeBase64Update, type RawUpdate } from './sessionTimeline';

/**
 * The history endpoints: the paged update log and version history.
 */

export interface ServerSession {
  startId: number;
  endId: number;
  startedAt: string;
  endedAt: string;
  count: number;
}

export interface HistoryPage {
  updates: RawUpdate[];
  nextAfter: number | null;
  baseline?: string | null;
  total?: number;
  trimmed?: boolean;
  trimmedCount?: number;
  sessions?: ServerSession[];
}

export interface VersionAuthor {
  id: string;
  name: string;
  color: string;
}

export interface VersionMeta {
  id: number;
  kind: 'auto' | 'named';
  name: string | null;
  description: string | null;
  startedAt: string;
  endedAt: string;
  updateCount: number;
  authors: VersionAuthor[];
  createdByName: string | null;
}

/** An error the server described, with its status. */
export class HistoryError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const versionsUrl = (roomId: string) => roomHistoryUrl(roomId).replace(/\/history$/, '/versions');

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

/**
 * Fetch JSON, retrying a rate-limited request after the server's
 * `Retry-After` (or a short backoff). A long log is many pages, and the
 * history limiter is per room.
 */
async function request<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      signal,
      headers: roomRequestHeaders({
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      }),
    });
    if (res.status === 429 && attempt < 5) {
      const after = Number(res.headers.get('Retry-After'));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 800 * (attempt + 1), signal);
      continue;
    }
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HistoryError(
        typeof body?.error === 'string' ? body.error : `The server responded ${res.status}.`,
        res.status
      );
    }
    return body as T;
  }
}

export const HISTORY_PAGE_SIZE = 1000;

export function fetchHistoryPage(
  roomId: string,
  after: number | null,
  signal?: AbortSignal
): Promise<HistoryPage> {
  const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
  if (after !== null) params.set('after', String(after));
  return request<HistoryPage>(`${roomHistoryUrl(roomId)}?${params}`, {}, signal);
}

/**
 * Read the whole log, page by page. `onFirst` sees the first page (baseline,
 * sessions, totals) before the rest arrive; `onRows` sees every page's rows.
 * A server without paging answers with everything and no `nextAfter`, which
 * ends the loop after one page.
 */
export async function loadHistory(
  roomId: string,
  handlers: { onFirst: (page: HistoryPage) => void; onRows: (rows: RawUpdate[]) => void },
  signal?: AbortSignal
): Promise<void> {
  let after: number | null = null;
  let trimmed: number | undefined;
  for (let page = 0; page < 10_000; page++) {
    const result = await fetchHistoryPage(roomId, after, signal);
    if (page === 0) {
      trimmed = result.trimmedCount;
      handlers.onFirst(result);
    } else if (trimmed !== undefined && result.trimmedCount !== undefined && result.trimmedCount !== trimmed) {
      // Retention folded rows away between two pages: the log in hand now
      // has a gap, and only a fresh start from the new baseline is whole.
      throw new HistoryError('The history log moved while loading.', 409);
    }
    handlers.onRows(result.updates ?? []);
    if (result.nextAfter == null || result.nextAfter === after) return;
    after = result.nextAfter;
  }
}

export async function listVersions(roomId: string, signal?: AbortSignal): Promise<VersionMeta[]> {
  const body = await request<{ versions: VersionMeta[] }>(versionsUrl(roomId), {}, signal);
  return body.versions ?? [];
}

export async function fetchVersionState(roomId: string, id: number, signal?: AbortSignal): Promise<Uint8Array> {
  const body = await request<{ state: string | null }>(`${versionsUrl(roomId)}/${id}`, {}, signal);
  return body.state ? decodeBase64Update(body.state) : new Uint8Array();
}

export function createVersion(
  roomId: string,
  input: { name: string; description?: string; atUpdateId?: number | null; createdByName?: string }
): Promise<VersionMeta> {
  return request<VersionMeta>(versionsUrl(roomId), { method: 'POST', body: JSON.stringify(input) });
}

export function renameVersion(
  roomId: string,
  id: number,
  input: { name: string; description?: string }
): Promise<VersionMeta> {
  return request<VersionMeta>(`${versionsUrl(roomId)}/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteVersion(roomId: string, id: number): Promise<void> {
  return request<void>(`${versionsUrl(roomId)}/${id}`, { method: 'DELETE' });
}
