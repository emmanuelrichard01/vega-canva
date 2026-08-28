/**
 * What counts as a room, and why the answer has a floor.
 *
 * ## The model, stated
 *
 * There are no accounts and no permissions. The room id **is** the capability:
 * whoever holds it can open the board and edit it, and that is the whole of
 * the access control. It is a legitimate model -- the same one a Google Docs
 * "anyone with the link" share uses -- and it has one hard requirement, which
 * is that the id must be genuinely unguessable.
 *
 * ## The hole this closes
 *
 * The validator was `/^[a-zA-Z0-9_-]{1,128}$/`. **One character.** Anybody
 * could have walked the entire space of short ids in seconds and opened every
 * board whose address was short enough for somebody to have typed by hand --
 * and the library's join box passes a bare id straight through, so those
 * boards are easy to create by accident.
 *
 * The floor does not make ids unguessable on its own; `nanoid(10)` does that,
 * at sixty bits. What it does is stop the model being quietly opted out of.
 */

/** The character set, unchanged: what `nanoid`'s URL alphabet can produce. */
const SHAPE = /^[a-zA-Z0-9_-]+$/;

const MAX_ROOM_ID_LENGTH = 128;

export interface RoomIdCheck {
  ok: boolean;
  /** Safe to show a client: it describes the rule, never the value. */
  reason?: string;
}

export function checkRoomId(id: unknown, minLength: number): RoomIdCheck {
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, reason: 'Missing room identifier' };
  }
  if (id.length > MAX_ROOM_ID_LENGTH) {
    return { ok: false, reason: 'Room identifier is too long' };
  }
  if (!SHAPE.test(id)) {
    return { ok: false, reason: 'Room identifier contains unsupported characters' };
  }
  if (id.length < minLength) {
    // Deliberately not "too short for security". The message a stranger sees
    // should describe the rule without describing what the rule is protecting.
    return { ok: false, reason: 'Room identifier is too short' };
  }
  return { ok: true };
}

/**
 * A room id reduced to something safe to put in a storage key.
 *
 * Kept separate from `checkRoomId` because they answer different questions:
 * this one asks "can this string hurt a path", the other asks "is this a room
 * we agree to serve". Both are applied on the upload route -- validation
 * first, then this -- so a rejected id never reaches a key at all.
 */
export function sanitizeRoomId(raw: unknown): string {
  return String(raw ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}
