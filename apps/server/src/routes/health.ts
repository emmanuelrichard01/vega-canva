import type { Express } from 'express';
import { isErrorTrackingActive } from '../observability';

export interface HealthProbe {
  /** Schema applied and a round trip to the database succeeds. */
  databaseReady(): Promise<boolean>;
  /** Shutdown has begun: take this instance out of rotation. */
  draining(): boolean;
  historyDepth(): number;
  historyDropped(): number;
}

export function registerHealthRoutes(app: Express, probe: HealthProbe): void {
  /**
   * Liveness: is the process running. Deliberately checks nothing else: a
   * liveness probe that touches the database turns a database hiccup into a
   * restart loop.
   */
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  /**
   * Readiness: should this instance get traffic. False while draining, so a
   * load balancer stops sending new connections to an instance on its way
   * out, and false when the database is unreachable. One `SELECT 1`; storage
   * totals live behind the admin credential at `/admin/stats`.
   */
  app.get('/readyz', async (_req, res) => {
    if (probe.draining()) {
      res.status(503).json({ status: 'draining' });
      return;
    }
    const database = await probe.databaseReady();
    res.status(database ? 200 : 503).json({
      status: database ? 'ready' : 'not-ready',
      database,
      historyQueue: probe.historyDepth(),
      historyDropped: probe.historyDropped(),
      // Whether error tracking actually came up, not whether a DSN was set.
      errorTracking: isErrorTrackingActive(),
    });
  });
}
