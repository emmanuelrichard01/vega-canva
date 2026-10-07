/**
 * What is being pointed at, shared between the Layers panel and the board.
 *
 * Hover a row (or move the tree's keyboard cursor) and the board outlines the
 * object; hover the object on the board and its row lights up. `source` says
 * which side the pointer is on, so each side shows the other's hover and not
 * its own: the board already draws its own hover, and a row needs no outline
 * of itself.
 *
 * Transient: what one person points at is nobody else's business and never
 * belongs in the document or the undo history.
 */

export interface LayerHoverState {
  ids: readonly string[];
  source: 'panel' | 'canvas';
}

type Listener = () => void;

const listeners = new Set<Listener>();
let state: LayerHoverState | null = null;

function same(a: LayerHoverState | null, b: LayerHoverState | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.source !== b.source || a.ids.length !== b.ids.length) return false;
  return a.ids.every((id, i) => id === b.ids[i]);
}

function publish(next: LayerHoverState | null): void {
  if (same(state, next)) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export const layerHover = {
  /** The panel points at one object, several (a group), or nothing. */
  set(ids: string | readonly string[] | null): void {
    const list = ids === null ? [] : typeof ids === 'string' ? [ids] : ids;
    publish(list.length > 0 ? { ids: list, source: 'panel' } : null);
  },
  /** The board points at an object, or at nothing. Clears only its own hover. */
  setFromCanvas(id: string | null): void {
    if (id) publish({ ids: [id], source: 'canvas' });
    else if (state?.source === 'canvas') publish(null);
  },
  /** Clear whatever the panel was pointing at, leaving a board hover alone. */
  clearPanel(): void {
    if (state?.source === 'panel') publish(null);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): LayerHoverState | null {
    return state;
  },
};
