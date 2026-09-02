/**
 * Which board a URL opens, and whether to open a socket for it.
 *
 * ## Why this is a module and not four lines in `doc.ts`
 *
 * It was four lines in `doc.ts`, and they answered the same question twice.
 * `roomId` was resolved from the invite first and the path second; the
 * separate decision "is this the landing page" re-derived it by asking whether
 * the path began `/room/`. Both were correct in isolation. They disagreed the
 * moment a second route into a board existed:
 *
 * ```text
 * /i/<token>   roomId -> the room in the token   isHome -> true
 * ```
 *
 * `isHome` disconnects the provider and skips IndexedDB persistence, so every
 * invite link opened a board that could never receive a document and had no
 * cache to fall back on. The canvas was empty, for every role, and nothing
 * logged a failure because the socket had been closed deliberately.
 *
 * `doc.ts` runs its side effects at import time — a `Y.Doc`, a WebSocket
 * provider, an IndexedDB connection — so nothing in it could be tested without
 * opening a socket. That is the reason a decision this small got no test and
 * shipped wrong. It is a pure function now, and `route.test.ts` holds it.
 */

/** The sentinel room name for "not a board" — the landing page. */
export const HOME_ROOM = 'home';

export interface RoomRoute {
  /** The board to open, or `HOME_ROOM`. */
  roomId: string;
  /**
   * True only for the landing page.
   *
   * Derived from `roomId` and nothing else, so it cannot contradict it. Every
   * caller that wants "should this tab talk to a server" must ask this rather
   * than re-reading the path.
   */
  isHome: boolean;
}

/**
 * Resolve the board from a pathname and an already-decoded invite.
 *
 * The invite wins: `/i/<token>` carries its room inside the token, and a
 * caller holding one has already done the decoding. Passing `null` means
 * "no invite on this URL", not "the invite was bad" — an invite that failed to
 * parse is the same as no invite as far as routing is concerned, and the
 * connection layer is where a bad token gets its refusal.
 */
export const resolveRoomRoute = (
  pathname: string | undefined,
  inviteRoomId: string | null
): RoomRoute => {
  if (inviteRoomId) return { roomId: inviteRoomId, isHome: false };

  // `split` rather than a prefix test plus a slice, so a path with no `/room/`
  // in it yields undefined rather than a subtly wrong substring.
  const fromPath = pathname?.split('/room/')[1];

  // A trailing segment, a query or a fragment is not part of the id. Boards
  // reached as `/room/abc?x=1` used to open a room literally called `abc?x=1`,
  // which is a different, empty board.
  const roomId = fromPath?.split(/[/?#]/)[0]?.trim() || HOME_ROOM;

  return { roomId, isHome: roomId === HOME_ROOM };
};
