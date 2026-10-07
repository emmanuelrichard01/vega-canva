import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { pipeline } from 'stream/promises';
import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { nanoid } from 'nanoid';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config';
import { MAX_FONT_BYTES, isAllowedUpload, isFontKey, safeExtension, serveAs } from '../media';
import { sanitizeRoomId } from '../rooms';
import { requireRole, type AccessPolicy } from '../access';
import type { RateLimiter } from '../rateLimit';
import { createUnfurler, UnfurlError } from '../unfurl';
import { checkFetchableUrl } from '../safeFetch';
import type { SniffedImage } from '../unfurlParse';
import {
  checkRoomStorageQuota,
  checkGlobalStorageQuota,
  cleanupFailedMedia,
  formatBytes,
  releaseUploadAllowance,
  reserveUploadAllowance,
  type IpDailyByteTracker,
} from '../quota';
import { captureError, logger } from '../observability';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface MediaDeps {
  config: Config;
  pool: Pick<Pool, 'query'>;
  s3: Pick<S3Client, 'send'>;
  bucket: string;
  quota: IpDailyByteTracker;
  access: AccessPolicy;
  requireRoom: RequestHandler;
  uploadLimiter: RequestHandler;
  unfurlLimiter: RateLimiter;
  /** Reads or mints the visitor session; only the routes that need an identity use it. */
  withSession: RequestHandler;
  publicApiBase: (req: any) => string;
  /** Overrides where uploads are written. Tests use this; production writes to S3. */
  storage?: multer.StorageEngine;
}

export const clientAddress = (req: any): string =>
  String(req.ip || req.socket?.remoteAddress || 'unknown');

/** Every key an upload is charged to: the address always, the session when there is one. */
export function allowanceKeys(ip: string, uid?: string | null): string[] {
  return uid ? [`ip:${ip}`, `user:${uid}`] : [`ip:${ip}`];
}

/** Whose allowance an unfurl's stored picture is charged to, carried through the unfurler's async work. */
const unfurlCharge = new AsyncLocalStorage<{ ip: string }>();

/**
 * The global ceiling stops uploads outright, because it is what keeps a
 * free-tier bill bounded. Approaching it is reported (at most hourly) so it
 * is raised or investigated before it bites.
 */
const CEILING_ALERT_MS = 60 * 60 * 1000;
let lastCeilingAlert = 0;
function noteGlobalUsage(currentBytes: number, maxBytes: number, refused: boolean): void {
  if (!refused && currentBytes < maxBytes * 0.9) return;
  const now = Date.now();
  if (now - lastCeilingAlert < CEILING_ALERT_MS) return;
  lastCeilingAlert = now;
  captureError(
    refused ? 'Global storage ceiling reached; uploads are refused' : 'Global storage is above 90% of its ceiling',
    new Error('storage ceiling'),
    { currentBytes, maxBytes }
  );
}

export function registerMediaRoutes(app: Express, deps: MediaDeps): void {
  const { config, pool, s3, bucket, quota } = deps;
  const maxDaily = config.quotas.maxIpDailyBytes;

  const storage =
    deps.storage ??
    multerS3({
      s3: s3 as S3Client,
      bucket,
      key: (req: any, file: any, cb: any) => {
        const roomId = sanitizeRoomId(req.params.roomId) || 'global';
        cb(null, `${roomId}/${nanoid()}${safeExtension(file.originalname)}`);
      },
    });

  const upload = multer({
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 6, fieldNameSize: 64 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (!isAllowedUpload(file.mimetype, file.originalname)) {
        return cb(new Error('Invalid file type. Only standard images, audio recordings and fonts (WOFF2, WOFF, TTF, OTF) are accepted.'), false);
      }
      cb(null, true);
    },
    storage,
  });

  /**
   * Refuse before streaming when the declared size alone would break an
   * allowance, so a client over its quota does not get to write 50MB to
   * object storage first. The exact charge is reserved after the upload.
   */
  const preflight: RequestHandler = async (req: any, res: any, next) => {
    const declared = Number(req.headers['content-length']);
    if (!Number.isFinite(declared) || declared <= 0) return next();
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      return res.status(413).json({ error: 'File exceeds the 50MB size limit.' });
    }
    for (const key of allowanceKeys(clientAddress(req), req.sessionUser?.uid)) {
      const check = await quota.checkAsync(key, declared, maxDaily);
      if (!check.allowed) {
        return res.status(413).json({
          error: `Daily upload limit of ${formatBytes(maxDaily)} exceeded. Currently used: ${formatBytes(check.currentBytes)}.`,
        });
      }
    }
    next();
  };

  app.post(
    '/rooms/:roomId/media',
    deps.requireRoom,
    requireRole(deps.access, 'editor'),
    deps.uploadLimiter,
    deps.withSession,
    preflight,
    (req: any, res: any, next: any) => {
      upload.single('media')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File exceeds the 50MB size limit.' });
          }
          return res.status(400).json({ error: err.message || 'Upload validation failed.' });
        }
        next();
      });
    },
    async (req: any, res: any) => {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const roomId = sanitizeRoomId(req.params.roomId) || 'global';
      const storageKey = req.file.key as string;
      const objectName = path.basename(storageKey);
      const mediaId = objectName.split('.')[0];
      const fileSize = req.file.size as number;
      const keys = allowanceKeys(clientAddress(req), req.sessionUser?.uid);

      const allowance = await reserveUploadAllowance(quota, keys, fileSize, maxDaily);
      if (!allowance.allowed) {
        await cleanupFailedMedia(s3 as S3Client, bucket, storageKey);
        return res.status(413).json({
          error: `Daily upload limit of ${formatBytes(maxDaily)} exceeded. Currently used: ${formatBytes(allowance.currentBytes)}.`,
        });
      }

      const refuse = async (status: number, error: string) => {
        await releaseUploadAllowance(quota, keys, fileSize);
        await cleanupFailedMedia(s3 as S3Client, bucket, storageKey);
        res.status(status).json({ error });
      };

      if (isFontKey(storageKey) && fileSize > MAX_FONT_BYTES) {
        return refuse(413, `Fonts are limited to ${formatBytes(MAX_FONT_BYTES)}.`);
      }

      try {
        const roomCheck = await checkRoomStorageQuota(pool as Pool, roomId, fileSize, config.quotas.maxRoomBytes);
        if (!roomCheck.allowed) {
          return refuse(
            413,
            `Room storage limit of ${formatBytes(config.quotas.maxRoomBytes)} exceeded. Currently used: ${formatBytes(roomCheck.currentBytes)}.`
          );
        }
        const globalCheck = await checkGlobalStorageQuota(pool as Pool, fileSize, config.quotas.maxGlobalBytes);
        noteGlobalUsage(globalCheck.currentBytes, config.quotas.maxGlobalBytes, !globalCheck.allowed);
        if (!globalCheck.allowed) {
          return refuse(
            413,
            `Global storage ceiling reached (${formatBytes(config.quotas.maxGlobalBytes)}). Uploads temporarily paused.`
          );
        }

        // The proxy's address, not the object store's: the bucket is private.
        const url = `${deps.publicApiBase(req)}/rooms/${roomId}/media/${objectName}`;
        await pool.query(`INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [roomId]);
        await pool.query(
          `INSERT INTO media_refs (id, room_id, url, mime_type, size_bytes, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [mediaId, roomId, url, req.file.mimetype, fileSize, storageKey]
        );
        res.json({ id: mediaId, url, mimeType: req.file.mimetype, sizeBytes: fileSize });
      } catch (err) {
        captureError('Could not record a media upload', err, { roomId });
        await releaseUploadAllowance(quota, keys, fileSize);
        await cleanupFailedMedia(s3 as S3Client, bucket, storageKey, pool as Pool, mediaId);
        if (!res.headersSent) res.status(500).json({ error: 'Database error processing media upload.' });
      }
    }
  );

  /**
   * The only way to read stored media.
   *
   * Only objects this server recorded in `media_refs` are served, so the
   * route cannot be pointed at anything else that shares the bucket.
   *
   * The headers make it incapable of serving an active document: the type
   * comes from our own extension table, `nosniff` stops the browser second-
   * guessing it, the CSP neutralises anything parsed as a document, and an
   * unknown extension is offered as a download.
   *
   * Not gated by `ENFORCE_SHARE_TOKENS`: an `<img>` cannot send the invite
   * header. Media ids are unguessable and only reachable through a board.
   */
  app.get('/rooms/:roomId/media/:mediaKey', deps.requireRoom, async (req: any, res: any) => {
    const roomId = sanitizeRoomId(req.params.roomId);
    const mediaKey = path.basename(String(req.params.mediaKey || ''));
    if (!roomId || !mediaKey) return res.status(400).json({ error: 'Invalid room or media parameter' });

    const s3Key = `${roomId}/${mediaKey}`;
    try {
      // Rows written before migration 3 have no storage key; their id is the
      // object name without its extension.
      const known = await pool.query(
        `SELECT 1 FROM media_refs
          WHERE room_id = $1 AND (storage_key = $2 OR (storage_key IS NULL AND id = $3))
          LIMIT 1`,
        [roomId, s3Key, mediaKey.split('.')[0]]
      );
      if (known.rows.length === 0) return res.status(404).json({ error: 'Media not found' });

      const s3Res: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));

      const { type, render } = serveAs(mediaKey);
      res.setHeader('Content-Type', type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (!render) res.setHeader('Content-Disposition', `attachment; filename="${mediaKey}"`);
      if (s3Res.ContentLength) res.setHeader('Content-Length', s3Res.ContentLength);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      const body = s3Res.Body;
      if (body && typeof body.pipe === 'function') {
        // `pipeline` tears the S3 stream down if the client goes away and
        // turns a reset mid-download into a rejection here, not an uncaught
        // stream error that would take the process down.
        try {
          await pipeline(body, res);
        } catch (err: any) {
          if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
            logger.warn('Media stream ended early', { key: s3Key, error: String(err?.message ?? err) });
          }
          res.destroy();
        }
        return;
      }
      const bytes = await body?.transformToByteArray?.();
      if (bytes) res.send(Buffer.from(bytes));
      else res.status(404).json({ error: 'Media not found' });
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.Code === 'NoSuchKey') {
        return res.status(404).json({ error: 'Media not found' });
      }
      captureError('Error streaming media from object storage', err, { key: s3Key });
      if (!res.headersSent) res.status(500).json({ error: 'Failed to fetch media stream' });
      else res.destroy();
    }
  });

  /**
   * Keep a link preview's picture as room media, with the same accounting as
   * an upload: the triggering address's daily allowance, the room quota, the
   * global ceiling, and a `media_refs` row so the reaper deletes it with the
   * board. The extension comes from the sniffed bytes, not from the site.
   */
  const storeUnfurlImage = async (roomId: string, bytes: Buffer, image: SniffedImage, apiBase: string): Promise<string | null> => {
    const size = bytes.length;
    const keys = allowanceKeys(unfurlCharge.getStore()?.ip ?? 'unknown');
    const allowance = await reserveUploadAllowance(quota, keys, size, maxDaily);
    if (!allowance.allowed) return null;

    const mediaId = nanoid();
    const objectName = `${mediaId}${image.ext}`;
    const storageKey = `${roomId}/${objectName}`;
    const url = `${apiBase}/rooms/${roomId}/media/${objectName}`;
    try {
      const roomCheck = await checkRoomStorageQuota(pool as Pool, roomId, size, config.quotas.maxRoomBytes);
      const globalCheck = await checkGlobalStorageQuota(pool as Pool, size, config.quotas.maxGlobalBytes);
      noteGlobalUsage(globalCheck.currentBytes, config.quotas.maxGlobalBytes, !globalCheck.allowed);
      if (!roomCheck.allowed || !globalCheck.allowed) {
        await releaseUploadAllowance(quota, keys, size);
        return null;
      }
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: storageKey, Body: bytes, ContentType: image.mime }));
      await pool.query(`INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [roomId]);
      await pool.query(
        `INSERT INTO media_refs (id, room_id, url, mime_type, size_bytes, storage_key) VALUES ($1, $2, $3, $4, $5, $6)`,
        [mediaId, roomId, url, image.mime, size, storageKey]
      );
      return url;
    } catch (err) {
      logger.warn('Could not keep a link preview image', { error: String((err as Error)?.message ?? err) });
      await releaseUploadAllowance(quota, keys, size);
      await cleanupFailedMedia(s3 as S3Client, bucket, storageKey, pool as Pool, mediaId);
      return null;
    }
  };

  let unfurlApiBase = config.publicApiUrl || '';
  const unfurler = createUnfurler({
    store: (roomId, bytes, image) => storeUnfurlImage(roomId, bytes, image, unfurlApiBase),
  });

  /**
   * Link previews. Every outbound request goes through `safeFetch`, where the
   * SSRF rules live. The limiter is spent by hand, only when the request is
   * about to fetch: a preview already held is answered from memory, and the
   * second half of every two-part preview is by construction such a hit.
   */
  app.get('/rooms/:roomId/unfurl', deps.requireRoom, requireRole(deps.access, 'viewer'), async (req: any, res: any) => {
    const roomId = sanitizeRoomId(req.params.roomId);
    const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!roomId || !raw || raw.length > 2048) {
      return res.status(400).json({ error: 'A web address is needed' });
    }
    let url: string;
    try {
      url = checkFetchableUrl(raw).href;
    } catch (err: any) {
      return res.status(422).json({ error: err?.message ?? 'That address cannot be previewed' });
    }
    if (!unfurlApiBase) unfurlApiBase = deps.publicApiBase(req);

    const known = unfurler.peek(roomId, url);
    if (known) {
      res.setHeader('Cache-Control', 'private, max-age=600');
      return res.json({ meta: known, pending: false });
    }

    const ip = clientAddress(req);
    if (!(await deps.unfurlLimiter.takeAsync(ip))) {
      res.setHeader('Retry-After', '5');
      return res.status(429).json({ error: 'Too many previews at once. Please try again shortly.' });
    }

    try {
      const { preview, pending } = await unfurlCharge.run({ ip }, () => unfurler.unfurl(roomId, url));
      // A card still waiting on its picture must not be cached: the next
      // request is the one that collects it.
      res.setHeader('Cache-Control', pending ? 'no-store' : 'private, max-age=600');
      res.json({ meta: preview, pending });
    } catch (err: any) {
      if (err instanceof UnfurlError) return res.status(err.status).json({ error: err.message });
      logger.warn('Link preview failed', { url, error: String(err?.message ?? err) });
      res.status(502).json({ error: 'That page could not be previewed' });
    }
  });
}
