/**
 * The operating system's media controls: lock screen, media keys, headset buttons.
 *
 * Whatever source is playing publishes its title and handlers here; the last
 * one to publish owns the controls.
 */

export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  artwork?: string | null;
}

export interface MediaHandlers {
  play: () => void;
  pause: () => void;
  next?: () => void;
  previous?: () => void;
  /** Seconds; offered only by sources that can seek. */
  seekTo?: (seconds: number) => void;
}

export interface MediaPosition {
  position: number;
  duration: number;
}

const session = (): MediaSession | null => (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null);

export function publishMedia(info: MediaInfo, handlers: MediaHandlers, playing: boolean, position?: MediaPosition): void {
  const ms = session();
  if (!ms || typeof MediaMetadata === 'undefined') return;
  try {
    ms.metadata = new MediaMetadata({
      title: info.title,
      artist: info.artist,
      album: info.album,
      artwork: info.artwork ? [{ src: info.artwork, sizes: '512x512' }] : [],
    });
    ms.playbackState = playing ? 'playing' : 'paused';
    ms.setActionHandler('play', handlers.play);
    ms.setActionHandler('pause', handlers.pause);
    ms.setActionHandler('nexttrack', handlers.next ?? null);
    ms.setActionHandler('previoustrack', handlers.previous ?? null);
  } catch {
    // Some browsers reject individual actions; the rest still work.
  }
  try {
    const seek = handlers.seekTo;
    ms.setActionHandler('seekto', seek ? (d) => d.seekTime !== undefined && seek(d.seekTime) : null);
    if (position && position.duration > 0 && 'setPositionState' in ms) {
      ms.setPositionState({ duration: position.duration, position: Math.min(position.duration, Math.max(0, position.position)), playbackRate: 1 });
    } else if ('setPositionState' in ms) {
      ms.setPositionState();
    }
  } catch {
    // Older browsers have no seek action or position state.
  }
}

export function clearMedia(): void {
  const ms = session();
  if (!ms) return;
  try {
    ms.playbackState = 'none';
    ms.metadata = null;
  } catch {
    // Nothing to clear.
  }
}
