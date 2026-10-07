/**
 * Everything the deployment gets to decide, read once and checked once.
 *
 * ## Why this file exists
 *
 * The settings were `process.env.X || "some-default"` scattered across two
 * modules, and the defaults were real working credentials: `canva_password`
 * for both Postgres and object storage, `*` for CORS. That shape is fine in
 * development and dangerous the moment it ships, because a missing environment
 * variable does not fail -- it succeeds, quietly, on a password that is written
 * in a public repository.
 *
 * The rule here is that **development gets convenient defaults and production
 * gets none**. Under `NODE_ENV=production` every secret must be supplied, must
 * not be one of the published development values, and the process refuses to
 * start otherwise. A server that will not boot is a page somebody fixes in
 * five minutes; a server that boots on a known password is an incident.
 */

import { parseOriginRule } from './cors';

/** The credentials committed to this repository for local development. */
const DEV_SECRETS = new Set([
  'canva_password',
  'canva_user',
  'canva_admin',
  'password',
  'changeme',
]);

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Problems found while reading the environment, reported together. */
export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(
      `Refusing to start. ${problems.length} configuration problem${problems.length === 1 ? '' : 's'}:\n` +
        problems.map((p) => `  - ${p}`).join('\n')
    );
    this.name = 'ConfigError';
  }
}

/**
 * Print a configuration failure as a message rather than as a crash.
 *
 * Installed on import, and this is the deliberate side effect of a module that
 * would otherwise have none. `readConfig` is called while `db.ts` is still
 * being imported, which is before any entry point has had a chance to wrap
 * anything in a `try`. Without this, the most likely failure a deployment will
 * ever hit -- a missing environment variable -- arrives as an uncaught
 * exception with fifteen lines of Node module-loader stack under it, and the
 * six lines that say exactly what to fix scroll away.
 *
 * Only `ConfigError` is swallowed. Anything else keeps its stack, because
 * anything else is a bug rather than a message.
 */
if (typeof process !== 'undefined' && process.on) {
  process.on('uncaughtException', (err) => {
    if (err instanceof ConfigError) {
      console.error(`
${err.message}
`);
      process.exit(78); // EX_CONFIG, from sysexits.h.
    }
    throw err;
  });
}

interface Reader {
  /** A value with a development-only fallback. */
  secret(name: string, devFallback: string): string;
  /** A value that is merely configuration, not a credential. */
  plain(name: string, fallback: string): string;
  int(name: string, fallback: number): number;
}

/**
 * @param strict  treat a missing secret as an error even outside production.
 *                The maintenance scripts read config this way, so a job that
 *                forgot its credentials fails instead of reaching for the
 *                development defaults.
 */
function reader(problems: string[], strict = isProduction()): Reader {
  const production = strict;

  return {
    secret(name, devFallback) {
      const value = process.env[name];
      if (!value) {
        if (production) {
          problems.push(
            isProduction()
              ? `${name} is required in production and was not set.`
              : `${name} is required and was not set (NODE_ENV=development allows the local defaults).`
          );
          return '';
        }
        return devFallback;
      }
      if (production && DEV_SECRETS.has(value)) {
        // Naming the value is safe: these are the ones already published in
        // this repository, so the message reveals nothing that is not public,
        // and it is the fastest possible path to understanding the failure.
        problems.push(
          `${name} is set to the development default "${value}". Use a real secret in production.`
        );
      }
      return value;
    },

    plain(name, fallback) {
      return process.env[name] || fallback;
    },

    int(name, fallback) {
      const raw = process.env[name];
      if (!raw) return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        problems.push(`${name} must be a number, got "${raw}".`);
        return fallback;
      }
      return value;
    },
  };
}

export interface Config {
  production: boolean;
  port: number;
  /** `'*'` only ever in development; a list otherwise. */
  allowedOrigins: '*' | string[];
  /**
   * How this server is reached from a browser, used to build media URLs.
   *
   * Absolute because the URL is stored in the document and loaded by a page on
   * the *frontend's* origin, which is a different origin from this one. Empty
   * means "work it out from the request", which is right in development and
   * wrong behind a proxy that rewrites the path.
   */
  publicApiUrl: string;
  trustProxy: string | number | null;
  db: {
    /** A connection string (`DATABASE_URL`); when set it replaces the fields below. */
    url: string | null;
    user: string;
    password: string;
    host: string;
    port: number;
    database: string;
    poolMax: number;
    ssl: boolean;
  };
  s3: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
  /**
   * Shared Redis, or `null` for a single instance. `url` wins when set
   * (`redis://`, or `rediss://` for TLS), which is what managed providers hand
   * out; host/port/password/tls are the same thing spelled out.
   */
  redis: {
    url: string | null;
    host: string | null;
    port: number;
    password: string | null;
    tls: boolean;
  } | null;
  /** A shared token every client must present, or `null` for an open server. */
  authSecret: string | null;
  /** Signs invite links. Absent means invite links cannot be offered. */
  shareSecret: string | null;
  /**
   * Signs anonymous session tokens. Required in production. Development
   * without it uses a per-process key, so identities reset on restart there.
   */
  sessionSecret: string | null;
  /**
   * Guards the admin routes, and nothing else. Absent means they are closed.
   * Never shared with AUTH_SECRET, which the browser bundle carries.
   */
  adminSecret: string | null;
  /** When true, unsigned direct room-id connections are rejected. */
  enforceShareTokens: boolean;
  /**
   * The shortest room id this server will serve.
   *
   * The whole access model rests on a room id being unguessable, and the
   * validator accepted a **one character** id. Anybody could have enumerated
   * every board whose address was short enough to type by hand. New boards use
   * ten characters of nanoid; this floor is what stops a hand-edited URL
   * creating a board that is trivially found.
   */
  minRoomIdLength: number;
  /**
   * Storage quotas and ceilings to prevent open anonymous file hosting abuse.
   */
  quotas: {
    maxRoomBytes: number;
    maxIpDailyBytes: number;
    maxGlobalBytes: number;
  };
  /** Retention for inactive rooms before reaping. */
  roomTtlDays: number;
  /** Limits on the collaboration socket. */
  collab: {
    /** Largest single WebSocket frame accepted. A larger one closes the socket. */
    maxPayloadBytes: number;
    /** Largest encoded document a room may grow to; updates past it are refused. */
    maxDocumentBytes: number;
    /** Open sockets one client address may hold at once. */
    maxConnectionsPerIp: number;
    /** New rooms one address may open: a burst, then this many per minute. */
    roomCreateBurst: number;
    roomCreatePerMinute: number;
  };
  history: {
    flushIntervalMs: number;
    /** Bytes the Time Travel buffer may hold before dropping the oldest. */
    maxBytes: number;
  };
  /** Sentry DSN for server error tracking, or null if disabled. */
  sentryDsn: string | null;
}

function readDb(env: Reader, production: boolean): Config['db'] {
  const url = process.env.DATABASE_URL || null;
  const host = process.env.POSTGRES_HOST;
  return {
    url,
    // A connection string carries its own credentials.
    user: url ? env.plain('POSTGRES_USER', '') : env.secret('POSTGRES_USER', 'canva_user'),
    password: url ? env.plain('POSTGRES_PASSWORD', '') : env.secret('POSTGRES_PASSWORD', 'canva_password'),
    host: env.plain('POSTGRES_HOST', 'localhost'),
    port: env.int('POSTGRES_PORT', 5432),
    database: env.plain('POSTGRES_DB', 'vega_canva'),
    poolMax: env.int('DB_POOL_MAX', 20),
    ssl:
      process.env.POSTGRES_SSL === 'false'
        ? false
        : process.env.POSTGRES_SSL === 'true' ||
          production ||
          Boolean(url && /sslmode=(require|verify)/.test(url)) ||
          (host !== undefined && host !== 'localhost' && host !== '127.0.0.1'),
  };
}

function readS3(env: Reader): Config['s3'] {
  return {
    endpoint: env.plain('S3_ENDPOINT', 'http://localhost:9000'),
    bucket: env.plain('S3_BUCKET', 'vega-canva-media'),
    accessKey: env.secret('S3_ACCESS_KEY', 'canva_admin'),
    secretKey: env.secret('S3_SECRET_KEY', 'canva_password'),
  };
}

/**
 * What the maintenance scripts need: the database, object storage and the
 * retention period, and nothing about serving traffic.
 *
 * Strict unless `NODE_ENV=development` says otherwise, so a scheduled job
 * missing a credential fails rather than connecting to localhost with the
 * published development password.
 */
export function readMaintenanceConfig(): Pick<Config, 'db' | 's3' | 'roomTtlDays'> {
  const problems: string[] = [];
  const strict = process.env.NODE_ENV !== 'development';
  const env = reader(problems, strict);
  const result = {
    db: readDb(env, strict),
    s3: readS3(env),
    roomTtlDays: env.int('ROOM_TTL_DAYS', 90),
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return result;
}

/** The database alone, read as strictly as `readMaintenanceConfig`. */
export function readDatabaseConfig(): Config['db'] {
  const problems: string[] = [];
  const strict = process.env.NODE_ENV !== 'development';
  const db = readDb(reader(problems, strict), strict);
  if (problems.length > 0) throw new ConfigError(problems);
  return db;
}

export function readConfig(): Config {
  const problems: string[] = [];
  const env = reader(problems);
  const production = isProduction();

  const originList = process.env.ALLOWED_ORIGINS;
  let allowedOrigins: '*' | string[];
  if (originList) {
    allowedOrigins = originList.split(',').map((o) => o.trim()).filter(Boolean);
    if (allowedOrigins.length === 0) problems.push('ALLOWED_ORIGINS was set but empty.');
    /**
     * An entry that cannot be parsed is refused at startup rather than at
     * request time.
     *
     * The failure it prevents is the quiet one: an origin written without its
     * scheme (`app.example.com`) or as a bare `*` matches nothing, so the
     * deployment starts, looks configured, and refuses every request its own
     * frontend makes. Naming the entry here turns a confusing outage into a
     * boot message that says which line to fix.
     */
    for (const entry of allowedOrigins) {
      if (parseOriginRule(entry)) continue;
      problems.push(
        `ALLOWED_ORIGINS entry "${entry}" is not an origin. Write the scheme too — "https://app.example.com" — or "https://*.example.com" for preview deployments.`
      );
    }
  } else if (production) {
    problems.push(
      'ALLOWED_ORIGINS is required in production. A wildcard lets any site on the internet call this API with a visitor\u2019s browser.'
    );
    allowedOrigins = [];
  } else {
    allowedOrigins = '*';
  }

  const config: Config = {
    production,
    port: env.int('PORT', 3000),
    allowedOrigins,
    publicApiUrl: (process.env.PUBLIC_API_URL || '').replace(/\/+$/, ''),
    trustProxy: null,
    db: readDb(env, production),
    s3: readS3(env),
    redis:
      process.env.REDIS_URL || process.env.REDIS_HOST
        ? {
            url: process.env.REDIS_URL || null,
            host: process.env.REDIS_HOST || null,
            port: env.int('REDIS_PORT', 6379),
            password: process.env.REDIS_PASSWORD || null,
            tls: process.env.REDIS_TLS === 'true',
          }
        : null,
    authSecret: process.env.AUTH_SECRET || null,
    /**
     * Deliberately not defaulted and deliberately not derived from anything
     * else. A signing key generated at boot would invalidate every invite
     * link on each deploy; one derived from the database password would make
     * a credential rotation silently revoke people's access, which is a
     * surprise nobody would connect to the cause.
     *
     * Absent is a supported state: `SHARE_SECRET` unset means the share
     * dialog offers full-access links only and says why, rather than offering
     * a restriction it cannot enforce.
     */
    shareSecret: process.env.SHARE_SECRET || null,
    sessionSecret: process.env.SESSION_SECRET || null,
    adminSecret: process.env.ADMIN_SECRET || null,
    enforceShareTokens: process.env.ENFORCE_SHARE_TOKENS === 'true',
    minRoomIdLength: env.int('MIN_ROOM_ID_LENGTH', 8),
    quotas: {
      maxRoomBytes: env.int('MAX_ROOM_STORAGE_BYTES', 200 * 1024 * 1024), // 200MB
      maxIpDailyBytes: env.int('MAX_IP_DAILY_STORAGE_BYTES', 500 * 1024 * 1024), // 500MB
      maxGlobalBytes: env.int('MAX_GLOBAL_STORAGE_BYTES', 10 * 1024 * 1024 * 1024), // 10GB
    },
    roomTtlDays: env.int('ROOM_TTL_DAYS', 90),
    sentryDsn: process.env.SENTRY_DSN || null,
    collab: {
      maxPayloadBytes: env.int('WS_MAX_PAYLOAD_BYTES', 4 * 1024 * 1024),
      maxDocumentBytes: env.int('MAX_DOCUMENT_BYTES', 32 * 1024 * 1024),
      maxConnectionsPerIp: env.int('WS_MAX_CONNECTIONS_PER_IP', 32),
      roomCreateBurst: env.int('ROOM_CREATE_BURST', 30),
      roomCreatePerMinute: env.int('ROOM_CREATE_PER_MINUTE', 6),
    },
    history: {
      flushIntervalMs: env.int('HISTORY_FLUSH_MS', 1000),
      maxBytes: env.int('HISTORY_MAX_BYTES', 64 * 1024 * 1024),
    },
  };

  /**
   * Session tokens decide whose upload allowance is spent and who a socket
   * belongs to, so production signs them with a key of their own. Not derived
   * from SHARE_SECRET: rotating that key is how invite links are revoked, and
   * it must not also reset every visitor's identity.
   */
  if (production) {
    if (!config.sessionSecret) {
      problems.push('SESSION_SECRET is required in production. It signs anonymous visitor sessions.');
    } else if (config.sessionSecret.length < 32) {
      problems.push('SESSION_SECRET must be at least 32 characters.');
    } else if (config.sessionSecret === config.shareSecret || config.sessionSecret === config.authSecret) {
      problems.push('SESSION_SECRET must differ from SHARE_SECRET and AUTH_SECRET.');
    }
    if (config.adminSecret && config.adminSecret === config.authSecret) {
      problems.push('ADMIN_SECRET must differ from AUTH_SECRET, which the browser bundle carries.');
    }
  }
  if (config.collab.maxPayloadBytes > config.collab.maxDocumentBytes) {
    problems.push('WS_MAX_PAYLOAD_BYTES cannot exceed MAX_DOCUMENT_BYTES.');
  }

  if (process.env.TRUST_PROXY) {
    // A number is a hop count, which is what you want behind n known proxies;
    // anything else (an IP, a subnet, "loopback") is passed through as-is.
    const hops = Number(process.env.TRUST_PROXY);
    config.trustProxy = Number.isFinite(hops) ? hops : process.env.TRUST_PROXY;
  }

  if (production && !config.publicApiUrl) {
    problems.push(
      'PUBLIC_API_URL is required in production. Media URLs are stored in the document and must not depend on the Host header of whichever request happened to upload them.'
    );
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
