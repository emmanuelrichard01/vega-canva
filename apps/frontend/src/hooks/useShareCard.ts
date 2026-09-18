import { useEffect, useRef } from 'react';
import { useStore } from './useStore';
import { buildPreview, MAX_ITEMS_RICH } from '../engine/model/boardPreview';
import { previewColorOf, previewPointsOf } from '../engine/model/previewPaint';
import { cardPayload, cardSignature, onCardFlush, type CardPayload } from '../engine/share/shareCard';
import { shareCardUrl } from '../utils/endpoints';

interface Options {
  roomId: string | null | undefined;
  name: string;
  hidden: boolean;
  /** Only once the document has arrived: before that, every board looks empty. */
  synced: boolean;
  /** A view-only visitor is not the one to describe the board to everyone else. */
  canEdit: boolean;
}

/** How long a board sits still before its card is refreshed. */
const SETTLE_MS = 12_000;

const sentKey = (roomId: string) => `vega_card_sent_${roomId}`;

/**
 * A sent card is trusted for a day, then sent again even if unchanged — the
 * server's copy can go (a restored database, a reaped room) without this
 * browser ever hearing about it.
 */
const TRUST_MS = 24 * 60 * 60 * 1000;

function readSent(roomId: string): string | null {
  try {
    const [signature, at] = (localStorage.getItem(sentKey(roomId)) ?? '').split('|');
    return signature && Date.now() - Number(at) < TRUST_MS ? signature : null;
  } catch {
    return null;
  }
}

function writeSent(roomId: string, signature: string) {
  try {
    localStorage.setItem(sentKey(roomId), `${signature}|${Date.now()}`);
  } catch {
    /* A full store costs a repeat upload, nothing more. */
  }
}

/**
 * Keep the server's picture of this board current, for link previews.
 *
 * ## Quiet by design
 *
 * The card is looked at in someone else's chat, minutes or days later, so it
 * can afford to be a little behind and must cost the board nothing: it is
 * built once the board has been still for twelve seconds, sent only if it
 * differs from what this browser last sent, and sent once more — with
 * `keepalive`, so it survives the tab closing — when the page is hidden with
 * a change still pending.
 *
 * ## Never an empty card by accident
 *
 * A tab that has not synced yet holds an empty document. Uploading from it
 * would replace a real board's card with "An empty board" for everyone the
 * link is shared with, so nothing is sent until `synced`.
 *
 * ## Privacy wins immediately
 *
 * Switching previews off is sent at once rather than after the settle, and it
 * clears the stored name and picture on the server — not merely hides them.
 */
export function useShareCard({ roomId, name, hidden, synced, canEdit }: Options) {
  const objects = useStore((s) => s.objects);
  /** Something changed that has not been sent. The preview is built only when sending. */
  const dirty = useRef(false);
  const lastHidden = useRef(hidden);

  useEffect(() => {
    if (!roomId || !synced || !canEdit) return;

    const build = () => {
      const nodes = Object.values(objects);
      const preview = buildPreview(nodes, previewColorOf, (node) => previewPointsOf(node, objects), MAX_ITEMS_RICH);
      return cardPayload(name, preview, hidden);
    };

    const send = async (keepalive = false): Promise<void> => {
      dirty.current = false;
      const payload: CardPayload = build();
      const signature = cardSignature(payload);
      if (readSent(roomId) === signature) return;
      await fetch(shareCardUrl(roomId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive,
      })
        .then((res) => {
          if (res.ok) writeSent(roomId, signature);
        })
        .catch(() => {
          /* Offline or asleep: the next change tries again. */
        });
    };

    const privacyChanged = lastHidden.current !== hidden;
    lastHidden.current = hidden;
    dirty.current = true;
    const timer = window.setTimeout(() => {
      if (dirty.current) void send();
    }, privacyChanged ? 300 : SETTLE_MS);

    const flush = () => {
      if (document.visibilityState === 'hidden' && dirty.current) void send(true);
    };
    document.addEventListener('visibilitychange', flush);
    const offFlush = onCardFlush(() => send());
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      offFlush();
    };
  }, [objects, name, hidden, roomId, synced, canEdit]);
}
