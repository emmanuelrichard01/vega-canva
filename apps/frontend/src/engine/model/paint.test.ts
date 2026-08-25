import { describe, expect, it } from 'vitest';
import {
  colorStopArray,
  convertPaint,
  hexToRgb,
  konvaFillProps,
  linearAngle,
  needsPattern,
  paintColor,
  distributeStops,
  paintToCss,
  reverseStops,
  sortedStops,
  withAlpha,
  withLinearAngle,
  type LinearPaint,
  type Paint,
  type RadialPaint,
} from './paint';

const BOX = { x: 0, y: 0, width: 200, height: 100 };

const linear = (over: Partial<LinearPaint> = {}): LinearPaint => ({
  type: 'linear',
  from: { x: 0.5, y: 0 },
  to: { x: 0.5, y: 1 },
  stops: [
    { offset: 0, color: '#FF0000' },
    { offset: 1, color: '#0000FF' },
  ],
  ...over,
});

describe('withAlpha', () => {
  it('leaves an opaque colour alone', () => {
    expect(withAlpha('#FF0000', 1)).toBe('#FF0000');
    expect(withAlpha('#FF0000', undefined)).toBe('#FF0000');
  });

  it('folds alpha into the colour, because canvas stops have no opacity', () => {
    expect(withAlpha('#FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(withAlpha('#F00', 0)).toBe('rgba(255, 0, 0, 0)');
  });

  it('clamps rather than emitting an alpha a canvas will reject', () => {
    expect(withAlpha('#FF0000', -1)).toBe('rgba(255, 0, 0, 0)');
    expect(withAlpha('#FF0000', 2)).toBe('#FF0000');
  });

  it('returns an unparseable colour unchanged rather than guessing', () => {
    // Losing the opacity is the lesser failure: the alternative is a colour
    // that is simply wrong, and every colour this app writes is a hex.
    expect(withAlpha('rebeccapurple', 0.5)).toBe('rebeccapurple');
    expect(withAlpha('hsl(0 0% 0%)', 0.5)).toBe('hsl(0 0% 0%)');
  });
});

describe('hexToRgb', () => {
  it('reads all four hex lengths', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#ffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#102030')).toEqual({ r: 16, g: 32, b: 48 });
    expect(hexToRgb('#10203040')).toEqual({ r: 16, g: 32, b: 48 });
  });

  it('rejects anything that is not a hex', () => {
    expect(hexToRgb('red')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });
});

describe('sortedStops', () => {
  it('sorts, because addColorStop requires ascending offsets', () => {
    // Dragging the first stop past the second is the ordinary way to reverse
    // a gradient, and it must not throw.
    const paint = linear({
      stops: [
        { offset: 0.9, color: '#111111' },
        { offset: 0.1, color: '#222222' },
      ],
    });
    expect(sortedStops(paint).map((s) => s.color)).toEqual(['#222222', '#111111']);
  });

  it('clamps offsets outside the bar', () => {
    const paint = linear({
      stops: [
        { offset: -3, color: '#111111' },
        { offset: 9, color: '#222222' },
      ],
    });
    expect(sortedStops(paint).map((s) => s.offset)).toEqual([0, 1]);
  });

  it('turns a single stop into a flat run of that colour', () => {
    // One stop draws nothing at all on a canvas, and deleting stops until only
    // one is left is reachable from the panel.
    const stops = sortedStops(linear({ stops: [{ offset: 0.3, color: '#ABCDEF' }] }));
    expect(stops).toEqual([
      { offset: 0, color: '#ABCDEF' },
      { offset: 1, color: '#ABCDEF' },
    ]);
  });

  it('supplies a usable pair when there are no stops at all', () => {
    expect(sortedStops(linear({ stops: [] }))).toHaveLength(2);
  });

  it('drops entries a canvas would throw on', () => {
    const paint = linear({
      stops: [
        { offset: Number.NaN, color: '#111111' },
        { offset: 0, color: '#222222' },
        { offset: 1, color: '#333333' },
      ],
    });
    expect(sortedStops(paint).map((s) => s.color)).toEqual(['#222222', '#333333']);
  });
});

describe('colorStopArray', () => {
  it('flattens to the form both Konva and Canvas2D want', () => {
    expect(colorStopArray(linear())).toEqual([0, '#FF0000', 1, '#0000FF']);
  });

  it('carries per-stop opacity into the colour', () => {
    const paint = linear({
      stops: [
        { offset: 0, color: '#FF0000', opacity: 1 },
        { offset: 1, color: '#FF0000', opacity: 0 },
      ],
    });
    expect(colorStopArray(paint)).toEqual([0, '#FF0000', 1, 'rgba(255, 0, 0, 0)']);
  });
});

describe('linear angle', () => {
  it('is zero for the default downward gradient', () => {
    expect(linearAngle(linear())).toBe(0);
  });

  it('round-trips through every quadrant', () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(Math.round(linearAngle(withLinearAngle(linear(), deg)))).toBe(deg);
    }
  });

  it('keeps both endpoints inside the box at every angle', () => {
    // A full-diagonal axis would put the end stops outside the shape at 45
    // degrees, silently compressing the visible range as you turn it.
    for (let deg = 0; deg < 360; deg += 15) {
      const p = withLinearAngle(linear(), deg);
      for (const point of [p.from, p.to]) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(1);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does not divide by zero on a collapsed axis', () => {
    expect(linearAngle(linear({ from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 } }))).toBe(0);
  });
});

describe('konvaFillProps', () => {
  it('always states a priority, so a stale gradient cannot outrank a new solid', () => {
    // React does not unset props it stops passing, and Konva picks a fill by
    // priority while leaving the others in place. Every branch must say which.
    const solid = konvaFillProps({ type: 'solid', color: '#123456' }, BOX, '#000');
    expect(solid).toMatchObject({ fill: '#123456', fillPriority: 'color' });
    expect(konvaFillProps(linear(), BOX, '#000')).toMatchObject({ fillPriority: 'linear-gradient' });
    expect(konvaFillProps(undefined, BOX, '#000')).toMatchObject({ fillPriority: 'color' });
  });

  it('maps unit space onto the box it is given', () => {
    const props = konvaFillProps(linear(), BOX, '#000')!;
    expect(props.fillLinearGradientStartPoint).toEqual({ x: 100, y: 0 });
    expect(props.fillLinearGradientEndPoint).toEqual({ x: 100, y: 100 });
  });

  it('measures against a box that does not start at the origin', () => {
    // An Ellipse and a RegularPolygon are drawn from their centre, so their
    // box starts negative. Getting this wrong starts the gradient halfway
    // down the shape.
    const centred = { x: -100, y: -50, width: 200, height: 100 };
    const props = konvaFillProps(linear(), centred, '#000')!;
    expect(props.fillLinearGradientStartPoint).toEqual({ x: 0, y: -50 });
    expect(props.fillLinearGradientEndPoint).toEqual({ x: 0, y: 50 });
  });

  it('gives a radial gradient a radius against the larger dimension', () => {
    const radial: RadialPaint = { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops: linear().stops };
    const props = konvaFillProps(radial, BOX, '#000')!;
    expect(props.fillRadialGradientEndRadius).toBe(100);
    expect(props.fillRadialGradientStartRadius).toBe(0);
  });

  it('never returns a zero radius, which draws nothing', () => {
    const radial: RadialPaint = { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0, stops: linear().stops };
    expect(konvaFillProps(radial, BOX, '#000')!.fillRadialGradientEndRadius).toBe(1);
  });

  it('returns null for the kinds that need a generated pattern', () => {
    // Null and not a solid fallback: a fallback would hide a missing call to
    // `paintPattern` behind a fill that looks almost right.
    const conic: Paint = { type: 'conic', center: { x: 0.5, y: 0.5 }, angle: 0, stops: linear().stops };
    expect(konvaFillProps(conic, BOX, '#000')).toBeNull();
    expect(needsPattern(conic)).toBe(true);
    expect(needsPattern({ type: 'solid', color: '#000' })).toBe(false);
    expect(needsPattern(linear())).toBe(false);
  });

  it('folds a solid paint opacity into its colour', () => {
    expect(konvaFillProps({ type: 'solid', color: '#FF0000', opacity: 0.25 }, BOX, '#000')).toMatchObject({
      fill: 'rgba(255, 0, 0, 0.25)',
    });
  });
});

describe('convertPaint', () => {
  it('starts a gradient from the colour that was already there', () => {
    // An unrelated two-colour default reads as the fill having been discarded.
    const made = convertPaint({ type: 'solid', color: '#22C55E' }, 'linear');
    expect(made.type).toBe('linear');
    expect(sortedStops(made as LinearPaint).map((s) => s.color)).toEqual(['#22C55E', '#22C55E']);
    expect(sortedStops(made as LinearPaint)[1].opacity).toBe(0);
  });

  it('keeps the stops when switching between gradients', () => {
    const from = linear({ stops: [{ offset: 0, color: '#AAAAAA' }, { offset: 1, color: '#BBBBBB' }] });
    const to = convertPaint(from, 'radial');
    expect(to.type).toBe('radial');
    expect(sortedStops(to as RadialPaint).map((s) => s.color)).toEqual(['#AAAAAA', '#BBBBBB']);
  });

  it('collapses a gradient back to its first stop', () => {
    const back = convertPaint(linear(), 'solid');
    expect(back).toMatchObject({ type: 'solid', color: '#FF0000' });
  });

  it('carries the centre across the gradients that have one', () => {
    const off = convertPaint(linear(), 'radial') as RadialPaint;
    off.center = { x: 0.2, y: 0.8 };
    const conic = convertPaint(off, 'conic');
    expect(conic).toMatchObject({ center: { x: 0.2, y: 0.8 } });
  });

  it('handles being given nothing at all', () => {
    expect(convertPaint(undefined, 'linear').type).toBe('linear');
    expect(convertPaint(undefined, 'solid').type).toBe('solid');
  });
});

describe('paintColor', () => {
  it('answers with the first stop, not an average', () => {
    // An averaged colour matches nothing anyone can see on the canvas.
    expect(paintColor(linear(), '#000')).toBe('#FF0000');
    expect(paintColor({ type: 'solid', color: '#123456' }, '#000')).toBe('#123456');
    expect(paintColor(undefined, '#000')).toBe('#000');
    expect(paintColor({ type: 'solid', color: '' }, '#000')).toBe('#000');
  });
});

describe('paintToCss', () => {
  it('states a linear gradient in CSS degrees, which run the other way', () => {
    // CSS measures clockwise from "to top"; the model measures a vector in a
    // y-down space. A preview that disagreed with the canvas would be worse
    // than no preview.
    // Model 0 is downward, which CSS calls 180deg. Model 90 is rightward,
    // which CSS also calls 90deg — the two scales agree at one point and
    // nowhere else, which is exactly why this is worth a test.
    expect(paintToCss(linear())).toBe('linear-gradient(180deg, #FF0000 0%, #0000FF 100%)');
    expect(paintToCss(withLinearAngle(linear(), 90))).toContain('90deg');
    expect(paintToCss(withLinearAngle(linear(), 180))).toContain('0deg');
    expect(paintToCss(withLinearAngle(linear(), 270))).toContain('-90deg');
  });

  it('describes the other kinds without throwing', () => {
    for (const kind of ['radial', 'conic', 'diamond'] as const) {
      expect(paintToCss(convertPaint(linear(), kind))).toContain('gradient(');
    }
  });

  it('falls back when there is no paint', () => {
    expect(paintToCss(undefined, '#ABCDEF')).toBe('#ABCDEF');
  });
});

describe('reverseStops', () => {
  it('mirrors the offsets rather than reassigning the colours', () => {
    /**
     * The distinction only shows on uneven stops, and it is the whole design.
     * A stop bunched at 10% should end up bunched at 90% carrying its own
     * colour and opacity, not handing them to whichever stop sits opposite --
     * which for three stops at 0, 0.1 and 1 is a completely different gradient.
     */
    const flipped = reverseStops(linear({
      stops: [
        { offset: 0, color: '#FF0000' },
        { offset: 0.1, color: '#00FF00', opacity: 0.5 },
        { offset: 1, color: '#0000FF' },
      ],
    }));

    expect(flipped.stops).toEqual([
      { offset: 0, color: '#0000FF' },
      { offset: 0.9, color: '#00FF00', opacity: 0.5 },
      { offset: 1, color: '#FF0000' },
    ]);
  });

  it('comes back to where it started when applied twice', () => {
    const start = linear({
      stops: [
        { offset: 0, color: '#FF0000' },
        { offset: 0.3, color: '#00FF00' },
        { offset: 1, color: '#0000FF' },
      ],
    });
    const round = reverseStops(reverseStops(start)).stops;
    // Compared to a tolerance, not exactly: `1 - (1 - 0.3)` is
    // `0.30000000000000004`. Rounding inside `reverseStops` to make an equality
    // check pass would be inventing a precision the value does not have -- an
    // offset is a continuous position, and nothing downstream cares about the
    // sixteenth decimal place.
    expect(round.map((s) => s.color)).toEqual(start.stops.map((s) => s.color));
    round.forEach((s, i) => expect(s.offset).toBeCloseTo(start.stops[i].offset, 10));
  });

  it('leaves the gradient\'s geometry alone', () => {
    // Reversing is about the colours along the axis, not about the axis. Turning
    // the gradient round *and* flipping the stops would be a no-op dressed up as
    // a command.
    const start = linear();
    const flipped = reverseStops(start);
    expect(flipped.from).toEqual(start.from);
    expect(flipped.to).toEqual(start.to);
  });
});

describe('distributeStops', () => {
  it('spaces the stops evenly and pins both ends', () => {
    const even = distributeStops(linear({
      stops: [
        { offset: 0.2, color: '#FF0000' },
        { offset: 0.25, color: '#00FF00' },
        { offset: 0.9, color: '#0000FF' },
      ],
    }));
    expect(even.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  });

  it('takes its order from where the stops sit, not from the array', () => {
    // The gradient somebody can see is the one that gets evened out. An array
    // that has drifted out of order mid-drag must not reshuffle the colours.
    const even = distributeStops(linear({
      stops: [
        { offset: 0.8, color: '#0000FF' },
        { offset: 0.1, color: '#FF0000' },
      ],
    }));
    expect(even.stops.map((s) => s.color)).toEqual(['#FF0000', '#0000FF']);
    expect(even.stops.map((s) => s.offset)).toEqual([0, 1]);
  });

  it('does not divide by zero on a single stop', () => {
    // CSS drops a stop whose offset is NaN, so the gradient would silently lose
    // it rather than fail loudly.
    const even = distributeStops(linear({ stops: [{ offset: 0.4, color: '#FF0000' }] }));
    expect(even.stops[0].offset).toBe(0);
  });

  it('keeps each stop\'s own colour and opacity', () => {
    const even = distributeStops(linear({
      stops: [
        { offset: 0.9, color: '#00FF00', opacity: 0.25 },
        { offset: 0.1, color: '#FF0000' },
      ],
    }));
    expect(even.stops[0]).toMatchObject({ color: '#FF0000' });
    expect(even.stops[1]).toMatchObject({ color: '#00FF00', opacity: 0.25 });
  });
});
