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

function reader(problems: string[]): Reader {
  const production = isProduction();

  return {
    secret(name, devFallback) {
      const value = process.env[name];
      if (!value) {
        if (production) {
          problems.push(`${name} is required in production and was not set.`);
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
    user: string;
    password: string;
    host: string;
    port: number;
    database: string;
    poolMax: number;
  };
  s3: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
  redisHost: string | null;
  redisPort: number;
  /** A shared token every client must present, or `null` for an open server. */
  authSecret: string | null;
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
    db: {
      user: env.secret('POSTGRES_USER', 'canva_user'),
      password: env.secret('POSTGRES_PASSWORD', 'canva_password'),
      host: env.plain('POSTGRES_HOST', 'localhost'),
      port: env.int('POSTGRES_PORT', 5432),
      database: env.plain('POSTGRES_DB', 'vega_canva'),
      poolMax: env.int('DB_POOL_MAX', 20),
    },
    s3: {
      endpoint: env.plain('S3_ENDPOINT', 'http://localhost:9000'),
      bucket: env.plain('S3_BUCKET', 'vega-canva-media'),
      accessKey: env.secret('S3_ACCESS_KEY', 'canva_admin'),
      secretKey: env.secret('S3_SECRET_KEY', 'canva_password'),
    },
    redisHost: process.env.REDIS_HOST || null,
    redisPort: env.int('REDIS_PORT', 6379),
    authSecret: process.env.AUTH_SECRET || null,
    minRoomIdLength: env.int('MIN_ROOM_ID_LENGTH', 8),
  };

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
