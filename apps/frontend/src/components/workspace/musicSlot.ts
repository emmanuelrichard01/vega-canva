/**
 * Requests to open the music player from elsewhere (the board menu), without
 * loading any of it.
 *
 * The header's record button is always present and subscribes here; a
 * request makes it click itself, so the player opens in that button's own
 * panel, never inside a menu that closes when focus moves into an embedded
 * player.
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
