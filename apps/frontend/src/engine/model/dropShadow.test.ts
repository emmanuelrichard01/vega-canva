import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DROP_SHADOW,
  SHADOW_PRESETS,
  castRegions,
  colorHasAlpha,
  deviceBox,
  inkOf,
  needsKnockout,
  paintDraws,
  paintIsOpaque,
  presetOf,
  shadowReach,
} from './dropShadow';
import type { Appearance } from './schema';

const solid = (color: string, opacity?: number) => ({ type: 'solid' as const, color, opacity });

describe('which ink casts, and whether the shadow is cut from under it', () => {
  const stroke = { color: '#111111', width: 2 };

  it('stroke 0: the fill alone casts, and an opaque fill needs no cut', () => {
    const ink = inkOf({ fill: [solid('#ff0000')] });
    expect(ink).toMatchObject({ filled: true, fillOpaque: true, stroked: false });
    expect(needsKnockout(ink)).toBe(false);
  });

  it('fill none, stroke only: the stroke casts', () => {
    // `NO_FILL` is a transparent solid at zero opacity: it draws nothing.
    const ink = inkOf({ fill: [solid('transparent', 0)], stroke });
    expect(ink).toMatchObject({ filled: false, stroked: true, strokeOpaque: true });
    expect(needsKnockout(ink)).toBe(false);
  });

  it('fill plus stroke: both cast, together', () => {
    const ink = inkOf({ fill: [solid('#ff0000')], stroke });
    expect(ink).toMatchObject({ filled: true, stroked: true });
    expect(needsKnockout(ink)).toBe(false);
  });

  it('a translucent fill cuts its shadow out, as CSS and Figma do', () => {
    expect(needsKnockout(inkOf({ fill: [solid('#ff0000', 0.4)] }))).toBe(true);
    expect(needsKnockout(inkOf({ fill: [solid('#ff000080')] }))).toBe(true);
    expect(needsKnockout(inkOf({ fill: [solid('#ff0000')], stroke: { color: 'rgba(0,0,0,0.5)', width: 2 } }))).toBe(true);
  });

  it('reads what a missing fill draws from the renderer', () => {
    // A crisp shape with no fill stored falls back to its default paint.
    expect(inkOf({}, { absentFill: true })).toMatchObject({ filled: true, fillOpaque: true });
    expect(inkOf({}, { absentFill: false }).filled).toBe(false);
  });

  it('counts a line with no stored weight as stroked when the renderer says so', () => {
    expect(inkOf({}, { stroked: true }).stroked).toBe(true);
    expect(inkOf({ stroke: { color: '#000', width: 0 } }).stroked).toBe(false);
  });
});

describe('paint opacity', () => {
  it('reads alpha from every colour form', () => {
    expect(colorHasAlpha('#000')).toBe(false);
    expect(colorHasAlpha('#0008')).toBe(true);
    expect(colorHasAlpha('#000000ff')).toBe(false);
    expect(colorHasAlpha('#00000080')).toBe(true);
    expect(colorHasAlpha('rgba(0, 0, 0, 0.2)')).toBe(true);
    expect(colorHasAlpha('rgba(0, 0, 0, 1)')).toBe(false);
    expect(colorHasAlpha('rgb(0 0 0 / 50%)')).toBe(true);
    expect(colorHasAlpha('rgb(0, 0, 0)')).toBe(false);
    expect(colorHasAlpha('transparent')).toBe(true);
    expect(colorHasAlpha(undefined)).toBe(false);
  });

  it('treats a gradient as opaque only when every stop is', () => {
    const grad = (op?: number) => ({
      type: 'linear' as const,
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
      stops: [
        { offset: 0, color: '#fff' },
        { offset: 1, color: '#000', opacity: op },
      ],
    });
    expect(paintIsOpaque(grad())).toBe(true);
    expect(paintIsOpaque(grad(0.5))).toBe(false);
    expect(paintDraws(solid('transparent'))).toBe(false);
    expect(paintDraws(solid('#fff', 0))).toBe(false);
  });
});

describe('shadowReach', () => {
  it('covers three sigma of blur, the spread and the offset', () => {
    // blur 12 is sigma 6; three sigma is 18. Plus spread 2 and offset 4.
    expect(shadowReach({ color: '#000', blur: 12, offsetX: 0, offsetY: 4, spread: 2 })).toBe(25);
    expect(shadowReach({ color: '#000', blur: 0, offsetX: -10, offsetY: 3 })).toBe(11);
  });
});

describe('castRegions', () => {
  const canvas = { width: 1000, height: 800 };

  it('places the shadow at the ink, moved by the offset and grown by the blur', () => {
    const r = castRegions({ x: 100, y: 100, width: 50, height: 50 }, canvas, 10, { x: 0, y: 8 })!;
    expect(r.ink).toEqual({ x: 100, y: 100, width: 50, height: 50 });
    // reach = ceil(10 * 1.5) + 2 = 17
    expect(r.shadow).toEqual({ x: 83, y: 91, width: 84, height: 84 });
  });

  it('never asks for a bitmap larger than the canvas around it', () => {
    const r = castRegions({ x: -50000, y: -50000, width: 100000, height: 100000 }, canvas, 20, { x: 0, y: 0 })!;
    expect(r.shadow).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(r.ink.width).toBeLessThanOrEqual(1000 + 2 * 32);
  });

  it('skips a shadow that lands entirely off the canvas', () => {
    expect(castRegions({ x: 2000, y: 2000, width: 10, height: 10 }, canvas, 4, { x: 0, y: 4 })).toBeNull();
  });

  it('still casts onto the canvas from ink just off its edge', () => {
    const r = castRegions({ x: -40, y: 100, width: 30, height: 30 }, canvas, 0, { x: 30, y: 0 });
    expect(r).not.toBeNull();
    expect(r!.ink.x).toBeLessThan(0);
  });
});

describe('deviceBox', () => {
  it('bounds a rotated box by all four corners', () => {
    const c = Math.SQRT1_2;
    const box = deviceBox({ a: c, b: c, c: -c, d: c, e: 0, f: 0 }, { x: 0, y: 0, width: 10, height: 10 });
    expect(box.width).toBeCloseTo(10 * Math.SQRT2);
    expect(box.height).toBeCloseTo(10 * Math.SQRT2);
  });
});

describe('presets', () => {
  it('step from a contact shadow to a lift, each deeper and softer than the last', () => {
    const [subtle, medium, lifted] = SHADOW_PRESETS.map((p) => p.shadow);
    expect(subtle.offsetY).toBeLessThan(medium.offsetY);
    expect(medium.offsetY).toBeLessThan(lifted.offsetY);
    expect(subtle.blur).toBeLessThan(medium.blur);
    expect(medium.blur).toBeLessThan(lifted.blur);
  });

  it('recognises a shadow that is a preset, whatever its colour', () => {
    expect(presetOf({ ...SHADOW_PRESETS[2].shadow, color: '#123456' })).toBe('lifted');
    expect(presetOf({ ...DEFAULT_DROP_SHADOW, blur: 13 })).toBeNull();
    expect(presetOf(undefined)).toBeNull();
  });

  it('starts a new shadow as the resting card, which the panel adds', () => {
    expect(presetOf(DEFAULT_DROP_SHADOW)).toBe('medium');
    // Kept identical to the panel's own seed, so "add" and "Medium" agree.
    expect(DEFAULT_DROP_SHADOW).toMatchObject({ offsetX: 0, offsetY: 4, blur: 12, spread: 0, opacity: 0.25 });
  });
});

describe('appearance with no shadow', () => {
  it('reads as opaque ink with nothing to cut', () => {
    const a: Appearance = {};
    expect(needsKnockout(inkOf(a, { absentFill: true }))).toBe(false);
  });
});
