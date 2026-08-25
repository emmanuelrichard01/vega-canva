import { describe, expect, it } from 'vitest';
import { CURATED_PALETTES, paletteOf, tintsAndShades } from './colorRamp';
import { hexToHsv, luminance } from './color';

describe('tintsAndShades', () => {
  const BASE = '#3B82F6';

  it('runs light to dark, without a step out of order', () => {
    const ramp = tintsAndShades(BASE, 9);
    const light = ramp.map(luminance);
    for (let i = 1; i < light.length; i += 1) {
      expect(light[i]).toBeLessThan(light[i - 1]);
    }
  });

  it('holds the hue across every step', () => {
    /**
     * The property that makes it a ramp *of this colour*. A ramp that drifted
     * hue would be a set of related colours, which is a different and much less
     * useful thing: you would have to check each step against the original.
     */
    const base = hexToHsv(BASE)!;
    for (const step of tintsAndShades(BASE, 9)) {
      const hsv = hexToHsv(step)!;
      // Grey has no hue to compare -- the ends of a long ramp approach it.
      if (hsv.s < 0.02) continue;
      expect(Math.abs(hsv.h - base.h)).toBeLessThan(1);
    }
  });

  it('desaturates towards the light end and holds saturation at the dark one', () => {
    // Lightening by value alone runs to white through a chalky middle. Real
    // tint ramps drop saturation as they lighten, which is what keeps the pale
    // end looking tinted rather than faded.
    const ramp = tintsAndShades(BASE, 9);
    const sat = (hex: string) => hexToHsv(hex)!.s;
    expect(sat(ramp[0])).toBeLessThan(sat(ramp[4]));
    expect(sat(ramp[8])).toBeGreaterThanOrEqual(sat(ramp[4]));
  });

  it('stops short of pure white and pure black', () => {
    // A ramp whose ends are white and black wastes two of its nine steps on
    // colours that are already one click away in the neutrals row.
    const ramp = tintsAndShades(BASE, 9);
    expect(ramp[0].toUpperCase()).not.toBe('#FFFFFF');
    expect(ramp[8].toUpperCase()).not.toBe('#000000');
  });

  it('returns a grey ramp for a colour with no hue', () => {
    // Grey has no hue to hold, so a grey ramp is the honest answer. Inventing
    // one would hand back a colour nobody picked.
    for (const step of tintsAndShades('#808080', 9)) {
      expect(hexToHsv(step)!.s).toBeLessThan(0.02);
    }
  });

  it('gives a ramp for input that is not a colour at all', () => {
    // Called on whatever the picker is currently showing, which for a node with
    // no fill is the empty string.
    const ramp = tintsAndShades('', 9);
    expect(ramp).toHaveLength(9);
    for (const step of ramp) expect(step).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('handles a single-step ramp without dividing by zero', () => {
    expect(tintsAndShades(BASE, 1)).toHaveLength(1);
  });
});

describe('CURATED_PALETTES', () => {
  it('is the single source both pickers read', async () => {
    // The grid re-exports this list rather than keeping its own. Two copies of
    // a palette set is two palette sets that will drift.
    const { GRID_PALETTES } = await import('../grid/gridStyle');
    expect(GRID_PALETTES).toBe(CURATED_PALETTES);
  });

  it('has a unique id per palette', () => {
    const ids = CURATED_PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is all valid hex, so a swatch can never render as nothing', () => {
    for (const palette of CURATED_PALETTES) {
      expect(palette.colors.length).toBeGreaterThan(0);
      for (const c of palette.colors) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('paletteOf', () => {
  it('finds the row a colour came from', () => {
    expect(paletteOf('#F97316')).toBe('ember');
  });

  it('ignores case, because hex arrives from a text field too', () => {
    expect(paletteOf('#f97316')).toBe('ember');
  });

  it('is null for a colour that is nobody\'s', () => {
    expect(paletteOf('#123456')).toBeNull();
  });
});
