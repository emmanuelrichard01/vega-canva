// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { cleanup } from '@testing-library/react';
import type Konva from 'konva';
import { nodesOf, renderInStage } from '../../../test/konvaHarness';
import { ShapeRenderer } from './ShapeRenderer';
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
 * Two halves: the value `roughShape` produces, and the Konva nodes the
 * renderer builds from it. Either alone can pass over a broken fix: markup
 * gated on an empty silhouette renders nothing, and a correct silhouette is
 * useless if no listening node carries it.
 */
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

/* ---------------------------------------------------------------- render */

afterEach(cleanup);

const COLOR = '#5B8DEF';

function paths(node: ShapeNode): Konva.Path[] {
  const stage = renderInStage(createElement(ShapeRenderer, { node, showLabel: false }));
  return nodesOf<Konva.Path>(stage, 'Path');
}

/** The node that makes the interior a target: declared fill, painted nothing. */
const hitRegion = (ps: Konva.Path[]) => ps.find((p) => p.fill() === 'transparent');

describe('a sketched shape carries its own hit area', () => {
  for (const style of FILL_STYLES) {
    it(`gives a filled ${style} shape a listening interior`, () => {
      const node = shape(style);
      const region = hitRegion(paths(node));
      expect(region, `${style} has no hit region`).toBeDefined();
      // listening={false} on this node is the whole bug.
      expect(region!.listening()).toBe(true);
      expect(region!.data()).toBe(roughShape(node, true).silhouette);
    });
  }

  it('leaves a hollow shape edge-only', () => {
    expect(hitRegion(paths(shape('hachure', false)))).toBeUndefined();
  });

  it('paints a solid fill with the silhouette, behind the hit region', () => {
    const painted = paths(shape('solid')).filter((p) => p.fill() === COLOR);
    expect(painted).toHaveLength(1);
    expect(painted[0].listening()).toBe(false);
  });

  it('does not paint a pen-style fill solid under its own strokes', () => {
    for (const style of FILL_STYLES.filter((s) => !fillsInterior(s))) {
      const ps = paths(shape(style));
      expect(ps.filter((p) => p.fill() === COLOR), style).toHaveLength(0);
      // The style is drawn as strokes in the fill colour, and those do not listen.
      const strokes = ps.filter((p) => p.stroke() === COLOR);
      expect(strokes.length, style).toBeGreaterThan(0);
      for (const p of strokes) expect(p.listening(), style).toBe(false);
      cleanup();
    }
  });

  it('still gives the outline a generous stroke target', () => {
    // The interior is the fix, not a replacement: an unfilled sketched shape
    // and every open one still depend on this.
    const outline = paths(shape('hachure', false)).find((p) => p.listening() && p.fill() !== 'transparent');
    expect(outline).toBeDefined();
    expect(outline!.hitStrokeWidth()).toBeGreaterThanOrEqual(20);
  });
});
