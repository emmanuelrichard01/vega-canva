import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  FONTS,
  boldWeightFor,
  canBold,
  fontEntry,
  fontStack,
  hasTrueItalic,
  nearestWeight,
  searchFonts,
  weightName,
  weightsFor,
} from './fontCatalogue';

describe('the catalogue is internally consistent', () => {
  it('has no duplicate families', () => {
    const names = FONTS.map((f) => f.family);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every category at least two faces', () => {
    // A group of one is a heading with nothing under it, which reads as a
    // mistake rather than as a category.
    for (const c of CATEGORIES) {
      expect(FONTS.filter((f) => f.category === c.id).length).toBeGreaterThan(1);
    }
  });

  it('puts every font in a category the picker will render', () => {
    const known = new Set(CATEGORIES.map((c) => c.id));
    for (const f of FONTS) expect(known.has(f.category)).toBe(true);
  });

  it('gives every Google-hosted face a spec, and nothing else one', () => {
    /**
     * The spec is what the lazy loader turns into a stylesheet URL. A Google
     * face without one silently never loads; a bundled face *with* one would
     * fetch a family that is already compiled in.
     */
    for (const f of FONTS) {
      if (f.source === 'google') expect(f.spec, f.family).toBeTruthy();
      else expect(f.spec, f.family).toBeUndefined();
    }
  });

  it('gives every face at least one real weight', () => {
    for (const f of FONTS) expect(f.weights.length, f.family).toBeGreaterThan(0);
  });

  it('keeps weights on the standard ladder, ascending', () => {
    for (const f of FONTS) {
      expect(f.weights, f.family).toEqual([...f.weights].sort((a, b) => a - b));
      for (const w of f.weights) expect(w % 100, f.family).toBe(0);
    }
  });

  it('offers Regular everywhere', () => {
    // Every face here has a 400, and the default typography is 400 — a family
    // without one would render the app's default as a synthesised weight the
    // moment it was chosen.
    for (const f of FONTS) expect(f.weights, f.family).toContain(400);
  });
});

describe('a font stack is built, not listed', () => {
  it('names the family, its aliases, then a generic', () => {
    expect(fontStack('Inter')).toBe(
      "'Inter', 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    );
  });

  it('falls back within the right genre', () => {
    // A serif waiting for its webfont should wait in a serif, not in the
    // system sans — otherwise the block reflows *and* changes voice when the
    // real face lands.
    expect(fontStack('Lora')).toContain('serif');
    expect(fontStack('JetBrains Mono')).toContain('monospace');
    expect(fontStack('Caveat')).toContain('cursive');
  });

  it('honours a family this build has never heard of', () => {
    /**
     * A document may carry a face from another install, or from a future
     * catalogue. Quoting the name lets the OS supply it if it can; dropping to
     * the default would silently rewrite somebody's board and look like it had
     * always been that way.
     */
    const out = fontStack('Some Corporate Sans');
    expect(out.startsWith("'Some Corporate Sans'")).toBe(true);
  });

  it('cannot be broken out of by a family name', () => {
    // The name reaches a CSS declaration, so a quote in it would end the
    // string early.
    expect(fontStack("Ev'il', monospace; x:")).not.toContain("'Ev'");
  });

  it('has something to say about nothing', () => {
    expect(fontStack(undefined)).toContain('Inter');
  });
});

describe('weights answer for the face in hand', () => {
  it('reports what a family actually has', () => {
    expect(weightsFor('Bebas Neue')).toEqual([400]);
    expect(weightsFor('Libre Baskerville')).toEqual([400, 700]);
    expect(weightsFor('Inter')).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('names them the way people do', () => {
    expect(weightName(400)).toBe('Regular');
    expect(weightName(600)).toBe('Semi Bold');
    expect(weightName(900)).toBe('Black');
  });

  it('snaps to the nearest real weight when the face changes', () => {
    /**
     * The case this exists for: text set in Inter Thin, retyped in Libre
     * Baskerville. Keeping `100` would leave the document rendering a
     * *synthesised* thin — the same board, quietly in a face nobody chose.
     */
    expect(nearestWeight('Libre Baskerville', 100)).toBe(400);
    expect(nearestWeight('Libre Baskerville', 800)).toBe(700);
    expect(nearestWeight('Bebas Neue', 900)).toBe(400);
  });

  it('leaves a weight the face has alone', () => {
    expect(nearestWeight('Inter', 300)).toBe(300);
  });

  it('breaks a tie towards the heavier', () => {
    // The ladder is perceptually uneven at the light end, and of two equally
    // distant neighbours the heavier is the one that still reads small.
    expect(nearestWeight('Libre Baskerville', 550)).toBe(700);
  });

  it('sends Bold to a weight the family has', () => {
    expect(boldWeightFor('Inter')).toBe(700);
    expect(boldWeightFor('Bebas Neue')).toBe(400);
    expect(boldWeightFor('Space Grotesk')).toBe(700);
  });

  it('knows when a face cannot go bold at all', () => {
    // The old Bold button set 700 unconditionally: on a single-weight display
    // face it lit up and changed nothing.
    expect(canBold('Bebas Neue')).toBe(false);
    expect(canBold('Anton')).toBe(false);
    expect(canBold('Inter')).toBe(true);
  });

  it('gives an unknown family the whole ladder rather than a guess', () => {
    expect(weightsFor('Some Corporate Sans')).toHaveLength(9);
  });
});

describe('italics are declared, not assumed', () => {
  it('knows which faces have a drawn one', () => {
    expect(hasTrueItalic('Lora')).toBe(true);
    expect(hasTrueItalic('Bebas Neue')).toBe(false);
    expect(hasTrueItalic('Oswald')).toBe(false);
  });

  it('gives an unknown family the benefit of the doubt', () => {
    // Warning about a face the catalogue knows nothing about would be
    // inventing a problem.
    expect(hasTrueItalic('Some Corporate Sans')).toBe(true);
  });
});

describe('search finds a font by what it is for', () => {
  it('matches on name', () => {
    expect(searchFonts('garamond').map((f) => f.family)).toEqual(['EB Garamond']);
  });

  it('matches on the job, not only the name', () => {
    /**
     * Somebody looking for a font usually knows the job before the name —
     * "narrow" is a thing you need, "Archivo Narrow" is a thing you have to
     * already know about.
     */
    const narrow = searchFonts('narrow').map((f) => f.family);
    expect(narrow).toContain('Oswald');
    expect(narrow).toContain('Barlow Condensed');

    expect(searchFonts('code').map((f) => f.family)).toContain('JetBrains Mono');
  });

  it('is case and space insensitive', () => {
    expect(searchFonts('  JETBRAINS ').length).toBe(1);
  });

  it('returns everything for an empty query', () => {
    expect(searchFonts('')).toHaveLength(FONTS.length);
  });

  it('returns nothing rather than everything for a miss', () => {
    expect(searchFonts('zzzzz')).toHaveLength(0);
  });
});

describe('lookups', () => {
  it('finds an entry by family', () => {
    expect(fontEntry('Anton')?.category).toBe('display');
  });

  it('answers nothing for nothing', () => {
    expect(fontEntry(undefined)).toBeUndefined();
    expect(fontEntry('Nope')).toBeUndefined();
  });
});
