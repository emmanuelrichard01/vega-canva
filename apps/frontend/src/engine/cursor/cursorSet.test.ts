import { afterEach, describe, expect, it } from 'vitest';
import {
  CURSOR_SIZE,
  DRAW_TIP,
  ERASER_RING_MAX,
  REGION_TOOLS,
  commentVisual,
  cursorTheme,
  cursorVisual,
  drawVisual,
  eraserVisual,
  resizeVisual,
  rotateVisual,
  setCursorTheme,
  stateVisual,
  zoomVisual,
  type CursorVisual,
} from './cursorVisual';
import { atScale, cursorCss, resetImageSetProbe } from './cursorCss';

const ACCENT = '#F3A024';

/** Every pointer the set can produce, for the properties all of them must hold. */
function everyVisual(): CursorVisual[] {
  return [
    cursorVisual('pointer', 'select', ACCENT),
    cursorVisual('pointer', 'direct-select', ACCENT),
    cursorVisual('pan', 'hand', ACCENT),
    cursorVisual('grab', 'hand', ACCENT),
    cursorVisual('text', 'text', ACCENT),
    cursorVisual('note', 'sticky', ACCENT),
    cursorVisual('comment', 'comment', ACCENT),
    cursorVisual('place', 'image', ACCENT),
    cursorVisual('aim', 'magnet', ACCENT),
    cursorVisual('draw', 'bezier-pen', ACCENT),
    ...[...REGION_TOOLS].map((tool) => cursorVisual('draw', tool, ACCENT)),
    ...(['pen', 'marker', 'highlighter'] as const).map((b) => drawVisual(b, '#2563EB')),
    eraserVisual(4),
    eraserVisual(20),
    eraserVisual(120),
    commentVisual(),
    zoomVisual('in'),
    zoomVisual('out'),
    stateVisual('not-allowed'),
    stateVisual('busy'),
    resizeVisual(30),
    rotateVisual(225),
  ];
}

afterEach(() => {
  setCursorTheme({ dark: false, weight: 1 });
  resetImageSetProbe(undefined);
});

describe('every pointer in the set', () => {
  it('is a standalone SVG document, or the browser silently drops it', () => {
    for (const v of everyVisual()) {
      expect(v.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), v.id).toBe(true);
    }
  });

  it('keeps its hotspot inside the box it is drawn in', () => {
    for (const v of everyVisual()) {
      const box = v.size ?? CURSOR_SIZE;
      expect(-v.offsetX, v.id).toBeGreaterThanOrEqual(0);
      expect(-v.offsetY, v.id).toBeGreaterThanOrEqual(0);
      expect(-v.offsetX, v.id).toBeLessThanOrEqual(box);
      expect(-v.offsetY, v.id).toBeLessThanOrEqual(box);
    }
  });

  it('stays within a platform cursor size, even at 2x', () => {
    // Chrome ignores image cursors larger than 128 device pixels.
    for (const v of everyVisual()) {
      expect((v.size ?? CURSOR_SIZE) * 2, v.id).toBeLessThanOrEqual(128);
    }
  });

  it('has a distinct id for distinct art, so the DOM is rewritten when it should be', () => {
    const seen = new Map<string, string>();
    for (const v of everyVisual()) {
      const prior = seen.get(v.id);
      if (prior !== undefined) expect(prior, v.id).toBe(v.svg);
      seen.set(v.id, v.svg);
    }
  });
});

describe('the tool set', () => {
  it('gives region tools a crosshair, hot at its centre, and keeps the tool badge', () => {
    const rect = cursorVisual('draw', 'shape-rect', ACCENT);
    const table = cursorVisual('draw', 'table', ACCENT);
    expect({ x: rect.offsetX, y: rect.offsetY }).toEqual({ x: -10, y: -10 });
    expect(rect.svg).toContain('translate(19.6 19.6)');
    expect(rect.svg).not.toBe(table.svg);
    expect(rect.svg).not.toContain('M5.65376');
  });

  it('draws direct-select hollow, so it reads as a different arrow from select', () => {
    const select = cursorVisual('pointer', 'select', ACCENT);
    const direct = cursorVisual('pointer', 'direct-select', ACCENT);
    expect(direct.offsetX).toBe(select.offsetX);
    expect(direct.svg).not.toBe(select.svg);
  });

  it('paints the drawing tip in the ink it will lay down', () => {
    const blue = cursorVisual('draw', 'pen', ACCENT, false, { brush: 'marker', ink: '#2563EB' });
    const red = cursorVisual('draw', 'pen', ACCENT, false, { brush: 'marker', ink: '#DC2626' });
    expect(blue.svg).toContain('#2563EB');
    expect(red.svg).toContain('#DC2626');
    expect(blue.id).not.toBe(red.id);
    expect({ x: -blue.offsetX, y: -blue.offsetY }).toEqual(DRAW_TIP);
  });

  it('tells pen, marker and highlighter apart', () => {
    const ink = '#111111';
    const art = (['pen', 'marker', 'highlighter'] as const).map((b) => drawVisual(b, ink).svg);
    expect(new Set(art).size).toBe(3);
  });

  it('sizes the eraser ring to the eraser, and caps what a cursor may carry', () => {
    expect(eraserVisual(30).svg).toContain('r="15"');
    expect(eraserVisual(4).svg).toContain('r="4"');
    const huge = eraserVisual(500);
    expect(huge.svg).toContain(`r="${ERASER_RING_MAX / 2}"`);
  });

  it('puts the comment hotspot on the pin point, not the bubble', () => {
    const v = commentVisual();
    expect({ x: -v.offsetX, y: -v.offsetY }).toEqual({ x: 3, y: 25 });
  });

  it('signs zoom in and zoom out differently', () => {
    expect(zoomVisual('in').svg).not.toBe(zoomVisual('out').svg);
  });

  it('marks not-allowed and busy on the arrow, keeping its hotspot', () => {
    const arrow = cursorVisual('pointer', 'select', ACCENT);
    for (const state of ['not-allowed', 'busy'] as const) {
      const v = stateVisual(state);
      expect({ x: v.offsetX, y: v.offsetY }).toEqual({ x: arrow.offsetX, y: arrow.offsetY });
      expect(v.svg).toContain('translate(19.6 19.6)');
    }
  });
});

describe('the cursor theme', () => {
  it('draws claimed handle cursors in the current theme, not always the light one', () => {
    const light = resizeVisual(0);
    setCursorTheme({ dark: true });
    const dark = resizeVisual(0);
    expect(dark.svg).not.toBe(light.svg);
    expect(dark.id).not.toBe(light.id);
  });

  it('thickens every stroke under enhanced contrast, and changes the id', () => {
    const normal = rotateVisual(225);
    setCursorTheme({ weight: 1.75 });
    const strong = rotateVisual(225);
    expect(strong.id).not.toBe(normal.id);
    const widths = (svg: string) => [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    const before = widths(normal.svg);
    const after = widths(strong.svg);
    expect(after.length).toBe(before.length);
    after.forEach((w, i) => expect(w).toBeCloseTo(before[i] * 1.75, 1));
    expect(cursorTheme.weight).toBe(1.75);
  });
});

describe('high-density screens', () => {
  it('doubles the raster size without touching the drawing', () => {
    const v = cursorVisual('pointer', 'select', ACCENT);
    const two = atScale(v.svg, 2);
    expect(two).toContain(`width="${CURSOR_SIZE * 2}" height="${CURSOR_SIZE * 2}"`);
    expect(two).toContain(`viewBox="0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}"`);
  });

  it('offers a 1x and a 2x candidate where the browser takes image-set', () => {
    resetImageSetProbe('-webkit-image-set');
    const v = cursorVisual('pointer', 'select', ACCENT);
    const css = cursorCss(v, 'default');
    expect(css.startsWith('-webkit-image-set(url("data:image/svg+xml,')).toBe(true);
    expect(css).toContain(' 1x, url("data:image/svg+xml,');
    expect(css).toMatch(/ 2x\) 2 1, default$/);
  });

  it('falls back to a plain url() where it does not', () => {
    resetImageSetProbe(null);
    const css = cursorCss(cursorVisual('pointer', 'select', ACCENT), 'default');
    expect(css.startsWith('url("data:image/svg+xml,')).toBe(true);
  });
});
