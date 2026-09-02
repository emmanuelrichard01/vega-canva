import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Checked by reading the source, in the manner of `shapeLabelFont.test.ts`
 * beside it and for the same reason: proving a hit region properly needs a
 * real canvas and real pointer events, and a synthetic click would pass
 * against a control that is broken for every hand. The claim is narrow and
 * structural, and so is the check.
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

  it('still gives the outline a generous stroke target', () => {
    // The interior is the fix, not a replacement: an unfilled sketched shape
    // and every open one still depend on this.
    expect(sketchBranch()).toMatch(/hitStrokeWidth=\{Math\.max\(20, nib \* 3\)\}/);
  });
});
