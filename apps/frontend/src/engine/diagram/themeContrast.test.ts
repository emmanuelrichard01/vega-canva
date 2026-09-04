import { describe, expect, it } from 'vitest';
import { DIAGRAM_THEMES, type DiagramTheme } from './mermaid';

/**
 * Whether a generated diagram can actually be read, on either board.
 *
 * A diagram's colours are **content**: they are written into the objects when
 * it is generated and then shared with everybody, so they cannot be re-picked
 * per viewer the way a piece of chrome can. That makes every pairing here a
 * decision taken once, blind to the theme the reader will open it in — and
 * exactly the kind of decision that is wrong quietly.
 *
 * Two rules, and the second is the one that was being broken:
 *
 * 1. Anything with a **surface** is checked against that surface. A node's
 *    label reads against the node's own fill, so it is knowable and it must be
 *    right.
 * 2. Anything with **no surface** — a lifeline, a block frame, a chart title —
 *    sits on the canvas, whose colour is the viewer's. It gets `canvasInk`,
 *    which has to clear a usable ratio against *both* a white board and a
 *    near-black one. That is why these are mid-tones rather than the near-black
 *    `textColor`, which is invisible on a dark board.
 *
 * Small dense text cannot be served by any single colour against two opposite
 * backgrounds — the best a fixed ink can do against both is a little under 4:1
 * — which is why the pie legend gets a card instead of taking `canvasInk`.
 */

const WHITE = '#FFFFFF';
/** Not pure black: the dark canvas is a near-black, and pure black flatters. */
const DARK = '#14161A';

function channel(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channel(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The cluster fills are translucent, so what a label really sits on is the
 * board showing through them. Flattened against white, which is where they are
 * lightest and therefore where a light ink has the least to work with.
 */
function flatten(color: string, over: string): string {
  const rgba = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (!rgba) return color;
  const parts = rgba[1].split(',').map((p) => Number(p.trim()));
  const alpha = parts.length > 3 ? parts[3] : 1;
  const base = channel(over);
  const mixed = parts
    .slice(0, 3)
    .map((v, i) => Math.round(v * alpha + base[i] * (1 - alpha)));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const THEMES = Object.values(DIAGRAM_THEMES) as DiagramTheme[];
const named = THEMES.map((theme) => [theme.name, theme] as const);

describe('every theme declares an ink for the bare canvas', () => {
  it.each(named)('%s has one', (_name, theme) => {
    expect(theme.canvasInk).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it.each(named)('%s: it reads on a light board', (_name, theme) => {
    // 3:1 is the bar for a line, an outline, or large text — which is all this
    // ink is ever asked to carry.
    expect(contrast(theme.canvasInk, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it.each(named)('%s: it reads on a dark board too', (_name, theme) => {
    expect(contrast(theme.canvasInk, DARK)).toBeGreaterThanOrEqual(3);
  });

  it.each(named)('%s: it is not just the text colour again', (_name, theme) => {
    /**
     * The bug this whole field exists for. `textColor` is a near-black chosen
     * against the pale node fills; using it on the canvas is what made block
     * labels and lifelines disappear on a dark board.
     */
    expect(contrast(theme.textColor, DARK)).toBeLessThan(3);
    expect(theme.canvasInk.toLowerCase()).not.toBe(theme.textColor.toLowerCase());
  });
});

describe('every pairing that does have a surface is legible on it', () => {
  it.each(named)('%s: labels read on every accent fill', (_name, theme) => {
    for (const fill of theme.accentFills) {
      expect(contrast(theme.textColor, fill), `${theme.textColor} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(named)('%s: labels read on the primary fill', (_name, theme) => {
    expect(contrast(theme.textColor, theme.primaryFill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(named)('%s: note and legend text reads on the cluster fill', (_name, theme) => {
    // The pie legend and every note sit on this, which is the whole reason
    // they are given a card rather than left on the board.
    const surface = flatten(theme.clusterFill, WHITE);
    expect(contrast(theme.textColor, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(named)('%s: a node outline is visible against its own fill', (_name, theme) => {
    expect(contrast(theme.primaryStroke, theme.primaryFill)).toBeGreaterThanOrEqual(3);
  });
});

describe('the accent fills stay a set', () => {
  it.each(named)('%s: no two are the same colour', (_name, theme) => {
    // They are handed out round-robin to distinguish one node from the next;
    // two identical entries make two nodes look related when they are not.
    expect(new Set(theme.accentFills.map((c) => c.toLowerCase())).size).toBe(
      theme.accentFills.length
    );
  });

  it.each(named)('%s: there are enough to tell a few nodes apart', (_name, theme) => {
    expect(theme.accentFills.length).toBeGreaterThanOrEqual(4);
  });
});
