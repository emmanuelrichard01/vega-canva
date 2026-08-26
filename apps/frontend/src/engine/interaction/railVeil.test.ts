import { beforeEach, describe, expect, it } from 'vitest';
import { railVeil } from './railVeil';

describe('railVeil', () => {
  beforeEach(() => railVeil.end());

  it('starts down', () => {
    expect(railVeil.held).toBe(false);
  });

  it('hides for a gesture and comes back when it ends', () => {
    railVeil.begin();
    expect(railVeil.held).toBe(true);
    railVeil.end();
    expect(railVeil.held).toBe(false);
  });

  it('recovers from a gesture that never said it ended', () => {
    /**
     * The bug this exists for. Konva does not fire `dragend` for a node
     * destroyed mid-drag, and every handle that dispatches these events is
     * conditionally rendered -- so a selection change during a handle drag
     * ends the gesture with no event, and the rail stayed hidden for the life
     * of the page. Reloading was the only way to get it back.
     */
    railVeil.begin();
    expect(railVeil.settle(null)).toBe(true);
    expect(railVeil.held).toBe(false);
  });

  it('keeps hiding while text is being edited', () => {
    // The one gesture that outlives the click that began it: the rail anchors
    // to committed bounds, and a growing text box would slide out from under
    // it for the whole edit.
    railVeil.begin();
    expect(railVeil.settle('node-1')).toBe(false);
    expect(railVeil.held).toBe(true);
  });

  it('reports nothing to do when the veil is already down', () => {
    // So an ordinary click does not cost a reposition.
    expect(railVeil.settle(null)).toBe(false);
  });

  it('does not count overlapping gestures', () => {
    /**
     * Reference counting would make a missing `end` worse: a permanent surplus
     * that no later release can clear, rather than a boolean `settle` can.
     * The overlap it would protect against -- a drag inside an edit -- is
     * handled by `settle` consulting the editor instead.
     */
    railVeil.begin();
    railVeil.begin();
    railVeil.end();
    expect(railVeil.held).toBe(false);
  });
});
