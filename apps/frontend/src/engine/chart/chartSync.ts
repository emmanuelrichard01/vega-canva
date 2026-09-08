import { parseChartData, parseNumber, type ParsedChartData } from './chartCsv';

/**
 * Pulling a chart's data from somewhere else.
 *
 * ## The security model, which decides the whole design
 *
 * A chart spec lives in the CRDT and is replicated to every member of the
 * room. `dataSource.url` is part of that spec, so **a URL one person types is
 * a URL that arrives in everybody else's browser.**
 *
 * That single fact rules out the obvious implementation. If the app polled
 * `dataSource.url` automatically wherever the chart was open, then typing a
 * URL into a shared board would make every other member's browser issue a GET
 * to it, on a schedule, carrying whatever cookies that origin has, from
 * whatever network each of them happens to be on. It is the same class of
 * problem the expression parser refuses `eval` for, and it deserves the same
 * answer: the document may *describe* the request, and only a local, explicit
 * act may *make* it.
 *
 * So:
 *
 *   - The URL is document state. It syncs, and it is a description.
 *   - Fetching is always a local act, started by the person who pressed the
 *     button or who turned auto-refresh on in *their* session.
 *   - The refresh interval is **transient, per-session** state and never
 *     enters the document -- one person can leave a chart polling without
 *     conscripting the rest of the room into doing it too.
 *   - The *result* is written to the document like any other edit, so
 *     everyone sees the data without anyone else having made a request.
 *
 * `pollInterval` and `streamSpeed` were on the spec and read by nothing at
 * all, so "refresh every 5 seconds" was a dropdown that did nothing. Making
 * the interval work and making it local are the same change.
 *
 * ## Everything here is pure except `fetchRemote`
 *
 * The shape-guessing was inline in a modal, which is why none of it was
 * tested -- and it is the part most likely to be wrong, because it is a pile
 * of judgements about what somebody's JSON probably means.
 */

/** What a sync attempt produced. Never throws; the failure is a value. */
export type SyncResult =
  | { ok: true; data: ParsedChartData; rows: number }
  | { ok: false; error: string };

/** How long a fetch may take before it is abandoned, and how much it may return. */
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** The refresh intervals offered, in seconds. Zero is "only when I ask". */
export const POLL_INTERVALS = [0, 5, 15, 30, 60, 300] as const;

export const POLL_LABELS: Record<number, string> = {
  0: 'Only when I ask',
  5: 'Every 5 seconds',
  15: 'Every 15 seconds',
  30: 'Every 30 seconds',
  60: 'Every minute',
  300: 'Every 5 minutes',
};

/**
 * Walk a dotted path into a payload.
 *
 * Written out rather than `split('.').reduce(...)` so that an index into an
 * array works: `results.0.series` is how half of the APIs anybody points this
 * at are shaped, and the reduce version returned `undefined` for all of them.
 */
export function atPath(payload: unknown, path?: string): unknown {
  if (!path) return payload;
  let current: unknown = payload;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * A row-shaped JSON array, read as categories and series.
 *
 * The guess: **one string column names the rows, and every numeric column is
 * a series.** That is what a records endpoint looks like almost every time --
 * `[{ month: 'Jan', revenue: 12, cost: 8 }, ...]` -- and it is the guess the
 * modal was already making. What it did badly:
 *
 *   - It read the column names off `rows[0]` alone, so a first record with a
 *     null in it lost that column for the whole table.
 *   - It picked the *first* string column as the labels, which on a payload
 *     with an `id` and a `name` chose the id.
 *   - It fell back to the literal key `'id'` when there was no string column,
 *     producing a table of empty labels rather than saying it could not tell.
 *
 * Columns are gathered across every row, the label column prefers a name-ish
 * key, and a table with no labels is numbered rather than blanked.
 */
export function fromRecords(rows: unknown[]): ParsedChartData | null {
  const objects = rows.filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r)
  );
  if (objects.length === 0) return null;

  // Union of keys, in first-seen order, so a sparse first row costs nothing.
  const keys: string[] = [];
  for (const row of objects) {
    for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  }

  /**
   * One reader for both questions.
   *
   * Which columns are series and what each cell holds have to be the same
   * judgement, and they were not: the selector accepted only `typeof ===
   * 'number'` while the reader below parsed strings too. A JSON API that
   * quotes its numbers -- which a great many do, to survive large integers --
   * had every one of its columns silently dropped, and the chart came back
   * saying the payload had nothing to plot.
   */
  const asNumber = (raw: unknown): number | null => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw === 'string') return parseNumber(raw);
    return null;
  };

  const numericKeys = keys.filter((k) => objects.some((r) => asNumber(r[k]) !== null));
  // A column that reads as numbers is a series, so it cannot also be the
  // labels -- otherwise a table of years names itself and plots itself.
  const stringKeys = keys.filter(
    (k) => !numericKeys.includes(k) && objects.some((r) => typeof r[k] === 'string')
  );
  if (numericKeys.length === 0) return null;

  /**
   * The label column: the one a person would have chosen.
   *
   * A payload with `id` and `name` should be labelled by the name. Preferring
   * a recognisable word over "whichever came first" is the difference between
   * a chart of months and a chart of UUIDs.
   */
  const PREFERRED = ['name', 'label', 'category', 'title', 'month', 'date', 'day', 'key'];
  const labelKey =
    stringKeys.find((k) => PREFERRED.includes(k.toLowerCase())) ?? stringKeys[0] ?? null;

  return {
    categories: objects.map((row, i) =>
      labelKey ? String(row[labelKey] ?? '') : `Row ${i + 1}`
    ),
    series: numericKeys.map((key) => ({
      name: key,
      values: objects.map((row) => asNumber(row[key])),
    })),
  };
}

/**
 * A payload of any supported shape, as a chart's data.
 *
 * Tries JSON first when the text looks like JSON, and falls back to the CSV
 * reader -- which is the same one the paste box and the file import use, so a
 * remote CSV and a pasted one cannot be read differently.
 */
export function parseRemotePayload(text: string, dataPath?: string): SyncResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: 'The response was empty.' };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: 'The response looked like JSON but could not be parsed.' };
    }

    const target = atPath(payload, dataPath);
    if (target === undefined && dataPath) {
      return { ok: false, error: `Nothing found at “${dataPath}” in the response.` };
    }
    if (Array.isArray(target)) {
      const data = fromRecords(target);
      if (data) return { ok: true, data, rows: data.categories.length };
      return {
        ok: false,
        error: 'That array has no numeric columns to plot. Point the data path at the records.',
      };
    }
    return {
      ok: false,
      error: dataPath
        ? `“${dataPath}” is not a list of records.`
        : 'The response is an object. Set a data path pointing at the list of records inside it.',
    };
  }

  const data = parseChartData(trimmed);
  if (data.categories.length === 0) {
    return { ok: false, error: 'No table could be read from the response.' };
  }
  return { ok: true, data, rows: data.categories.length };
}

/**
 * One request, bounded.
 *
 * Bounded three ways, because a chart's data source is a URL a person typed
 * and none of the three failures it guards are exotic:
 *
 *   - **Time.** An endpoint that never answers left the button spinning
 *     forever, with no way back but closing the dialog.
 *   - **Size.** A misaddressed URL returning a video is a tab that runs out
 *     of memory.
 *   - **Cancellation.** Closing the dialog mid-request left the response to
 *     arrive and write into a document nobody was looking at.
 *
 * Errors come back as values rather than exceptions: every caller here is a
 * button that has to say what went wrong, and none of them can do anything
 * with a stack.
 */
export async function fetchRemote(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: `${parsed.protocol} is not a protocol this can fetch.` };
  }

  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_PAYLOAD_BYTES;

  // The caller's signal and the timeout, as one -- so closing the dialog
  // cancels a request that has not timed out yet, and vice versa.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      // No credentials. The document says which URL; it does not get to say
      // "and send this person's cookies with it".
      credentials: 'omit',
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `The server answered ${res.status} ${res.statusText}.` };

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      return { ok: false, error: `That response is ${Math.round(declared / 1024)}KB, which is too large to read.` };
    }

    const text = await res.text();
    if (text.length > maxBytes) {
      return { ok: false, error: 'That response is too large to read.' };
    }
    return { ok: true, text };
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        error: options.signal?.aborted ? 'Cancelled.' : `No answer within ${Math.round(timeoutMs / 1000)}s.`,
      };
    }
    // A cross-origin fetch without CORS headers fails exactly here, and it is
    // by far the most common thing to go wrong -- so it is named rather than
    // reported as "Failed to fetch".
    return {
      ok: false,
      error:
        err instanceof TypeError
          ? 'The request failed. The endpoint may not allow browser requests (CORS).'
          : 'The request failed.',
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Fetch and read, in one call. The whole of a sync. */
export async function syncFromUrl(
  url: string,
  dataPath?: string,
  options: { signal?: AbortSignal } = {}
): Promise<SyncResult> {
  const res = await fetchRemote(url, options);
  if (!res.ok) return { ok: false, error: res.error };
  return parseRemotePayload(res.text, dataPath);
}
