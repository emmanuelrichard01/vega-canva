import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../engine/model/colorFormat';

/**
 * Increase contrast keeps its promises in both themes.
 *
 * Reads the real stylesheets, resolves each token the way the cascade does
 * (base theme, then the `data-contrast="more"` overrides on top), and measures
 * the pairs that matter against every app surface they can sit on.
 */

const src = resolve(__dirname, '..');
const indexCss = readFileSync(resolve(src, 'index.css'), 'utf8');
const contrastCss = readFileSync(resolve(src, 'styles/contrast.css'), 'utf8');

/** The declarations of the first block whose selector is exactly `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (!match) throw new Error(`No block for ${selector}`);
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const lightBase = { ...block(indexCss, ':root'), ...block(contrastCss, ':root') };
const darkBase = { ...lightBase, ...block(indexCss, '.dark-theme') };
const lightMore = block(contrastCss, ":root[data-contrast='more']");
const darkMore = block(contrastCss, ":root[data-contrast='more'] .dark-theme");

const themes = {
  light: { standard: lightBase, more: { ...lightBase, ...lightMore } },
  dark: { standard: darkBase, more: { ...darkBase, ...lightMore, ...darkMore } },
};

function token(map: Record<string, string>, name: string, depth = 0): string {
  const value = map[name];
  if (value === undefined) throw new Error(`Undefined token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref && depth < 10) return token(map, ref[1], depth + 1);
  return value;
}

function hex(map: Record<string, string>, name: string): string {
  const value = token(map, name);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a solid colour: ${value}`);
  return value;
}

const SURFACES = ['--surface-primary', '--surface-secondary', '--surface-canvas', '--surface-elevated'];

function worst(map: Record<string, string>, fg: string, surfaces = SURFACES): number {
  return Math.min(...surfaces.map((s) => contrastRatio(hex(map, fg), hex(map, s))));
}

describe.each(Object.entries(themes))('increase contrast, %s theme', (_name, { standard, more }) => {
  it('overrides only tokens the base theme declares', () => {
    for (const name of Object.keys(lightMore)) expect(lightBase[name], name).toBeDefined();
    for (const name of Object.keys(darkMore)) expect(lightBase[name], name).toBeDefined();
  });

  it('puts primary and secondary text at 7:1 or better on every surface', () => {
    expect(worst(more, '--text-primary')).toBeGreaterThanOrEqual(7);
    expect(worst(more, '--text-secondary')).toBeGreaterThanOrEqual(7);
  });

  it('puts tertiary text at 7:1 on panels and AA everywhere', () => {
    expect(worst(more, '--text-tertiary', ['--surface-primary'])).toBeGreaterThanOrEqual(7);
    expect(worst(more, '--text-tertiary')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps accent and status text readable on every surface', () => {
    for (const fg of ['--text-accent', '--status-online', '--status-danger', '--status-warning']) {
      expect(worst(more, fg), fg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws dividers, control borders and the focus ring at 3:1 or better', () => {
    for (const fg of ['--border-divider', '--border-strong', '--border-focus', '--control-border', '--focus-ring-color', '--focus-field-color']) {
      expect(worst(more, fg), fg).toBeGreaterThanOrEqual(3);
    }
  });

  it('never makes a text tier weaker than the standard theme', () => {
    for (const fg of ['--text-primary', '--text-secondary', '--text-tertiary', '--text-disabled']) {
      expect(worst(more, fg), fg).toBeGreaterThanOrEqual(worst(standard, fg) - 0.01);
    }
  });

  it('replaces glass with an opaque surface and a thicker ring', () => {
    expect(token(more, '--glass-surface')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(token(more, '--glass-filter')).toBe('none');
    expect(parseFloat(token(more, '--focus-ring-width'))).toBeGreaterThan(parseFloat(token(standard, '--focus-ring-width')));
  });
});
