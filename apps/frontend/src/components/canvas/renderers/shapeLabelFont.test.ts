import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every renderer that draws text with a webfont has to do two things, and
 * doing one is worse than doing neither: subscribe to `fontEpoch` so the
 * drawing is redone when the real face lands, and call `ensureFontLoaded` so
 * something actually asks for that face. Subscribing without requesting waits
 * for an event nobody triggered; requesting without subscribing gets the event
 * and ignores it.
 *
 * `ShapeRenderer` did neither, which is why a mermaid diagram -- almost
 * entirely shape labels -- drew its text measured against the fallback face
 * and left it there. A reload appeared to fix it because the font was then in
 * cache and won the race.
 *
 * Checked by reading the source rather than by rendering: proving this
 * properly needs a canvas, a font that has genuinely not loaded, and control
 * over when it does. The claim here is narrow and structural, and so is the
 * check.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), 'utf8');

/**
 * Each renderer, with the file that measures on its behalf where that is not
 * the renderer itself. `StickyRenderer` delegates to `stickyFit`, which is
 * where its `requestFont` lives -- the obligation is on the pair, not on the
 * component file.
 */
const TEXT_RENDERERS: Array<{ renderer: string; measures: string[] }> = [
  { renderer: 'ShapeRenderer.tsx', measures: ['ShapeRenderer.tsx'] },
  { renderer: 'TextRenderer.tsx', measures: ['TextRenderer.tsx'] },
  { renderer: 'StickyRenderer.tsx', measures: ['StickyRenderer.tsx', 'stickyFit.ts'] },
];

describe('renderers that draw a webfont', () => {
  it('subscribe to the font epoch', () => {
    for (const { renderer, measures } of TEXT_RENDERERS) {
      const src = measures.map(read).join('\n');
      expect(src, renderer).toContain('fontEpoch');
    }
  });

  it('ask for the face they are going to measure', () => {
    for (const { renderer, measures } of TEXT_RENDERERS) {
      const src = measures.map(read).join('\n');
      expect(
        src.includes('ensureFontLoaded') || src.includes('requestFont'),
        `${renderer} subscribes to the epoch but nothing requests the font`
      ).toBe(true);
    }
  });

  it('redraws the shape label when the epoch changes', () => {
    // Konva measures a string once and keeps the result -- line breaks,
    // textWidth, and the offsets `align: center` is computed from. On a font
    // swap none of the attributes it watches has changed, so the node has to
    // be rebuilt for the measurement to be taken again.
    const src = read('ShapeRenderer.tsx');
    expect(src).toMatch(/key=\{`label-\$\{epoch\}`\}/);
  });
});
