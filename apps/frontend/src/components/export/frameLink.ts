/**
 * A link that opens a board on one frame.
 *
 * `…/room/abc?frame=<frame id>`. Like the follow link, it adds no access: the
 * room decides what the visitor may do, and the frame is only where the
 * camera starts. Copied from the export dialog and the frame's context menu.
 */

export const FRAME_PARAM = 'frame';

/**
 * The board's own address with `frame=<id>`. Built from the room id, never
 * from the current location: someone who arrived through an invite
 * (`/i/<token>`) must not hand their token on by copying a frame link.
 */
export function frameLink(origin: string, roomId: string, frameId: string): string {
  return withFrameParam(`${origin}/room/${encodeURIComponent(roomId)}`, frameId);
}

/** `url` with `frame=<id>` set, leaving every other part of it alone. */
export function withFrameParam(url: string, frameId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(FRAME_PARAM, frameId);
  return parsed.toString();
}

/** The frame id a location asks to open on, or `null`. */
export function readFrameTarget(search: string): string | null {
  const value = new URLSearchParams(search).get(FRAME_PARAM)?.trim();
  // Node ids are short opaque strings; anything else is not one.
  if (!value || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}

/** `search` without the frame parameter, so a reload does not jump back. */
export function withoutFrameParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(FRAME_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
