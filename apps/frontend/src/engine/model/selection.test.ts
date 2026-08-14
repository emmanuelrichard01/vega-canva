import { describe, it, expect } from 'vitest';
import type { AnyNode } from './schema';
import {
  canResizeAsBox,
  intersectCapabilities,
  sameValue,
  scaleSelection,
  selectionBounds,
  selectionLabel,
  sharedValue,
  translateSelection,
} from './selection';

/**
 * A node with only the fields this module reads. Cast rather than built in
 * full: `AnyNode` carries authorship, timestamps and a per-type payload, none
 * of which any function here touches, and spelling them out would make each
 * case unreadable for no extra coverage.
 */
function node(partial: Partial<AnyNode> & { id: string }): AnyNode {
  return {
    type: 'shape',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    ...partial,
  } as AnyNode;
}

describe('sameValue', () => {
  it('compares plain values', () => {
    expect(sameValue(2, 2)).toBe(true);
    expect(sameValue(2, 3)).toBe(false);
    expect(sameValue('a', 'a')).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, undefined)).toBe(false);
  });

  it('does not mistake null for an object', () => {
    // `typeof null === 'object'`, so a missing guard walks its keys and throws.
    expect(sameValue(null, { a: 1 })).toBe(false);
    expect(sameValue({ a: 1 }, null)).toBe(false);
  });

  it('compares nested objects by value, whatever order the keys arrive in', () => {
    // This is the whole reason the function exists: the normalizer rebuilds
    // these objects on every read, so two nodes agreeing on a stroke hold two
    // different object identities.
    expect(sameValue({ color: '#000', width: 2 }, { width: 2, color: '#000' })).toBe(true);
    expect(sameValue({ color: '#000', width: 2 }, { color: '#000', width: 3 })).toBe(false);
  });

  it('does not call a subset equal to its superset', () => {
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('compares arrays by position, and never to an object', () => {
    expect(sameValue([{ type: 'solid', color: '#f00' }], [{ type: 'solid', color: '#f00' }])).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([1, 2], [1])).toBe(false);
    expect(sameValue([], {})).toBe(false);
  });
});

describe('sharedValue', () => {
  it('reports the common value when everything agrees', () => {
    const nodes = [node({ id: 'a', opacity: 0.5 }), node({ id: 'b', opacity: 0.5 })];
    expect(sharedValue(nodes, (n) => n.opacity)).toEqual({ value: 0.5, mixed: false });
  });

  it('reports mixed, carrying the primary node value, when they disagree', () => {
    const nodes = [node({ id: 'a', opacity: 0.5 }), node({ id: 'b', opacity: 1 })];
    expect(sharedValue(nodes, (n) => n.opacity)).toEqual({ value: 0.5, mixed: true });
  });

  it('treats a single selection as never mixed', () => {
    expect(sharedValue([node({ id: 'a', width: 30 })], (n) => n.width).mixed).toBe(false);
  });

  it('is not mixed merely because a value is an object', () => {
    const nodes = [
      node({ id: 'a', appearance: { fill: [{ type: 'solid', color: '#f00' }] } } as Partial<AnyNode> & { id: string }),
      node({ id: 'b', appearance: { fill: [{ type: 'solid', color: '#f00' }] } } as Partial<AnyNode> & { id: string }),
    ];
    expect(sharedValue(nodes, (n) => (n as { appearance?: unknown }).appearance).mixed).toBe(false);
  });

  it('handles an empty selection without throwing', () => {
    expect(sharedValue([], (n) => n.opacity)).toEqual({ value: undefined, mixed: false });
  });
});

describe('intersectCapabilities', () => {
  it('keeps only what every type supports', () => {
    expect(
      intersectCapabilities([
        { supportsFill: true, supportsStroke: true, supportsOpacity: true },
        { supportsFill: true, supportsStroke: false, supportsOpacity: true },
      ])
    ).toEqual({ supportsFill: true, supportsStroke: false, supportsOpacity: true });
  });

  it('treats an absent flag as unsupported rather than inheriting the first type', () => {
    // An audio node simply has no `supportsStroke` key. Reading it as "not
    // stated, so keep the other one's" is how a stroke control appears over a
    // voice note.
    expect(intersectCapabilities([{ supportsStroke: true }, {}])).toEqual({ supportsStroke: false });
  });

  it('returns nothing for an empty list', () => {
    expect(intersectCapabilities([])).toEqual({});
  });
});

describe('selectionBounds', () => {
  it('is null for an empty selection', () => {
    expect(selectionBounds([])).toBeNull();
  });

  it('unions unrotated boxes', () => {
    const nodes = [
      node({ id: 'a', x: 0, y: 0, width: 100, height: 50 }),
      node({ id: 'b', x: 200, y: 20, width: 100, height: 100 }),
    ];
    expect(selectionBounds(nodes)).toEqual({ x: 0, y: 0, width: 300, height: 120 });
  });

  it('accounts for scale', () => {
    const nodes = [node({ id: 'a', x: 10, y: 10, width: 100, height: 100, scaleX: 2, scaleY: 0.5 })];
    expect(selectionBounds(nodes)).toEqual({ x: 10, y: 10, width: 200, height: 50 });
  });

  it('takes a negative scale as a flip, not as a negative size', () => {
    // `scaleX: -1` mirrors the object in place; it does not put it at a
    // negative width, which would invert the box.
    const nodes = [node({ id: 'a', x: 0, y: 0, width: 100, height: 100, scaleX: -1 })];
    expect(selectionBounds(nodes)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('grows the box to hold a rotated object', () => {
    // A 100×100 square turned 45° about its centre spans 100√2 ≈ 141.42, and
    // stays centred on (50, 50).
    const bounds = selectionBounds([node({ id: 'a', x: 0, y: 0, width: 100, height: 100, rotation: 45 })]);
    expect(bounds!.width).toBeCloseTo(141.42, 1);
    expect(bounds!.height).toBeCloseTo(141.42, 1);
    expect(bounds!.x).toBeCloseTo(-20.71, 1);
    expect(bounds!.y).toBeCloseTo(-20.71, 1);
  });

  it('leaves a 90° rotation the same size, just swapped', () => {
    const bounds = selectionBounds([node({ id: 'a', x: 0, y: 0, width: 100, height: 40, rotation: 90 })]);
    expect(bounds!.width).toBeCloseTo(40, 6);
    expect(bounds!.height).toBeCloseTo(100, 6);
  });
});

describe('translateSelection', () => {
  const nodes = [node({ id: 'a', x: 10, y: 0 }), node({ id: 'b', x: 60, y: 0 })];
  const bounds = selectionBounds(nodes)!;

  it('shifts every node by the same delta, keeping their spacing', () => {
    expect(translateSelection(nodes, bounds, 'x', 0)).toEqual([
      { id: 'a', changes: { x: 0 } },
      { id: 'b', changes: { x: 50 } },
    ]);
  });

  it('writes nothing when the value has not changed', () => {
    expect(translateSelection(nodes, bounds, 'x', bounds.x)).toEqual([]);
  });

  it('moves a rotated node exactly, since translation needs no approximation', () => {
    const rotated = [node({ id: 'a', x: 0, y: 0, width: 100, height: 100, rotation: 45 })];
    const box = selectionBounds(rotated)!;
    const patches = translateSelection(rotated, box, 'x', box.x + 10);
    expect(patches).toEqual([{ id: 'a', changes: { x: 10 } }]);
  });
});

describe('canResizeAsBox', () => {
  it('allows an unrotated selection', () => {
    expect(canResizeAsBox([node({ id: 'a' }), node({ id: 'b' })])).toBe(true);
  });

  it('declines as soon as anything is rotated', () => {
    // Squashing a rotated rectangle produces a parallelogram, and a node has
    // nowhere to store the shear — so the control is withheld rather than
    // writing a box that does not match the result.
    expect(canResizeAsBox([node({ id: 'a' }), node({ id: 'b', rotation: 12 })])).toBe(false);
  });
});

describe('scaleSelection', () => {
  const nodes = [
    node({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
    node({ id: 'b', x: 100, y: 0, width: 100, height: 100 }),
  ];
  const bounds = selectionBounds(nodes)!;

  it('scales positions about the box origin so spacing scales too', () => {
    expect(scaleSelection(nodes, bounds, 'width', 400)).toEqual([
      { id: 'a', changes: { x: 0, width: 200 } },
      { id: 'b', changes: { x: 200, width: 200 } },
    ]);
  });

  it('keeps the box origin fixed, so only the far edge moves', () => {
    const offset = [node({ id: 'a', x: 50, y: 0, width: 100, height: 100 })];
    const box = selectionBounds(offset)!;
    expect(scaleSelection(offset, box, 'width', 50)).toEqual([
      { id: 'a', changes: { x: 50, width: 50 } },
    ]);
  });

  it('writes nothing when the size has not changed', () => {
    expect(scaleSelection(nodes, bounds, 'width', bounds.width)).toEqual([]);
  });

  it('never scales an object down to nothing', () => {
    const patches = scaleSelection(nodes, bounds, 'width', 1);
    patches.forEach((patch) => expect(patch.changes.width as number).toBeGreaterThanOrEqual(1));
  });
});

describe('selectionLabel', () => {
  it('names a single object by its type', () => {
    expect(selectionLabel([node({ id: 'a', type: 'shape' })])).toBe('shape');
  });

  it('counts a uniform selection', () => {
    expect(selectionLabel([node({ id: 'a', type: 'shape' }), node({ id: 'b', type: 'shape' })])).toBe('2 shapes');
  });

  it('stays neutral over a mixed selection rather than naming one type', () => {
    expect(selectionLabel([node({ id: 'a', type: 'shape' }), node({ id: 'b', type: 'image' })])).toBe('2 objects');
  });

  it('says so when nothing is selected', () => {
    expect(selectionLabel([])).toBe('Nothing selected');
  });
});
