import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { verifyShareToken } from '../shareToken';
import { checkRoomId } from '../rooms';
import { normalizeCard, normalizePreview, type BoardCard } from './cardData';
import { boardCardSvg, privateCardSvg } from './cardSvg';
import { svgToPng } from './raster';

/**
 * Share cards: what a board link looks like when it is pasted somewhere.
 *
 *   PUT  /rooms/:roomId/card                 a board describes itself
 *   GET  /cards/room/:roomId                 what an unfurl should say (JSON)
 *   GET  /cards/room/:roomId/image.png       and show (1200×630)
 *   GET  /cards/invite/:token[/image.png]    the same, for a role-limited invite
 *
 * The HTML the unfurlers read is served by the frontend's host (see
 * `apps/frontend/api/share.ts`), which asks these for the facts.
 *
 * ## An invite card never names its room
 *
 * A view or comment invite exists to give someone *less* than the room's own
 * address. So everything about an invite — its JSON and its image URL — is
 * keyed by the token, and nothing handed back contains the room id: an unfurl
 * of a view link must not become a way to learn the edit link.
 *
 * ## Rendering is dear, so it is cached
 *
 * A card is a few hundred milliseconds of layout and rasterising, and one link
 * pasted into a busy channel is fetched by every unfurler that sees it. PNGs
 * are kept in memory by room and version, and the URL carries the version, so
 * a CDN in front can keep them for as long as it likes: a changed board is a
 * different URL.
 */

interface Deps {
  pool: Pool;
  shareSecret: string | null;
  minRoomIdLength: number;
  limiter: RequestHandler;
  uploadLimiter: RequestHandler;
  apiBase: (req: any) => string;
}

interface CardRow {
  name: string;
  hidden: boolean;
  preview: unknown;
  updated_at: Date;
}

const PNG_CACHE_LIMIT = 48;
const pngCache = new Map<string, Buffer>();
let privatePng: Promise<Buffer> | null = null;

function remember(key: string, png: Buffer) {
  pngCache.set(key, png);
  while (pngCache.size > PNG_CACHE_LIMIT) pngCache.delete(pngCache.keys().next().value as string);
}

async function readCard(pool: Pool, roomId: string): Promise<{ card: BoardCard; version: number } | null> {
  const { rows } = await pool.query<CardRow>(
    'SELECT name, hidden, preview, updated_at FROM room_cards WHERE room_id = $1',
    [roomId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    // Normalised again on the way out: the table is trusted to hold what
    // was written, not to hold what the renderer needs.
    card: { name: row.name, hidden: row.hidden, preview: normalizePreview(row.preview) },
    version: row.updated_at.getTime(),
  };
}

interface Target {
  roomId: string;
  /** For an invite, what it allows. The one fact about a token worth saying out loud. */
  role?: string;
}

/** The room behind an invite, if the token is genuine and still good. */
function roomFromToken(token: string, secret: string | null): Target | null {
  if (token.length > 1024) return null;
  const result = verifyShareToken(token, secret);
  return result.ok ? { roomId: result.payload.r, role: result.payload.o } : null;
}

function describe(card: BoardCard | null) {
  if (!card || card.hidden || !card.name) return null;
  return { name: card.name, total: card.preview?.total ?? 0 };
}

export function registerShareRoutes(app: Express, deps: Deps) {
  const { pool } = deps;

  app.put('/rooms/:roomId/card', deps.uploadLimiter, async (req: any, res: any) => {
    const check = checkRoomId(req.params.roomId, deps.minRoomIdLength);
    if (!check.ok) return res.status(400).json({ error: check.reason });
    const card = normalizeCard(req.body);
    if (!card) return res.status(400).json({ error: 'A card is a name and a preview' });

    try {
      await pool.query('INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [req.params.roomId]);
      await pool.query(
        `INSERT INTO room_cards (room_id, name, hidden, preview, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (room_id) DO UPDATE
           SET name = EXCLUDED.name, hidden = EXCLUDED.hidden, preview = EXCLUDED.preview, updated_at = NOW()`,
        [req.params.roomId, card.name, card.hidden, card.preview ? JSON.stringify(card.preview) : null]
      );
      res.status(204).end();
    } catch (err) {
      console.error('Could not store a share card:', err);
      res.status(500).json({ error: 'The card could not be saved' });
    }
  });

  /** One handler for both kinds of link; `resolve` says which room, if any. */
  const cardJson =
    (resolve: (req: any) => Target | null, imagePath: (req: any) => string): RequestHandler =>
    async (req: any, res: any) => {
      const target = resolve(req);
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      if (!target) return res.json({ found: false });
      try {
        const stored = await readCard(pool, target.roomId);
        const facts = describe(stored?.card ?? null);
        if (!stored || !facts) return res.json({ found: false });
        res.json({
          found: true,
          ...facts,
          ...(target.role ? { role: target.role } : {}),
          updatedAt: new Date(stored.version).toISOString(),
          image: `${deps.apiBase(req)}${imagePath(req)}?v=${stored.version.toString(36)}`,
        });
      } catch (err) {
        console.error('Could not read a share card:', err);
        res.json({ found: false });
      }
    };

  const cardImage =
    (resolve: (req: any) => Target | null): RequestHandler =>
    async (req: any, res: any) => {
      const roomId = resolve(req)?.roomId ?? null;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const stored = roomId ? await readCard(pool, roomId) : null;
        if (!stored || !describe(stored.card)) {
          privatePng ??= svgToPng(privateCardSvg()).catch((err) => {
            privatePng = null;
            throw err;
          });
          res.setHeader('Cache-Control', 'public, max-age=300');
          return res.send(await privatePng);
        }
        const key = `${roomId}:${stored.version}`;
        let png = pngCache.get(key);
        if (!png) {
          png = await svgToPng(boardCardSvg(stored.card));
          remember(key, png);
        }
        // Versioned URLs are immutable; an unversioned request gets the current
        // picture and a short life.
        const current = req.query.v === stored.version.toString(36);
        res.setHeader('Cache-Control', current ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
        res.send(png);
      } catch (err) {
        console.error('Could not draw a share card:', err);
        res.removeHeader('Content-Type');
        res.status(500).json({ error: 'The card could not be drawn' });
      }
    };

  const room = (req: any): Target | null =>
    checkRoomId(req.params.roomId, deps.minRoomIdLength).ok ? { roomId: String(req.params.roomId) } : null;
  const invite = (req: any) => roomFromToken(String(req.params.token ?? ''), deps.shareSecret);

  app.get('/cards/room/:roomId', deps.limiter, cardJson(room, (req) => `/cards/room/${encodeURIComponent(req.params.roomId)}/image.png`));
  app.get('/cards/room/:roomId/image.png', deps.limiter, cardImage(room));
  app.get('/cards/invite/:token', deps.limiter, cardJson(invite, (req) => `/cards/invite/${encodeURIComponent(req.params.token)}/image.png`));
  app.get('/cards/invite/:token/image.png', deps.limiter, cardImage(invite));

  /**
   * Crawlers may fetch the cards and nothing else.
   *
   * X and LinkedIn honour robots.txt even for an unfurl, so disallowing
   * everything would quietly take the picture off every shared link; allowing
   * everything invites search engines to index an API.
   */
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nAllow: /cards/\nDisallow: /\n');
  });
}
