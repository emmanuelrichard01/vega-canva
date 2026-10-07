import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compactPath, svgToIcon } from '../../../scripts/icons/svgToIcon.mjs';
import { normalizeNode } from '../document/normalize';
import { artFor, clearIconCache, iconCacheStats } from './iconCache';
import { iconEntryNow, loadCatalogue, loadCategory, loadPackIndex, resetIconPacks, setIconFetcher } from './iconPacks';
import { searchCatalogue } from './iconSearch';
import { iconArtToSvg } from './iconSvg';
import { isIconId, normalizeIconSpec } from './iconSpec';

const PUBLIC = join(__dirname, '../../../public/icon-packs');

const HOSTILE = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 20" onload="alert(1)">
  <script>alert(2)</script>
  <style>path { fill: url(https://evil.example/x) }</style>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <image href="https://evil.example/p.png" width="5" height="5"/>
  <a xlink:href="javascript:alert(3)"><path d="M0 0H5V5Z" fill="#ff0000" onclick="alert(4)"/></a>
  <use href="https://evil.example/s.svg#a"/>
  <path d="M1 1 L2 2 <script>" fill="url(https://evil.example/g)"/>
  <rect width="4" height="4" fill="red" style="fill:#00ff00;background:url(http://x)"/>
  <text>hello</text>
</svg>`;

describe('svgToIcon sanitiser', () => {
  const out = svgToIcon(HOSTILE)!;
  const json = JSON.stringify({ viewBox: out.viewBox, paths: out.paths });

  it('keeps only drawable geometry', () => {
    expect(out.paths.length).toBeGreaterThan(0);
    for (const p of out.paths) expect(Object.keys(p).every((k) => ['d', 'f', 'fo', 'eo', 's', 'sw', 'so', 'lc', 'lj', 'm'].includes(k))).toBe(true);
  });
  it('removes scripts, handlers, external refs, styles and foreignObject', () => {
    expect(json).not.toMatch(/script|alert|onload|onclick|evil|javascript|http|foreign|style|passwd|hello|<|>/i);
  });
  it('drops path data that is not path syntax', () => {
    expect(compactPath('M1 1 L2 2 <script>', 2)).toBeNull();
    expect(compactPath('L1 1', 2)).toBeNull();
    expect(compactPath('M0 0 A1 1 0 011 1', 2)).toBe('M0 0A1 1 0 0 1 1 1');
  });
  it('resolves styles and colours to hex', () => {
    expect(out.paths.some((p) => p.f === '#00ff00')).toBe(true);
  });
  it('flattens gradients and bakes transforms', () => {
    const g = svgToIcon(
      `<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><g transform="translate(2 3)"><path d="M0 0H1V1z" fill="url(#g)"/></g></svg>`,
    )!;
    expect(g.paths[0].f).toBe('#808080');
    expect(g.paths[0].m).toEqual([1, 0, 0, 1, 2, 3]);
  });
});

describe('icon spec', () => {
  it('validates references against a strict charset', () => {
    expect(isIconId('svc-compute/amazon-ec2')).toBe(true);
    for (const bad of ['../../etc/passwd', 'a/b/c', 'a b/c', 'A/b', 'x/<s>', '']) expect(isIconId(bad)).toBe(false);
  });
  it('normalises a node, defaulting unusable references to the placeholder', () => {
    const n = normalizeNode({ type: 'icon', pack: 'aws', iconId: 'svc-compute/amazon-ec2', colour: '#ff0000', label: 'Web', width: 64, height: 64 }) as never as Record<string, unknown>;
    expect(n).toMatchObject({ type: 'icon', pack: 'aws', iconId: 'svc-compute/amazon-ec2', colour: '#ff0000', label: 'Web' });
    const bad = normalizeIconSpec({ pack: '../x', iconId: 'nope', colour: 'url(http://x)', label: 5 });
    expect(bad).toEqual({ pack: '', iconId: '' });
  });
});

describe('shipped packs', () => {
  beforeEach(() => {
    resetIconPacks();
    setIconFetcher(async (url) => JSON.parse(readFileSync(join(PUBLIC, url.replace(/^.*icon-packs\//, '')), 'utf8')));
  });

  it('round-trips the manifest and finds an icon by reference', async () => {
    const index = await loadPackIndex();
    expect(index!.packs.map((p) => p.id)).toEqual(expect.arrayContaining(['aws', 'azure', 'gcp', 'k8s']));
    expect(index!.unavailable.some((u) => u.id === 'cisco')).toBe(true);
    const aws = index!.packs.find((p) => p.id === 'aws')!;
    const cat = aws.cats.find((c) => c.id === 'svc-compute')!;
    const icons = await loadCategory('aws', cat.id);
    expect(icons.length).toBe(cat.count);
    const ec2 = icons.find((i) => /EC2$/.test(i.n))!;
    expect(iconEntryNow('aws', `svc-compute/${ec2.i}`)).toBe(ec2);
    expect(iconEntryNow('aws', 'svc-compute/does-not-exist')).toBeNull();
    expect(iconEntryNow('nope', 'svc-compute/x')).toBeNull();
    const svg = iconArtToSvg(ec2, 64, 64);
    expect(svg).toMatch(/^<g transform=/);
    expect(svg).not.toMatch(/script|on\w+=/i);
  });

  it('searches the catalogue', async () => {
    const cat = (await loadCatalogue('k8s'))!;
    const hits = searchCatalogue(cat, 'pvc');
    expect(hits[0].name).toBe('PersistentVolumeClaim');
    expect(searchCatalogue(cat, 'zzzz')).toEqual([]);
    const aws = (await loadCatalogue('aws'))!;
    expect(searchCatalogue(aws, 'lambda').some((h) => /lambda/i.test(h.name))).toBe(true);
    expect(searchCatalogue(aws, 'compute ec2').length).toBeGreaterThan(0);
  });
});

describe('icon cache', () => {
  beforeEach(() => {
    clearIconCache();
    vi.stubGlobal(
      'Path2D',
      class {
        addPath() {}
      },
    );
  });
  it('parses once for any number of instances', () => {
    const entry = { i: 'x', n: 'X', v: [10, 10] as [number, number], p: [{ d: 'M0 0H1V1z', f: '#000000' }, { d: 'M1 1H2V2z', f: '#ffffff', m: [1, 0, 0, 1, 1, 1] }] };
    const first = artFor('aws:svc-compute/x', entry);
    for (let i = 0; i < 2000; i++) expect(artFor('aws:svc-compute/x', entry)).toBe(first);
    expect(iconCacheStats().parses).toBe(1);
  });
});
