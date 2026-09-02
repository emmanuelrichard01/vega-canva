import { describe, it, expect } from 'vitest';
import { resolveRoomRoute, HOME_ROOM } from './route';

describe('resolveRoomRoute', () => {
  it('opens the board named in the path', () => {
    expect(resolveRoomRoute('/room/abcdefgh12', null)).toEqual({
      roomId: 'abcdefgh12',
      isHome: false,
    });
  });

  it('treats the landing page as home', () => {
    expect(resolveRoomRoute('/', null)).toEqual({ roomId: HOME_ROOM, isHome: true });
  });

  /**
   * The regression this file exists for.
   *
   * An invite resolves a real board from a path that does not begin `/room/`.
   * The old code answered "which board" from the invite and "is this home"
   * from the path, so this case came back as a real room that was also the
   * landing page -- and the landing page does not connect. Every shared link
   * opened an empty canvas.
   */
  it('connects for an invite route, whose path is not /room/', () => {
    const route = resolveRoomRoute('/i/eyJyIjoiYWJjZGVmZ2gxMiJ9.sig', 'abcdefgh12');
    expect(route).toEqual({ roomId: 'abcdefgh12', isHome: false });
  });

  it('never reports a resolved board as home', () => {
    // The invariant, stated directly rather than sampled: whatever the path
    // looks like, `isHome` is exactly "there is no board here".
    const paths = ['/', '/room/', '/i/token', '/room/x', '/anything', ''];
    const invites = [null, 'realroom'];

    for (const path of paths) {
      for (const invite of invites) {
        const route = resolveRoomRoute(path, invite);
        expect(route.isHome).toBe(route.roomId === HOME_ROOM);
      }
    }
  });

  it('drops a query or fragment from the room id', () => {
    expect(resolveRoomRoute('/room/abc?ref=slack', null).roomId).toBe('abc');
    expect(resolveRoomRoute('/room/abc#top', null).roomId).toBe('abc');
    expect(resolveRoomRoute('/room/abc/extra', null).roomId).toBe('abc');
  });

  it('falls back to home for a room path with no id', () => {
    expect(resolveRoomRoute('/room/', null)).toEqual({ roomId: HOME_ROOM, isHome: true });
  });

  it('prefers the invite over a room id in the path', () => {
    // Both present should not be possible from a link this app mints, but the
    // signed value is the one the server will enforce, so it must win here
    // too -- otherwise the tab syncs one board and claims another.
    expect(resolveRoomRoute('/room/fromthepath', 'fromtheinvite').roomId).toBe('fromtheinvite');
  });

  it('handles an undefined pathname without throwing', () => {
    expect(resolveRoomRoute(undefined, null)).toEqual({ roomId: HOME_ROOM, isHome: true });
  });
});
