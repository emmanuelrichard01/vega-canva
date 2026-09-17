import { describe, expect, it } from 'vitest';
import type { AnyNode } from './schema';
import {
  boardColors,
  colorAtOffset,
  contrastGrade,
  contrastRatio,
  formatColor,
  parseColorInput,
  parseInFormat,
} from './colorFormat';
import { placeFloating } from '../interaction/floatingPlacement';

describe('parseColorInput', () => {
  it('reads hex in every length, with alpha from the long forms', () => {
    expect(parseColorInput('#abc')).toEqual({ hex: '#AABBCC' });
    expect(parseColorInput('3b82f6')).toEqual({ hex: '#3B82F6' });
    expect(parseColorInput('#3b82f680')).toEqual({ hex: '#3B82F6', alpha: 0.5 });
    expect(parseColorInput('#f008')).toEqual({ hex: '#FF0000', alpha: 0.53 });
  });

  it('reads rgb and hsl in the comma and space syntaxes', () => {
    expect(parseColorInput('rgb(59, 130, 246)')).toEqual({ hex: '#3B82F6' });
    expect(parseColorInput('rgb(59 130 246 / 50%)')).toEqual({ hex: '#3B82F6', alpha: 0.5 });
    expect(parseColorInput('rgba(255,0,0,0.25)')).toEqual({ hex: '#FF0000', alpha: 0.25 });
    expect(parseColorInput('hsl(0 100% 50%)')).toEqual({ hex: '#FF0000' });
    expect(parseColorInput('hsl(120deg, 100%, 25%)')).toEqual({ hex: '#008000' });
  });

  it('reads the common names and rejects nonsense', () => {
    expect(parseColorInput('RebeccaPurple')).toEqual({ hex: '#663399' });
    expect(parseColorInput('not a colour')).toBeNull();
    expect(parseColorInput('#12')).toBeNull();
    expect(parseColorInput('rgb(1, 2)')).toBeNull();
  });

  it('accepts a bare triple in the format the field is showing', () => {
    expect(parseInFormat('59, 130, 246', 'rgb')).toEqual({ hex: '#3B82F6' });
    expect(parseInFormat('0°, 100%, 50%', 'hsl')).toEqual({ hex: '#FF0000' });
  });
});

describe('formatColor', () => {
  it('writes each format', () => {
    expect(formatColor('#3b82f6', 'hex')).toBe('#3B82F6');
    expect(formatColor('#3B82F6', 'rgb')).toBe('59, 130, 246');
    expect(formatColor('#FF0000', 'hsl')).toBe('0°, 100%, 50%');
  });
});

describe('contrast', () => {
  it('matches WCAG for black on white and grades it', () => {
    expect(Math.round(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
    expect(contrastGrade(4.6)).toBe('AA');
    expect(contrastGrade(3.2)).toBe('AA large');
    expect(contrastGrade(2)).toBe('Fails');
  });
});

describe('colorAtOffset', () => {
  const stops = [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#FFFFFF', opacity: 0 },
  ];

  it('blends colour and alpha between stops', () => {
    expect(colorAtOffset(stops, 0.5)).toEqual({ color: '#808080', opacity: 0.5 });
  });

  it('holds the end colours past the ends', () => {
    expect(colorAtOffset(stops, -1)).toEqual({ color: '#000000', opacity: 1 });
    expect(colorAtOffset(stops, 2)).toEqual({ color: '#FFFFFF', opacity: 0 });
  });
});

describe('boardColors', () => {
  it('counts fills, gradient stops, strokes and type, most used first', () => {
    const objects = {
      a: { id: 'a', type: 'shape', appearance: { fill: [{ type: 'solid', color: '#ff0000' }], stroke: { color: '#000', width: 2 } } },
      b: { id: 'b', type: 'shape', appearance: { fill: [{ type: 'solid', color: '#FF0000' }], stroke: { color: '#000000', width: 0 } } },
      c: { id: 'c', type: 'shape', appearance: { fill: [{ type: 'linear', stops: [{ offset: 0, color: '#00FF00' }] }] } },
      d: { id: 'd', type: 'text', typography: { color: '#111111' } },
      e: { id: 'e', type: 'shape', appearance: { fill: [{ type: 'solid', color: 'transparent', opacity: 0 }] } },
    } as unknown as Record<string, AnyNode>;
    expect(boardColors(objects)).toEqual([
      { color: '#FF0000', count: 2 },
      { color: '#000000', count: 1 },
      { color: '#00FF00', count: 1 },
      { color: '#111111', count: 1 },
    ]);
  });
});

describe('placeFloating', () => {
  const view = { width: 1200, height: 800, margin: 8 };
  const size = { width: 260, height: 420 };

  it('opens beside a swatch in the right-hand panel instead of over the panel', () => {
    const swatch = { left: 1100, top: 300, right: 1124, bottom: 324 };
    const p = placeFloating(swatch, size, view, { prefer: ['left', 'bottom', 'top'] });
    expect(p.side).toBe('left');
    expect(p.x).toBe(832);
    expect(p.y).toBe(288);
  });

  it('skips a side that would cover the thing being edited', () => {
    const swatch = { left: 500, top: 100, right: 524, bottom: 124 };
    const artwork = { left: 300, top: 140, right: 520, bottom: 600 };
    const p = placeFloating(swatch, size, view, { prefer: ['bottom', 'right', 'left'], avoid: artwork });
    expect(p.side).toBe('right');
  });

  it('scrolls on the roomier vertical side when nothing fits whole', () => {
    const swatch = { left: 500, top: 420, right: 524, bottom: 444 };
    const p = placeFloating(swatch, { width: 1200, height: 700 }, view, { prefer: ['bottom', 'top'] });
    expect(p.side).toBe('top');
    expect(p.maxHeight).toBe(404);
    expect(p.y).toBe(8);
  });
});

import { gradientPreviewCss } from './paintPreview';
import { fadeStops, matchesPreset, stopDrag } from './gradientPresets';

describe('gradientPreviewCss', () => {
  const stops = [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF' }];

  it('places linear stops between the stored endpoints, not across the box', () => {
    const css = gradientPreviewCss(
      { type: 'linear', from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 }, stops },
      200,
      100
    );
    expect(css).toBe('linear-gradient(90deg, #000000 50px, #FFFFFF 150px)');
  });

  it('gives a radial its real radius', () => {
    const css = gradientPreviewCss({ type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops }, 200, 100);
    expect(css).toBe('radial-gradient(circle 50px at 100px 50px, #000000 0px, #FFFFFF 50px)');
  });
});

describe('gradient presets and stop dragging', () => {
  it('recognises a gradient built from a preset', () => {
    const paint = { type: 'linear' as const, from: { x: 0, y: 0 }, to: { x: 0, y: 1 }, stops: fadeStops('#3B82F6') };
    expect(matchesPreset(paint, fadeStops('#3b82f6'))).toBe(true);
    expect(matchesPreset(paint, fadeStops('#000000'))).toBe(false);
  });

  it('detaches a stop pulled well off the bar, but never one of the last two', () => {
    const bar = { left: 0, width: 200, top: 100, bottom: 120 };
    expect(stopDrag({ x: 50, y: 110 }, bar, 3)).toEqual({ offset: 0.25, detaching: false });
    expect(stopDrag({ x: 50, y: 170 }, bar, 3)).toEqual({ offset: 0.25, detaching: true });
    expect(stopDrag({ x: 50, y: 170 }, bar, 2).detaching).toBe(false);
  });
});
