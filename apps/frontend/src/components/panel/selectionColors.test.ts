import { describe, expect, it } from 'vitest';
import { colorUses, recolorPatches, textStyles } from './selectionColors';
import type { AnyNode } from '../../engine/model/schema';

const shape = (id: string, fill: string, stroke?: string, text?: string): AnyNode =>
  ({
    id,
    type: 'shape',
    text,
    appearance: {
      fill: [{ type: 'solid', color: fill }],
      ...(stroke ? { stroke: { color: stroke, width: 2 } } : {}),
    },
    typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 400, color: '#111111' },
  }) as unknown as AnyNode;

describe('colorUses', () => {
  it('lists unique colours most used first, case-insensitively', () => {
    const uses = colorUses([shape('a', '#ff0000', '#000000'), shape('b', '#FF0000'), shape('c', '#00ff00')]);
    expect(uses[0]).toMatchObject({ color: '#FF0000', count: 2, ids: ['a', 'b'], roles: ['fill'] });
    expect(uses.map((u) => u.color)).toEqual(['#FF0000', '#000000', '#00FF00']);
  });

  it('counts text colour only where there is text', () => {
    const uses = colorUses([shape('a', '#ffffff', undefined, ''), shape('b', '#ffffff', undefined, 'Hello')]);
    expect(uses.find((u) => u.color === '#111111')?.ids).toEqual(['b']);
  });
});

describe('recolorPatches', () => {
  it('repaints every use in one batch of patches', () => {
    const nodes = [shape('a', '#ff0000', '#ff0000'), shape('b', '#00ff00'), shape('c', '#FF0000')];
    const patches = recolorPatches(nodes, '#FF0000', '#0000ff');
    expect(patches.map((p) => p.id)).toEqual(['a', 'c']);
    const a = patches[0].changes.appearance as { fill: { color: string }[]; stroke: { color: string } };
    expect(a.fill[0].color).toBe('#0000ff');
    expect(a.stroke.color).toBe('#0000ff');
  });

  it('touches gradient stops and text, and nothing it does not match', () => {
    const grad = {
      id: 'g',
      type: 'shape',
      text: 'Hi',
      appearance: { fill: [{ type: 'linear', angle: 0, stops: [{ offset: 0, color: '#123456' }, { offset: 1, color: '#abcdef' }] }] },
      typography: { fontFamily: 'Inter', fontSize: 12, color: '#123456' },
    } as unknown as AnyNode;
    const [patch] = recolorPatches([grad], '#123456', '#000000');
    const fill = (patch.changes.appearance as { fill: { stops: { color: string }[] }[] }).fill[0];
    expect(fill.stops.map((s) => s.color)).toEqual(['#000000', '#abcdef']);
    expect((patch.changes.typography as { color: string }).color).toBe('#000000');
    expect(recolorPatches([grad], '#999999', '#000000')).toEqual([]);
  });
});

describe('textStyles', () => {
  it('groups by family, size and weight', () => {
    const t = (id: string, size: number) =>
      ({ id, type: 'text', typography: { fontFamily: 'Inter', fontSize: size, fontWeight: 400, color: '#000' } }) as unknown as AnyNode;
    const styles = textStyles([t('a', 16), t('b', 16), t('c', 24)]);
    expect(styles[0]).toMatchObject({ size: 16, count: 2, ids: ['a', 'b'] });
    expect(styles[1]).toMatchObject({ size: 24, count: 1 });
  });
});
