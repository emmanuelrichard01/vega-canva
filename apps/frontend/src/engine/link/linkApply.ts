import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { applyNodePatches, nextZIndex, roomId } from '../document';
import { useStore } from '../../hooks/useStore';
import { API_BASE } from '../../utils/endpoints';
import type { LinkNode } from '../model/schema';
import { naturalLinkSize, resolveDisplay } from './linkLayout';
import { parseLink, providerFor } from './linkProviders';
import type { LinkDisplay, LinkMeta, LinkSpec, ResolvedLinkDisplay } from './linkTypes';

/**
 * Placing links and filling in their previews.
 *
 * ## Who fetches
 *
 * Whoever places a link fetches its preview and writes it into the document;
 * everyone else draws the card from there. Two collaborators opening a board
 * with a link still loading must not both fetch, so a fetch is claimed first
 * with `requestedAt`, and a claim younger than `CLAIM_MS` is left to its owner.
 * An older one belonged to somebody who closed the tab mid-fetch, and anyone
 * may take it over.
 */

const CLAIM_MS = 20_000;
const inFlight = new Set<string>();

/** What a new link should open as: players open playing-ready, pages as cards. */
function openingDisplay(url: string): { display: LinkDisplay; resolved: ResolvedLinkDisplay; aspect?: number } {
  const provider = providerFor(url);
  if (provider.embed && ['video', 'audio', 'design'].includes(provider.kind)) {
    return { display: 'embed', resolved: 'embed', aspect: provider.embed.aspect };
  }
  return { display: 'auto', resolved: 'horizontal' };
}

export function createLink(rawUrl: string, at: { x: number; y: number }, options: { display?: LinkDisplay } = {}): string | null {
  const parsed = parseLink(rawUrl);
  if (!parsed) return null;
  const url = parsed.url.href;
  const opening = openingDisplay(url);
  const display = options.display ?? opening.display;
  const provider = providerFor(url);
  const resolved = resolveDisplay(display, 520, display === 'compact' ? 64 : 144, Boolean(provider.embed));
  const size = naturalLinkSize(display === 'auto' ? opening.resolved : resolved, provider.embed?.aspect);
  const id = nanoid();
  const link: LinkSpec = { url, display, status: 'loading', meta: null };
  editor.createNode({
    id,
    type: 'link',
    x: Math.round(at.x - size.width / 2),
    y: Math.round(at.y - size.height / 2),
    ...size,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: nextZIndex(),
    link,
  } as never);
  void ensurePreview(id);
  return id;
}

interface PreviewResponse {
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

async function fetchPreview(url: string, timeoutMs = 22_000): Promise<PreviewResponse> {
  const endpoint = `${API_BASE}/rooms/${encodeURIComponent(roomId ?? 'global')}/unfurl?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as PreviewResponse;
    // A 404 with no JSON error is a server that predates link previews, not a
    // missing page — the page's own 404 comes back as `{ error }`.
    if (res.status === 404 && !body.error) return { error: 'This server does not have link previews yet' };
    if (res.status === 429) {
      // The one failure that is *expected* in normal use: paste forty links at
      // once and the limiter refuses the tail of them. Those cards are not
      // broken, they are queued, and the retry below is what makes that true.
      return { error: 'Too many previews at once. Trying again shortly', retryable: true };
    }
    if (!res.ok) {
      /*
       * 4xx is the server's considered answer about this address — not a web
       * page, a blocked host, a page that does not exist. 5xx is the service
       * having a bad moment, which is exactly what a retry is for.
       */
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

/**
 * When to try a failed preview again.
 *
 * ## Why an errored card used to stay errored forever
 *
 * `ensurePreview` returns early unless the status is `loading`, so the only
 * route out of `error` was somebody noticing the card and choosing "Refresh
 * preview". That made every *transient* failure permanent: a server restart
 * mid-paste, a rate limit on a bulk paste, a dropped connection, a board opened
 * while the API was still waking up. The link was fine and the card was dead,
 * and nothing in the interface suggested that pressing anything would help.
 *
 * ## Why these three numbers
 *
 * The first is short, because the failures worth catching quickly — a 429 from
 * pasting a boardful at once, a blip — are over in seconds.
 *
 * The second clears **the server's own failure cache**. `unfurl.ts` remembers a
 * refusal for `FAILURE_TTL_MS` (60s) so a dead link is not re-chased on every
 * paste, which means an earlier retry is answered from that memory rather than
 * by a real attempt. Seventy seconds is the first moment a page-level failure
 * gets genuinely re-tried, and the two numbers are related on purpose: if that
 * TTL moves, this should move with it.
 *
 * The last is a long shot for a site that was having an outage.
 *
 * Three attempts, then it stops and the manual refresh is the remaining route.
 * An unbounded retry is a background loop pointed at somebody else's server,
 * multiplied by everyone with the board open.
 */
const RETRY_DELAYS_MS = [8_000, 70_000, 240_000];

/**
 * The waiting timer and the spent budget, kept apart.
 *
 * They have different lifetimes, and conflating them is a retry loop: the timer
 * is cancelled every time a fetch begins — including the fetch the timer itself
 * just triggered — so a single record holding both would have its attempt count
 * wiped on the way into every retry, and every retry would be the first one,
 * eight seconds apart, forever.
 *
 * The count belongs to *the URL in this node*, and only a new address or a
 * success is allowed to clear it.
 */
const retryTimers = new Map<string, number>();
const retryBudget = new Map<string, { url: string; attempts: number }>();

/** Stop a pending retry, without forgiving the ones already spent. */
function clearRetryTimer(id: string): void {
  const timer = retryTimers.get(id);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  retryTimers.delete(id);
}

/** Stop retrying and wipe the slate: a success, a new address, or a manual refresh. */
function forgetRetries(id: string): void {
  clearRetryTimer(id);
  retryBudget.delete(id);
}

/**
 * Put a failed card back in the queue, once the wait is up.
 *
 * It does not fetch. It sets the node back to `loading` and lets the ordinary
 * path take over, which matters when several people have the board open: going
 * through `loading` means the existing claim (`requestedAt`, `CLAIM_MS`) still
 * decides who actually fetches, so five tabs retrying produce one request. A
 * forced fetch from each of them would produce five.
 */
function scheduleRetry(id: string, url: string): void {
  const spent = retryBudget.get(id);
  // A different address in the same node is a different question: start over.
  const attempts = spent && spent.url === url ? spent.attempts : 0;
  const wait = RETRY_DELAYS_MS[attempts];
  // Out of attempts. The card keeps what it has and the manual refresh remains.
  if (wait === undefined) return;

  clearRetryTimer(id);
  // Counted when the retry is *booked*, not when it runs, so a timer that is
  // cancelled by something else still costs an attempt. Otherwise a card that
  // keeps being nudged could book the first delay indefinitely.
  retryBudget.set(id, { url, attempts: attempts + 1 });

  const timer = window.setTimeout(() => {
    retryTimers.delete(id);
    const node = liveNode(id);
    // Gone, pointed elsewhere, or somebody already fixed it by hand.
    if (!node || node.link.url !== url || node.link.status !== 'error') return;
    applyNodePatches([
      { id, changes: { link: { ...node.link, status: 'loading', requestedAt: undefined, error: undefined } } },
    ]);
  }, wait);

  retryTimers.set(id, timer);
}

/**
 * Coming back online is worth one more try, whatever the count had reached.
 *
 * A board opened on a train, or while the API was still starting, can exhaust
 * every attempt against a network that was never going to answer. The moment
 * the browser says it is back is new information, and it is the one event that
 * justifies resetting the budget rather than spending from it.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const { objects } = useStore.getState();
    for (const [id, node] of Object.entries(objects)) {
      if (node.type !== 'link' || node.link.status !== 'error') continue;
      forgetRetries(id);
      scheduleRetry(id, node.link.url);
    }
  });
}

/** How long until someone else's claim on a fetch may be taken over, in ms. */
export function claimRemaining(link: LinkSpec): number {
  return link.requestedAt ? Math.max(0, CLAIM_MS - (Date.now() - link.requestedAt)) : 0;
}

const liveNode = (id: string): LinkNode | null => {
  const node = useStore.getState().objects[id];
  return node && node.type === 'link' ? node : null;
};

/**
 * Fetch a link's preview if nobody else is, and write it in.
 *
 * Safe to call from anywhere and as often as a renderer likes: it returns
 * immediately when the preview is already there, already on its way from this
 * tab, or claimed recently by someone else.
 */
export async function ensurePreview(id: string, force = false): Promise<void> {
  const node = liveNode(id);
  if (!node || inFlight.has(id)) return;
  const { link } = node;
  if (!force && link.status !== 'loading') return;
  // A fresh claim is someone's fetch in progress. The renderer asks again once
  // it has had time to go stale — see `claimRemaining`.
  if (!force && claimRemaining(link) > 0) return;

  // A fetch is under way, so a timer waiting to start one is redundant — but
  // the attempts already spent are not forgiven here, or the retry that just
  // fired would reset its own budget and the backoff would never advance.
  clearRetryTimer(id);

  inFlight.add(id);
  applyNodePatches([{ id, changes: { link: { ...link, status: 'loading', requestedAt: Date.now(), error: undefined } } }]);

  const result = await fetchPreview(link.url);
  inFlight.delete(id);

  if (!result.meta) {
    const failed = liveNode(id);
    if (failed) {
      applyNodePatches([
        { id, changes: { link: { ...failed.link, status: 'error', requestedAt: undefined, error: result.error ?? 'No preview' } } },
      ]);
      // A failure that could go the other way next time gets a next time. One
      // that could not — a blocked address, a page that does not exist — keeps
      // the card it has, and "Refresh preview" remains for anyone who disagrees.
      if (result.retryable) scheduleRetry(id, failed.link.url);
    }
    return;
  }

  write(id, result.meta, result.pending === true);
  if (result.pending) void collectImage(id, link.url);
}

/**
 * Put a preview into the document, sizing the card to what actually arrived.
 *
 * `imagePending` is the difference between "this card has no picture" and
 * "this card's picture has not landed yet", and the two look nothing alike: the
 * first reflows the card to a text layout, the second holds the space and
 * shimmers. Guessing wrong in either direction is a card that jumps.
 */
function write(id: string, incoming: Omit<LinkMeta, 'fetchedAt'>, imagePending: boolean): void {
  const node = liveNode(id);
  if (!node) return;
  // It worked. Whatever it took to get here is not held against the next
  // failure, which may be years and a hundred edits away.
  forgetRetries(id);
  const meta: LinkMeta = { ...incoming, imagePending: imagePending || undefined, fetchedAt: Date.now() };
  const changes: Record<string, unknown> = {
    link: { ...node.link, status: 'ready', meta, requestedAt: undefined, error: undefined },
  };
  // A vertical card sized for a picture that turned out not to exist gives the
  // empty space back — but only once we know there is no picture coming.
  const resolved = resolveDisplay(node.link.display, node.width, node.height, Boolean(providerFor(node.link.url).embed));
  if (resolved === 'vertical' && !meta.image && !imagePending && node.height > 200) changes.height = 176;
  applyNodePatches([{ id, changes }]);
}

/**
 * Collect the picture the server said was still coming.
 *
 * The second request is cheap on the server — the work is already running and
 * this only waits on it — so the one thing that matters here is not letting it
 * become noise. It runs once, it is abandoned if the card has gone or been
 * pointed somewhere else meanwhile, and if the picture never arrives the card
 * simply keeps the words it already has rather than reverting to an error: a
 * titled card with no picture is a good card, and it is already on screen.
 */
async function collectImage(id: string, url: string): Promise<void> {
  const result = await fetchPreview(url, 25_000);
  const node = liveNode(id);
  if (!node || node.link.url !== url) return;
  if (!result.meta) {
    if (node.link.meta?.imagePending) write(id, node.link.meta, false);
    return;
  }
  write(id, result.meta, false);
}

/** Change how a link is shown, snapping the box to what that display wants. */
export function setLinkDisplay(node: LinkNode, display: LinkDisplay): void {
  const provider = providerFor(node.link.url);
  const resolved = resolveDisplay(display, node.width, node.height, Boolean(provider.embed));
  const size = display === 'auto' ? { width: node.width, height: node.height } : naturalLinkSize(resolved, provider.embed?.aspect);
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  applyNodePatches([
    {
      id: node.id,
      changes: {
        link: { ...node.link, display },
        width: size.width,
        height: size.height,
        x: Math.round(cx - size.width / 2),
        y: Math.round(cy - size.height / 2),
      },
    },
  ]);
  if (display !== 'embed' && useStore.getState().embedActiveNodeId === node.id) {
    useStore.getState().setEmbedActiveNodeId(null);
  }
}

/** Point a card somewhere else, keeping its place, and fetch the new preview. */
export function replaceLinkUrl(node: LinkNode, rawUrl: string): boolean {
  const parsed = parseLink(rawUrl);
  if (!parsed) return false;
  // A new address is a new question, so it gets the full retry budget rather
  // than whatever the previous one had left.
  forgetRetries(node.id);
  applyNodePatches([{ id: node.id, changes: { link: { ...node.link, url: parsed.url.href, status: 'loading', meta: null, requestedAt: undefined } } }]);
  void ensurePreview(node.id, true);
  return true;
}

export function refreshPreview(node: LinkNode): void {
  // Asked for by hand, which outranks a budget this tab spent on its own.
  forgetRetries(node.id);
  void ensurePreview(node.id, true);
}

export function openLink(url: string): void {
  // `noopener` so the page cannot reach back into the board through `opener`.
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * What "open this link" means for this card: play it in place when it is showing
 * as a player, otherwise go to the page.
 *
 * A rotated player is the exception — the live frame is a screen-aligned
 * overlay and cannot be turned to match — so it opens in a tab instead of
 * appearing square over a tilted poster. Double-click and Enter both come here.
 */
export function activateLink(node: LinkNode): void {
  const provider = providerFor(node.link.url);
  const shown = resolveDisplay(node.link.display, node.width, node.height, Boolean(provider.embed));
  if (shown === 'embed' && provider.embed && !node.rotation) useStore.getState().setEmbedActiveNodeId(node.id);
  else openLink(node.link.url);
}
