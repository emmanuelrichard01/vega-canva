import { describe, expect, it } from 'vitest';
import { isolateObjects, OBJECT_NODE } from './isolate';

/** A Konva node, reduced to the three calls this module makes on one. */
function fakeNode(id: string, visible = true) {
  let shown = visible;
  return {
    id: () => id,
    visible: ((value?: boolean) => {
      if (value === undefined) return shown;
      shown = value;
      return undefined;
    }) as { (): boolean; (value: boolean): unknown },
    get shown() { return shown; },
  };
}

function fakeStage(nodes: ReturnType<typeof fakeNode>[]) {
  return {
    calls: [] as string[],
    find(selector: string) {
      this.calls.push(selector);
      return nodes;
    },
  };
}

describe('isolateObjects', () => {
  it('hides everything outside the selection', () => {
    /**
     * The bug: the raster path framed to the selection and captured the whole
     * stage inside that frame, so the PNG of one sticky note also contained
     * the frame behind it and the notes overlapping its corners -- while the
     * SVG of the same selection contained the note alone.
     */
    const keep = fakeNode('a');
    const other = fakeNode('b');
    isolateObjects(fakeStage([keep, other]), new Set(['a']));
    expect(keep.shown).toBe(true);
    expect(other.shown).toBe(false);
  });

  it('puts back exactly what it hid', () => {
    const keep = fakeNode('a');
    const other = fakeNode('b');
    const restore = isolateObjects(fakeStage([keep, other]), new Set(['a']));
    restore();
    expect(other.shown).toBe(true);
  });

  it('does not reveal an object the user had hidden', () => {
    /**
     * Restoring by setting everything visible would turn on an object hidden
     * from the Layers panel -- editing what the user sees, not just what the
     * file contains. Only nodes that were visible to begin with are recorded.
     */
    const hiddenByUser = fakeNode('b', false);
    const restore = isolateObjects(fakeStage([fakeNode('a'), hiddenByUser]), new Set(['a']));
    restore();
    expect(hiddenByUser.shown).toBe(false);
  });

  it('does nothing at all for a whole-board export', () => {
    // Not "hides nothing" -- does not walk the tree. The whole-board case is
    // the common one and must not pay for a feature it does not use.
    const stage = fakeStage([fakeNode('a')]);
    const restore = isolateObjects(stage, null);
    restore();
    expect(stage.calls).toEqual([]);
  });

  it('asks for the object groups by name, in one traversal', () => {
    // `findOne('#id')` is a full walk per id in this Konva; nine hundred ids
    // would be nine hundred walks.
    const stage = fakeStage([]);
    isolateObjects(stage, new Set(['a']));
    expect(stage.calls).toEqual([`.${OBJECT_NODE}`]);
  });

  it('survives a selected id that is not on the stage', () => {
    // Culling, or a collaborator's delete landing mid-export.
    const other = fakeNode('b');
    isolateObjects(fakeStage([other]), new Set(['gone']));
    expect(other.shown).toBe(false);
  });
});
