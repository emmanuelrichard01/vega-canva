// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChartArt, DataSeatArt, GridArt, GridKindArt, type DataSeat } from './DataArt';
import { CHART_KINDS, CHART_PALETTE } from '../../../engine/chart/chartTypes';
import { CHART_PICKER_ORDER } from '../../../engine/chart/chartKinds';
import { GRID_KINDS, KIND_DEFAULTS, layoutGrid } from '../../../engine/grid/gridLayout';
import { GRID_PRESETS } from '../../../engine/grid/gridPresets';

afterEach(cleanup);

const CSS = readFileSync(resolve(__dirname, 'dataArt.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SOURCE = readFileSync(resolve(__dirname, 'DataArt.tsx'), 'utf8');
const SEATS: DataSeat[] = ['chart', 'grid', 'table'];

/** The body of the first rule whose selector is exactly `selector`. */
function block(selector: string, css = CSS): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', at) + 1, i);
  }
  throw new Error(`unclosed rule for ${selector}`);
}

const declared = (body: string) => new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const value = (body: string, prop: string) => new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim();

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
const luminance = (hex: string) => {
  const lin = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
/** HSL saturation of an sRGB colour. */
function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

/** Every `url(#…)` in the art points at something defined inside the same svg. */
function expectReferencesResolve(svg: SVGSVGElement) {
  const ids = new Set([...svg.querySelectorAll('[id]')].map((el) => el.id));
  for (const el of svg.querySelectorAll('*')) {
    for (const attr of ['fill', 'stroke', 'filter']) {
      const ref = /^url\(#(.+)\)$/.exec(el.getAttribute(attr) ?? '')?.[1];
      if (ref) expect(ids, `${attr} -> #${ref}`).toContain(ref);
    }
  }
}

const drawn = (svg: SVGSVGElement) => svg.querySelectorAll(':scope > :not(defs):not(.da-plate):not(.da-plate-shadow)').length;

describe('chart art', () => {
  it('draws every chart kind, including every kind the picker offers', () => {
    expect(new Set(CHART_PICKER_ORDER)).toEqual(new Set(CHART_KINDS));
    for (const kind of CHART_KINDS) {
      const { container, unmount } = render(<ChartArt kind={kind} size={64} />);
      const svg = container.querySelector('svg')!;
      expect(svg, kind).not.toBeNull();
      expect(svg.getAttribute('data-art')).toBe(kind);
      expect(drawn(svg), kind).toBeGreaterThan(0);
      expectReferencesResolve(svg);
      unmount();
    }
  });

  it('keeps gradient ids apart between two copies of the same tile', () => {
    const { container } = render(
      <>
        <ChartArt kind="bar" />
        <ChartArt kind="bar" />
      </>
    );
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws nothing for a kind it has no art for, rather than throwing', () => {
    const { container } = render(<ChartArt kind={'sankey' as never} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('is a 4:3 tile at the size it is given', () => {
    const { container } = render(<ChartArt kind="pie" size={56} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('56');
    expect(svg.getAttribute('height')).toBe('42');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('grid art', () => {
  it('draws every preset as exactly the cells the layout produces for its numbers', () => {
    for (const preset of GRID_PRESETS) {
      const { container, unmount } = render(<GridArt preset={preset.id} />);
      const svg = container.querySelector('svg')!;
      expect(svg, preset.id).not.toBeNull();
      expectReferencesResolve(svg);
      const expected = layoutGrid({
        kind: preset.kind, x: 0, y: 0, width: 960, height: 662, seed: 1,
        ...KIND_DEFAULTS[preset.kind], margin: 0, ...preset.patch,
      }).length;
      expect(svg.querySelectorAll('.da-a-breathe').length, preset.id).toBe(expected);
      unmount();
    }
  });

  it('draws every grid system the dock offers', () => {
    for (const kind of GRID_KINDS) {
      const { container, unmount } = render(<GridKindArt kind={kind} />);
      const svg = container.querySelector('svg')!;
      expect(svg.querySelectorAll('.da-a-breathe').length, kind).toBeGreaterThan(0);
      expectReferencesResolve(svg);
      unmount();
    }
  });

  it('draws nothing for an id that names no preset', () => {
    const { container } = render(<GridArt preset="no-such-grid" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('marks the rule of thirds on its four power points', () => {
    const { container } = render(<GridArt preset="thirds" />);
    expect(container.querySelectorAll('.da-power').length).toBe(4);
  });
});

describe('seat art', () => {
  it('draws each Data seat on the dock glyph grid, its line in currentColor', () => {
    for (const seat of SEATS) {
      const { container, unmount } = render(<DataSeatArt seat={seat} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.querySelectorAll('.da-seat-line').length, seat).toBeGreaterThan(0);
      expect(svg.querySelectorAll('.da-seat-mark').length, seat).toBeGreaterThan(0);
      expectReferencesResolve(svg);
      unmount();
    }
  });
});

describe('palette tokens', () => {
  const base = block('.data-art');
  const dark = block('.dark-theme .data-art');
  const baseTokens = declared(base);

  it('declares every token the art and its stylesheet read', () => {
    // Template-built names (`--da-${h}-tint`) are checked through their concrete forms below.
    const read = new Set(
      [...`${SOURCE}\n${CSS}`.matchAll(/var\((--da-[\w-]*)(\$\{)?/g)].filter((m) => !m[2]).map((m) => m[1])
    );
    // Set by the stagger classes and read with a fallback; not a palette token.
    read.delete('--da-delay');
    expect(read.size).toBeGreaterThan(10);
    for (const token of read) expect(baseTokens, token).toContain(token);
    for (const h of [0, 1, 2, 3, 4]) {
      for (const suffix of ['', '-mid', '-soft', '-base', '-wash', '-field']) {
        expect(baseTokens, `--da-${h}${suffix}`).toContain(`--da-${h}${suffix}`);
      }
    }
    for (const suffix of ['-tint', '-deep']) {
      for (const h of [0, 1, 2]) expect(baseTokens, `--da-${h}${suffix}`).toContain(`--da-${h}${suffix}`);
    }
    for (let q = 0; q < 5; q += 1) expect(baseTokens).toContain(`--da-q${q}`);
  });

  it('takes the first five chart palette colours in the light theme', () => {
    for (let h = 0; h < 5; h += 1) {
      expect(value(base, `--da-${h}`)?.toLowerCase()).toBe(CHART_PALETTE[h].toLowerCase());
    }
  });

  it('re-declares the hues, the plate and the tier bases for the dark theme', () => {
    const darkTokens = declared(dark);
    for (const t of ['--da-plate-top', '--da-plate-low', '--da-plate', '--da-plate-shadow']) {
      expect(darkTokens, t).toContain(t);
    }
    for (let h = 0; h < 5; h += 1) {
      expect(darkTokens).toContain(`--da-${h}`);
      expect(darkTokens).toContain(`--da-${h}-base`);
    }
  });

  it('lifts each hue on the dark plate rather than dimming it', () => {
    for (let h = 0; h < 5; h += 1) {
      expect(luminance(value(dark, `--da-${h}`)!), `hue ${h}`).toBeGreaterThan(luminance(value(base, `--da-${h}`)!));
    }
  });

  it('keeps the quietest tier saturated on the dark plate, never grey', () => {
    const soft = parseFloat(value(dark, '--da-soft')!) / 100;
    for (let h = 0; h < 5; h += 1) {
      const a = rgb(value(dark, `--da-${h}`)!);
      const b = rgb(value(dark, `--da-${h}-base`)!);
      const mixed = a.map((c, i) => c * soft + b[i] * (1 - soft)) as [number, number, number];
      expect(saturation(mixed), `hue ${h}`).toBeGreaterThan(0.6);
    }
  });
});

describe('motion', () => {
  const motionBlock = block('@media (prefers-reduced-motion: no-preference)');
  const outside = CSS.replace(motionBlock, '');

  it('declares no animation or keyframes anywhere, so nothing can restart or flash', () => {
    expect(CSS).not.toMatch(/(^|[;{\s])animation\s*:/);
    expect(CSS).not.toMatch(/animation-name\s*:/);
    expect(CSS).not.toMatch(/@keyframes/);
  });

  it('declares no transition outside the motion-allowed block, so reduced motion has none', () => {
    expect(outside).not.toMatch(/transition\s*:/);
  });

  it('moves only on hover or focus of the tile, from the resting picture', () => {
    const rules = [...motionBlock.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const moved = rules.filter(([, , body]) => /(transform|stroke-width|filter)\s*:/.test(body) && !/transition/.test(body));
    expect(moved.length).toBeGreaterThan(0);
    for (const [, selector, body] of moved) {
      if (/transform-origin/.test(body) && !/transform\s*:/.test(body.replace(/transform-origin[^;]*;/, ''))) continue;
      for (const part of selector.split(/,(?![^(]*\))/)) {
        expect(part, part.trim()).toMatch(/:hover|:focus-visible/);
      }
    }
    // Nothing dips in opacity or starts from zero.
    expect(motionBlock).not.toMatch(/opacity\s*:/);
    expect(motionBlock).not.toMatch(/scale[XY]?\(0(\.\d+)?\)/);
  });

  it('has a hover rule for every motion class the art uses', () => {
    const used = new Set([...SOURCE.matchAll(/da-a-([a-z]+)/g)].map((m) => m[1]));
    for (const name of used) {
      expect(motionBlock, name).toMatch(new RegExp(String.raw`:hover[^{}]*\.da-a-${name}\s*\{[^}]*(transform|stroke-width|filter)\s*:`));
    }
  });

  it('eases in no more than 400ms', () => {
    const dur = parseFloat(value(block('.data-art'), '--da-dur')!);
    expect(dur).toBeGreaterThanOrEqual(200);
    expect(dur).toBeLessThanOrEqual(400);
    expect(motionBlock).toMatch(/transition:[^;]*var\(--da-dur\)/);
  });
});
