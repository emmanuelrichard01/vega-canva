import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportClientError } from '../../utils/observability';
import { isChunkLoadError } from './chunkError';

interface FeatureBoundaryProps {
  /** Named in the report, so a crash says which panel it came from. */
  name: string;
  /**
   * `panel` replaces the failed part in place; `modal` shows a small dialog
   * that can be dismissed with `onClose`; `silent` draws nothing, for
   * floating chrome (the context rail) where a card would land on the work.
   * Every variant reports the error.
   */
  variant?: 'panel' | 'modal' | 'silent';
  /** Any change clears the error and tries again (a new selection, a reopen). */
  resetKey?: unknown;
  onClose?: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains a crash to the feature that threw.
 *
 * The root `AppErrorBoundary` is the floor, but it replaces the whole board:
 * one malformed chart in the properties panel, or a dialog chunk that 404s
 * after a deploy, would otherwise take the canvas with it. The board is the
 * part people are working on, so a failed panel or dialog is replaced on its
 * own and everything else keeps running.
 */
export class FeatureBoundary extends Component<FeatureBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, {
      context: 'render',
      extra: { feature: this.props.name, componentStack: info.componentStack },
    });
  }

  componentDidUpdate(prev: FeatureBoundaryProps) {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.variant === 'silent') return null;

    const stale = isChunkLoadError(error);
    const title = stale ? 'A new version of Vega is available' : `The ${this.props.name} hit a problem`;
    const body = stale
      ? 'Reload to finish opening this. Your boards are saved.'
      : 'The rest of the board is fine and nothing was lost.';

    const actions = (
      <div className="feature-fallback__actions">
        {stale ? (
          <button type="button" className="feature-fallback__button" onClick={() => window.location.reload()}>
            Reload
          </button>
        ) : (
          <button type="button" className="feature-fallback__button" onClick={this.retry}>
            Try again
          </button>
        )}
        {this.props.onClose && (
          <button type="button" className="feature-fallback__button feature-fallback__button--quiet" onClick={this.props.onClose}>
            Close
          </button>
        )}
      </div>
    );

    if (this.props.variant === 'modal') {
      return (
        <div className="feature-fallback__scrim">
          <div className="feature-fallback feature-fallback--modal" role="alertdialog" aria-modal="true" aria-label={title}>
            <p className="feature-fallback__title">{title}</p>
            <p className="feature-fallback__body">{body}</p>
            {actions}
          </div>
        </div>
      );
    }

    return (
      <div className="feature-fallback" role="alert">
        <p className="feature-fallback__title">{title}</p>
        <p className="feature-fallback__body">{body}</p>
        {actions}
      </div>
    );
  }
}
