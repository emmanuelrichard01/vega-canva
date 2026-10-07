import type { Server as HttpServer } from 'http';
import type { WebSocketServer } from 'ws';
import { captureError, logger } from './observability';

export interface ShutdownDeps {
  httpServer: HttpServer;
  wss: WebSocketServer | null;
  /** Stores every open document. */
  flushDocuments: () => Promise<void>;
  /** Writes buffered Time Travel history. */
  drainHistory: () => Promise<void>;
  /** Everything else to close, in order, after the writes above (the pool last). */
  closers: Array<() => Promise<unknown>>;
  /** Called first, so `/readyz` starts answering 503. */
  onDraining: () => void;
  /** How long the whole shutdown may take before the process is forced out. */
  forceAfterMs?: number;
  exit?: (code: number) => void;
}

/**
 * Graceful shutdown: stop taking traffic, store every open board, write the
 * buffered history, close the pool, exit.
 *
 * The forced exit is armed before any of that starts, so a hung store or a
 * pool that will not drain cannot keep the process alive. A second signal
 * exits at once: whoever sent it has run out of patience.
 */
export function createShutdown(deps: ShutdownDeps) {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  let started = false;

  return async function shutdown(signal: string): Promise<void> {
    if (started) {
      logger.warn(`Received ${signal} during shutdown; exiting now`);
      exit(1);
      return;
    }
    started = true;
    logger.info(`Received ${signal}; starting graceful shutdown`);
    deps.onDraining();

    const force = setTimeout(() => {
      logger.error('Shutdown did not finish in time; forcing exit');
      exit(1);
    }, deps.forceAfterMs ?? 15_000);
    force.unref?.();

    // 1001 "going away": clients flush and reconnect promptly to whichever
    // instance replaces this one, rather than treating a deploy as a fault.
    if (deps.wss) {
      for (const client of deps.wss.clients) client.close(1001, 'Server shutting down');
      deps.wss.close();
    }
    // Stops accepting new requests; the callback waits for open ones.
    deps.httpServer.close();

    let code = 0;
    try {
      await deps.flushDocuments();
      await deps.drainHistory();
      for (const close of deps.closers) await close();
      logger.info('Shutdown complete');
    } catch (err) {
      captureError('Error during shutdown', err);
      code = 1;
    }
    clearTimeout(force);
    exit(code);
  };
}
