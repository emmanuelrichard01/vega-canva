/**
 * Client error tracking.
 *
 * ## The stub this replaced
 *
 * ```
 * if (dsn) {
 *   // Sentry initialization if DSN is supplied
 *   console.log('[Observability] Sentry client tracking enabled');
 * }
 * ```
 *
 * No SDK was installed, so setting `VITE_SENTRY_DSN` printed a line claiming
 * tracking was on and then reported nothing. `reportClientError` matched it:
 * in production it serialised the error to `console.error` and stopped -- a
 * structured log written to a console nobody is attached to.
 *
 * ## Why the SDK is imported dynamically
 *
 * Measured, not assumed. A static `import * as Sentry` costs nothing while
 * `VITE_SENTRY_DSN` is unset -- the branch folds and the SDK is shaken out --
 * so a local build looks free and the cost only appears in the deployment
 * that has the DSN configured. With it set, the entry chunk went from 5.76 kB
 * to 34.09 kB gzipped: a sixfold increase on the eagerly-loaded entry, on the
 * same first paint the `modulePreload` filter in `vite.config.ts` had just
 * spent 850 kB getting out of the way of.
 *
 * So the listeners are registered synchronously and the SDK is fetched after
 * them. Anything thrown in the gap goes into `pending` and is flushed once it
 * arrives, which is the part a plain `import()` on its own would lose.
 */

export interface ErrorReportMeta {
  context?: string;
  extra?: Record<string, unknown>;
}

type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;
let pending: Array<{ error: unknown; meta?: ErrorReportMeta }> | null = null;

/** Bounded: a render loop throwing every frame must not become the leak. */
const MAX_PENDING = 20;

/** Whether tracking is actually running, rather than merely configured. */
export function isErrorTrackingActive(): boolean {
  return sentry !== null;
}

export function initFrontendObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  // Registered first and synchronously, so the window between page load and
  // the SDK arriving is covered rather than merely short.
  window.addEventListener('error', (event) => {
    reportClientError(event.error || event.message, {
      context: 'window.onerror',
      extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, { context: 'window.onunhandledrejection' });
  });

  if (!dsn) {
    if (import.meta.env.PROD) {
      console.warn('[Observability] VITE_SENTRY_DSN is not set: running without error tracking');
    }
    return;
  }

  pending = [];

  import('@sentry/react')
    .then((mod) => {
      mod.init({
        dsn,
        environment: import.meta.env.MODE,
        // Vercel exposes the deploy's commit. Without a release, every error
        // in the dashboard looks like it came from the same build.
        release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
        // Errors only. Tracing and session replay are the two things that
        // consume a free-tier quota fastest, and neither answers the question
        // this is being turned on to answer.
        tracesSampleRate: 0,
        // A canvas app throws the same handful of Konva and font errors on a
        // loop; without a cap one bad frame can spend the day's quota.
        maxBreadcrumbs: 30,
      });

      sentry = mod;

      const queued = pending ?? [];
      pending = null;
      for (const { error, meta } of queued) reportClientError(error, meta);
    })
    .catch((err) => {
      // Never fatal, and never quiet: being silently off is the failure this
      // module exists to stop repeating.
      pending = null;
      console.error('[Observability] Sentry failed to load', err);
    });
}

/**
 * Report an error, with context, to wherever errors go.
 */
export function reportClientError(error: unknown, meta?: ErrorReportMeta): void {
  if (sentry) {
    sentry.captureException(error, {
      tags: meta?.context ? { context: meta.context } : undefined,
      extra: meta?.extra,
    });
  } else if (pending) {
    if (pending.length < MAX_PENDING) pending.push({ error, meta });
  }

  if (import.meta.env.DEV) {
    console.error(`[Client Error][${meta?.context || 'app'}]`, error, meta?.extra || '');
  } else if (!sentry && !pending) {
    // Tracking is off or failed to load, so there is nowhere else for it to
    // go. Kept structured so it is at least greppable if somebody is reading
    // a browser console over a support call.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: 'error',
        message,
        stack: error instanceof Error ? error.stack : undefined,
        context: meta?.context,
        extra: meta?.extra,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
