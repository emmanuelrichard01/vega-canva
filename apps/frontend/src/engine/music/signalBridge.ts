/**
 * Keeps `playingSignal` in step with whichever source is selected.
 *
 * Imported for its effect by the player, so it runs only once the player has
 * loaded, and keeps running after the popover closes.
 */
import { getMusicState, subscribeMusic } from './musicStore';
import { getLibraryState, subscribeLibrary } from './library/libraryStore';
import { getSpotifyState, subscribeSpotify } from './spotify/spotifyStore';
import { setPlayingSignal, type PlayingSignal } from './playingSignal';

export function currentSignal(): PlayingSignal {
  if (getMusicState().source === 'stations') {
    const lib = getLibraryState();
    const t = lib.current;
    return { playing: lib.playing, line: lib.playing && t ? `${t.title} by ${t.artist}` : null };
  }
  const s = getSpotifyState();
  return { playing: s.playing, line: s.playing && s.current ? s.current.name : null };
}

const sync = () => setPlayingSignal(currentSignal());
subscribeMusic(sync);
subscribeLibrary(sync);
subscribeSpotify(sync);
sync();
