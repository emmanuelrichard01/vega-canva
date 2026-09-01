import { describe, it, expect } from 'vitest';
import { labelInk, solidFillOf } from './labelInk';
import { DEFAULT_INK, DEFAULT_TYPOGRAPHY, type AnyNode } from './schema';

const shape = (fill?: string, color = DEFAULT_INK, opacity?: number): AnyNode =>
  ({
    id: 'n', type: 'shape', x: 0, y: 0, width: 10, height: 10,
    geometry: { kind: 'rect' },
    appearance: fill ? { fill: [{ type: 'solid', color, opacity }] } : undefined,
    typography: { ...DEFAULT_TYPOGRAPHY, color },
  }) as unknown as AnyNode;

const withFill = (fill: string, color = DEFAULT_INK): AnyNode =>
  ({
    id: 'n', type: 'shape', x: 0, y: 0, width: 10, height: 10,
    geometry: { kind: 'rect' },
    appearance: { fill: [{ type: 'solid', color: fill }] },
    typography: { ...DEFAULT_TYPOGRAPHY, color },
  }) as unknown as AnyNode;

describe('labelInk', () => {
  it('lifts the default ink off a dark fill', () => {
    // The bug: near-black text on a near-black shape. Present, syncing,
    // exporting, unreadable.
    expect(labelInk(withFill('#111827'))).toBe('#FFFFFF');
    expect(labelInk(withFill('#1E3A8A'))).toBe('#FFFFFF');
  });

  it('leaves the default alone on a light fill', () => {
    // Not pure black: the default is what the rest of the board uses, and the
    // two are close enough that snapping would be a visible inconsistency.
    expect(labelInk(withFill('#FFFFFF'))).toBe(DEFAULT_INK);
    expect(labelInk(withFill('#FEF3C7'))).toBe(DEFAULT_INK);
  });

  it('never overrides a colour somebody chose', () => {
    /**
     * A picked colour is an instruction, including a bad one. Correcting it
     * silently would make the colour control look broken.
     */
    expect(labelInk(withFill('#111827', '#64748B'))).toBe('#64748B');
    expect(labelInk(withFill('#FFFFFF', '#DC2626'))).toBe('#DC2626');
  });

  it('keeps the stored colour when there is no solid fill to read', () => {
    const noFill = { ...(shape() as object) } as AnyNode;
    expect(labelInk(noFill)).toBe(DEFAULT_INK);
  });

  it('ignores a fill you can see through', () => {
    // A 20%-opacity fill is not the surface the words sit on; the board is.
    const sheer = {
      id: 'n', type: 'shape', x: 0, y: 0, width: 10, height: 10,
      geometry: { kind: 'rect' },
      appearance: { fill: [{ type: 'solid', color: '#111827', opacity: 0.2 }] },
      typography: { ...DEFAULT_TYPOGRAPHY, color: DEFAULT_INK },
    } as unknown as AnyNode;
    expect(labelInk(sheer)).toBe(DEFAULT_INK);
  });

  it('is undefined for a node with no typography at all', () => {
    const bare = { id: 'n', type: 'connector' } as unknown as AnyNode;
    expect(labelInk(bare)).toBeUndefined();
  });

  it('resolves identically for every viewer', () => {
    /**
     * The invariant `DEFAULT_INK` is documented with: content cannot resolve
     * per viewer, or two people looking at one board see two different
     * drawings. This derives from the *fill*, which is in the same document,
     * so it is derivation rather than theming -- same input, same answer,
     * everywhere.
     */
    const node = withFill('#111827');
    expect(labelInk(node)).toBe(labelInk(node));
    expect(labelInk(node)).toBe(labelInk(withFill('#111827')));
  });
});

describe('solidFillOf', () => {
  it('reads the first solid fill', () => {
    expect(solidFillOf(withFill('#ABCDEF'))).toBe('#ABCDEF');
  });

  it('has no answer for a gradient', () => {
    const grad = {
      id: 'n', type: 'shape',
      appearance: { fill: [{ type: 'linear', stops: [] }] },
    } as unknown as AnyNode;
    expect(solidFillOf(grad)).toBeUndefined();
  });
});
