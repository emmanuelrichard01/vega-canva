import { describe, expect, it } from 'vitest';
import { shadowProps, shadowSpreadProps } from './shared';
import type { Appearance, Shadow } from '../../../engine/model/schema';

const withShadow = (over: Partial<Shadow> = {}): Appearance => ({
  shadow: { color: '#000000', blur: 12, offsetX: 0, offsetY: 4, ...over },
});

describe('shadowProps', () => {
  it('returns nothing at all when there is no shadow', () => {
    // Not `{ shadowBlur: 0 }`: Konva treats a zero-blur shadow as one it still
    // has to consider on every draw, and a board is mostly objects with none.
    expect(shadowProps(undefined)).toEqual({});
    expect(shadowProps({})).toEqual({});
  });

  it('translates the whole shadow, which nothing used to do', () => {
    expect(shadowProps(withShadow({ opacity: 0.4 }))).toMatchObject({
      shadowColor: '#000000',
      shadowBlur: 12,
      shadowOffsetX: 0,
      shadowOffsetY: 4,
      shadowOpacity: 0.4,
    });
  });

  it('defaults opacity to opaque rather than to zero', () => {
    // A shadow that stored no opacity is a shadow, not an invisible one.
    expect(shadowProps(withShadow()).shadowOpacity).toBe(1);
  });

  it('never passes a negative blur, which Konva reads as an enormous one', () => {
    expect(shadowProps(withShadow({ blur: -20 })).shadowBlur).toBe(0);
  });

  it('does not let the shadow scale with a stretched polygon', () => {
    // A widened hexagon is drawn by scaling a square one, and a shadow that
    // scaled with it would be blurred further horizontally than vertically.
    expect(shadowProps(withShadow()).shadowForStrokeEnabled).toBe(false);
  });
});

describe('shadowSpreadProps', () => {
  it('is null unless there is spread to draw', () => {
    // Null means "no second draw": the shadow rides on the shape itself, which
    // is both cheaper and exact.
    expect(shadowSpreadProps(undefined)).toBeNull();
    expect(shadowSpreadProps(withShadow())).toBeNull();
    expect(shadowSpreadProps(withShadow({ spread: 0 }))).toBeNull();
  });

  it('grows the silhouette by exactly the spread, in every direction', () => {
    // A stroke is centred on the path, so half of a `2 * spread` line falls
    // outside it. That is what makes this work for a star and a bezier as
    // well as a rectangle.
    expect(shadowSpreadProps(withShadow({ spread: 7 }))!.strokeWidth).toBe(14);
  });

  it('paints the grown silhouette in the shadow colour', () => {
    // At zero offset the grown silhouette is visible as a ring around the
    // shape — which is what spread looks like in CSS too, so it has to be the
    // shadow's colour rather than the shape's.
    const props = shadowSpreadProps(withShadow({ spread: 4, color: '#123456' }))!;
    expect(props.fill).toBe('#123456');
    expect(props.stroke).toBe('#123456');
    expect(props.fillPriority).toBe('color');
  });

  it('casts the stroke it just drew', () => {
    // Konva skips a stroke's shadow by default, and here the stroke *is* the
    // silhouette being cast — without this the spread is invisible.
    expect(shadowSpreadProps(withShadow({ spread: 4 }))!.shadowForStrokeEnabled).toBe(true);
  });

  it('drops the dash, so a dashed outline does not become a dashed shadow', () => {
    const props = shadowSpreadProps(withShadow({ spread: 4 }))!;
    expect(props.dash).toBeUndefined();
    expect(props.listening).toBe(false);
  });

  it('carries the shadow itself, since the real shape will not', () => {
    const props = shadowSpreadProps(withShadow({ spread: 4, opacity: 0.5 }))!;
    expect(props).toMatchObject({ shadowBlur: 12, shadowOffsetY: 4, shadowOpacity: 0.5 });
  });
});
