import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME,
  FRAME_PRESETS,
  MIN_FRAME_SIZE,
  centreIsInside,
  descendantsOfFrame,
  frameBoxFromDrag,
  frameForNode,
  framePreset,
  nextFrameName,
  safeAreaBox,
} from './frames';

describe('presets', () => {
  it('have unique ids and usable sizes', () => {
    const ids = FRAME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FRAME_PRESETS) {
      expect(p.width).toBeGreaterThan(MIN_FRAME_SIZE);
      expect(p.height).toBeGreaterThan(MIN_FRAME_SIZE);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it('are findable by id, and a bad id is not a crash', () => {
    expect(framePreset('phone')?.width).toBe(390);
    expect(framePreset('nope')).toBeUndefined();
    expect(framePreset(undefined)).toBeUndefined();
  });

  it('never declare a safe area that does not fit inside the frame', () => {
    for (const p of FRAME_PRESETS) {
      if (!p.safeArea) continue;
      expect(safeAreaBox({ x: 0, y: 0, ...p })).not.toBeNull();
    }
  });
});

describe('safeAreaBox', () => {
  const frame = { x: 100, y: 200, width: 1080, height: 1920 };

  it('insets from each edge independently', () => {
    expect(safeAreaBox({ ...frame, safeArea: { top: 250, right: 64, bottom: 320, left: 64 } })).toEqual({
      x: 164,
      y: 450,
      width: 952,
      height: 1350,
    });
  });

  it('is null when there is nothing to draw', () => {
    expect(safeAreaBox(frame)).toBeNull();
    expect(safeAreaBox({ ...frame, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } })).toBeNull();
  });

  it('clamps negative insets away rather than drawing outside the frame', () => {
    // A guide outside the frame reads as bleed, which is a different feature
    // with different export rules — and both are plain rectangles, so nobody
    // looking at one could tell which they had.
    expect(safeAreaBox({ ...frame, safeArea: { top: -50, right: 0, bottom: 0, left: 0 } })).toBeNull();
    expect(safeAreaBox({ ...frame, safeArea: { top: -50, right: 10, bottom: 0, left: 0 } })).toEqual({
      x: 100,
      y: 200,
      width: 1070,
      height: 1920,
    });
  });

  it('is null rather than inside-out when opposing insets cross', () => {
    // 1000 + 1000 exceeds the 1920 height, so the naive arithmetic gives a
    // negative height. An inside-out rectangle is a stranger thing to look at
    // than no rectangle, and Konva will happily draw one.
    expect(safeAreaBox({ ...frame, safeArea: { top: 1000, right: 0, bottom: 1000, left: 0 } })).toBeNull();
    expect(safeAreaBox({ ...frame, safeArea: { top: 0, right: 600, bottom: 0, left: 600 } })).toBeNull();
  });

  it('is null when the insets exactly consume the frame', () => {
    // Zero-area, not negative: still nothing worth drawing, and a
    // zero-height dashed line reads as a stray stroke across the middle.
    expect(safeAreaBox({ ...frame, safeArea: { top: 960, right: 0, bottom: 960, left: 0 } })).toBeNull();
  });
});

describe('nextFrameName', () => {
  it('starts at 1 on an empty board', () => {
    expect(nextFrameName([])).toBe('Frame 1');
  });

  it('ignores titles that are not default frame names', () => {
    expect(nextFrameName(['Checkout flow', 'Frame', undefined, 'Frame two'])).toBe('Frame 1');
  });

  it('continues past the highest number rather than filling gaps', () => {
    // Deleting Frame 2 and letting the next frame silently take that name
    // would make yesterday's note about "Frame 2" point at something nobody
    // recognises.
    expect(nextFrameName(['Frame 1', 'Frame 3'])).toBe('Frame 4');
  });

  it('is not confused by numbers elsewhere in a title', () => {
    expect(nextFrameName(['Frame 12 of 30', 'My Frame 9'])).toBe('Frame 1');
  });

  it('tolerates surrounding whitespace', () => {
    expect(nextFrameName([' Frame 7 '])).toBe('Frame 8');
  });
});

describe('frameBoxFromDrag', () => {
  const fallback = { width: 400, height: 300 };

  it('uses the dragged rectangle when the drag is deliberate', () => {
    expect(frameBoxFromDrag({ x: 10, y: 20 }, { x: 210, y: 170 }, fallback)).toEqual({
      x: 10, y: 20, width: 200, height: 150,
    });
  });

  it('normalizes a drag in any direction', () => {
    // Dragging up-and-left must produce the same box as down-and-right.
    expect(frameBoxFromDrag({ x: 210, y: 170 }, { x: 10, y: 20 }, fallback)).toEqual({
      x: 10, y: 20, width: 200, height: 150,
    });
  });

  it('drops the fallback size centred on a click', () => {
    expect(frameBoxFromDrag({ x: 100, y: 100 }, { x: 102, y: 101 }, fallback)).toEqual({
      x: -100, y: -50, width: 400, height: 300,
    });
  });

  it('treats a one-axis drag as a click', () => {
    // Dragging horizontally with no vertical movement would otherwise create a
    // frame with no height, which cannot be grabbed again.
    const box = frameBoxFromDrag({ x: 0, y: 0 }, { x: 500, y: 1 }, fallback);
    expect(box.width).toBe(400);
    expect(box.height).toBe(300);
  });

  it('never produces a frame below the minimum size', () => {
    for (const d of [7, 20, 1000]) {
      const box = frameBoxFromDrag({ x: 0, y: 0 }, { x: d, y: d }, fallback);
      expect(box.width).toBeGreaterThanOrEqual(MIN_FRAME_SIZE);
      expect(box.height).toBeGreaterThanOrEqual(MIN_FRAME_SIZE);
    }
  });

  it('uses the default size when no preset is armed', () => {
    const box = frameBoxFromDrag({ x: 0, y: 0 }, { x: 0, y: 0 }, DEFAULT_FRAME);
    expect(box.width).toBe(DEFAULT_FRAME.width);
  });
});

describe('centreIsInside', () => {
  const frame = { x: 0, y: 0, width: 100, height: 100 };

  it('captures an object whose middle is over the frame', () => {
    // Centre-based, so an object half in and half out belongs where it looks
    // like it belongs.
    expect(centreIsInside({ x: 40, y: 40, width: 20, height: 20 }, frame)).toBe(true);
    expect(centreIsInside({ x: -40, y: 40, width: 100, height: 20 }, frame)).toBe(true);
  });

  it('leaves out an object whose middle is not', () => {
    expect(centreIsInside({ x: 90, y: 40, width: 100, height: 20 }, frame)).toBe(false);
    expect(centreIsInside({ x: 200, y: 200, width: 20, height: 20 }, frame)).toBe(false);
  });

  it('counts a centre exactly on the edge as inside', () => {
    expect(centreIsInside({ x: 90, y: 40, width: 20, height: 20 }, frame)).toBe(true);
  });
});

describe('frameForNode', () => {
  const outer = { id: 'outer', x: 0, y: 0, width: 400, height: 400, zIndex: 1 };
  const inner = { id: 'inner', x: 50, y: 50, width: 100, height: 100, zIndex: 2 };
  const node = (x: number, y: number) => ({ x, y, width: 10, height: 10 });

  it('is null when no frame contains the node', () => {
    expect(frameForNode(node(900, 900), [outer, inner])).toBeNull();
    expect(frameForNode(node(10, 10), [])).toBeNull();
  });

  it('picks the only containing frame', () => {
    expect(frameForNode(node(300, 300), [outer, inner])).toBe('outer');
  });

  it('picks the smallest containing frame, so a nested frame wins', () => {
    // Otherwise dropping something into a frame inside another frame would be
    // silently claimed by the outer one.
    expect(frameForNode(node(90, 90), [outer, inner])).toBe('inner');
    // Order of the list must not matter.
    expect(frameForNode(node(90, 90), [inner, outer])).toBe('inner');
  });

  it('never lets a frame contain itself', () => {
    // Otherwise a frame dropped anywhere becomes its own child, and every rule
    // that walks a frame's contents has a cycle to fall into.
    const self = { id: 'outer', x: 10, y: 10, width: 20, height: 20 };
    expect(frameForNode(self, [outer, inner])).toBeNull();
  });

  it('still places a frame inside another frame', () => {
    const small = { id: 'small', type: 'frame', x: 60, y: 60, width: 20, height: 20 };
    expect(frameForNode(small, [outer, inner])).toBe('inner');
  });

  /**
   * A frame is placed by whole-box containment, not by its centre, and the
   * reason is a cycle reachable from an entirely ordinary gesture.
   *
   * Draw a small frame in the middle of a board-sized one: both centres
   * coincide, so under the centre rule each frame's centre is inside the other
   * and the document ends up holding `small.frameId = big` *and*
   * `big.frameId = small`. `descendantsOfFrame(small)` then walks to `big` and
   * everything it owns — so deleting the small frame deleted the outer frame
   * and its entire contents, and dragging it dragged the whole region.
   *
   * The delete path is cycle-safe in that it terminates, which is precisely why
   * nothing caught this: it did not hang, it took the wrong things with it.
   */
  describe('frame nesting cannot make a cycle', () => {
    const big = { id: 'big', x: 0, y: 0, width: 1000, height: 1000, zIndex: 1 };
    const small = { id: 'small', x: 400, y: 400, width: 200, height: 200, zIndex: 2 };

    it('nests the small frame in the big one', () => {
      expect(frameForNode({ ...small, type: 'frame' }, [big, small])).toBe('big');
    });

    it('does not nest the big frame in the small one it merely covers', () => {
      // The centre rule said it did. This is the whole defect.
      expect(frameForNode({ ...big, type: 'frame' }, [big, small])).toBeNull();
    });

    it('refuses to nest two frames of the same box, in either direction', () => {
      // Equal area is two frames stacked, not one inside the other — and
      // calling it nesting would bring the cycle back by way of a tie.
      const a = { id: 'a', x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
      const b = { id: 'b', x: 0, y: 0, width: 100, height: 100, zIndex: 2 };
      expect(frameForNode({ ...a, type: 'frame' }, [a, b])).toBeNull();
      expect(frameForNode({ ...b, type: 'frame' }, [a, b])).toBeNull();
    });

    it('refuses to nest two frames that merely cross', () => {
      // A wide short frame and a tall narrow one, each centred on the other.
      // Their areas are equal, so a size test alone would not save this.
      const wide = { id: 'wide', x: 0, y: 450, width: 1000, height: 100, zIndex: 1 };
      const tall = { id: 'tall', x: 450, y: 0, width: 100, height: 1000, zIndex: 2 };
      expect(frameForNode({ ...wide, type: 'frame' }, [wide, tall])).toBeNull();
      expect(frameForNode({ ...tall, type: 'frame' }, [wide, tall])).toBeNull();
    });

    it('nests a frame that overhangs an edge in neither direction', () => {
      // Half in, half out. An ordinary object would join by its centre; a
      // region that does not fit is not contained.
      const overhang = { id: 'over', type: 'frame', x: 900, y: 400, width: 200, height: 200 };
      expect(frameForNode(overhang, [big])).toBeNull();
    });

    /**
     * The property, stated directly: for any pair of frames, at most one of
     * them can be the other's parent. This is what makes the containment graph
     * acyclic by construction rather than by a guard somebody has to remember.
     */
    it('never lets two frames each claim the other', () => {
      const boxes = [
        { id: 'a', x: 0, y: 0, width: 1000, height: 1000, zIndex: 1 },
        { id: 'b', x: 400, y: 400, width: 200, height: 200, zIndex: 2 },
        { id: 'c', x: 0, y: 0, width: 1000, height: 1000, zIndex: 3 },
        { id: 'd', x: 0, y: 450, width: 1000, height: 100, zIndex: 4 },
        { id: 'e', x: 450, y: 0, width: 100, height: 1000, zIndex: 5 },
        { id: 'f', x: 900, y: 400, width: 200, height: 200, zIndex: 6 },
      ];
      for (const x of boxes) {
        for (const y of boxes) {
          if (x.id === y.id) continue;
          const xOwner = frameForNode({ ...x, type: 'frame' }, boxes);
          const yOwner = frameForNode({ ...y, type: 'frame' }, boxes);
          expect(xOwner === y.id && yOwner === x.id, `${x.id} and ${y.id} claim each other`).toBe(false);
        }
      }
    });

    it('still lets an ordinary object join by its centre', () => {
      // The forgiving rule is right for objects and only wrong for regions —
      // this fix must not have tightened it for everything else.
      // Overhangs the right edge by 50, but its middle is well inside.
      const sticky = { id: 's', type: 'sticky', x: 850, y: 450, width: 200, height: 200 };
      expect(frameForNode(sticky, [big])).toBe('big');
      // And the same box as a frame is refused, which is the whole distinction.
      expect(frameForNode({ ...sticky, type: 'frame' }, [big])).toBeNull();
    });
  });

  it('breaks a tie toward the frame on top', () => {
    const a = { id: 'a', x: 0, y: 0, width: 100, height: 100, zIndex: 5 };
    const b = { id: 'b', x: 0, y: 0, width: 100, height: 100, zIndex: 9 };
    expect(frameForNode(node(40, 40), [a, b])).toBe('b');
    expect(frameForNode(node(40, 40), [b, a])).toBe('b');
  });
});

describe('descendantsOfFrame', () => {
  it('is empty for a frame owning nothing', () => {
    expect(descendantsOfFrame('f1', [{ id: 'a' }, { id: 'b', frameId: 'other' }])).toEqual([]);
  });

  it('collects direct children', () => {
    const nodes = [{ id: 'a', frameId: 'f1' }, { id: 'b', frameId: 'f1' }, { id: 'c' }];
    expect(descendantsOfFrame('f1', nodes).sort()).toEqual(['a', 'b']);
  });

  it('follows nested frames', () => {
    // Moving or deleting a frame has to take everything below it, not just
    // the objects sitting directly on it.
    const nodes = [
      { id: 'inner', frameId: 'outer' },
      { id: 'a', frameId: 'inner' },
      { id: 'b', frameId: 'outer' },
      { id: 'far', frameId: 'elsewhere' },
    ];
    expect(descendantsOfFrame('outer', nodes).sort()).toEqual(['a', 'b', 'inner']);
  });

  it('terminates on a cycle instead of hanging', () => {
    // `frameForNode` cannot produce one, but a hand-edited document or a
    // concurrent merge is not bound by that — and a hang is far worse than a
    // misplaced rectangle.
    const nodes = [
      { id: 'f1', frameId: 'f2' },
      { id: 'f2', frameId: 'f1' },
      { id: 'leaf', frameId: 'f2' },
    ];
    const found = descendantsOfFrame('f1', nodes);
    expect(found).toContain('f2');
    expect(found).toContain('leaf');
    expect(new Set(found).size).toBe(found.length);
  });

  it('does not report the frame itself', () => {
    expect(descendantsOfFrame('f1', [{ id: 'f1', frameId: 'f1' }])).toEqual([]);
  });
});
