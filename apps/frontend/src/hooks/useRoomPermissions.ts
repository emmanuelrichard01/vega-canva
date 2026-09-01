import { useSyncExternalStore } from 'react';
import {
  getPermissions,
  getRoomRole,
  subscribeRoomRole,
  type RoomPermissions,
} from '../engine/model/permissions';

/**
 * The current mode's capabilities, as React state.
 *
 * `getRoomRole()` could be called directly -- the mode is read from the URL
 * once and nothing changes it today -- but a bare call is a value React does
 * not know it depends on, so the first `setRoomRole` from anywhere would
 * update the module and leave the interface showing the previous mode. Going
 * through the subscription that already exists costs one hook and removes
 * that as a thing to remember.
 */
export function useRoomPermissions(): RoomPermissions {
  const role = useSyncExternalStore(
    subscribeRoomRole,
    getRoomRole,
    // Server snapshot: rendering without a URL to read is always the default.
    () => 'editor' as const
  );

  return getPermissions(role);
}
