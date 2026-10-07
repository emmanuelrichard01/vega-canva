import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The exported file is opened directly by whoever receives it, so markup that
 * survives into it runs there. These nodes carry hostile values in every
 * string field the exporter writes into an attribute, bypassing `normalize`
 * on purpose: escaping in the exporter has to hold even for a value a
 * validator missed.
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

const PAYLOAD = '"/><img src=x onerror=alert(1)>';

function expectInert(svg: string) {
  const TAG = /<\/?([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*\/?>/g;
  for (const m of svg.matchAll(TAG)) {
    expect(m[1].toLowerCase()).not.toBe('img');
    expect(m[1].toLowerCase()).not.toBe('script');
    for (const a of m[2].matchAll(/([\w:-]+)="/g)) expect(a[1].toLowerCase().startsWith('on')).toBe(false);
  }
  // Text between well-formed tags never carries a raw bracket. The XML prolog
  // and comments are stripped first; they are not node content.
  const body = svg.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  expect(body.replace(TAG, '')).not.toMatch(/[<>]/);
}

function poison(node: any): any {
  if (node.appearance) {
    node.appearance.fill = [{ type: 'solid', color: PAYLOAD }];
    node.appearance.stroke = { color: PAYLOAD, width: 2, cap: PAYLOAD, join: PAYLOAD, dash: [4, 2] };
  }
  if (node.typography) {
    node.typography.color = PAYLOAD;
    node.typography.fontWeight = PAYLOAD;
    node.typography.highlight = { color: PAYLOAD, radius: 4, paddingX: 4, paddingY: 2, join: 'ribbon' };
    node.typography.outline = { color: PAYLOAD, width: 1 };
    node.typography.glow = { color: PAYLOAD, blur: 4 };
  }
  return node;
}

beforeEach(() => {
  objects = {};
});

describe('SVGExporter escapes every interpolated string', () => {
  it('shapes, text, paths and connectors with hostile colours export inert', async () => {
    const raw = [
      { id: PAYLOAD, type: 'shape', x: 0, y: 0, width: 100, height: 60, text: PAYLOAD, zIndex: 1 },
      { id: 't1', type: 'text', x: 0, y: 100, width: 200, height: 40, text: PAYLOAD, zIndex: 2 },
      {
        id: 'p1', type: 'path', x: 0, y: 200, width: 50, height: 50, zIndex: 3,
        geometry: { kind: 'freehand', svgPath: 'M0 0 L10 10', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      },
      { id: 'c1', type: 'connector', x: 0, y: 0, width: 0, height: 0, zIndex: 4, from: { x: 0, y: 0 }, to: { x: 100, y: 100 } },
    ];
    for (const r of raw) {
      const node = poison(normalizeNode(r));
      objects[node.id] = node;
    }
    // A path whose data was never validated must not escape its attribute.
    objects.p1.geometry.svgPath = PAYLOAD;

    const svg = await new SVGExporter().export({});
    expect(typeof svg).toBe('string');
    expectInert(svg as string);
    // The payload did reach the file, escaped, so the check above tested something.
    expect(svg).toContain('&quot;/&gt;&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('normalize strips hostile values before they reach a painter', () => {
  it('colours, text effects and freehand path data', () => {
    const node = normalizeNode({
      id: 'x', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'hi',
      typography: {
        color: PAYLOAD,
        highlight: { color: PAYLOAD },
        outline: { color: 'red', width: 1 },
        glow: { color: 'expression(alert(1))', blur: 2 },
      },
      appearance: { fill: [PAYLOAD], stroke: { color: PAYLOAD, width: 1 }, shadow: { color: PAYLOAD } },
    }) as any;
    expect(node.typography.color).not.toContain('<');
    expect(node.typography.highlight).toBeUndefined();
    expect(node.typography.outline.color).toBe('red');
    expect(node.typography.glow).toBeUndefined();
    expect(node.appearance.fill).toBeUndefined();
    expect(node.appearance.stroke).toBeUndefined();

    const path = normalizeNode({
      id: 'p', type: 'path', x: 0, y: 0, width: 1, height: 1,
      geometry: { kind: 'freehand', svgPath: 'M0 0" onload="alert(1)' },
    }) as any;
    expect(path.geometry.svgPath).toBe('');

    const ok = normalizeNode({
      id: 'q', type: 'path', x: 0, y: 0, width: 1, height: 1,
      geometry: { kind: 'freehand', svgPath: 'M0,0 L1.5e2 -3 Z' },
    }) as any;
    expect(ok.geometry.svgPath).toBe('M0,0 L1.5e2 -3 Z');
  });
});
