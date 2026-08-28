import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeCard, TOUR, TOUR_GAP, type TourSide } from './tour';

/** Every source file under `src`, so an anchor can be looked for in all of them. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('the tour', () => {
  it('points at elements that actually exist', () => {
    /**
     * The guarantee that makes string anchors safe.
     *
     * A `data-tour` value nobody writes is a step that silently skips itself,
     * and the only way to notice is to run the tour and count. This is the same
     * class of rot `toolNames.ts` opens by warning about, caught the same way:
     * by checking the claim against the thing it claims about.
     *
     * It reads the source rather than rendering, because rendering the whole
     * shell would need a document, a Y.Doc and a canvas, and would still only
     * prove the anchors exist in whatever state that render happened to be in.
     */
    // Relative to this file rather than to the working directory, which is
    // whatever the runner happened to be started from.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const code = sources(root)
      .filter((f) => !f.endsWith('tour.test.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    for (const step of TOUR) {
      expect(
        code.includes(`data-tour="${step.anchor}"`) || code.includes(`data-tour={\`${step.anchor}`),
        `step "${step.id}" anchors to "${step.anchor}", which nothing carries`
      ).toBe(true);
    }
  });

  it('gives every step its own id', () => {
    expect(new Set(TOUR.map((s) => s.id)).size).toBe(TOUR.length);
  });

  it('keeps every step to one sentence', () => {
    /**
     * The limit is the point. A tour that explains is a tour people skip; one
     * that locates is one they finish. Two sentences is allowed where the
     * second is a short aside; three is a lesson, and lessons belong in
     * `lessons.ts` where they arrive when the tool is picked up.
     */
    for (const step of TOUR) {
      const sentences = step.body.split(/\.\s/).length;
      expect(sentences, `${step.id}: "${step.body}"`).toBeLessThanOrEqual(2);
      expect(step.body.length, step.id).toBeLessThanOrEqual(140);
      expect(step.body, step.id).not.toContain('—');
      expect(step.title, step.id).not.toContain('—');
    }
  });
});

describe('placeCard', () => {
  const CARD = { width: 300, height: 180 };
  const VIEW = { width: 1400, height: 900 };
  const middle = { x: 600, y: 400, width: 200, height: 100 };

  it('honours the side it was asked for when there is room', () => {
    for (const side of ['top', 'bottom', 'left', 'right'] as TourSide[]) {
      expect(placeCard(middle, CARD, VIEW, side).side, side).toBe(side);
    }
  });

  it('centres the card on the anchor along the free axis', () => {
    const above = placeCard(middle, CARD, VIEW, 'top');
    expect(above.x + CARD.width / 2).toBeCloseTo(middle.x + middle.width / 2, 6);
    expect(above.y + CARD.height + TOUR_GAP).toBeCloseTo(middle.y, 6);

    const beside = placeCard(middle, CARD, VIEW, 'right');
    expect(beside.y + CARD.height / 2).toBeCloseTo(middle.y + middle.height / 2, 6);
    expect(beside.x - TOUR_GAP).toBeCloseTo(middle.x + middle.width, 6);
  });

  it('flips to the opposite side rather than running off the screen', () => {
    // The dock: at the foot of the window, asking for a card above it, which is
    // right. The same anchor at the top of the window has to go below instead.
    const atTop = { x: 600, y: 4, width: 200, height: 40 };
    expect(placeCard(atTop, CARD, VIEW, 'top').side).toBe('bottom');

    const atLeft = { x: 6, y: 400, width: 52, height: 300 };
    expect(placeCard(atLeft, CARD, VIEW, 'left').side).toBe('right');
  });

  it('turns a corner when neither side along one axis fits', () => {
    /**
     * The radar's case. It sits in the bottom-left corner: there is no room to
     * its left and none below it either, so the card has to leave the axis it
     * was asked about rather than being clamped into a wall.
     */
    const corner = { x: 16, y: VIEW.height - 60, width: 150, height: 40 };
    const p = placeCard(corner, CARD, VIEW, 'left');
    expect(['right', 'top']).toContain(p.side);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y + CARD.height).toBeLessThanOrEqual(VIEW.height);
  });

  it('never leaves the viewport, even when nothing fits', () => {
    // A window smaller than the card. Clamping in the asked-for direction is
    // the honest answer: half a card pointing the right way still reads as
    // pointing, and a card placed by a rule nobody can predict does not.
    const tiny = { width: 320, height: 200 };
    for (const side of ['top', 'bottom', 'left', 'right'] as TourSide[]) {
      const p = placeCard({ x: 10, y: 10, width: 100, height: 40 }, CARD, tiny, side);
      expect(p.x, side).toBeGreaterThanOrEqual(0);
      expect(p.y, side).toBeGreaterThanOrEqual(0);
      expect(p.side, side).toBe(side);
    }
  });
});
