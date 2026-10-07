import type { Express, Request, RequestHandler, Response } from 'express';
import { pipeline } from 'stream/promises';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { captureError, logger } from '../observability';

/**
 * The music library, streamed from object storage.
 *
 * The bucket is private, so the player reaches tracks through here rather than
 * a public bucket URL. Only `music/v<n>/manifest.json` and
 * `music/v<n>/<category>/<slug>.m4a` can be named: the pattern is the whole
 * access policy, so no other object in the bucket is reachable.
 *
 * Range requests pass straight through to storage, which is what lets the
 * player seek and lets browsers start playback before the file has arrived.
 * Tracks are immutable under a versioned prefix and cache for a year; the
 * manifest caches briefly so a new upload shows up within minutes.
 */

const KEY = /^music\/v\d{1,3}\/(manifest\.json|[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9-]{0,119}\.m4a)$/;
const RANGE = /^bytes=\d*-\d*$/;

export interface MusicDeps {
  s3: Pick<S3Client, 'send'>;
  bucket: string;
  /** Seeking issues several range requests per track, so this should be generous. */
  limiter?: RequestHandler;
}

/** The storage key a request path names, or null when it names nothing playable. */
export function musicKey(path: string): string | null {
  const key = `music/${path}`;
  return KEY.test(key) ? key : null;
}

export function registerMusicRoutes(app: Express, { s3, bucket, limiter }: MusicDeps): void {
  const pass: RequestHandler = (_req, _res, next) => next();
  app.get(/^\/music\/(.+)$/, limiter ?? pass, async (req: Request, res: Response) => {
    const key = musicKey(String((req.params as Record<string, string>)[0] ?? ''));
    if (!key) return res.status(404).json({ error: 'Not found' });

    const rangeHeader = req.headers.range;
    const range = typeof rangeHeader === 'string' && RANGE.test(rangeHeader) ? rangeHeader : undefined;
    const isManifest = key.endsWith('manifest.json');

    try {
      const out: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));

      res.setHeader('Content-Type', isManifest ? 'application/json; charset=utf-8' : 'audio/mp4');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader(
        'Cache-Control',
        isManifest ? 'public, max-age=300' : 'public, max-age=31536000, immutable'
      );
      if (out.ContentLength != null) res.setHeader('Content-Length', String(out.ContentLength));
      if (out.ContentRange) {
        res.status(206);
        res.setHeader('Content-Range', out.ContentRange);
      }

      const body = out.Body;
      if (body && typeof body.pipe === 'function') {
        try {
          await pipeline(body, res);
        } catch (err: any) {
          // Seeking aborts the previous range request; that is not an error.
          if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
            logger.warn('Music stream ended early', { key, error: String(err?.message ?? err) });
          }
          res.destroy();
        }
        return;
      }
      const bytes = await body?.transformToByteArray?.();
      if (bytes) return res.end(Buffer.from(bytes));
      return res.status(404).json({ error: 'Not found' });
    } catch (err: any) {
      const name = err?.name ?? err?.Code;
      if (name === 'NoSuchKey') return res.status(404).json({ error: 'Not found' });
      if (name === 'InvalidRange' || err?.$metadata?.httpStatusCode === 416) {
        return res.status(416).json({ error: 'Range not satisfiable' });
      }
      captureError('Error streaming music from object storage', err, { key });
      if (!res.headersSent) res.status(502).json({ error: 'Music is unavailable right now' });
    }
  });
}
