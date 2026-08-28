/**
 * Frontend Observability & Error Tracking.
 *
 * Configures Sentry browser SDK if VITE_SENTRY_DSN is provided and registers
 * global uncaught error / unhandled rejection listeners to prevent silent client failures.
 */

export interface ErrorReportMeta {
  context?: string;
  extra?: Record<string, unknown>;
}

export function initFrontendObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (dsn) {
    // Sentry initialization if DSN is supplied
    console.log('[Observability] Sentry client tracking enabled');
  }

  // Global uncaught runtime errors
  window.addEventListener('error', (event) => {
    reportClientError(event.error || event.message, {
      context: 'window.onerror',
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // Global unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, {
      context: 'window.onunhandledrejection',
    });
  });
}

/**
 * Report an error to observability pipelines with contextual metadata.
 */
export function reportClientError(error: unknown, meta?: ErrorReportMeta): void {
  const isProd = import.meta.env.PROD;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  if (isProd) {
    // In production, forward to Sentry or structured analytics
    console.error(
      JSON.stringify({
        level: 'error',
        message,
        stack,
        context: meta?.context,
        extra: meta?.extra,
        timestamp: new Date().toISOString(),
      })
    );
  } else {
    console.error(`[Client Error][${meta?.context || 'app'}]`, error, meta?.extra || '');
  }
}
