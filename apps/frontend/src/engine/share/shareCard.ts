import type { BoardPreview } from '../model/boardPreview';

/**
 * What a board tells the server about itself, for the card its link unfurls
 * into in Slack, iMessage, X, Teams and the rest.
 *
 * Pure: the payload and its signature. The hook that sends it is
 * `hooks/useShareCard.ts`; the server that draws it is
 * `apps/server/src/share/`.
 */

/**
 * The document key that switches link previews off for a board.
 *
 * In the document, not in this browser's storage, because it is a decision
 * about the board: once someone says "don't show this board's name when the
 * link is shared", no collaborator's tab should go on publishing it.
 */
export const SHARE_PREVIEW_KEY = 'sharePreview';

export function previewsHidden(metadata: Record<string, string> | undefined): boolean {
  return metadata?.[SHARE_PREVIEW_KEY] === 'off';
}

export interface CardPayload {
  name: string;
  hidden: boolean;
  preview: BoardPreview | null;
}

/** Everything the server keeps, and nothing it does not. */
export function cardPayload(name: string, preview: BoardPreview | null, hidden: boolean): CardPayload {
  if (hidden) return { name: '', hidden: true, preview: null };
  return {
    name: name.trim().slice(0, 120),
    hidden: false,
    preview: preview ? { ratio: preview.ratio, total: preview.total, items: preview.items } : null,
  };
}

/**
 * A short fingerprint of a payload, to tell whether it is worth sending.
 *
 * Every tab on a board runs the upload, and most of the time nothing a card
 * shows has changed — a cursor moved, a comment was read. Comparing against the
 * last fingerprint this browser sent means an idle board uploads nothing at all.
 * FNV-1a over the JSON: a collision costs one skipped update, which the next
 * real edit repairs.
 */
export function cardSignature(payload: CardPayload): string {
  const text = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}.${text.length.toString(36)}`;
}

const FLUSH_EVENT = 'vega:share-card-flush';

/**
 * Ask the board to publish its card now, rather than after it settles.
 *
 * The Share dialog calls this as it opens, so the preview it shows is the
 * board as it is this second — not as it was twelve seconds ago, and not a
 * generic card because nothing had been sent yet. Resolves when the upload
 * has finished or was not needed; resolves at once when nothing is listening
 * (a view-only visitor does not publish).
 */
export function requestCardFlush(timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const event = new CustomEvent<{ done: () => void; claimed: boolean }>(FLUSH_EVENT, { detail: { done, claimed: false } });
    window.dispatchEvent(event);
    if (!event.detail.claimed) done();
    else window.setTimeout(done, timeoutMs);
  });
}

export function onCardFlush(handler: () => Promise<void>): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ done: () => void; claimed: boolean }>).detail;
    detail.claimed = true;
    void handler().finally(detail.done);
  };
  window.addEventListener(FLUSH_EVENT, listener);
  return () => window.removeEventListener(FLUSH_EVENT, listener);
}
