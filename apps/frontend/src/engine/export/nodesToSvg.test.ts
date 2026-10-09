import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- jsdom is installed for Vitest without @types/jsdom; only its XML parser is used here.
import { JSDOM } from 'jsdom';
import { normalizeNode } from '../document/normalize';
import type { AnyNode } from '../model/schema';
import { nodesToSvg } from './nodesToSvg';
import { assembleSvg } from './svgDocument';

/**
 * The shared SVG writer: the markup the export and the gallery draw with.
 * Each case is something a reader of the file would see go wrong.
 */

const { DOMParser } = new JSDOM().window as { DOMParser: typeof globalThis.DOMParser };

beforeAll(() => {
  // Icon packs and emoji artwork are fetched; offline, they draw placeholders.
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
});

const node = (raw: Record<string, unknown>) => normalizeNode(raw) as AnyNode;

async function svgOf(nodes: AnyNode[], options: Parameters<typeof nodesToSvg>[1] = {}) {
  const { body, defs } = await nodesToSvg(nodes, options);
  return assembleSvg({ bounds: { x: -100, y: -100, width: 1200, height: 900 }, defs, background: null, body });
}

function parseError(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  return error ? (error.textContent ?? 'parsererror') : null;
}

/** No element may carry an attribute twice: XML forbids it and strict readers reject the file. */
function duplicateAttributes(svg: string): string[] {
  const out: string[] = [];
  for (const tag of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const names = [...tag[0].matchAll(/\s([a-zA-Z:-]+)="/g)].map((m) => m[1]);
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) out.push(`${n} in ${tag[0].slice(0, 80)}`);
      seen.add(n);
    }
  }
  return out;
}

const box = (id: string, x: number, extra: Record<string, unknown> = {}) =>
  node({ id, type: 'shape', x, y: 0, width: 160, height: 80, geometry: { kind: 'rect' }, ...extra });

describe('stroke ends', () => {
  it('writes one stroke-linecap on a connector that has both a dash and its own cap', async () => {
    const link = node({
      id: 'c',
      type: 'connector',
      from: { nodeId: 'a' },
      to: { nodeId: 'b' },
      appearance: { stroke: { color: '#334155', width: 2, dash: [6, 4], cap: 'butt' } },
    });
    const svg = await svgOf([box('a', 0), box('b', 400), link]);
    expect(duplicateAttributes(svg)).toEqual([]);
    expect(parseError(svg)).toBeNull();
    const path = /<path [^>]*stroke-dasharray="6 4"[^>]*>/.exec(svg)?.[0] ?? '';
    expect(path).toContain('stroke-linecap="butt"');
  });

  it('keeps a dotted connector round when it names no cap, so the dots are not drawn as nothing', async () => {
    const link = node({
      id: 'd',
      type: 'connector',
      from: { x: 0, y: 0 },
      to: { x: 300, y: 0 },
      appearance: { stroke: { color: '#000000', width: 2, dash: [0, 6] } },
    });
    expect(await svgOf([link])).toMatch(/stroke-dasharray="0 6" stroke-linecap="round"/);
  });

  it('writes one cap on dashed and capped shapes, crisp and sketched', async () => {
    const stroke = { color: '#111827', width: 3, dash: [8, 4], cap: 'square' };
    const svg = await svgOf([
      box('crisp', 0, { appearance: { stroke } }),
      box('rough', 300, { appearance: { stroke, sketch: 'loose' } }),
      node({ id: 'star', type: 'shape', x: 600, y: 0, width: 100, height: 100, geometry: { kind: 'star' }, appearance: { stroke } }),
    ]);
    expect(duplicateAttributes(svg)).toEqual([]);
    expect(parseError(svg)).toBeNull();
  });
});

describe('parity with the canvas', () => {
  it('wraps a shape label inside its box and inks it for a dark fill', async () => {
    const shape = box('label', 0, {
      width: 120,
      text: 'A label long enough to need several lines',
      appearance: { fill: [{ type: 'solid', color: '#111827' }] },
    });
    const svg = await svgOf([shape]);
    const lines = [...svg.matchAll(/<text [^>]*>([^<]+)<\/text>/g)];
    expect(lines.length).toBeGreaterThan(1);
    // The default near-black ink becomes light on a near-black fill, as `labelInk` derives it.
    const ink = /fill="([^"]+)"/.exec(lines[0][0])?.[1] ?? '';
    expect(ink.toUpperCase()).toMatch(/^#F/);
  });

  it('turns a rotated path with the node, as the renderer does', async () => {
    const pen = node({
      id: 'pen',
      type: 'path',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      rotation: 30,
      geometry: { kind: 'bezier', closed: false, segments: [{ point: { x: 0, y: 0 } }, { point: { x: 100, y: 50 } }] },
      appearance: { stroke: { color: '#000000', width: 2 } },
    });
    expect(await svgOf([pen])).toContain('rotate(30)');
  });

  it('leaves a frame with no background unfilled and keeps its edge', async () => {
    // As the document holds a frame whose background was removed.
    const frame = { ...node({ id: 'f', type: 'frame', x: 0, y: 0, width: 400, height: 300, title: 'Page' }), appearance: { fill: [] } } as AnyNode;
    expect(await svgOf([frame])).toMatch(/<rect [^>]*fill="none"[^>]*stroke="rgba\(115,115,115,0.45\)"/);
  });

  it('labels a connector in ink that reads on the ground it is exported on', async () => {
    const link = node({
      id: 'g',
      type: 'connector',
      from: { x: 0, y: 0 },
      to: { x: 300, y: 0 },
      labels: [{ id: 'l', text: 'HTTPS' }],
      appearance: { stroke: { color: '#94A3B8', width: 2 } },
    });
    const ink = (svg: string) => /<text [^>]*fill="([^"]+)"[^>]*>HTTPS/.exec(svg)?.[1];
    const light = ink(await svgOf([link], { ground: '#FFFFFF' }));
    const dark = ink(await svgOf([link], { ground: '#161616' }));
    expect(light).toBeDefined();
    expect(light).not.toBe(dark);
  });
});

describe('comments, replacements and cancelling', () => {
  const comment = node({
    id: 'cm',
    type: 'comment',
    x: 50,
    y: 60,
    width: 0,
    height: 0,
    text: 'Is this the final copy?',
    author: { id: 'u', name: 'Ada', color: '#0EA5E9' },
    resolved: false,
  });

  it('leaves comments out unless asked, and then draws them over everything', async () => {
    const shape = box('s', 0);
    expect(await svgOf([comment, shape])).not.toContain('final copy');
    const { body } = await nodesToSvg([comment, shape], { includeComments: true });
    expect(body[body.length - 1]).toContain('Ada: Is this the final copy?');
    expect(parseError(await svgOf([comment, shape], { includeComments: true }))).toBeNull();
  });

  it('draws the markup it is handed in place of a node', async () => {
    const text = node({ id: 't', type: 'text', x: 0, y: 0, width: 200, height: 40, text: 'Outlined' });
    const { body } = await nodesToSvg([text], { replace: new Map([['t', '<path d="M0 0L1 1" />']]) });
    expect(body).toEqual(['<path d="M0 0L1 1" />']);
  });

  it('stops when the export is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(nodesToSvg([box('x', 0)], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
