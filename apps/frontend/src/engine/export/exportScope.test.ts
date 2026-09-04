import { describe, expect, it } from 'vitest';
import {
  copyLabel,
  expandForExport,
  exportIds,
  exportIdSet,
  exportLabel,
  exportScope,
  scopeOptions,
} from './exportScope';
import type { AnyNode } from '../model/schema';

const node = (id: string, extra: Partial<AnyNode> = {}): AnyNode =>
  ({
    id, type: 'shape', x: 0, y: 0, width: 100, height: 100,
    rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 0,
    locked: false, hidden: false, createdBy: 'u', createdAt: 0, updatedAt: 0,
    ...extra,
  } as AnyNode);

const board = (...nodes: AnyNode[]): Record<string, AnyNode> =>
  Object.fromEntries(nodes.map((n) => [n.id, n]));

describe('expandForExport', () => {
  it('takes a frame\'s contents with it', () => {
    /**
     * Exporting a selected frame and getting an empty rectangle is not a
     * defensible reading of the request -- and it is not the reading
     * `resolveExportTarget` already takes for the dialog's per-frame option.
     */
    const objects = board(
      node('f', { type: 'frame' }),
      node('a', { frameId: 'f' }),
      node('b', { frameId: 'f' }),
      node('outside')
    );
    expect(expandForExport(objects, ['f']).sort()).toEqual(['a', 'b', 'f']);
  });

  it('does not duplicate a child that was also selected by hand', () => {
    const objects = board(node('f', { type: 'frame' }), node('a', { frameId: 'f' }));
    expect(expandForExport(objects, ['a', 'f'])).toEqual(['a', 'f']);
  });

  it('leaves a plain selection exactly as it was', () => {
    const objects = board(node('a'), node('b'));
    expect(expandForExport(objects, ['b', 'a'])).toEqual(['b', 'a']);
  });
});

describe('exportScope', () => {
  it('falls back to the whole board when nothing is selected', () => {
    const scope = exportScope(board(node('a'), node('b')), [], 'Roadmap');
    expect(scope.ids).toBeNull();
    expect(scope.wholeBoard).toBe(true);
    expect(scope.count).toBe(2);
    expect(scope.subject).toBe('the board');
    expect(scope.filenameBase).toBe('Roadmap');
  });

  it('names a single object by its own words', () => {
    // "Copied Sprint goals as PNG" says which of nine notes you copied.
    // "Copied sticky note as PNG" does not.
    const objects = board(node('s', { type: 'sticky', text: 'Sprint goals' } as Partial<AnyNode>));
    const scope = exportScope(objects, ['s'], 'Roadmap');
    expect(scope.subject).toBe('“Sprint goals”');
    expect(scope.filenameBase).toBe('Sprint goals');
  });

  it('falls back to the type name when an object has no words of its own', () => {
    const scope = exportScope(board(node('s', { type: 'sticky' })), ['s'], 'Roadmap');
    expect(scope.subject).toBe('this sticky note');
  });

  it('shortens words that would run past a menu item', () => {
    const long = 'a'.repeat(60);
    const scope = exportScope(board(node('t', { type: 'text', text: long } as Partial<AnyNode>)), ['t'], 'B');
    expect(scope.subject.length).toBeLessThan(34);
    expect(scope.subject).toContain('…');
  });

  it('collapses the whitespace a multi-line note carries', () => {
    const objects = board(node('s', { type: 'sticky', text: ' one\n\ntwo ' } as Partial<AnyNode>));
    expect(exportScope(objects, ['s'], 'B').subject).toBe('“one two”');
  });

  it('counts a multiple selection', () => {
    const scope = exportScope(board(node('a'), node('b'), node('c')), ['a', 'b'], 'Roadmap');
    expect(scope.subject).toBe('2 objects');
    expect(scope.count).toBe(2);
    expect(scope.filenameBase).toBe('Roadmap selection');
  });

  it('drops ids whose objects are gone', () => {
    /**
     * A selection outlives its objects when a collaborator deletes one. An
     * exporter handed a dead id frames to a box with nothing in it.
     */
    const scope = exportScope(board(node('a')), ['a', 'deleted'], 'B');
    expect(scope.ids).toEqual(['a']);
    expect(scope.count).toBe(1);
  });

  it('falls back to the board when every selected id is gone', () => {
    expect(exportScope(board(node('a')), ['gone'], 'B').wholeBoard).toBe(true);
  });

  it('counts the frame\'s contents, not the one thing you clicked', () => {
    const objects = board(
      node('f', { type: 'frame', title: 'Cover' }),
      node('a', { frameId: 'f' }),
      node('b', { frameId: 'f' })
    );
    const scope = exportScope(objects, ['f'], 'B');
    expect(scope.count).toBe(3);
    expect(scope.subject).toBe('3 objects');
  });
});

describe('scopeOptions', () => {
  it('sets both halves of the restriction or neither', () => {
    /**
     * `selectedOnly` and `selectedIds` are two fields carrying one fact, which
     * is how the raster path came to honour the second and ignore the first.
     */
    const scoped = scopeOptions(exportScope(board(node('a')), ['a'], 'B'));
    expect(scoped).toEqual({ selectedOnly: true, selectedIds: ['a'] });
    expect(scopeOptions(exportScope(board(node('a')), [], 'B'))).toEqual({});
  });
});

/**
 * The invariant these hold is the one `isolate.ts` was written for: **a PNG
 * and an SVG of the same selection must cover the same objects.**
 *
 * That was checkable only by exporting both and opening them, and it is on
 * HANDOFF's unwatched list for exactly that reason. It does not have to be.
 * What made the two disagree was never the pixels — it was four separate
 * copies of "which ids does this export cover", and the raster path answering
 * it differently from the vector path. One reader, asserted here, is a
 * stronger guarantee than looking at two files once.
 */
describe('exportIds / exportIdSet', () => {
  it('answers null for a whole-board export, not an empty list', () => {
    /**
     * The distinction is load-bearing. `computeContentBounds` treats "no ids"
     * as the whole document and an empty list as zero objects — for which it
     * returns a default 800x600 box at the origin. Collapsing the two is how
     * a caller frames a capture to a box with nothing in it.
     */
    expect(exportIds({})).toBeNull();
    expect(exportIds({ selectedOnly: false, selectedIds: ['a'] })).toBeNull();
    expect(exportIdSet({})).toBeNull();
  });

  it('treats an empty selection as the whole board, because [] is truthy', () => {
    /**
     * The bug this forecloses. Two of the four old call sites tested
     * `selectedIds?.length` and two tested `selectedOnly ? selectedIds :
     * undefined`; given `{ selectedOnly: true, selectedIds: [] }` the first
     * pair said "everything" and the second said "these zero objects". The
     * raster export would then frame to the 800x600 fallback while isolating
     * nothing, and capture whatever board content overlapped that box.
     *
     * `exportScope` never produces this state -- it returns `ids: null` when
     * nothing survives -- so this asserts a latch on a door that is shut.
     * Four copies agreeing by coincidence is what invariant 7 rules out.
     */
    expect(exportIds({ selectedOnly: true, selectedIds: [] })).toBeNull();
    expect(exportIdSet({ selectedOnly: true, selectedIds: [] })).toBeNull();
  });

  it('gives the raster and vector paths the same answer', () => {
    /**
     * The two exporters consume the result differently -- the vector path
     * filters nodes by membership, the raster path hides everything outside
     * the set and frames to `computeContentBounds` -- but they must start
     * from one set. This asserts the set, which is the half that used to
     * differ; `isolate.ts` covers the hiding.
     */
    const options = { selectedOnly: true, selectedIds: ['a', 'c'] };

    const vector = exportIdSet(options);
    const raster = exportIdSet(options);
    expect(vector).toEqual(raster);

    // And what each derives from it, in the shape its own caller uses.
    const nodes = [node('a'), node('b'), node('c')];
    expect(nodes.filter((n) => vector!.has(n.id)).map((n) => n.id)).toEqual(['a', 'c']);
    expect(exportIds(options)).toEqual(['a', 'c']);
  });

  it('copies the ids rather than aliasing the caller\'s array', () => {
    /**
     * An exporter that sorted or spliced its ids in place would otherwise
     * reach back into the selection it was handed.
     */
    const selectedIds = ['a', 'b'];
    const out = exportIds({ selectedOnly: true, selectedIds })!;
    out.push('c');
    expect(selectedIds).toEqual(['a', 'b']);
  });
});

describe('the words on the menu', () => {
  const objects = board(node('a'), node('b'), node('c'));

  it('says "board" when that is what it will copy', () => {
    /**
     * "Copy as PNG" on an empty selection copies the whole board, and the menu
     * had no way to know -- the scope was decided at the other end, from a
     * different variable.
     */
    expect(copyLabel(exportScope(objects, [], 'B'), 'PNG')).toBe('Copy board as PNG');
  });

  it('does not count a selection of one', () => {
    expect(copyLabel(exportScope(objects, ['a'], 'B'), 'SVG')).toBe('Copy as SVG');
  });

  it('counts a selection you might not have meant', () => {
    // The only warning that the marquee caught the frame behind the notes.
    expect(copyLabel(exportScope(objects, ['a', 'b'], 'B'), 'PNG')).toBe('Copy 2 objects as PNG');
  });

  it('offers the dialog by what it will be pointed at', () => {
    expect(exportLabel(exportScope(objects, [], 'B'))).toBe('Export board…');
    expect(exportLabel(exportScope(objects, ['a'], 'B'))).toBe('Export this object…');
    expect(exportLabel(exportScope(objects, ['a', 'b'], 'B'))).toBe('Export 2 objects…');
  });
});
