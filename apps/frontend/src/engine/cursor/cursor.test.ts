import { describe, it, expect } from 'vitest';
import { cursorModeForTool } from './toolCursor';
import {
  chipColorsFor,
  contrastRatio,
  parseHex,
  placeChip,
  relativeLuminance,
  smoothingFactor,
  CHIP_OFFSET,
} from './remoteCursor';

/**
 * The cursor cannot be observed running here — no rAF, no real pointer (see
 * `HANDOFF.md` §3) — so everything that can be decided arithmetically is, and
 * it is decided in this file. What is left in the renderer is only the DOM.
 */

/** The ten presence colours, from `engine/presence/ColorPalette.ts`. */
const PALETTE = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#10B981',
  '#06B6D4', '#6366F1', '#EF4444', '#F59E0B', '#14B8A6',
];

describe('cursorModeForTool', () => {
  it('gives each tool a mode that matches what a drag will actually do', () => {
    expect(cursorModeForTool('select')).toBe('pointer');
    expect(cursorModeForTool('hand')).toBe('pan');
    expect(cursorModeForTool('text')).toBe('text');
    expect(cursorModeForTool('eraser')).toBe('erase');
    expect(cursorModeForTool('sticky')).toBe('note');
    expect(cursorModeForTool('comment')).toBe('comment');
    expect(cursorModeForTool('image')).toBe('place');
    expect(cursorModeForTool('pen')).toBe('draw');
    expect(cursorModeForTool('bezier-pen')).toBe('draw');
  });

  it('treats every shape variant as drawing', () => {
    for (const t of ['shape', 'shape-rect', 'shape-ellipse', 'shape-triangle', 'shape-hexagon', 'shape-star']) {
      expect(cursorModeForTool(t)).toBe('draw');
    }
  });

  it('treats every force tool as aiming', () => {
    for (const t of ['magnet', 'repel', 'wind', 'shockwave', 'gravity']) {
      expect(cursorModeForTool(t)).toBe('aim');
    }
  });

  it('lets Space outrank the active tool, because Space always pans', () => {
    // The bug this pins: holding Space with the Shape tool selected showed a
    // crosshair while the drag actually panned the canvas.
    expect(cursorModeForTool('shape-rect', { spacePressed: true })).toBe('pan');
    expect(cursorModeForTool('text', { spacePressed: true })).toBe('pan');
    expect(cursorModeForTool('magnet', { spacePressed: true })).toBe('pan');
  });

  it('falls back to the pointer for anything it does not recognise', () => {
    expect(cursorModeForTool('some-future-tool')).toBe('pointer');
    expect(cursorModeForTool(undefined)).toBe('pointer');
  });
});

describe('name chip colour', () => {
  it('parses the hex forms a user colour can arrive in', () => {
    expect(parseHex('#3B82F6')).toEqual([0x3b, 0x82, 0xf6]);
    expect(parseHex('3b82f6')).toEqual([0x3b, 0x82, 0xf6]);
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('rebeccapurple')).toBeNull();
    expect(parseHex('')).toBeNull();
  });

  it('agrees with the WCAG reference points', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 2);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('carries readable text on every presence colour', () => {
    // This is the whole reason the chip derives its colours instead of using
    // the raw one: white on Amber #F59E0B was about 2:1.
    for (const color of PALETTE) {
      const { fill, ink } = chipColorsFor(color);
      expect(contrastRatio(fill, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('carries readable text on a colour nobody planned for', () => {
    // Sign-in lets people pick their own, so the palette is not the domain.
    for (const color of ['#000000', '#FFFFFF', '#808080', '#FFFF00', '#1A1A2E', '#7F0000']) {
      const { fill, ink } = chipColorsFor(color);
      expect(contrastRatio(fill, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('leaves colours that are already readable exactly as they are', () => {
    // Amber is bright enough for dark ink; a near-black is deep enough for
    // white. Both keep the person's real colour rather than an approximation.
    expect(chipColorsFor('#F59E0B').fill).toBe('#F59E0B');
    expect(chipColorsFor('#1A1A2E').fill).toBe('#1A1A2E');
  });

  it('moves an unreadable colour the shorter way, not always the same way', () => {
    // Deep blue is nearer the dark end, so it stays saturated and takes white
    // text; green is nearer the bright end, so it stays bright and takes dark.
    const blue = chipColorsFor('#3B82F6');
    const green = chipColorsFor('#10B981');
    expect(blue.ink).toBe('#FFFFFF');
    expect(relativeLuminance(blue.fill)).toBeLessThan(relativeLuminance('#3B82F6'));
    expect(green.ink).not.toBe('#FFFFFF');
    expect(relativeLuminance(green.fill)).toBeGreaterThan(relativeLuminance('#10B981'));
  });

  it('stays on its own hue when it moves, rather than sliding toward gray', () => {
    for (const color of ['#3B82F6', '#10B981', '#EC4899']) {
      const before = parseHex(color)!;
      const after = parseHex(chipColorsFor(color).fill)!;
      // The dominant channel is still the dominant channel.
      const dominant = before.indexOf(Math.max(...before));
      expect(after.indexOf(Math.max(...after))).toBe(dominant);
    }
  });

  it('keeps a trace of the hue in dark ink instead of using neutral gray', () => {
    const ink = parseHex(chipColorsFor('#F59E0B').ink)!;
    expect(ink[0]).toBeGreaterThan(ink[2]);
  });

  it('edges the chip in the identity colour it stands for', () => {
    expect(chipColorsFor('#3B82F6').outline).toBe('#3B82F6');
  });

  it('degrades to something visible when the colour is unusable', () => {
    const { fill, ink } = chipColorsFor('not-a-colour');
    expect(contrastRatio(fill, ink)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('placeChip', () => {
  const viewport = { width: 1000, height: 800 };
  const chip = { width: 120, height: 22 };

  it('sits below and to the right of the pointer when there is room', () => {
    const p = placeChip({ x: 100, y: 100 }, chip, viewport);
    expect(p.left).toBe(100 + CHIP_OFFSET.x);
    expect(p.top).toBe(100 + CHIP_OFFSET.y);
    expect(p.flippedX).toBe(false);
    expect(p.flippedY).toBe(false);
  });

  it('flips across the pointer at the right edge instead of being clipped', () => {
    // The overlay hides overflow, so without this a collaborator working near
    // the right edge simply has no name.
    const p = placeChip({ x: 980, y: 100 }, chip, viewport);
    expect(p.flippedX).toBe(true);
    expect(p.left).toBeLessThan(980);
    expect(p.left + chip.width).toBeLessThanOrEqual(viewport.width);
  });

  it('flips above the pointer at the bottom edge', () => {
    const p = placeChip({ x: 100, y: 795 }, chip, viewport);
    expect(p.flippedY).toBe(true);
    expect(p.top + chip.height).toBeLessThanOrEqual(viewport.height);
  });

  it('flips both ways in the bottom-right corner', () => {
    const p = placeChip({ x: 995, y: 795 }, chip, viewport);
    expect(p.flippedX).toBe(true);
    expect(p.flippedY).toBe(true);
  });

  it('keeps a chip wider than the viewport on screen', () => {
    const p = placeChip({ x: 10, y: 10 }, { width: 2000, height: 22 }, viewport);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });
});

describe('smoothingFactor', () => {
  it('reproduces the old feel at 60Hz', () => {
    // The fixed factor it replaces was 0.25 per frame.
    expect(smoothingFactor(1000 / 60)).toBeCloseTo(0.19, 2);
  });

  it('reaches the same place regardless of frame rate', () => {
    // Two 120Hz frames must move a cursor exactly as far as one 60Hz frame.
    // The old per-frame constant did not: a 144Hz display converged nearly
    // 2.5x faster than a 60Hz one on identical network updates.
    const one = smoothingFactor(1000 / 60);
    const f = smoothingFactor(1000 / 120);
    const two = 1 - (1 - f) * (1 - f);
    expect(two).toBeCloseTo(one, 10);
  });

  it('snaps rather than crawling back after the tab was asleep', () => {
    expect(smoothingFactor(5000)).toBe(1);
  });

  it('does not move on a zero-length or nonsense frame', () => {
    expect(smoothingFactor(0)).toBe(0);
    expect(smoothingFactor(-16)).toBe(0);
    expect(smoothingFactor(NaN)).toBe(0);
  });

  it('stays inside [0, 1] across every plausible frame length', () => {
    for (let dt = 0; dt <= 300; dt += 1) {
      const f = smoothingFactor(dt);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});
