/**
 * View preferences for comments, shared by the canvas pins and the inbox.
 *
 * There were two controls for one idea: a floating "Show Resolved" button
 * pinned to the canvas, and a Resolved filter in the inbox — which then
 * collided on screen, because both wanted the bottom-right corner. They are
 * the same preference and there is now one of it.
 *
 * A store rather than React state because the two surfaces live on opposite
 * sides of the Room/Canvas boundary, and a preference that disagrees with
 * itself between them is worse than no preference at all.
 */

const KEY = 'vega_comments_show_resolved';

class CommentViewStore {
  private showResolved = false;
  private listeners = new Set<() => void>();

  constructor() {
    try {
      this.showResolved = localStorage.getItem(KEY) === '1';
    } catch {
      /* private mode; the default is fine */
    }
  }

  getSnapshot = (): boolean => this.showResolved;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setShowResolved(next: boolean) {
    if (this.showResolved === next) return;
    this.showResolved = next;
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.listeners.forEach((fn) => fn());
  }

  toggle() {
    this.setShowResolved(!this.showResolved);
  }
}

export const commentView = new CommentViewStore();
