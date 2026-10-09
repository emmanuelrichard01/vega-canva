import { describe, expect, it } from 'vitest';
import { isMirrored, shadowProps, strokeWidth } from './shared';
import type { Appearance, Shadow } from '../../../engine/model/schema';

const withShadow = (over: Partial<Shadow> = {}): Appearance => ({
  shadow: { color: '#000000', blur: 12, offsetX: 0, offsetY: 4, ...over },
});

describe('shadowProps (text, the one native caster)', () => {
  it('returns nothing at all when there is no shadow, or an invisible one', () => {
    // Not `{ shadowBlur: 0 }`: Konva treats a zero-blur shadow as one it still
    // has to consider on every draw, and a board is mostly objects with none.
    expect(shadowProps(undefined)).toEqual({});
    expect(shadowProps({})).toEqual({});
    expect(shadowProps(withShadow({ opacity: 0 }))).toEqual({});
  });

  it('translates the whole shadow', () => {
    expect(shadowProps(withShadow({ opacity: 0.4 }))).toMatchObject({
      shadowColor: '#000000',
      shadowBlur: 12,
      shadowOffsetX: 0,
      shadowOffsetY: 4,
      shadowOpacity: 0.4,
    });
  });

  it('defaults opacity to opaque rather than to zero', () => {
    expect(shadowProps(withShadow()).shadowOpacity).toBe(1);
  });

  it('never passes a negative blur, which a canvas reads as an enormous one', () => {
    expect(shadowProps(withShadow({ blur: -20 })).shadowBlur).toBe(0);
  });

  it('casts from the glyph fill only, so an outline pass cannot cast a second shadow', () => {
    expect(shadowProps(withShadow()).shadowForStrokeEnabled).toBe(false);
  });

  it('keeps a mirrored object casting downwards', () => {
    // Konva scales the offset by the decomposed scale, and a flip decomposes to
    // a negative vertical scale: without the correction the shadow rises.
    expect(shadowProps(withShadow({ offsetY: 6 }), { flipped: true }).shadowOffsetY).toBe(-6);
    expect(isMirrored({ scaleX: -1 })).toBe(true);
    expect(isMirrored({ scaleX: -1, scaleY: -1 })).toBe(false);
    expect(isMirrored({})).toBe(false);
  });
});

describe('strokeWidth', () => {
  it('keeps a fractional weight exactly', () => {
    expect(strokeWidth({ stroke: { color: '#000', width: 0.25 } })).toBe(0.25);
    expect(strokeWidth({ stroke: { color: '#000', width: 0.75 } })).toBe(0.75);
  });

  it('never hands a canvas a negative or non-finite weight', () => {
    expect(strokeWidth({ stroke: { color: '#000', width: -3 } })).toBe(0);
    expect(strokeWidth({ stroke: { color: '#000', width: Number.NaN } })).toBe(0);
  });
});
