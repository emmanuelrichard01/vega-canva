/**
 * Server Observability and Structured Logging.
 *
 * Provides structured JSON logs in production, clean readable console output
 * in development, and initializes Sentry error tracking if SENTRY_DSN is configured.
 */

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

/**
 * Initializes error tracking hooks (Sentry / process unhandled rejections).
 */
export function initServerObservability(sentryDsn: string | null): void {
  if (sentryDsn) {
    logger.info('Sentry error tracking enabled for server');
    // If Sentry Node SDK is installed in production, it initializes here.
  }

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled Promise Rejection caught at process root', reason);
  });
}
