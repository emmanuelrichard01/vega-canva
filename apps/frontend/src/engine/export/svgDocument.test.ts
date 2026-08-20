import { describe, expect, it } from 'vitest';
import { assembleSvg } from './svgDocument';
import { SvgPaintDefs } from './svgPaint';
import type { Paint } from '../model/paint';

/**
 * The assembly step, and the omission it exists to make impossible.
 *
 * `SvgPaintDefs` hands out `fill="url(#vg0)"` and collects the matching
 * `<linearGradient>` into a buffer that something has to write out. Nothing
 * did — `markup()` had no callers anywhere in the codebase — so every gradient
 * in every exported SVG referenced a paint server the file did not contain.
 *
 * A dangling paint reference is not an SVG error. The file opened, validated
 * and rendered; the shapes were simply unpainted. That is why it survived, and
 * why the guarantee is asserted here rather than trusted to a call site.
 */

const bounds = { x: 0, y: 0, width: 400, height: 300 };

const linear: Paint = {
  type: 'linear',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  stops: [
    { offset: 0, color: '#F3A024' },
    { offset: 1, color: '#10B981' },
  ],
};

const radial: Paint = {
  type: 'radial',
  center: { x: 0.5, y: 0.5 },
  radius: 0.5,
  stops: [
    { offset: 0, color: '#FFFFFF' },
    { offset: 1, color: '#161616' },
  ],
};

/** A collector that reports whether it was actually drained. */
function spyDefs(markup: string) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    markup() {
      calls += 1;
      return markup;
    },
  };
}

describe('assembleSvg', () => {
  it('drains the paint collector into the document', () => {
    const defs = spyDefs('<defs><linearGradient id="vg0" /></defs>');
    const svg = assembleSvg({ bounds, defs, background: null, body: ['<rect />'] });
    expect(defs.calls).toBe(1);
    expect(svg).toContain('<linearGradient id="vg0" />');
  });

  /**
   * The end-to-end form of the same guarantee: every id the collector hands
   * out has to appear as a definition in the finished file. This is the
   * assertion that fails if `markup()` is ever dropped again.
   */
  it('defines every gradient id it referenced', () => {
    const defs = new SvgPaintDefs();
    const fills = [
      defs.fill(linear, bounds, 'none'),
      defs.fill(radial, bounds, 'none'),
      defs.fill(linear, { x: 10, y: 10, width: 50, height: 50 }, 'none'),
    ];

    const svg = assembleSvg({ bounds, defs, background: null, body: fills.map((f) => `<rect fill="${f}" />`) });

    const referenced = [...svg.matchAll(/fill="url\(#([^)]+)\)"/g)].map((m) => m[1]);
    expect(referenced).toHaveLength(3);
    for (const id of referenced) {
      expect(svg, `#${id} is referenced but never defined`).toContain(`id="${id}"`);
    }
  });

  it('writes the definitions before the artwork that uses them', () => {
    // Browsers resolve a reference in either direction; several importers only
    // look backwards, so a forward reference is silently dropped there.
    const defs = new SvgPaintDefs();
    const fill = defs.fill(linear, bounds, 'none');
    const svg = assembleSvg({ bounds, defs, background: null, body: [`<rect fill="${fill}" />`] });
    expect(svg.indexOf('<defs>')).toBeLessThan(svg.indexOf('<rect'));
  });

  it('omits the defs block entirely when nothing needed one', () => {
    const defs = new SvgPaintDefs();
    defs.fill({ type: 'solid', color: '#F3A024' }, bounds, 'none');
    const svg = assembleSvg({ bounds, defs, background: null, body: ['<rect />'] });
    expect(svg).not.toContain('<defs>');
  });

  describe('the background', () => {
    it('is left out when the export is transparent', () => {
      const svg = assembleSvg({ bounds, defs: spyDefs(''), background: null, body: ['<rect />'] });
      // The only rect present is the body's own.
      expect(svg.match(/<rect/g)).toHaveLength(1);
    });

    it('covers the whole viewBox when one is asked for', () => {
      const svg = assembleSvg({
        bounds: { x: -50, y: -20, width: 400, height: 300 },
        defs: spyDefs(''),
        background: '#FFFFFF',
        body: [],
      });
      expect(svg).toContain('<rect x="-50" y="-20" width="400" height="300" fill="#FFFFFF" />');
    });

    it('sits behind the artwork, not on top of it', () => {
      const svg = assembleSvg({
        bounds,
        defs: spyDefs(''),
        background: '#161616',
        body: ['<circle id="art" />'],
      });
      expect(svg.indexOf('#161616')).toBeLessThan(svg.indexOf('id="art"'));
    });
  });

  describe('the root element', () => {
    it('carries the viewBox the bounds describe', () => {
      const svg = assembleSvg({
        bounds: { x: 10, y: 20, width: 300, height: 150 },
        defs: spyDefs(''),
        background: null,
        body: [],
      });
      expect(svg).toContain('viewBox="10 20 300 150"');
    });

    it('states an intrinsic size as well as a viewBox', () => {
      // Illustrator and Figma read the intrinsic size to size the artboard; a
      // viewBox alone lands the board at some default that has to be undone.
      const svg = assembleSvg({ bounds, defs: spyDefs(''), background: null, body: [] });
      expect(svg).toContain('width="400"');
      expect(svg).toContain('height="300"');
    });

    it('declares the namespace, so the file opens at all', () => {
      const svg = assembleSvg({ bounds, defs: spyDefs(''), background: null, body: [] });
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('drops empty entries rather than emitting blank lines', () => {
      const svg = assembleSvg({ bounds, defs: spyDefs(''), background: null, body: ['', '<rect />', ''] });
      expect(svg).not.toMatch(/\n\n/);
    });
  });
});

describe('SvgPaintDefs', () => {
  it('returns a solid colour without registering anything', () => {
    const defs = new SvgPaintDefs();
    expect(defs.fill({ type: 'solid', color: '#4B5563' }, bounds, 'none')).toContain('4B5563');
    expect(defs.markup()).toBe('');
  });

  it('falls back to the given colour when there is no paint', () => {
    expect(new SvgPaintDefs().fill(undefined, bounds, '#FFFFFF')).toBe('#FFFFFF');
  });

  it('gives each gradient its own id', () => {
    const defs = new SvgPaintDefs();
    const a = defs.fill(linear, bounds, 'none');
    const b = defs.fill(linear, bounds, 'none');
    expect(a).not.toBe(b);
  });

  /**
   * Conic and diamond have no SVG equivalent and fall back to a flat colour.
   * The id must not be consumed by a definition that is never written, or the
   * sequence develops a hole — harmless in itself, but it means the id counter
   * no longer describes the definitions, which is how the next reader is
   * misled.
   */
  it('does not consume an id for a gradient it cannot express', () => {
    const defs = new SvgPaintDefs();
    const conic: Paint = {
      type: 'conic',
      center: { x: 0.5, y: 0.5 },
      angle: 0,
      stops: [{ offset: 0, color: '#B45309' }],
    } as Paint;
    const flat = defs.fill(conic, bounds, 'none');
    expect(flat).not.toContain('url(#');
    // The next real gradient still takes the first id.
    expect(defs.fill(linear, bounds, 'none')).toBe('url(#vg0)');
  });

  it('emits gradient geometry in absolute coordinates', () => {
    // userSpaceOnUse, not objectBoundingBox: bounding-box units define a radius
    // against a normalised diagonal, so a radial gradient on a wide shape would
    // come out a different size in the file than on the canvas.
    const defs = new SvgPaintDefs();
    defs.fill(linear, { x: 100, y: 50, width: 200, height: 100 }, 'none');
    const markup = defs.markup();
    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    expect(markup).toContain('x1="100"');
    expect(markup).toContain('y1="50"');
    expect(markup).toContain('x2="300"');
    expect(markup).toContain('y2="150"');
  });
});
