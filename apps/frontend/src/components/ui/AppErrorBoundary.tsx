import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportClientError } from '../../utils/observability';
import { isChunkLoadError } from './chunkError';

/**
 * The floor under the whole app.
 *
 * Panels and dialogs have their own `FeatureBoundary`, so what reaches this
 * one is a failure of the board or the page itself. Without it a throw
 * unmounts the entire tree and leaves a white page, and on a collaborative
 * board the natural reading of a blank page is "my work is gone".
 *
 * It is not gone. Every board lives in the CRDT document, mirrored to
 * IndexedDB and synced to the server; a render failure touches none of that.
 * So this screen says so first, then offers the one action that almost always
 * works — reload — and the one that always works — go back to the library.
 *
 * Styled with the design tokens directly rather than the app's component
 * classes: whatever threw may be the stylesheet's own markup, and the screen
 * that reports a failure must not depend on the thing that failed.
 */
interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, { context: 'render', extra: { componentStack: info.componentStack } });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const onBoard = window.location.pathname.startsWith('/room/') || window.location.pathname.startsWith('/i/');
    // After a deploy an open tab asks for chunks that no longer exist. That is
    // a new version waiting, not a fault, and reloading always fixes it.
    const stale = isChunkLoadError(this.state.error);
    const heading = stale
      ? 'A new version of Vega is available'
      : onBoard
        ? 'This board hit a problem drawing itself'
        : 'Something went wrong';
    const detail = stale
      ? 'Reload to load it. Your work is safe: boards are saved on this device and on the server as you go.'
      : onBoard
        ? 'Your work is safe — boards are saved on this device and on the server as you go, and nothing was lost when this screen appeared. Reloading usually brings the board straight back.'
        : 'Nothing you made was lost. Reloading usually fixes it.';

    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--surface-canvas, #F9FAFB)',
          color: 'var(--text-primary, #111827)',
          fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
        }}
      >
        <div role="alert" style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
            {heading}
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-secondary, #4B5563)', margin: '0 0 20px' }}>
            {detail}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 38,
                padding: '0 16px',
                borderRadius: 'var(--radius-lg, 8px)',
                border: 'none',
                background: 'var(--accent, #F3A024)',
                color: 'var(--accent-on, #161616)',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            {onBoard && (
              <a
                href="/"
                style={{
                  height: 38,
                  padding: '0 16px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 'var(--radius-lg, 8px)',
                  border: '1px solid var(--border-strong, #D1D5DB)',
                  color: 'var(--text-secondary, #4B5563)',
                  fontSize: 14,
                  textDecoration: 'none',
                }}
              >
                Back to your boards
              </a>
            )}
          </div>
        </div>
      </main>
    );
  }
}
