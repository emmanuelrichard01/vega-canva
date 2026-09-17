import { describe, expect, it } from 'vitest';
import type { AnyNode } from './schema';
import { applyStylePatches, canPasteStyle, extractStyle } from './styleClipboard';
import { matchingIds } from './selectMatching';

const base = {
  x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 0,
  locked: false, hidden: false, createdBy: 'a', createdAt: 0, updatedAt: 0,
};

const rect = (id: string, color = '#f00', extra: Record<string, unknown> = {}) =>
  ({
    ...base, id, type: 'shape', geometry: { kind: 'rect' },
    appearance: { fill: [{ type: 'solid', color }], stroke: { color: '#000', width: 2 }, cornerRadius: 12 },
    ...extra,
  }) as unknown as AnyNode;

const ellipse = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    ...base, id, type: 'shape', geometry: { kind: 'ellipse' },
    appearance: { fill: [{ type: 'solid', color: '#0f0' }], shadow: { color: '#000', blur: 4 } },
    ...extra,
  }) as unknown as AnyNode;

const connector = (id: string) =>
  ({ ...base, id, type: 'connector', routing: 'straight', appearance: {} }) as unknown as AnyNode;

const table = (id: string) => ({ ...base, id, type: 'table', table: {} }) as unknown as AnyNode;

describe('style clipboard', () => {
  it('carries fill and stroke to a shape but keeps what the source had no opinion on', () => {
    const style = extractStyle(rect('src', '#abcdef'));
    const [patch] = applyStylePatches([ellipse('e')], style);
    const appearance = patch.changes.appearance as Record<string, unknown>;
    expect(appearance.fill).toEqual([{ type: 'solid', color: '#abcdef' }]);
    expect(appearance.shadow).toEqual({ color: '#000', blur: 4 });
    // A rectangle's corner radius is not written to an ellipse, which ignores it.
    expect(appearance.cornerRadius).toBeUndefined();
  });

  it('gives a connector the stroke but never a fill', () => {
    const style = extractStyle(rect('src'));
    const [patch] = applyStylePatches([connector('c')], style);
    const appearance = patch.changes.appearance as Record<string, unknown>;
    expect(appearance.stroke).toEqual({ color: '#000', width: 2 });
    expect(appearance.fill).toBeUndefined();
  });

  it('offers nothing to a type that can take none of it', () => {
    const style = extractStyle(rect('src', '#f00', { opacity: 0.5 }));
    expect(canPasteStyle([table('t')], style)).toBe(false);
  });

  it('skips locked targets', () => {
    const style = extractStyle(rect('src'));
    expect(applyStylePatches([ellipse('e', { locked: true })], style)).toEqual([]);
  });

  it('copies a snapshot, so editing the source afterwards does not change the paste', () => {
    const source = rect('src', '#111111');
    const style = extractStyle(source);
    (source as unknown as { appearance: { fill: { color: string }[] } }).appearance.fill[0].color = '#999999';
    const [patch] = applyStylePatches([ellipse('e')], style);
    expect((patch.changes.appearance as { fill: { color: string }[] }).fill[0].color).toBe('#111111');
  });
});

describe('select matching', () => {
  it('matches by geometry kind, so a line is not a rectangle', () => {
    const line = { ...ellipse('l'), geometry: { kind: 'line' } } as unknown as AnyNode;
    const all = [rect('a'), rect('b', '#00f'), line];
    expect(matchingIds(all, [all[0]], 'kind')).toEqual(['a', 'b']);
  });

  it('matches by style within a kind', () => {
    const all = [rect('a', '#f00'), rect('b', '#00f'), rect('c', '#F00')];
    expect(matchingIds(all, [all[0]], 'style')).toEqual(['a', 'c']);
  });

  it('leaves hidden objects out', () => {
    const all = [rect('a'), rect('b', '#f00', { hidden: true })];
    expect(matchingIds(all, [all[0]], 'kind')).toEqual(['a']);
  });
});
