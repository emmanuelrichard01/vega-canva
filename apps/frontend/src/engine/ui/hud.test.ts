import { afterEach, describe, expect, it, vi } from 'vitest';
import { hud } from './hud';
import { formatDegrees, formatHud, formatHudNumber, normaliseDegrees, onSnapAngle } from './hudFormat';
import { HUD_BOX_GAP, HUD_EDGE_MARGIN, HUD_POINTER_OFFSET, placeHudPill, worldBoxToScreen } from './hudPlace';

afterEach(() => hud.clear());

describe('formatting', () => {
  it('rounds board lengths to whole units, and to tenths only when zoomed in far enough to place them', () => {
    expect(formatHudNumber(239.6)).toBe('240');
    expect(formatHudNumber(239.64, 4)).toBe('239.6');
    expect(formatHudNumber(240.04, 4)).toBe('240');
  });

  it('keeps a tenth below ten units, so a small gap never reads as touching', () => {
    expect(formatHudNumber(0.4)).toBe('0.4');
    expect(formatHudNumber(2.25)).toBe('2.3');
    expect(formatHudNumber(4)).toBe('4');
    expect(formatHudNumber(12.6)).toBe('13');
  });

  it('uses a true minus and never prints negative zero', () => {
    expect(formatHudNumber(-12.2)).toBe('−12');
    expect(formatHudNumber(-0.04)).toBe('0');
    expect(formatHudNumber(-0.3)).toBe('−0.3');
    expect(formatDegrees(-0.4)).toBe('0°');
    expect(formatDegrees(-45)).toBe('−45°');
  });

  it('normalises a rotation into [0, 360)', () => {
    expect(normaliseDegrees(360)).toBe(0);
    expect(normaliseDegrees(-90)).toBe(270);
    expect(normaliseDegrees(359.6)).toBe(0);
  });

  it('knows the 15 degree grid', () => {
    expect(onSnapAngle(45)).toBe(true);
    expect(onSnapAngle(-30)).toBe(true);
    expect(onSnapAngle(44)).toBe(false);
  });

  it('writes each kind the same way everywhere', () => {
    expect(formatHud({ kind: 'size', value: { width: 240.2, height: -180 } }).text).toBe('240 × 180');
    expect(formatHud({ kind: 'length', value: { length: 128.4, angle: 45 } }).text).toBe('128 · 45°');
    expect(formatHud({ kind: 'length', value: { length: 64 } }).text).toBe('64');
    expect(formatHud({ kind: 'angle', value: 90 }).text).toBe('90°');
    expect(formatHud({ kind: 'position', value: { x: 12, y: -8 } }).text).toBe('X 12  Y −8');
    expect(formatHud({ kind: 'distance', value: 24 }).text).toBe('24');
    expect(formatHud({ kind: 'size', value: { width: 10, height: 20, count: 3 } }).text).toBe('3 objects · 10 × 20');
  });

  it('marks separators and axis letters as muted, values as values', () => {
    const { parts } = formatHud({ kind: 'size', value: { width: 1, height: 2 } });
    expect(parts.map((p) => p.role)).toEqual(['value', 'muted', 'value']);
  });

  it('survives a non-finite value instead of printing NaN', () => {
    expect(formatHud({ kind: 'distance', value: Number.NaN }).text).toBe('—');
  });
});

describe('placement', () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 60, height: 20 };

  it('centres under the box, clear of its bottom handles', () => {
    const p = placeHudPill({ anchor: { x: 0, y: 0 }, box: { x: 100, y: 100, width: 200, height: 100 }, size, viewport, placement: 'below' });
    expect(p).toMatchObject({ x: 170, y: 200 + HUD_BOX_GAP, side: 'below' });
  });

  it('flips above the box near the bottom edge, never onto it', () => {
    const box = { x: 100, y: 450, width: 200, height: 130 };
    const p = placeHudPill({ anchor: { x: 0, y: 0 }, box, size, viewport, placement: 'below' });
    expect(p.side).toBe('above');
    expect(p.y + size.height).toBeLessThanOrEqual(box.y);
  });

  it('pins inside the bottom edge when the box fills the viewport', () => {
    const p = placeHudPill({ anchor: { x: 0, y: 0 }, box: { x: -50, y: -50, width: 900, height: 700 }, size, viewport, placement: 'below' });
    expect(p.side).toBe('inside');
    expect(p.y).toBe(viewport.height - HUD_EDGE_MARGIN - size.height);
  });

  it('keeps the pill inside the viewport horizontally', () => {
    const p = placeHudPill({ anchor: { x: 0, y: 0 }, box: { x: -40, y: 100, width: 20, height: 20 }, size, viewport, placement: 'below' });
    expect(p.x).toBe(HUD_EDGE_MARGIN);
  });

  it('sits beside the pointer and flips left and up near the far edges', () => {
    expect(placeHudPill({ anchor: { x: 100, y: 100 }, size, viewport, placement: 'pointer' })).toMatchObject({
      x: 100 + HUD_POINTER_OFFSET,
      y: 100 + HUD_POINTER_OFFSET,
      flippedX: false,
    });
    const corner = placeHudPill({ anchor: { x: 790, y: 590 }, size, viewport, placement: 'pointer' });
    expect(corner).toMatchObject({ x: 790 - HUD_POINTER_OFFSET - size.width, y: 590 - HUD_POINTER_OFFSET - size.height, side: 'above', flippedX: true });
  });

  it('maps a world box through the camera', () => {
    expect(worldBoxToScreen({ x: 10, y: 20, width: 30, height: 40 }, { x: 5, y: -5, zoom: 2 })).toEqual({ x: 25, y: 35, width: 60, height: 80 });
  });
});

describe('the hud store', () => {
  it('shows, updates and hides a readout per source', () => {
    hud.show({ source: 'shape', kind: 'size', value: { width: 10, height: 20 }, at: { x: 0, y: 0 } });
    hud.show({ source: 'line', kind: 'length', value: { length: 5 }, at: { x: 1, y: 1 } });
    expect([...hud.get().keys()]).toEqual(['shape', 'line']);
    hud.hide('shape');
    expect([...hud.get().keys()]).toEqual(['line']);
  });

  it('defaults placement from the box and tone from the kind', () => {
    hud.show({ kind: 'distance', value: 4, at: { x: 0, y: 0 } });
    expect(hud.get().get('draw')).toMatchObject({ tone: 'measure', placement: 'pointer' });
    hud.show({ kind: 'size', value: { width: 1, height: 1 }, at: { x: 0, y: 0 }, box: { x: 0, y: 0, width: 1, height: 1 } });
    expect(hud.get().get('draw')).toMatchObject({ tone: 'object', placement: 'below' });
  });

  it('does not notify when nothing changed, so a still pointer costs nothing', () => {
    const listener = vi.fn();
    const off = hud.subscribe(listener);
    const input = { kind: 'size' as const, value: { width: 1, height: 2 }, at: { x: 3, y: 4 } };
    hud.show(input);
    hud.show({ ...input, value: { ...input.value }, at: { ...input.at } });
    expect(listener).toHaveBeenCalledTimes(1);
    hud.hide('nothing-here');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('counts each arrival on a snap once, so the layer pulses once per snap', () => {
    const at = { x: 0, y: 0 };
    hud.show({ kind: 'angle', value: 44, at });
    hud.show({ kind: 'angle', value: 45, at, snapped: true });
    hud.show({ kind: 'angle', value: 45, at: { x: 1, y: 0 }, snapped: true });
    expect(hud.get().get('draw')?.snapCount).toBe(1);
    hud.show({ kind: 'angle', value: 46, at });
    hud.show({ kind: 'angle', value: 60, at, snapped: true });
    expect(hud.get().get('draw')?.snapCount).toBe(2);
  });

  it('hides the default channel when no source is given', () => {
    hud.show({ kind: 'label', value: 'Connect', at: { x: 0, y: 0 } });
    hud.hide();
    expect(hud.get().size).toBe(0);
  });
});
