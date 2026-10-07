/**
 * Play/pause and skip for whichever source is selected. Used by keyboard
 * shortcuts, which act on the player as a whole rather than on one pane.
 */
import { getMusicState, togglePlay } from './musicStore';
import { getLibraryState, skipLibrary } from './library/libraryStore';
import { getSpotifyState, nextSpotifyTrack, pauseSpotify, previousSpotifyTrack, resumeSpotify } from './spotify/spotifyStore';

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

/** True when a key press should stay with the focused control instead of driving the player. */
export function keyBelongsToControl(target: EventTarget | null, key: string): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) return true;
  // Arrow keys move within radio groups and segmented controls.
  if ((key === 'ArrowLeft' || key === 'ArrowRight') && el.closest('[role="radiogroup"], [role="radio"], [role="tablist"], .seg')) return true;
  // Space activates a focused button; only take it when focus is on the panel itself.
  if (key === ' ' && el.closest('button, a, [role="button"], [role="radio"], [role="switch"], [role="option"], summary')) return true;
  return false;
}
