/**
 * What the player says when Spotify sign-in or playback does not go to plan.
 * Pure, so every message is testable and none is a dead end: each names what
 * happened and what to do next.
 */
import type { PlaybackRoute, SdkFailure } from './playback';

/** A sign-in that came back without tokens, by Spotify's error code or ours. */
export function signInErrorMessage(code: string): string {
  switch (code) {
    case 'access_denied':
      return "You cancelled the Spotify sign-in. Connect again whenever you're ready.";
    case 'state_mismatch':
      return "This Spotify sign-in couldn't be verified, so it was stopped. That happens when it starts in another tab or window. Connect again to retry.";
    case 'invalid_grant':
      return 'The Spotify sign-in expired before it finished. Connect again to retry.';
    case 'not_configured':
      return "Spotify isn't available here.";
    case 'unavailable_here':
      return "Spotify can't connect from this page.";
    default:
      return `Spotify sign-in didn't finish (${code}). Connect again to retry.`;
  }
}

/** The account is not on the allowlist of an app Spotify still holds in limited access. */
export const DEV_MODE_MESSAGE = 'This Spotify app is in limited access. Ask the board owner to add your Spotify account.';

/**
 * A Web API failure in the player's words.
 *
 * `onProfile` marks the first call after sign-in: a 403 there means the
 * account is not on a development-mode app's allowlist.
 */
export function apiErrorMessage(status: number, spotifyMessage: string, reason: string | null, onProfile = false): string {
  if (status === 403 && (reason === 'PREMIUM_REQUIRED' || /premium/i.test(spotifyMessage))) {
    return 'Full tracks need Spotify Premium. Previews play here.';
  }
  if (status === 403 && (onProfile || /registered|developer|dashboard/i.test(spotifyMessage))) return DEV_MODE_MESSAGE;
  if (status === 404 && reason === 'NO_ACTIVE_DEVICE') return 'No Spotify device is open. Open Spotify on your phone or computer, then try again.';
  if (status === 429) return 'Spotify is busy right now. Try again in a moment.';
  if (status === 401) return 'Your Spotify session ended. Connect again to keep listening.';
  if (status === 403 && /scope/i.test(spotifyMessage)) return 'Spotify needs a little more access. Connect again to allow it.';
  if (status >= 500) return "Spotify isn't responding right now. Try again in a moment.";
  return spotifyMessage || `Spotify responded ${status}. Try again in a moment.`;
}

export interface PlaybackNotice {
  text: string;
  /** Offer to sign in again: the grant lacks the `streaming` scope. */
  reconnect: boolean;
  /** `open`: offer to open the playlist in Spotify itself, where full tracks play. */
  action?: 'open';
}

/**
 * A quiet line about where the music plays, shown only when that is not
 * simply "here, in full". Premium playing in the tab says nothing.
 */
export function playbackNotice(opts: {
  premium: boolean;
  hasStreamingScope: boolean;
  route: PlaybackRoute;
  sdkFailure: SdkFailure | null;
  liked: boolean;
}): PlaybackNotice | null {
  const { premium, hasStreamingScope, route, sdkFailure } = opts;
  if (route.kind === 'sdk') return null;
  const missingScope = premium && (!hasStreamingScope || sdkFailure === 'auth');
  if (route.kind === 'device') {
    if (missingScope) return { text: `Playing on ${route.name}. Reconnect Spotify to play in this tab instead.`, reconnect: true };
    return { text: `Playing on ${route.name}.`, reconnect: false };
  }
  if (!premium) {
    return opts.liked
      ? { text: 'Liked Songs plays in full in Spotify. Pick a playlist for 30-second previews here.', reconnect: false, action: 'open' }
      : { text: 'Free accounts play 30-second previews here. Open Spotify on any device to play full tracks there.', reconnect: false, action: 'open' };
  }
  if (missingScope) return { text: 'Reconnect Spotify to play full tracks in this tab. Until then, previews play here.', reconnect: true };
  if (opts.liked) return { text: 'Liked Songs needs Spotify open on one of your devices. Pick a playlist for previews here.', reconnect: false };
  return { text: "Spotify couldn't start in this tab. Open Spotify on a device for full tracks; previews play here.", reconnect: false };
}
