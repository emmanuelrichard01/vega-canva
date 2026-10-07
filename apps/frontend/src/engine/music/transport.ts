/**
 * Play/pause and skip for whichever source is selected. Used by keyboard
 * shortcuts, which act on the player as a whole rather than on one pane.
 */
import { getMusicState, setMusicVolume, toggleMute, togglePlay } from './musicStore';
import { cycleLibraryRepeat, getLibraryState, skipLibrary, toggleLibraryShuffle } from './library/libraryStore';
import {
  canLikeTracks,
  cycleSpotifyRepeat,
  getSpotifyState,
  nextSpotifyTrack,
  pauseSpotify,
  previousSpotifyTrack,
  resumeSpotify,
  toggleSpotifyLike,
  toggleSpotifyShuffle,
} from './spotify/spotifyStore';
import { clamp } from './playerMath';

export function transportToggle(): void {
  const music = getMusicState();
  if (music.source === 'stations') void togglePlay();
  else {
    const s = getSpotifyState();
    if (s.playing) void pauseSpotify();
    else if (s.current) void resumeSpotify(music.volume);
  }
}

export function transportSkip(direction: 1 | -1): void {
  const music = getMusicState();
  if (music.source === 'stations') {
    if (getLibraryState().current) void skipLibrary(direction);
  } else {
    const s = getSpotifyState();
    if (!s.current || s.route?.kind === 'embed') return;
    void (direction === 1 ? nextSpotifyTrack() : previousSpotifyTrack());
  }
}

const spotifyControllable = () => {
  const s = getSpotifyState();
  return s.current !== null && s.route !== null && s.route.kind !== 'embed';
};

export function transportShuffle(): void {
  if (getMusicState().source === 'stations') toggleLibraryShuffle();
  else if (spotifyControllable()) void toggleSpotifyShuffle();
}

export function transportRepeat(): void {
  if (getMusicState().source === 'stations') cycleLibraryRepeat();
  else if (spotifyControllable()) void cycleSpotifyRepeat();
}

export function transportLike(): void {
  if (getMusicState().source === 'spotify' && spotifyControllable() && canLikeTracks()) void toggleSpotifyLike();
}

export { toggleMute as transportMute };

/** Volume up or down by 5%. */
export function transportVolume(direction: 1 | -1): void {
  setMusicVolume(clamp(Math.round((getMusicState().volume + direction * 0.05) * 100) / 100, 0, 1));
}

export type TransportKey = 'toggle' | 'next' | 'previous' | 'shuffle' | 'repeat' | 'like' | 'mute' | 'volumeUp' | 'volumeDown';

/** The player action a key stands for while the player has focus, or null. */
export function transportKeyAction(key: string): TransportKey | null {
  switch (key) {
    case ' ':
      return 'toggle';
    case 'ArrowRight':
      return 'next';
    case 'ArrowLeft':
      return 'previous';
    case 'ArrowUp':
      return 'volumeUp';
    case 'ArrowDown':
      return 'volumeDown';
    case 's':
    case 'S':
      return 'shuffle';
    case 'r':
    case 'R':
      return 'repeat';
    case 'l':
    case 'L':
      return 'like';
    case 'm':
    case 'M':
      return 'mute';
    default:
      return null;
  }
}

export function runTransportKey(action: TransportKey): void {
  switch (action) {
    case 'toggle':
      return transportToggle();
    case 'next':
      return transportSkip(1);
    case 'previous':
      return transportSkip(-1);
    case 'shuffle':
      return transportShuffle();
    case 'repeat':
      return transportRepeat();
    case 'like':
      return transportLike();
    case 'mute':
      return toggleMute();
    case 'volumeUp':
      return transportVolume(1);
    case 'volumeDown':
      return transportVolume(-1);
  }
}

/** True when a key press should stay with the focused control instead of driving the player. */
export function keyBelongsToControl(target: EventTarget | null, key: string): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) return true;
  // Arrow keys move within radio groups and segmented controls.
  if ((key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') && el.closest('[role="radiogroup"], [role="radio"], [role="tablist"], .seg')) return true;
  // Arrow keys also scroll the lists and step a focused menu.
  if ((key === 'ArrowUp' || key === 'ArrowDown') && el.closest('[role="menu"], [role="listbox"], details, .music-library, .music-stations')) return true;
  // Space activates a focused button; only take it when focus is on the panel itself.
  if (key === ' ' && el.closest('button, a, [role="button"], [role="radio"], [role="switch"], [role="option"], summary')) return true;
  return false;
}
