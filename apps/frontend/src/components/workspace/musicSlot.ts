/**
 * Whether music has been asked for in this tab, without loading any of it.
 *
 * The player, its stations and Spotify are thousands of lines most boards
 * never use, so the header imports none of them up front. Nothing can be
 * playing until someone opens the player, so "asked for" is the only fact the
 * header needs: once it is true, the header loads the player's button and
 * keeps it there for the rest of the session. The player then lives in that
 * button's own panel, never inside a menu that closes when focus moves into
 * an embedded player.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let requested = false;
let openPending = false;

export const musicSlot = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): boolean => requested,
  /** Load the player into the header and open it. */
  request() {
    requested = true;
    openPending = true;
    listeners.forEach((fn) => fn());
  },
  /** Whether an open was asked for that has not been carried out yet. Clears it. */
  takeOpen(): boolean {
    const pending = openPending;
    openPending = false;
    return pending;
  },
};
