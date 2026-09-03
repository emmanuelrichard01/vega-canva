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

describe('the veil knows a move from a resize', () => {
  beforeEach(() => railVeil.end());

  it('reports moving only for a move', () => {
    /**
     * The distinction the selection chrome turns on. A resize is also a
     * gesture, and its handles must stay: one of them is what the pointer is
     * holding, so hiding it mid-drag would hide the control being used.
     */
    railVeil.begin('move');
    expect(railVeil.moving).toBe(true);

    railVeil.begin('gesture');
    expect(railVeil.held).toBe(true);
    expect(railVeil.moving).toBe(false);
  });

  it('defaults to the unnamed kind', () => {
    // Five of the six senders never say what they are, and they are all the
    // "keep the handles" case.
    railVeil.begin();
    expect(railVeil.moving).toBe(false);
  });

  it('is never moving while nothing is held', () => {
    // So a reader checks one thing rather than two.
    expect(railVeil.moving).toBe(false);
    railVeil.begin('move');
    railVeil.end();
    expect(railVeil.moving).toBe(false);
  });

  it('clears the kind on settle, not just the flag', () => {
    /**
     * The reason the kind lives on this state rather than in a flag beside it:
     * `settle` is the floor under every gesture that ends without saying so,
     * and a separate `moving` boolean would need its own — which is the bug
     * this module was written to fix, recreated one field over.
     */
    railVeil.begin('move');
    railVeil.settle(null);
    expect(railVeil.moving).toBe(false);
    expect(railVeil.held).toBe(false);
  });

  it('leaves a move held while something is being typed into', () => {
    railVeil.begin('move');
    expect(railVeil.settle('node-1')).toBe(false);
    expect(railVeil.moving).toBe(true);
  });

  it('tells subscribers when only the kind changed', () => {
    // A drag beginning inside an open text edit does not change `held`, and a
    // subscriber reading the kind still needs waking.
    railVeil.begin('gesture');
    let calls = 0;
    const off = railVeil.subscribe(() => { calls += 1; });
    railVeil.begin('move');
    off();
    expect(calls).toBe(1);
  });
});
