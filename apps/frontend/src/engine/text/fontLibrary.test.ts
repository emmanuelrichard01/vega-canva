import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fontEntry, fontStack, nearestWeight, weightsFor } from './fontCatalogue';
import {
  bestFace,
  dynamicEntry,
  ensureDynamicFamily,
  faceSrc,
  resetFontLibraryForTests,
  setBoardFamilies,
  setLocalFamilies,
  weightsOfFaces,
  type DynamicFamily,
} from './fontLibrary';
import { fontEpoch } from './fontEpoch';
import { familiesInNodes, fontFaceCss, usesLocalFonts } from './fontEmbed';
import { probeInstalled } from './fontAvailability';
import { groupLocalFonts } from './localFonts';

const brand: DynamicFamily = {
  family: 'Brand Sans',
  source: 'board',
  faces: [
    { weight: 400, italic: false, style: 'Regular', source: { kind: 'url', url: 'https://api.test/rooms/r/media/a.woff2', format: 'woff2' } },
    { weight: 700, italic: false, style: 'Bold', source: { kind: 'url', url: 'https://api.test/rooms/r/media/b.woff2', format: 'woff2' } },
    { weight: 400, italic: true, style: 'Italic', source: { kind: 'url', url: 'https://api.test/rooms/r/media/c.woff2', format: 'woff2' } },
  ],
};

beforeEach(() => resetFontLibraryForTests());

describe('runtime families in the catalogue', () => {
  it('behave like built-in entries once registered', () => {
    expect(fontEntry('Brand Sans')).toBeUndefined();
    setBoardFamilies([brand]);
    expect(fontEntry('Brand Sans')?.source).toBe('board');
    expect(weightsFor('Brand Sans')).toEqual([400, 700]);
    expect(nearestWeight('Brand Sans', 600)).toBe(700);
    expect(fontStack('Brand Sans').startsWith("'Brand Sans'")).toBe(true);
  });

  it('board families win a name clash with device families', () => {
    setLocalFamilies([{ ...brand, source: 'local', faces: [] }]);
    setBoardFamilies([brand]);
    expect(dynamicEntry('Brand Sans')?.source).toBe('board');
  });

  it('expands a variable range onto the weight ladder', () => {
    expect(
      weightsOfFaces([{ weight: 400, weightMin: 300, weightMax: 700, italic: false, style: 'Var', source: { kind: 'local', postscriptName: 'V' } }])
    ).toEqual([300, 400, 500, 600, 700]);
  });

  it('picks the nearest face, slant first', () => {
    expect(bestFace(brand.faces, 600, false)?.style).toBe('Bold');
    expect(bestFace(brand.faces, 700, true)?.style).toBe('Italic');
  });

  it('writes safe CSS sources', () => {
    expect(faceSrc({ kind: 'local', postscriptName: 'Evil")Name' })).toBe('local("Evil)Name")');
    expect(faceSrc({ kind: 'url', url: 'https://x/a.ttf', format: 'ttf' })).toBe('url("https://x/a.ttf") format("truetype")');
  });
});

describe('loading through FontFace', () => {
  const created: string[] = [];
  const added: unknown[] = [];

  beforeEach(() => {
    created.length = 0;
    added.length = 0;
    class FakeFontFace {
      constructor(family: string, src: string) {
        created.push(`${family} ${src}`);
      }
      load() {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: (f: unknown) => added.push(f) } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('registers each face once, however often it is asked for', async () => {
    setBoardFamilies([brand]);
    const before = fontEpoch.get();
    await ensureDynamicFamily('Brand Sans');
    await ensureDynamicFamily('Brand Sans');
    expect(created).toHaveLength(3);
    expect(added).toHaveLength(3);
    // Arrival moves the epoch, so text measured against the fallback is redone.
    expect(fontEpoch.get()).toBeGreaterThan(before);
  });

  it('loads a family asked for before the registry knew it, once it arrives', async () => {
    await ensureDynamicFamily('Brand Sans');
    expect(created).toHaveLength(0);
    setBoardFamilies([brand]);
    await new Promise((r) => setTimeout(r, 0));
    expect(created).toHaveLength(3);
  });
});

describe('export embedding', () => {
  it('finds every family a node names, however deep', () => {
    const nodes = [
      { typography: { fontFamily: 'Brand Sans' } },
      { table: { cells: [[{ style: { fontFamily: 'Lora' } }]] } },
      { fontFamily: 'Inter' },
    ];
    expect(familiesInNodes(nodes)).toEqual(['Brand Sans', 'Inter', 'Lora']);
  });

  it('embeds uploaded faces, and local ones only when chosen', async () => {
    setBoardFamilies([brand]);
    setLocalFamilies([{ family: 'Mine', source: 'local', faces: [{ weight: 400, italic: false, style: 'Regular', source: { kind: 'local', postscriptName: 'Mine-Regular' } }] }]);
    const fetchBytes = vi.fn(async () => new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2]).buffer);
    const localBlob = vi.fn(async () => new Blob([new Uint8Array([0x00, 0x01, 0x00, 0x00, 9])]));

    const css = await fontFaceCss(['Brand Sans', 'Mine', 'Inter'], { fetchBytes, localBlob });
    expect(css.match(/@font-face/g)).toHaveLength(3);
    expect(css).toContain("font-family:'Brand Sans'");
    expect(css).toContain('font-style:italic');
    expect(css).not.toContain('Mine');
    expect(localBlob).not.toHaveBeenCalled();

    const withLocal = await fontFaceCss(['Mine'], { fetchBytes, localBlob, embedLocal: true });
    expect(withLocal).toContain("font-family:'Mine'");
    expect(withLocal).toContain("format('truetype')");
    expect(usesLocalFonts(['Mine'])).toBe(true);
    expect(usesLocalFonts(['Brand Sans'])).toBe(false);
  });
});

describe('device fonts', () => {
  it('groups faces by family and leaves out built-in families', () => {
    const fams = groupLocalFonts([
      { family: 'Acme Grotesk', postscriptName: 'AcmeGrotesk-Bold', style: 'Bold' },
      { family: 'Acme Grotesk', postscriptName: 'AcmeGrotesk-Regular', style: 'Regular' },
      { family: 'Inter', postscriptName: 'Inter-Regular', style: 'Regular' },
    ]);
    expect(fams.map((f) => f.family)).toEqual(['Acme Grotesk']);
    expect(fams[0].faces.map((f) => f.weight)).toEqual([400, 700]);
  });

  it('tells installed from missing by measurement', () => {
    const installed = (font: string) => (font.includes('"Here"') ? 120 : 100);
    expect(probeInstalled('Here', installed)).toBe('installed');
    expect(probeInstalled('Gone', () => 100)).toBe('missing');
    expect(probeInstalled('Any', null)).toBe('unknown');
  });
});
