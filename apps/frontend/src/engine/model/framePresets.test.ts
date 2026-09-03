import { describe, expect, it } from 'vitest';
import {
  FRAME_PRESETS,
  FRAME_PRESET_GROUPS,
  framePreset,
  orientationOf,
  presetMatching,
  turnPreset,
} from './frames';

/**
 * Orientation is a control, not more catalogue.
 *
 * Half the sizes anybody wants are a listed size on its side — a landscape
 * phone, a portrait slide, an A4 turned for a certificate. Listing both of
 * every one would double a list this module deliberately keeps short, to buy a
 * single bit of information. One toggle buys the same bit and leaves the list
 * readable.
 */

describe('the catalogue is coherent', () => {
  it('has no duplicate ids', () => {
    const ids = FRAME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every preset under a group the picker draws', () => {
    for (const p of FRAME_PRESETS) {
      expect(FRAME_PRESET_GROUPS, p.id).toContain(p.group);
    }
  });

  it('gives every preset a positive size', () => {
    for (const p of FRAME_PRESETS) {
      expect(p.width, p.id).toBeGreaterThan(0);
      expect(p.height, p.id).toBeGreaterThan(0);
    }
  });

  it('keeps every safe area inside its frame', () => {
    // A "safe" area larger than the frame is not a safe area, and an
    // inside-out rectangle drawn from one is a stranger thing to look at than
    // a collapsed one.
    for (const p of FRAME_PRESETS) {
      if (!p.safeArea) continue;
      expect(p.safeArea.left + p.safeArea.right, p.id).toBeLessThan(p.width);
      expect(p.safeArea.top + p.safeArea.bottom, p.id).toBeLessThan(p.height);
    }
  });
});

describe('turning a preset', () => {
  it('swaps the two dimensions', () => {
    const a4 = framePreset('a4')!;
    const turned = turnPreset(a4);
    expect(turned.width).toBe(a4.height);
    expect(turned.height).toBe(a4.width);
  });

  it('is its own inverse', () => {
    // Turning twice is the preset back, so the toggle cannot drift a size out
    // of shape by being pressed repeatedly.
    for (const p of FRAME_PRESETS) {
      expect(turnPreset(turnPreset(p)), p.id).toEqual(p);
    }
  });

  it('leaves a symmetrical safe area identical', () => {
    // Which is most of them, and it is the honest result rather than a special
    // case: an evenly inset margin looks the same whichever way up it is.
    const square = framePreset('square')!;
    expect(turnPreset(square).safeArea).toEqual(square.safeArea);
  });

  it('transposes an asymmetrical one', () => {
    /**
     * Top swaps with left and bottom with right — the same transpose the box
     * itself gets when its width and height trade places.
     *
     * A quarter *rotation* was the first instinct, and the involution test
     * above rejected it in one run: two quarter turns is a half turn, so
     * pressing the toggle twice would have left a story's guide upside down
     * instead of back where it started.
     *
     * The story's guide ends up along the side, where it plainly does not
     * belong — which is a better signal than silence, because a landscape
     * story is not a story.
     */
    const story = framePreset('story')!;
    expect(story.safeArea).toEqual({ top: 250, right: 64, bottom: 320, left: 64 });
    expect(turnPreset(story).safeArea).toEqual({ top: 64, right: 320, bottom: 64, left: 250 });
  });

  it('carries nothing where there was nothing', () => {
    const desktop = framePreset('desktop')!;
    expect(desktop.safeArea).toBeUndefined();
    expect(turnPreset(desktop).safeArea).toBeUndefined();
  });
});

describe('orientation', () => {
  it('reads a preset the way up it is', () => {
    expect(orientationOf(framePreset('phone')!)).toBe('portrait');
    expect(orientationOf(framePreset('desktop')!)).toBe('landscape');
  });

  it('calls a square a square', () => {
    // Not "portrait", which is what a `height >= width` test would say — and
    // which would make the toggle claim a square post could be turned.
    expect(orientationOf(framePreset('square')!)).toBe('square');
  });
});

describe('recognising a frame`s size', () => {
  it('names a size that matches a preset', () => {
    expect(presetMatching(1440, 1024)?.id).toBe('desktop');
  });

  it('recognises a turned one', () => {
    // Which is what lets the panel show a name rather than two numbers for a
    // frame somebody turned, and lets the toggle know which way it points.
    expect(presetMatching(1024, 1440)?.id).toBe('desktop');
    expect(presetMatching(842, 595)?.id).toBe('a4');
  });

  it('refuses a near miss', () => {
    /**
     * A frame one unit off a preset is not that preset — it has been resized
     * deliberately, and telling somebody their 1439-wide frame is a Desktop is
     * worse than telling them nothing.
     */
    expect(presetMatching(1439, 1024)).toBeUndefined();
  });

  it('answers nothing for a size nobody listed', () => {
    expect(presetMatching(333, 777)).toBeUndefined();
  });
});
