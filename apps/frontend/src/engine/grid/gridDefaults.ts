import { defaultSpec, type GridSpec } from './gridLayout';
import { defaultStyle, type GridStyle } from './gridStyle';
import type { GridRecipe } from './gridBuild';

/**
 * What the next grid will look like before you have drawn it.
 *
 * ## Why this is remembered, and why it is not in the document
 *
 * A generator that resets to three grey squares on every use is one you
 * configure once per grid — which means the second grid on a board costs as
 * much as the first, and the tool's whole value is that it should not.
 *
 * It is deliberately *not* in the CRDT. "The settings I last used" is a fact
 * about a person, not about the board: syncing it would mean a collaborator
 * tuning a bento wall silently changes what your next drag produces. Same rule
 * the frame-collapse set and the tag filter follow.
 *
 * Not in `localStorage` either. A default carried across sessions is a default
 * nobody remembers choosing, and the first grid of a new session arriving as
 * whatever you were experimenting with a week ago is worse than a clean start.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let spec: Omit<GridSpec, 'x' | 'y' | 'width' | 'height'> = (() => {
  const { x: _x, y: _y, width: _w, height: _h, ...rest } = defaultSpec({ x: 0, y: 0, width: 0, height: 0 });
  return rest;
})();
let style: GridStyle = defaultStyle();

function emit() {
  listeners.forEach((fn) => fn());
}

export const gridDefaults = {
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** The remembered settings, fitted to a box. */
  forBox(box: { x: number; y: number; width: number; height: number }): GridRecipe {
    return { spec: { ...spec, ...box }, style };
  },

  /**
   * Carry a recipe forward, minus its box.
   *
   * The box is the one part that must *not* persist: the next grid goes where
   * the next drag goes, and remembering the last one's dimensions would make
   * the drag ornamental.
   */
  remember(recipe: GridRecipe) {
    const { x: _x, y: _y, width: _w, height: _h, ...rest } = recipe.spec;
    spec = rest;
    style = recipe.style;
    emit();
  },

  getSnapshot: () => ({ spec, style }),
};
