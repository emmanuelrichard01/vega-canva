import { roomId } from '../document';
import { API_BASE, roomRequestHeaders } from '../../utils/endpoints';
import type { LinkMeta } from './linkTypes';

/**
 * One request to the server's preview service.
 *
 * Every outbound fetch of somebody else's page goes through the server, where
 * the SSRF rules live (`safeFetch`), and any picture it finds is stored as a
 * copy on this app's media store. The browser never fetches a third-party
 * address itself, so a board cannot announce its viewers to the sites it
 * links to.
 */
export interface PreviewResponse {
  meta?: Omit<LinkMeta, 'fetchedAt'>;
  /** The words are final and a picture is still coming. Ask once more to collect it. */
  pending?: boolean;
  error?: string;
  /**
   * Whether asking again could plausibly give a different answer.
   *
   * The difference between "this address is not a web page" and "the preview
   * service was restarting". Both leave the same card, and only one of them is
   * worth a second request — retrying a 422 forever is noise aimed at our own
   * server on behalf of a link that will never unfurl.
   */
  retryable?: boolean;
}

export async function fetchLinkPreview(url: string, timeoutMs = 22_000): Promise<PreviewResponse> {
  const endpoint = `${API_BASE}/rooms/${encodeURIComponent(roomId ?? 'global')}/unfurl?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, { signal: controller.signal, headers: roomRequestHeaders() });
    const body = (await res.json().catch(() => ({}))) as PreviewResponse;
    // A 404 with no JSON error is a server that predates link previews, not a
    // missing page — the page's own 404 comes back as `{ error }`.
    if (res.status === 404 && !body.error) return { error: 'This server does not have link previews yet' };
    if (res.status === 429) {
      // The one failure that is *expected* in normal use: paste forty links at
      // once and the limiter refuses the tail of them. Those cards are not
      // broken, they are queued, and the retry is what makes that true.
      return { error: 'Too many previews at once. Trying again shortly', retryable: true };
    }
    if (!res.ok) {
      // 4xx is the server's considered answer about this address — not a web
      // page, a blocked host, a page that does not exist. 5xx is the service
      // having a bad moment, which is exactly what a retry is for.
      return { error: body.error ?? `The preview service answered ${res.status}`, retryable: res.status >= 500 };
    }
    return body;
  } catch {
    // Aborted, offline, DNS, TLS, a proxy in the way. None of these say
    // anything about the link itself.
    return { error: 'The preview service could not be reached', retryable: true };
  } finally {
    clearTimeout(timer);
  }
}
