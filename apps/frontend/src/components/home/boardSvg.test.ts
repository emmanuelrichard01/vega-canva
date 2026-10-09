import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- jsdom is installed for Vitest without @types/jsdom; only its XML parser is used here.
import { JSDOM } from 'jsdom';
import type { NewNodeInput } from '../../engine/document/mutations';
import { TEMPLATES } from '../../engine/templates/templates';
import {
  box, chart, code, frame, link, note, plot, sketched, sticky, table, title,
} from '../../engine/templates/templateKit';
import { renderBoardSvg } from './boardSvg';

/** Run without a DOM, as the renderer's fallbacks are what a test can check; parsed with jsdom's XML parser. */
const { DOMParser } = new JSDOM().window as { DOMParser: typeof globalThis.DOMParser };

/** Where an SVG fails to parse, or null. */
function malformed(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  return error ? (error.textContent ?? 'parsererror').slice(0, 300) : null;
}

beforeAll(() => {
  // Icon packs and emoji artwork are fetched; offline, they draw placeholders.
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
});

/** A board touching every kind the renderer draws. */
function everyKind(): NewNodeInput[] {
  const a = box(40, 120, 200, 80, 'API gateway', 'indigo');
  const b = box(420, 120, 200, 80, 'Orders service', 'teal', sketched('light'));
  const pane = frame(0, 400, 900, 520, 'Data');
  return [
    title(40, 20, 'Every kind'),
    a,
    b,
    link(a.id, b.id, { label: 'gRPC', routing: 'orthogonal' }),
    { id: 'diamond', type: 'shape', x: 700, y: 120, width: 120, height: 90, text: 'Valid?', geometry: { kind: 'diamond' }, appearance: { fill: [{ type: 'solid', color: '#FEF3C7' }], stroke: { color: '#B45309', width: 1.5 } }, typography: { fontSize: 14, color: '#1F2937' } } as unknown as NewNodeInput,
    { id: 'arrow', type: 'shape', x: 40, y: 260, width: 200, height: 0, geometry: { kind: 'arrow' }, appearance: { stroke: { color: '#334155', width: 2 } } } as unknown as NewNodeInput,
    sticky(700, 240, 'Ship the retry budget first', 'yellow'),
    note(40, 300, 'Every request carries a trace id from the edge.', 340),
    pane,
    chart(40, 460, plot('line', {}), 400, 260),
    table(480, 460, { columns: [{ width: 1 }, { width: 1 }], cells: [['Plan', 'MRR'], ['Pro', '=120*42']] } as never, 380, 200),
    code(480, 700, 'SELECT 1;', 'sql', 380, 180),
    { id: 'pen', type: 'path', x: 960, y: 120, width: 120, height: 80, geometry: { kind: 'bezier', closed: false, segments: [{ point: { x: 0, y: 80 } }, { point: { x: 120, y: 0 } }] }, appearance: { stroke: { color: '#0F172A', width: 2 } } } as unknown as NewNodeInput,
  ];
}

describe('renderBoardSvg', () => {
  it('draws every kind of node as well-formed, finite SVG', async () => {
    const { svg, bounds, objectCount } = await renderBoardSvg(everyKind(), { idPrefix: 't1-', displayWidth: 600 });
    expect(objectCount).toBe(everyKind().length);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(malformed(svg)).toBeNull();
    expect(bounds.width).toBeGreaterThan(900);
    expect(svg).toContain('API gateway');
    expect(svg).toContain('gRPC');
    expect(svg).toContain('Data');
  });

  it('owns every id it writes, so two pictures of one board can share a page', async () => {
    const nodes = everyKind();
    const one = await renderBoardSvg(nodes, { idPrefix: 'hero-' });
    const two = await renderBoardSvg(nodes, { idPrefix: 'peek-' });
    const ids = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(one.svg).length).toBeGreaterThan(0);
    expect(ids(one.svg).filter((id) => !id.includes('hero-'))).toEqual([]);
    expect(ids(two.svg).filter((id) => !id.includes('peek-'))).toEqual([]);
    const refs = [...one.svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(refs.filter((id) => !id.includes('hero-'))).toEqual([]);
  });

  it('draws every catalogue board', async () => {
    const failures: string[] = [];
    for (const template of TEMPLATES) {
      try {
        const { svg } = await renderBoardSvg(template.build(150), { idPrefix: `c${template.id}-`, displayWidth: 320, maxSamples: 240 });
        if (/NaN|undefined/.test(svg)) failures.push(`${template.id}: NaN or undefined in markup`);
        const why = malformed(svg);
        if (why) failures.push(`${template.id}: not well-formed: ${why}`);
      } catch (error) {
        failures.push(`${template.id}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
