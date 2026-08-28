import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readConfig } from './config';

/**
 * These are the tests for "the server must not boot on a published password".
 *
 * The failure they exist to prevent is silent by nature: a missing environment
 * variable used to produce a *working* server on credentials committed to this
 * repository, so nothing anywhere reported a problem.
 */

const KEYS = [
  'NODE_ENV', 'PORT', 'ALLOWED_ORIGINS', 'PUBLIC_API_URL', 'TRUST_PROXY',
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_PORT',
  'POSTGRES_DB', 'DB_POOL_MAX', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY',
  'S3_SECRET_KEY', 'REDIS_HOST', 'REDIS_PORT', 'AUTH_SECRET',
  'MIN_ROOM_ID_LENGTH', 'MAX_ROOM_STORAGE_BYTES', 'MAX_IP_DAILY_STORAGE_BYTES',
  'MAX_GLOBAL_STORAGE_BYTES', 'ROOM_TTL_DAYS', 'SENTRY_DSN',
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** A complete, valid production environment, which individual tests spoil. */
function validProduction() {
  process.env.NODE_ENV = 'production';
  process.env.POSTGRES_USER = 'vega';
  process.env.POSTGRES_PASSWORD = 'a-real-secret-value';
  process.env.S3_ACCESS_KEY = 'a-real-access-key';
  process.env.S3_SECRET_KEY = 'another-real-secret';
  process.env.ALLOWED_ORIGINS = 'https://app.example.com';
  process.env.PUBLIC_API_URL = 'https://api.example.com';
}

describe('development', () => {
  it('starts with convenient defaults and a wildcard origin', () => {
    const config = readConfig();

    expect(config.production).toBe(false);
    expect(config.db.password).toBe('canva_password');
    expect(config.allowedOrigins).toBe('*');
    expect(config.quotas.maxRoomBytes).toBe(200 * 1024 * 1024);
    expect(config.quotas.maxIpDailyBytes).toBe(500 * 1024 * 1024);
    expect(config.quotas.maxGlobalBytes).toBe(10 * 1024 * 1024 * 1024);
    expect(config.roomTtlDays).toBe(90);
    expect(config.sentryDsn).toBeNull();
  });
});

describe('production', () => {
  it('accepts a complete environment', () => {
    validProduction();
    const config = readConfig();

    expect(config.production).toBe(true);
    expect(config.allowedOrigins).toEqual(['https://app.example.com']);
    expect(config.publicApiUrl).toBe('https://api.example.com');
    // The floor that keeps the capability model honest.
    expect(config.minRoomIdLength).toBe(8);
  });

  it('refuses to start when a secret is missing', () => {
    validProduction();
    delete process.env.POSTGRES_PASSWORD;

    expect(() => readConfig()).toThrow(/POSTGRES_PASSWORD is required/);
  });

  it('refuses the development credentials committed to this repository', () => {
    // The whole point. Without this, a deploy that forgets one variable comes
    // up healthy on a password anybody can read on GitHub.
    validProduction();
    process.env.S3_SECRET_KEY = 'canva_password';

    expect(() => readConfig()).toThrow(/development default/);
  });

  it('refuses a wildcard CORS origin', () => {
    validProduction();
    delete process.env.ALLOWED_ORIGINS;

    expect(() => readConfig()).toThrow(/ALLOWED_ORIGINS is required/);
  });

  it('requires the public API URL, because it is written into documents', () => {
    validProduction();
    delete process.env.PUBLIC_API_URL;

    expect(() => readConfig()).toThrow(/PUBLIC_API_URL is required/);
  });

  it('reports every problem at once rather than one per restart', () => {
    process.env.NODE_ENV = 'production';

    let message = '';
    try {
      readConfig();
    } catch (err) {
      message = (err as Error).message;
    }

    // Four secrets, the origins and the API URL. Finding them one deploy at a
    // time is how a ten-minute fix becomes an afternoon.
    for (const expected of [
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'ALLOWED_ORIGINS',
      'PUBLIC_API_URL',
    ]) {
      expect(message, expected).toContain(expected);
    }
  });

  it('trims a trailing slash off the API URL so media URLs do not double up', () => {
    validProduction();
    process.env.PUBLIC_API_URL = 'https://api.example.com///';

    expect(readConfig().publicApiUrl).toBe('https://api.example.com');
  });

  it('splits and trims a list of origins', () => {
    validProduction();
    process.env.ALLOWED_ORIGINS = ' https://a.example.com , https://b.example.com ';

    expect(readConfig().allowedOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('rejects a non-numeric number rather than silently using a default', () => {
    validProduction();
    process.env.PORT = 'not-a-port';

    expect(() => readConfig()).toThrow(/PORT must be a number/);
  });
});

describe('trust proxy', () => {
  it('is off unless the deployment says otherwise', () => {
    // Enabling it without a proxy in front lets any client forge
    // X-Forwarded-For and opt out of rate limiting entirely.
    expect(readConfig().trustProxy).toBeNull();
  });

  it('reads a hop count as a number and anything else as a literal', () => {
    process.env.TRUST_PROXY = '2';
    expect(readConfig().trustProxy).toBe(2);

    process.env.TRUST_PROXY = 'loopback';
    expect(readConfig().trustProxy).toBe('loopback');
  });
});
