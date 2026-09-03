import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roughShape } from '../../../engine/model/roughShape';
import { FILL_STYLES, fillsInterior } from '../../../engine/model/rough';
import type { FillStyle } from '../../../engine/model/rough';
import type { ShapeNode } from '../../../engine/model/schema';

/**
 * A sketched shape has to be clickable through the middle, like a crisp one.
 *
 * Konva takes a shape's hit area from what it *fills*. The crisp branch draws
 * a filled primitive, so its interior is a target for free. The sketch branch
 * draws everything by hand and marks every visible layer `listening={false}`
 * -- the silhouette fill, the hachure strokes, the caps -- which left the
 * outline path and its `hitStrokeWidth` band as the only live region. A
 * sketched shape was live near its edge and dead through the middle.
 *
 * Hachure and cross-hatch are the worst case and the way it was found: those
 * styles paint the inside as strokes, so nothing is filled anywhere. Clicking
 * the centre of a shape that plainly looks filled hits the stage, and a click
 * on the stage clears the selection -- so the object reads as refusing to be
 * selected and refusing to move, rather than as having been missed.
 *
 * ## Why this file is in two halves
 *
 * The first version of it had only the second half, and that is why the bug
 * survived its own fix. Reading the source proved the *element* was there:
 *
 *     {!open && hasFill && sketch.silhouette && <Path fill="transparent" … />}
 *
 * and it was, and it rendered nothing, because `roughShape` returned
 * `silhouette: ''` for every style except `solid` -- so the gate that could
 * never pass was the one guarding the case the fix was written for. Four
 * assertions passed over an inert fix.
 *
 * The lesson is the repo's own instruction to check a test is not vacuous by
 * reverting the fix: reverting the *markup* would have failed these, so they
 * looked sound. Reverting the thing that actually mattered -- the value the
 * markup consumes -- was not something the check could see, because it never
 * called anything. A structural check needs the value half to mean anything at
 * all, which is what `describe('the region exists')` below is.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'ShapeRenderer.tsx'), 'utf8');

/** The sketch branch, from `if (sketch) {` to the crisp renderer below it. */
function sketchBranch(): string {
  const from = src.indexOf('if (sketch) {');
  const to = src.indexOf('let shape: React.ReactElement;', from);
  expect(from, 'the sketch branch should still exist').toBeGreaterThan(-1);
  expect(to, 'the crisp branch should still follow it').toBeGreaterThan(from);
  return src.slice(from, to);
}

const shape = (fillStyle: FillStyle, filled = true): ShapeNode =>
  ({
    id: 'hit-area-probe',
    type: 'shape',
    x: 0,
    y: 0,
    width: 200,
    height: 140,
    geometry: { kind: 'rect' },
    appearance: {
      sketch: 'medium',
      fillStyle,
      fill: filled ? [{ type: 'solid', color: '#5B8DEF' }] : [],
    },
  }) as unknown as ShapeNode;

/* ------------------------------------------------------------------ value */

describe('the region a sketched shape occupies exists, whatever shades it', () => {
  // The assertion the first version of this file was missing. Every one of
  // these except `solid` returned an empty string, which is precisely the set
  // of styles the bug was reported against.
  for (const style of FILL_STYLES) {
    it(`produces a silhouette for a ${style} fill`, () => {
      const { silhouette } = roughShape(shape(style), true);
      expect(silhouette.length, `${style} must have a hit region`).toBeGreaterThan(0);
      expect(silhouette, `${style} must be a closed path`).toMatch(/^M /);
      expect(silhouette).toMatch(/Z\s*$/);
    });
  }

  it('produces none for a shape with no fill, which stays edge-only', () => {
    // A hollow sketched shape should behave like a hollow crisp one: you click
    // its outline, not its hole. `wantsFill` is how the renderer says so.
    expect(roughShape(shape('hachure', false), false).silhouette).toBe('');
  });

  it('produces none for an open shape, which has no interior at all', () => {
    const line = { ...shape('solid'), geometry: { kind: 'line' } } as unknown as ShapeNode;
    expect(roughShape(line, true).silhouette).toBe('');
  });

  it('still shades the pen styles, and does not shade a solid one', () => {
    // The region existing must not have turned every style into a solid fill,
    // which is the regression the `fillsInterior` gates guard against.
    expect(roughShape(shape('hachure'), true).fill.length).toBeGreaterThan(0);
    expect(roughShape(shape('solid'), true).fill).toBe('');
  });
});

describe('fillsInterior separates the region from the paint', () => {
  it('is true only for solid, and treats an unset style as solid', () => {
    expect(fillsInterior('solid')).toBe(true);
    expect(fillsInterior(undefined)).toBe(true);
    for (const style of FILL_STYLES.filter((s) => s !== 'solid')) {
      expect(fillsInterior(style), style).toBe(false);
    }
  });
});

/* ------------------------------------------------------------- structure */

describe('a sketched shape carries its own hit area', () => {
  it('renders a silhouette path whose fill is declared', () => {
    // `fill="transparent"` is the point: Konva paints the scene with the
    // declared fill (nothing) and the hit canvas with the shape's colour key,
    // so the interior becomes a target without becoming a mark.
    expect(sketchBranch()).toMatch(/data=\{sketch\.silhouette\}\s+fill="transparent"/);
  });

  it('leaves that path listening, unlike every painted layer', () => {
    const branch = sketchBranch();
    const hit = branch.slice(branch.indexOf('fill="transparent"'));
    const element = hit.slice(0, hit.indexOf('/>'));
    expect(
      element,
      'the hit path must not be listening={false} — that is the whole bug'
    ).not.toMatch(/listening=\{false\}/);
  });

  it('gates the hit area on the shape actually having a fill', () => {
    // A hollow sketched shape should stay edge-only, because a hollow crisp
    // one does: you click the outline of an unfilled rectangle, not its hole.
    expect(sketchBranch()).toMatch(/!open && hasFill && sketch\.silhouette/);
  });

  it('gates the painted fill on the style, not merely on there being a region', () => {
    // The two used to be the same test by accident. Now that the region exists
    // for a hachured shape, only this stops it being painted solid underneath
    // its own strokes.
    expect(sketchBranch()).toMatch(
      /sketch\.silhouette && hachureColor && fillsInterior\(fillStyle\)/
    );
  });

  it('still gives the outline a generous stroke target', () => {
    // The interior is the fix, not a replacement: an unfilled sketched shape
    // and every open one still depend on this.
    expect(sketchBranch()).toMatch(/hitStrokeWidth=\{Math\.max\(20, nib \* 3\)\}/);
  });
});
