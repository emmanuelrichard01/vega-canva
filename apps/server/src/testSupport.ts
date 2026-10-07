import type { Config } from './config';

/**
 * Shared fixtures for the server tests. Not imported by anything that ships.
 */

/** A complete development config, with overrides. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = {
    production: false,
    port: 0,
    allowedOrigins: '*',
    publicApiUrl: 'http://api.test',
    trustProxy: null,
    db: { url: null, user: 'u', password: 'p', host: 'localhost', port: 5432, database: 'd', poolMax: 1, ssl: false },
    s3: { endpoint: 'http://s3.test', bucket: 'bucket', accessKey: 'a', secretKey: 's' },
    redis: null,
    authSecret: null,
    shareSecret: 'share-secret-for-tests',
    sessionSecret: 'session-secret-for-tests-0123456789',
    adminSecret: 'admin-secret-for-tests',
    enforceShareTokens: false,
    minRoomIdLength: 8,
    quotas: { maxRoomBytes: 200 * 1024 * 1024, maxIpDailyBytes: 500 * 1024 * 1024, maxGlobalBytes: 10 * 1024 ** 3 },
    roomTtlDays: 90,
    sentryDsn: null,
    collab: {
      maxPayloadBytes: 4 * 1024 * 1024,
      maxDocumentBytes: 32 * 1024 * 1024,
      maxConnectionsPerIp: 32,
      roomCreateBurst: 30,
      roomCreatePerMinute: 6,
    },
    history: { flushIntervalMs: 1000, maxBytes: 64 * 1024 * 1024 },
  };
  return {
    ...base,
    ...overrides,
    collab: { ...base.collab, ...overrides.collab },
    quotas: { ...base.quotas, ...overrides.quotas },
  };
}

export interface FakeQuery {
  sql: string;
  params: unknown[];
}

/**
 * A pool that answers by matching SQL text. `handlers` are tried in order;
 * anything unmatched returns no rows. Every query is recorded.
 */
export function fakePool(handlers: Array<[RegExp, (params: unknown[]) => any]> = []) {
  const queries: FakeQuery[] = [];
  return {
    queries,
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      for (const [pattern, handler] of handlers) {
        if (pattern.test(sql)) return (await handler(params)) ?? { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
