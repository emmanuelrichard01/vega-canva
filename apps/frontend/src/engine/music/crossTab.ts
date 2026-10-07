/**
 * One tab plays at a time.
 *
 * When a tab starts music it claims playback; every other tab pauses
 * whatever it plays, library or Spotify. Uses `BroadcastChannel('vega.music')`,
 * and `storage` events where that does not exist. A claim carries the sender's
 * id, so a tab never answers its own.
 */
const CHANNEL = 'vega.music';
const STORAGE_KEY = 'vega.music.claim';

const tabId = Math.random().toString(36).slice(2);

interface Claim {
  tab: string;
  at: number;
}

let channel: BroadcastChannel | null | undefined;
function open(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    channel = null;
  }
  return channel;
}

/** Tells other tabs this one is playing, so they pause. */
export function claimPlayback(): void {
  const claim: Claim = { tab: tabId, at: Date.now() };
  const ch = open();
  if (ch) {
    ch.postMessage(claim);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(claim));
  } catch {
    // Storage blocked: tabs just do not coordinate.
  }
}

const isClaim = (v: unknown): v is Claim => typeof v === 'object' && v !== null && typeof (v as Claim).tab === 'string';

/** Calls `onClaim` when another tab starts playing. Returns the unsubscribe. */
export function onOtherTabClaim(onClaim: () => void): () => void {
  const ch = open();
  if (ch) {
    const handler = (e: MessageEvent) => {
      if (isClaim(e.data) && e.data.tab !== tabId) onClaim();
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }
  if (typeof window === 'undefined') return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const claim: unknown = JSON.parse(e.newValue);
      if (isClaim(claim) && claim.tab !== tabId) onClaim();
    } catch {
      // Not ours.
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/** Test seam: forgets the channel so a test can install a different one. */
export function resetCrossTab(): void {
  channel?.close();
  channel = undefined;
}
