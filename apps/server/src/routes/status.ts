import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { checkRoomId } from '../rooms';
import type { AccessPolicy } from '../access';
import { captureError } from '../observability';

/**
 * What the dashboard can say about the boards it already knows.
 *
 * `GET /api/rooms/status?ids=a,b,c` answers, per id: does the board exist on
 * this server, when did it last change, what is it called, and how many
 * people have it open right now — a count, never who. The caller already
 * holds every id it asks about, and an id is the capability to open the
 * board, but a count is all a list of cards needs, and a name read out to
 * anyone who holds an old link is more than a board should give away.
 *
 * A board that has turned its link previews off (`sharePreview: off`) gives
 * neither its name nor its occupancy. With `ENFORCE_SHARE_TOKENS` on an id is
 * no longer a capability, so the route answers `restricted` and nothing else.
 */

export const MAX_STATUS_IDS = 50;

/** The share-preview switch in a board's metadata, as the client writes it. */
const SHARE_PREVIEW_KEY = 'sharePreview';

export interface LiveRoom {
  /** `metadata.name` from the loaded document, which is always current. */
  title: string | null;
  /** The board has asked not to be described outside itself. */
  hidden: boolean;
  /** People with the board open, counted once however many tabs they have. */
  count: number;
}

/** `null` when the document is not loaded on this instance. */
export type LiveReader = (roomId: string) => LiveRoom | null;

export interface RoomStatus {
  id: string;
  exists: boolean;
  /** ISO time of the last stored change, when known. */
  updatedAt: string | null;
  title: string | null;
  onlineCount: number;
}

export interface StatusRouteDeps {
  pool: Pick<Pool, 'query'>;
  access: AccessPolicy;
  limiter: RequestHandler;
  minRoomIdLength: number;
  live?: LiveReader;
}

/** Valid, distinct ids from a comma-separated list, capped. */
export function parseStatusIds(raw: unknown, minLength: number): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!id || out.includes(id)) continue;
    if (!checkRoomId(id, minLength).ok) continue;
    out.push(id);
    if (out.length >= MAX_STATUS_IDS) break;
  }
  return out;
}

/**
 * How many people are in a live document, from its awareness states.
 *
 * One per person rather than per tab: a state with a `user.id` counts once
 * per id, otherwise once per name and colour. States without a user — a
 * dashboard's short-lived connection, say — are not people.
 */
export function countPeople(states: Iterable<unknown>): number {
  const seen = new Set<string>();
  for (const state of states) {
    const user = (state as { user?: { id?: unknown; name?: unknown; color?: unknown } } | null)?.user;
    if (!user || typeof user.name !== 'string' || !user.name.trim()) continue;
    seen.add(typeof user.id === 'string' && user.id ? `id:${user.id}` : `nc:${user.name.trim()}|${String(user.color ?? '')}`);
  }
  return seen.size;
}

interface LiveDocument {
  awareness?: { getStates(): Map<number, unknown> };
  getMap?: (name: string) => { get(key: string): unknown };
}

/** A live reader over a Hocuspocus instance's loaded documents. */
export function hocuspocusLive(hocuspocus: { documents: Map<string, LiveDocument> }): LiveReader {
  return (roomId) => {
    const doc = hocuspocus.documents.get(roomId);
    if (!doc) return null;
    const metadata = doc.getMap?.('metadata');
    const name = metadata?.get('name');
    return {
      title: typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : null,
      hidden: metadata?.get(SHARE_PREVIEW_KEY) === 'off',
      count: doc.awareness ? countPeople(doc.awareness.getStates().values()) : 0,
    };
  };
}

export function registerStatusRoutes(app: Express, deps: StatusRouteDeps): void {
  app.get('/api/rooms/status', deps.limiter, async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (deps.access.enforceShareTokens) {
      return res.json({ restricted: true, rooms: [] });
    }

    const ids = parseStatusIds(req.query?.ids, deps.minRoomIdLength);
    if (ids.length === 0) return res.json({ restricted: false, rooms: [] });

    try {
      const result = await deps.pool.query(
        `SELECT r.id,
                GREATEST(r.last_active_at, s.updated_at) AS updated_at,
                c.name AS card_name,
                c.hidden AS card_hidden
           FROM rooms r
           LEFT JOIN room_snapshots s ON s.room_id = r.id
           LEFT JOIN room_cards c ON c.room_id = r.id
          WHERE r.id = ANY($1::text[])`,
        [ids]
      );
      const rows = new Map<string, any>(result.rows.map((row: any) => [String(row.id), row]));

      const rooms: RoomStatus[] = ids.map((id) => {
        const row = rows.get(id);
        const live = deps.live?.(id) ?? null;
        const updated = row?.updated_at ? new Date(row.updated_at) : null;
        // The live document is the current word on both; the stored card is
        // what its clients last published.
        const hidden = live ? live.hidden : Boolean(row?.card_hidden);
        const stored = typeof row?.card_name === 'string' && row.card_name.trim() ? row.card_name.trim() : null;
        return {
          id,
          // A board open right now exists even before its first store.
          exists: Boolean(row) || live !== null,
          updatedAt: updated && !Number.isNaN(updated.getTime()) ? updated.toISOString() : null,
          title: hidden ? null : (live?.title ?? stored),
          onlineCount: hidden ? 0 : (live?.count ?? 0),
        };
      });

      res.json({ restricted: false, rooms });
    } catch (err) {
      captureError('Error reading board status', err, { count: ids.length });
      res.status(500).json({ error: 'Could not read board status.' });
    }
  });
}
