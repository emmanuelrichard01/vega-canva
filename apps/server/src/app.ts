import express, { type Express, type RequestHandler } from 'express';
import cors from 'cors';
import type multer from 'multer';
import type { Pool } from 'pg';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config';
import { createOriginCheck } from './cors';
import { checkRoomId } from './rooms';
import { createRateLimiter, rateLimit } from './rateLimit';
import type { SharedRedis } from './redisClient';
import type { IpDailyByteTracker } from './quota';
import { mintSessionToken, readSessionFromRequest, serializeSessionCookie, verifySessionToken } from './session';
import { INVITE_HEADER, type AccessPolicy } from './access';
import type { ReapOptions, ReapResult } from './reaper';
import { registerShareRoutes } from './share/routes';
import { registerHealthRoutes, type HealthProbe } from './routes/health';
import { registerMediaRoutes } from './routes/media';
import { registerRoomRoutes } from './routes/rooms';
import { adminCheck, registerAdminRoutes } from './routes/admin';
import { registerStatusRoutes, type LiveReader } from './routes/status';
import { logger } from './observability';

/**
 * The HTTP API, built from its dependencies.
 *
 * Everything with a side effect (the database pool, object storage, Redis,
 * the session key) is passed in, so a test can build the whole app against
 * fakes and call it over a real socket.
 */
export interface AppDeps {
  config: Config;
  pool: Pick<Pool, 'query'>;
  s3: Pick<S3Client, 'send'>;
  bucket: string;
  sharedRedis: SharedRedis | null;
  sessionSecret: string;
  quota: IpDailyByteTracker;
  health: HealthProbe;
  reap: (options: ReapOptions) => Promise<ReapResult>;
  /** Where uploads are written; S3 when omitted. */
  storage?: multer.StorageEngine;
  /** What a board loaded on this instance says about itself, for the dashboard. */
  live?: LiveReader;
}

/** One line per refused origin per window, rather than one per request. */
const REFUSAL_LOG_WINDOW_MS = 10 * 60 * 1000;

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const app = express();

  // `trust proxy` makes Express believe `X-Forwarded-For`, which any client can
  // send, so it is only on when the deployment says a proxy is in front.
  if (config.trustProxy !== null) app.set('trust proxy', config.trustProxy);

  const originAllowed = createOriginCheck(config.allowedOrigins);
  const refusalLoggedAt = new Map<string, number>();
  const noteRefusedOrigin = (origin: string) => {
    const now = Date.now();
    const last = refusalLoggedAt.get(origin);
    if (last !== undefined && now - last < REFUSAL_LOG_WINDOW_MS) return;
    if (refusalLoggedAt.size > 256) refusalLoggedAt.clear();
    refusalLoggedAt.set(origin, now);
    logger.warn('Cross-origin request refused', {
      origin,
      hint: 'Add this origin to ALLOWED_ORIGINS if it is one of yours.',
    });
  };

  app.use(
    cors({
      // `false`, never an Error: refusing is routine, and omitting the
      // Allow-Origin header is what stops the calling page reading the answer.
      // No Origin at all is same-origin, server-to-server or a probe.
      origin: (origin, callback) => {
        if (!origin || originAllowed(origin)) return callback(null, true);
        noteRefusedOrigin(origin);
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Session-Token', 'X-Invite-Token'],
      maxAge: 86400,
    })
  );
  app.use(express.json());

  /**
   * Durable anonymous identity (docs/GOING-LIVE.md §2.1): reads the visitor's
   * signed session, or mints one and sets the cookie.
   *
   * Route-level, never global. A `Set-Cookie` on a response marked publicly
   * cacheable (media, cards) could be stored by a shared cache and handed to
   * every later visitor, giving them all one identity.
   */
  const withSession: RequestHandler = (req: any, res, next) => {
    const existing = readSessionFromRequest(req, deps.sessionSecret);
    if (existing.session && existing.token) {
      req.sessionUser = existing.session;
      req.sessionToken = existing.token;
    } else {
      const token = mintSessionToken(deps.sessionSecret);
      const verified = verifySessionToken(token, deps.sessionSecret);
      if (verified.ok) {
        req.sessionUser = verified.session;
        req.sessionToken = token;
        const isSecure = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
        res.setHeader('Set-Cookie', serializeSessionCookie(token, { isSecure }));
        res.setHeader('Cache-Control', 'private, no-store');
      }
    }
    next();
  };

  app.get('/api/session', withSession, (req: any, res: any) => {
    if (!req.sessionUser) return res.status(500).json({ error: 'Session initialization failed' });
    res.json({
      user: {
        id: req.sessionUser.uid,
        isAnonymous: req.sessionUser.anon,
        createdAt: req.sessionUser.iat * 1000,
      },
      token: req.sessionToken,
    });
  });

  registerHealthRoutes(app, deps.health);

  const access: AccessPolicy = {
    shareSecret: config.shareSecret,
    enforceShareTokens: config.enforceShareTokens,
  };
  const requireRoom: RequestHandler = (req, res, next) => {
    const check = checkRoomId(req.params.roomId, config.minRoomIdLength);
    if (!check.ok) {
      res.status(400).json({ error: check.reason });
      return;
    }
    next();
  };
  const isAdmin = adminCheck(config.adminSecret);
  // Configured in production; derived from the request in development only.
  const publicApiBase = (req: any): string => config.publicApiUrl || `${req.protocol}://${req.get('host')}`;

  const redis = deps.sharedRedis;
  registerMediaRoutes(app, {
    config,
    pool: deps.pool,
    s3: deps.s3,
    bucket: deps.bucket,
    quota: deps.quota,
    access,
    requireRoom,
    uploadLimiter: rateLimit(30, 1, redis, 'rl:media'),
    unfurlLimiter: createRateLimiter(60, 2, redis, 'rl:unfurl'),
    withSession,
    publicApiBase,
    storage: deps.storage,
  });

  const roomLimiter = rateLimit(60, 2, redis, 'rl:history');
  registerRoomRoutes(app, { pool: deps.pool, access, requireRoom, limiter: roomLimiter, isAdmin });

  registerStatusRoutes(app, {
    pool: deps.pool,
    access,
    // A dashboard polls once a minute in batches of 50 ids; this allows a
    // library of about a thousand boards and little room for probing beyond it.
    limiter: rateLimit(20, 0.4, redis, 'rl:status'),
    minRoomIdLength: config.minRoomIdLength,
    live: deps.live,
  });

  registerShareRoutes(app, {
    pool: deps.pool,
    access,
    minRoomIdLength: config.minRoomIdLength,
    limiter: rateLimit(60, 1, redis, 'rl:card'),
    // A board re-describes itself at most every few seconds while people work.
    uploadLimiter: rateLimit(20, 0.2, redis, 'rl:card-put'),
    apiBase: publicApiBase,
  });

  registerAdminRoutes(app, {
    pool: deps.pool,
    limiter: roomLimiter,
    isAdmin,
    roomTtlDays: config.roomTtlDays,
    reap: deps.reap,
  });

  return app;
}

/** The header REST callers use to present an invite. Exported for the client contract. */
export { INVITE_HEADER };
