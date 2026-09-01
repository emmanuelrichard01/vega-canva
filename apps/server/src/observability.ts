/**
 * Server observability: structured logs, and error tracking that is real.
 *
 * Structured JSON in production so Render's log drain can parse it; readable
 * console output in development.
 *
 * ## The stub this replaced
 *
 * `initServerObservability` used to be:
 *
 * ```
 * if (sentryDsn) {
 *   logger.info('Sentry error tracking enabled for server');
 *   // If Sentry Node SDK is installed in production, it initializes here.
 * }
 * ```
 *
 * No SDK was installed, so setting `SENTRY_DSN` printed a line saying error
 * tracking was on and then reported nothing, forever. A deployment that is
 * silently blind is worse than one that is loudly blind, because the log line
 * is exactly the evidence somebody would check.
 *
 * `initSentry` below is therefore allowed to be noisy about failing, and the
 * readiness payload reports whether it actually came up rather than whether
 * a DSN was set.
 */
import * as Sentry from '@sentry/node';

export interface LogMeta {
  [key: string]: unknown;
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    if (process.env.NODE_ENV === 'production') {
      console.log(JSON.stringify({ level: 'info', message, timestamp: new Date().toISOString(), ...meta }));
    } else {
      console.log(`[INFO] ${message}`, meta ? meta : '');
    }
  },

  warn(message: string, meta?: LogMeta): void {
    if (process.env.NODE_ENV === 'production') {
      console.warn(JSON.stringify({ level: 'warn', message, timestamp: new Date().toISOString(), ...meta }));
    } else {
      console.warn(`[WARN] ${message}`, meta ? meta : '');
    }
  },

  error(message: string, error?: unknown, meta?: LogMeta): void {
    const errorDetails =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : { error };

    if (process.env.NODE_ENV === 'production') {
      console.error(
        JSON.stringify({
          level: 'error',
          message,
          timestamp: new Date().toISOString(),
          ...errorDetails,
          ...meta,
        })
      );
    } else {
      console.error(`[ERROR] ${message}`, error ?? '', meta ? meta : '');
    }
  },
};

let sentryReady = false;

/** Whether error tracking is actually running, for `/readyz` to report. */
export function isErrorTrackingActive(): boolean {
  return sentryReady;
}

/**
 * Initialises error tracking and the process-level safety nets.
 */
export function initServerObservability(sentryDsn: string | null): void {
  if (sentryDsn) {
    try {
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV ?? 'development',
        // Render sets this on every deploy; without it every release looks
        // like the same one and a regression cannot be bisected.
        release: process.env.RENDER_GIT_COMMIT || undefined,
        // Traces are the expensive part of the free tier and this server's
        // hot path is a WebSocket, which is not what tracing is good at.
        // Errors are the whole point here; sampling can be raised later.
        tracesSampleRate: 0,
      });
      sentryReady = true;
      logger.info('Sentry error tracking initialised', {
        release: process.env.RENDER_GIT_COMMIT ?? null,
      });
    } catch (err) {
      // Never fatal: an observability failure must not take the server with
      // it. But it says so, because the previous version's whole problem was
      // being quiet about not working.
      logger.error('Sentry failed to initialise; the server is running without error tracking', err);
    }
  } else {
    logger.warn('SENTRY_DSN is not set: this server is running without error tracking');
  }

  /**
   * Node's default for an unhandled rejection is to crash. Logging and
   * carrying on is the deliberate choice for a collaboration server -- a
   * rejected promise in one room's persistence should not disconnect every
   * other room -- but it does mean the process can continue in a state nobody
   * reasoned about, so it is reported at error level and sent onward.
   */
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled Promise Rejection caught at process root', reason);
    if (sentryReady) Sentry.captureException(reason);
  });

  /**
   * Uncaught exceptions are deliberately *not* handled here. `config.ts`
   * already registers a listener that exits 78 for a ConfigError and rethrows
   * everything else -- and a throw inside an uncaughtException listener ends
   * the process, so a second listener registered after it would never run. It
   * would read as coverage while being unreachable, which is the same failure
   * as the stub this function replaced.
   *
   * Sentry's own `onUncaughtException` integration is installed by `init` and
   * catches them ahead of both.
   */
}

/** Report an error to tracking as well as to the log. */
export function captureError(message: string, error: unknown, meta?: LogMeta): void {
  logger.error(message, error, meta);
  if (sentryReady) {
    Sentry.captureException(error, meta ? { extra: meta } : undefined);
  }
}
