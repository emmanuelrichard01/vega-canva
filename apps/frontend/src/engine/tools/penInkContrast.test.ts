import { describe, expect, it } from 'vitest';
import { ThemeService, canvasPlateFill } from '../ThemeService';
import { contrastRatio } from '../cursor/remoteCursor';

/**
 * The pencil's ink has to be visible on the board it is drawn on.
 *
 * ## The bug this exists for
 *
 * `PenTool.currentColor` was `static currentColor = DEFAULT_INK` — `#1F2937`,
 * a near-black — and **nothing anywhere ever assigned it**. There is no colour
 * control for the pencil, so that one constant was the colour of every
 * freehand stroke the product had ever drawn. On a dark board that is a
 * near-black line on a near-black surface: the tool looked like it did
 * nothing, and the stroke was there the whole time.
 *
 * A contrast assertion is the right shape for this rather than "the getter
 * calls ThemeService", because the thing that was broken was never the wiring
 * — it was that one end of a two-ended problem had been answered. Checking the
 * *ratio* fails whichever way a future change breaks it.
 */

/** The two boards a stroke can land on. */
const BOARD = { light: canvasPlateFill(false), dark: canvasPlateFill(true) };

describe('the pencil draws in ink that can be seen', () => {
  const withTheme = (dark: boolean, fn: () => void) => {
    const doc = globalThis as { document?: unknown };
    const had = doc.document;
    doc.document = {
      body: { classList: { contains: (c: string) => dark && c === 'dark-theme' } },
    };
    try {
      fn();
    } finally {
      if (had === undefined) delete doc.document;
      else doc.document = had;
    }
  };

  for (const dark of [false, true]) {
    it(`clears AA against the ${dark ? 'dark' : 'light'} board`, () => {
      withTheme(dark, () => {
        const ink = ThemeService.getDefaultTextColor();
        const board = dark ? BOARD.dark : BOARD.light;
        // 4.5:1 is the committed floor for this product, and a stroke is
        // content rather than decoration.
        expect(contrastRatio(ink, board), `${ink} on ${board}`).toBeGreaterThan(4.5);
      });
    });
  }

  it('is a different ink in each theme, which is the whole point', () => {
    let light = '';
    let dark = '';
    withTheme(false, () => {
      light = ThemeService.getDefaultTextColor();
    });
    withTheme(true, () => {
      dark = ThemeService.getDefaultTextColor();
    });
    expect(light).not.toBe(dark);
  });

  it('would have failed for the constant it replaced', () => {
    /**
     * `#1F2937` against the dark board, which is what every freehand stroke
     * used to be. Kept as an assertion rather than a comment so the number is
     * checked rather than asserted in prose — it is 1.5:1, which is not a
     * faint line, it is an invisible one.
     */
    expect(contrastRatio('#1F2937', BOARD.dark)).toBeLessThan(2);
  });
});
