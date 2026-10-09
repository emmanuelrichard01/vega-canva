import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dropShadowFilter, shadowRegion, withDropShadow } from './svgShadow';

/**
 * Export parity for drop shadows: the file casts what the canvas casts.
 *
 * The SVG file had no drop shadows at all — every shadow on the board was
 * missing from the export. These pin the filter's arithmetic to the canvas's
 * (blur is twice sigma), and assert against the real exporter that a shape
 * with a fill and a stroke is wrapped in exactly one shadow, never one per
 * paint, and that a label does not cast.
 */

let objects: Record<string, any> = {};

vi.mock('../../hooks/useStore', () => ({
  useStore: { getState: () => ({ objects, selectedIds: [] }) },
}));
vi.mock('./inlineImages', () => ({
  inlineImageSources: async () => ({ embedded: new Map() }),
  fetchBlob: async () => null,
}));

const { SVGExporter } = await import('./SVGExporter');
const { normalizeNode } = await import('../document/normalize');

const shadow = { color: '#000000', blur: 12, offsetX: 0, offsetY: 4, spread: 0, opacity: 0.25 };

describe('dropShadowFilter', () => {
  it('blurs at half the canvas blur, which is sigma', () => {
    const f = dropShadowFilter('ds-a', shadow, { x: 0, y: 0, width: 10, height: 10 });
    expect(f).toContain('stdDeviation="6"');
    expect(f).toContain('dx="0" dy="4"');
    expect(f).toContain('flood-opacity="0.25"');
    expect(f).not.toContain('feMorphology');
  });

  it('grows the silhouette by the spread before the blur', () => {
    const f = dropShadowFilter('ds-a', { ...shadow, spread: 3 }, { x: 0, y: 0, width: 10, height: 10 });
    expect(f).toMatch(/feMorphology[^>]*operator="dilate"[^>]*radius="3"/);
    expect(f.indexOf('feMorphology')).toBeLessThan(f.indexOf('feGaussianBlur'));
  });

  it('cuts the shadow from under translucent ink only when asked', () => {
    expect(dropShadowFilter('a', shadow, { x: 0, y: 0, width: 1, height: 1 }, true)).toContain('operator="out"');
    expect(dropShadowFilter('a', shadow, { x: 0, y: 0, width: 1, height: 1 })).not.toContain('operator="out"');
  });

  it('keeps fractional values exact', () => {
    const f = dropShadowFilter('a', { ...shadow, blur: 1.5, offsetY: 0.5 }, { x: 0, y: 0, width: 1, height: 1 });
    expect(f).toContain('stdDeviation="0.75"');
    expect(f).toContain('dy="0.5"');
  });

  it('sizes its region to the reach, not to the default 10% margin', () => {
    const r = shadowRegion({ x: 0, y: 0, width: 100, height: 0 }, { ...shadow, blur: 40 });
    // half-diagonal 50 + reach (1.5 * 40 + 4 + 1)
    expect(r.width / 2).toBe(50 + 65);
  });

  it('leaves markup alone when there is no shadow', () => {
    expect(withDropShadow({ id: 'n', x: 0, y: 0, width: 1, height: 1 }, '<rect/>')).toBe('<rect/>');
    expect(
      withDropShadow({ id: 'n', x: 0, y: 0, width: 1, height: 1, appearance: { shadow: { ...shadow, opacity: 0 } } }, '<rect/>')
    ).toBe('<rect/>');
  });
});

describe('SVG export of drop shadows', () => {
  beforeEach(() => {
    objects = {};
  });

  const add = (raw: any) => {
    const node = normalizeNode(raw)!;
    objects[node.id] = node;
    return node;
  };

  const exportSvg = () => new SVGExporter().export({ format: 'svg', background: 'transparent' } as any);

  it('wraps a filled, stroked shape in one shadow, not one per paint', async () => {
    add({
      id: 'box',
      type: 'shape',
      x: 10,
      y: 10,
      width: 100,
      height: 60,
      zIndex: 1,
      geometry: { kind: 'rect' },
      appearance: { fill: [{ type: 'solid', color: '#ffffff' }], stroke: { color: '#111111', width: 0.25 }, shadow },
      text: 'Label',
      typography: { fontFamily: 'Inter', fontSize: 14, fontWeight: 400, color: '#111111', align: 'center', lineHeight: 1.2 },
    });
    const svg = await exportSvg();
    expect(svg.match(/<filter id="ds-box"/g)).toHaveLength(1);
    expect(svg.match(/filter="url\(#ds-box\)"/g)).toHaveLength(1);
    // A hairline survives the trip without rounding.
    expect(svg).toContain('stroke-width="0.25"');
    // The label is drawn after the shadowed group closes: it does not cast.
    const group = svg.slice(svg.indexOf('filter="url(#ds-box)"'));
    expect(group.indexOf('</g>')).toBeLessThan(group.indexOf('Label'));
  });

  it('casts from an outline with no fill', async () => {
    add({
      id: 'ring',
      type: 'shape',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      zIndex: 1,
      geometry: { kind: 'ellipse' },
      appearance: { fill: [{ type: 'solid', color: 'transparent', opacity: 0 }], stroke: { color: '#111111', width: 2 }, shadow },
    });
    const svg = await exportSvg();
    expect(svg).toContain('filter="url(#ds-ring)"');
  });

  it('casts the glow instead of the shadow on text that has both, as the canvas does', async () => {
    add({
      id: 't',
      type: 'text',
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      zIndex: 1,
      text: 'Hello',
      typography: { fontFamily: 'Inter', fontSize: 20, fontWeight: 400, color: '#111111', align: 'left', lineHeight: 1.2, glow: { color: '#ff0000', blur: 6 } },
      appearance: { shadow },
    });
    const svg = await exportSvg();
    expect(svg).toContain('glow-t');
    expect(svg).not.toContain('ds-t');
  });
});

describe('spread, radius and inner shadows in the file', () => {
  beforeEach(() => {
    objects = {};
  });

  const add = (raw: any) => {
    const node = normalizeNode(raw)!;
    objects[node.id] = node;
    return node;
  };
  const exportSvg = () => new SVGExporter().export({ format: 'svg', background: 'transparent' } as any);
  const card = (id: string, appearance: any, cornerRadius: any = 12) => ({
    id,
    type: 'shape',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    zIndex: 1,
    geometry: { kind: 'rect' },
    appearance: { fill: [{ type: 'solid', color: '#ffffff' }], cornerRadius, ...appearance },
  });

  it('shrinks the silhouette for a negative spread', () => {
    const f = dropShadowFilter('a', { ...shadow, spread: -4 }, { x: 0, y: 0, width: 1, height: 1 });
    expect(f).toMatch(/feMorphology[^>]*operator="erode"[^>]*radius="4"/);
  });

  it('casts a spread rounded card from a grown rounded outline, not a square morphology', async () => {
    add(card('c', { shadow: { ...shadow, spread: 8 } }));
    const svg = await exportSvg();
    expect(svg).not.toContain('feMorphology');
    // The 100x60 card grown by 8 on every side, its corners grown 12 -> 20.
    expect(svg).toContain('<path d="M12 -8');
    expect(svg).toMatch(/A20 20 0 0 1 108 12/);
  });

  it('keeps a square corner square when it spreads, per corner', async () => {
    add(card('p', { shadow: { ...shadow, spread: 4 } }, [0, 16, 0, 16]));
    const svg = await exportSvg();
    // Top-left starts at the grown box's corner itself: no arc there.
    expect(svg).toContain('<path d="M-4 -4');
    expect(svg).toMatch(/A20 20 0 0 1 104 16/);
  });

  it('draws a radius past half the short side as a circular corner', async () => {
    add(card('r', {}, 80));
    const svg = await exportSvg();
    expect(svg).toContain('rx="30"');
  });

  it('exports the inner shadow, clipped to the shape and off its stroke', async () => {
    add(card('i', { stroke: { color: '#111111', width: 4 }, innerShadow: { ...shadow, spread: 2 } }));
    const svg = await exportSvg();
    expect(svg).toContain('<filter id="is-i"');
    expect(svg).toMatch(/feMorphology in="SourceAlpha" operator="erode" radius="2"/);
    expect(svg).toContain('tableValues="1 0"');
    expect(svg).toMatch(/operator="dilate" radius="2"/);
    expect(svg).toContain('stdDeviation="6"');
  });

  it('leaves a hidden shadow out of the file', async () => {
    add(card('h', { shadow: { ...shadow, visible: false }, innerShadow: { ...shadow, visible: false } }));
    const svg = await exportSvg();
    expect(svg).not.toContain('ds-h');
    expect(svg).not.toContain('is-h');
  });

  it('clips a rounded picture, so its shadow is rounded too', async () => {
    add({ id: 'img', type: 'image', x: 0, y: 0, width: 80, height: 80, zIndex: 1, src: 'https://example.com/a.png', appearance: { cornerRadius: 16, shadow } });
    const svg = await exportSvg();
    expect(svg).toContain('clip-path="url(#ic-img)"');
    expect(svg).toContain('filter="url(#ds-img)"');
  });
});
