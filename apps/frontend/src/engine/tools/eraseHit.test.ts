import { describe, expect, it } from 'vitest';
import { distanceToSegment, erasesObject, hasInterior } from './eraseHit';
import type { AnyNode } from '../model/schema';

/**
 * An eraser erases ink, not area.
 *
 * Every case here was a live target before: a place with visibly nothing in it
 * where brushing deleted an object. They are grouped by how bad each one was
 * rather than by node type, because that is the order they matter in.
 */

const base = {
  id: 'n', x: 100, y: 100, width: 200, height: 100, rotation: 0,
  scaleX: 1, scaleY: 1, opacity: 1, zIndex: 0, locked: false, hidden: false,
} as unknown as AnyNode;

const node = (over: Record<string, unknown>): AnyNode => ({ ...base, ...over }) as AnyNode;

const filled = { fill: [{ type: 'solid', color: '#000' }] };

describe('a frame is erased by its edge, never its interior', () => {
  const frame = node({ type: 'frame' });

  it('ignores the middle', () => {
    /**
     * The one that turns a small mistake into losing a board's work. A frame's
     * interior is where its children live — it is exactly the region somebody
     * reaches into with an eraser — and testing the box meant every one of
     * those strokes deleted the frame, taking its contents with it.
     */
    expect(erasesObject(frame, 200, 150, 10)).toBe(false);
  });

  it('catches its border', () => {
    expect(erasesObject(frame, 100, 150, 6)).toBe(true);
    expect(erasesObject(frame, 200, 100, 6)).toBe(true);
  });

  it('catches a border approached from outside', () => {
    expect(erasesObject(frame, 96, 150, 6)).toBe(true);
    expect(erasesObject(frame, 80, 150, 6)).toBe(false);
  });
});

describe('an unfilled shape is an outline', () => {
  const outline = node({ type: 'shape', geometry: { kind: 'rect' }, appearance: {} });
  const solid = node({ type: 'shape', geometry: { kind: 'rect' }, appearance: filled });

  it('ignores the empty middle', () => {
    // You can see there is nothing there. Illustrator agrees.
    expect(erasesObject(outline, 200, 150, 8)).toBe(false);
  });

  it('catches the outline itself', () => {
    expect(erasesObject(outline, 100, 150, 8)).toBe(true);
  });

  it('erases a filled one through the middle', () => {
    expect(erasesObject(solid, 200, 150, 8)).toBe(true);
  });

  it('treats pen shading as ink across the interior', () => {
    // The marks *are* the fill on a hachured shape, so the middle is inked
    // even with no fill paint on the node.
    const hatched = node({
      type: 'shape', geometry: { kind: 'rect' },
      appearance: { sketch: 'medium', fillStyle: 'hachure' },
    });
    expect(hasInterior(hatched)).toBe(true);
    expect(erasesObject(hatched, 200, 150, 8)).toBe(true);
  });
});

describe('a rotated object is tested in its own frame', () => {
  it('spares the empty corner of a turned box', () => {
    /**
     * A square turned 45° has a bounding box 41% wider in each direction, and
     * the four corners of that box are empty. They were all live targets.
     */
    const turned = node({
      type: 'shape', geometry: { kind: 'rect' }, appearance: filled,
      x: 0, y: 0, width: 100, height: 100, rotation: 45,
    });
    // The top-left corner of the axis-aligned box, well outside the diamond.
    expect(erasesObject(turned, -20, -20, 4)).toBe(false);
    // The centre is the centre however it is turned.
    expect(erasesObject(turned, 50, 50, 4)).toBe(true);
  });

  it('follows the shape round', () => {
    const turned = node({
      type: 'shape', geometry: { kind: 'rect' }, appearance: filled,
      x: 0, y: 0, width: 200, height: 20, rotation: 90,
    });
    // Ninety degrees about the centre makes a tall thin bar: the point above
    // the centre is on it, the point beside the centre is not.
    expect(erasesObject(turned, 100, 40, 3)).toBe(true);
    expect(erasesObject(turned, 160, 10, 3)).toBe(false);
  });
});

describe('a line is its line, not the box round it', () => {
  const line = node({
    type: 'shape',
    geometry: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 200, y: 100 } },
    appearance: {},
  });

  it('spares the empty triangles either side of a diagonal', () => {
    // A diagonal's box is mostly empty on both sides of it, and both large
    // triangles used to delete it.
    expect(erasesObject(line, 290, 110, 6)).toBe(false);
    expect(erasesObject(line, 110, 190, 6)).toBe(false);
  });

  it('catches the line', () => {
    expect(erasesObject(line, 200, 150, 6)).toBe(true);
  });

  it('falls back to the box when the endpoints are missing', () => {
    // An older document, or a run stored as vertices. The box is the honest
    // answer rather than a guess at where the line went.
    const legacy = node({ type: 'shape', geometry: { kind: 'line' }, appearance: {} });
    expect(erasesObject(legacy, 200, 150, 6)).toBe(true);
  });
});

describe('an ellipse is tested as an ellipse', () => {
  const disc = node({ type: 'shape', geometry: { kind: 'ellipse' }, appearance: filled });

  it('spares the corners of its box', () => {
    expect(erasesObject(disc, 100, 100, 2)).toBe(false);
  });

  it('erases through a filled one', () => {
    expect(erasesObject(disc, 200, 150, 2)).toBe(true);
  });

  it('ignores the middle of an unfilled ring', () => {
    const ring = node({ type: 'shape', geometry: { kind: 'ellipse' }, appearance: {} });
    expect(erasesObject(ring, 200, 150, 2)).toBe(false);
    // ...and still catches the curve.
    expect(erasesObject(ring, 100, 150, 4)).toBe(true);
  });
});

describe('a solid card is its box', () => {
  it('erases a sticky, an image and a text block through the middle', () => {
    for (const type of ['sticky', 'image', 'text'] as const) {
      expect(erasesObject(node({ type }), 200, 150, 4), type).toBe(true);
    }
  });

  it('still needs to be reached', () => {
    expect(erasesObject(node({ type: 'sticky' }), 400, 150, 4)).toBe(false);
  });
});

describe('distanceToSegment', () => {
  it('is zero on the segment', () => {
    expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
  });

  it('clamps to the ends rather than the infinite line', () => {
    // Past the end, the nearest point is the endpoint — not the perpendicular
    // foot, which is what makes this a segment test and not a line one.
    expect(distanceToSegment(-3, 4, 0, 0, 10, 0)).toBe(5);
  });

  it('survives a zero-length segment', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});
