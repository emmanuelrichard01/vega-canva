import { describe, expect, it } from 'vitest';
import {
  FRAME_PRESETS,
  FRAME_THEMES,
  frameThemeFill,
  frameThemeOf,
  moveSlide,
  presentationOrder,
  presetMatching,
  slideOrderPatches,
} from './frames';
import { normalizeNode } from '../document/normalize';
import type { FrameNode, StickyNode } from './schema';

describe('frame presets', () => {
  it('covers the sizes people reach for, each with an icon', () => {
    const labels = FRAME_PRESETS.map((p) => p.label);
    for (const want of ['Desktop', 'Laptop', 'Tablet', 'Phone', 'A4', 'A3', 'US Letter', 'Slide 16:9', 'Slide 4:3', 'Square 1:1', 'Portrait 4:5', 'Story 9:16']) {
      expect(labels).toContain(want);
    }
    for (const p of FRAME_PRESETS) expect(p.icon, p.id).toBeTruthy();
  });

  it('keeps the ids the dock arms tools by', () => {
    for (const id of ['desktop', 'tablet', 'phone', 'a4', 'slide']) expect(FRAME_PRESETS.some((p) => p.id === id)).toBe(true);
  });

  it('names a shared size by the preset the frame was made from', () => {
    expect(presetMatching(1920, 1080)?.id).toBe('desktop-hd');
    expect(presetMatching(1920, 1080, 'slide')?.id).toBe('slide');
    expect(presetMatching(1080, 1920, 'slide')?.id).toBe('slide');
    // A hint that no longer fits is ignored.
    expect(presetMatching(390, 844, 'slide')?.id).toBe('phone');
  });
});

describe('frame backgrounds', () => {
  it('round-trips every theme through the fill it writes', () => {
    for (const t of FRAME_THEMES) expect(frameThemeOf(frameThemeFill(t))?.id).toBe(t.id);
  });

  it('reads no fill, or a transparent one, as None', () => {
    expect(frameThemeOf([])?.id).toBe('none');
    expect(frameThemeOf([{ type: 'solid', color: '#FFFFFF', opacity: 0 }])?.id).toBe('none');
    expect(frameThemeOf([{ type: 'solid', color: '#123456', opacity: 1 }])).toBeUndefined();
  });
});

describe('slides', () => {
  const f = (id: string, x: number, y: number, slideOrder?: number) => ({ id, x, y, width: 100, height: 100, slideOrder });

  it('walks reading order until somebody reorders', () => {
    expect(presentationOrder([f('b', 200, 0), f('a', 0, 0), f('c', 0, 300)]).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts ordered slides first, and a frame added later at the end', () => {
    const order = presentationOrder([f('a', 0, 0, 1), f('b', 200, 0, 0), f('new', 400, 0)]).map((s) => s.id);
    expect(order).toEqual(['b', 'a', 'new']);
  });

  it('numbers every slide on a move and writes only what changed', () => {
    const next = moveSlide(['a', 'b', 'c'], 2, 0);
    expect(next).toEqual(['c', 'a', 'b']);
    const patches = slideOrderPatches(next, new Map([['a', 0], ['b', 1], ['c', 2]]));
    expect(patches).toEqual([
      { id: 'c', changes: { slideOrder: 0 } },
      { id: 'a', changes: { slideOrder: 1 } },
      { id: 'b', changes: { slideOrder: 2 } },
    ]);
    expect(slideOrderPatches(['a', 'b'], new Map([['a', 0], ['b', 1]]))).toEqual([]);
  });

  it('ignores an out-of-range move', () => {
    expect(moveSlide(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('the read boundary', () => {
  it('keeps a frame header and its options, and drops hostile values', () => {
    const ok = normalizeNode({ id: 'f', type: 'frame', icon: '🚀', description: '  Q3\nroadmap ', clipContent: false, slideOrder: 2, preset: 'slide' }) as FrameNode;
    expect(ok).toMatchObject({ icon: '🚀', description: 'Q3 roadmap', clipContent: false, slideOrder: 2, preset: 'slide' });

    const bad = normalizeNode({ id: 'f', type: 'frame', icon: '<svg onload=x>', description: 7, clipContent: 'no', slideOrder: Infinity, preset: '../x' }) as FrameNode;
    expect(bad.icon).toBeUndefined();
    expect(bad.description).toBeUndefined();
    expect(bad.clipContent).toBeUndefined();
    expect(bad.slideOrder).toBeUndefined();
    expect(bad.preset).toBeUndefined();
    expect((normalizeNode({ id: 'f', type: 'frame', description: 'x'.repeat(1000) }) as FrameNode).description).toHaveLength(280);
  });

  it('keeps a sticky note’s display options and the new papers', () => {
    const s = normalizeNode({
      id: 's',
      type: 'sticky',
      theme: 'coral',
      textSizing: 'fixed',
      showAuthor: false,
      showDate: true,
      showStamps: false,
      checklist: true,
    }) as StickyNode;
    expect(s).toMatchObject({ theme: 'coral', textSizing: 'fixed', showAuthor: false, showDate: true, showStamps: false, checklist: true });
    const junk = normalizeNode({ id: 's', type: 'sticky', textSizing: 'huge', showAuthor: 'yes' }) as StickyNode;
    expect(junk.textSizing).toBeUndefined();
    expect(junk.showAuthor).toBeUndefined();
  });
});
