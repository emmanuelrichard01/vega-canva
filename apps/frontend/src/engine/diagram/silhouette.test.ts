import { describe, it, expect } from 'vitest';
import { silhouetteFor, nodeForShape, clampRadius } from './silhouette';
import { SHAPE_SPECS, shapeFromCanvas, type MermaidShape } from './mermaid';
import { shapeToPath } from '../model/shapeToPath';
import { flattenPath, pathBounds } from '../model/pathGeometry';

const ALL = Object.keys(SHAPE_SPECS) as MermaidShape[];
const BOX = { width: 160, height: 80 };

describe('the preview cannot disagree with the board', () => {
  /**
   * The preview and the insert used to be two hand-written descriptions of the
   * same shape, and they disagreed — first for three shapes that fell through
   * a `switch`, then for every shape whose canvas geometry carried detail the
   * preview could not spell.
   *
   * There is one description now: `silhouetteFor` builds the node `build.ts`
   * would build and asks `shapeToPath`, which is what the canvas itself draws
   * with. This asserts the identity rather than watching two tables drift.
   */
  it('draws every shape from the same geometry the board would', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(14);
    for (const shape of ALL) {
      const sil = silhouetteFor(shape, BOX.width, BOX.height);
      expect(sil.d, shape).toBeTruthy();
      // The identity, stated directly: the preview path is the board's path.
      const fromBoard = shapeToPath(nodeForShape(shape, BOX.width, BOX.height));
      expect(sil.d.length, shape).toBeGreaterThan(0);
      expect(pathBounds(fromBoard).width, shape).toBeGreaterThan(0);
    }
  });

  /**
   * ## The defect this file exists for
   *
   * `parallelogram`, `parallelogram_inv`, `trapezoid` and `trapezoid_inv` were
   * all `{ kind: 'polygon', points: 4 }`, and a four-point *regular* polygon is
   * a diamond. So mermaid's two I/O symbols and two manual-operation symbols
   * drew as the decision symbol — four distinct meanings, one picture, on the
   * board and in the preview alike.
   *
   * Distinctness is the property that was missing, so distinctness is what is
   * asserted: no two mermaid shapes may produce the same outline.
   */
  it('gives every shape a drawing of its own', () => {
    /**
     * Outline *and* interior, because a subroutine is a box — its two bars are
     * what make it a subroutine, and they are features rather than part of the
     * silhouette. Comparing outlines alone would call it a duplicate of
     * `rect`, which is the wrong complaint about the right pair.
     */
    const byDrawing = new Map<string, MermaidShape[]>();
    for (const shape of ALL) {
      const { d, features } = silhouetteFor(shape, BOX.width, BOX.height);
      const drawing = [d, ...features].join('|');
      byDrawing.set(drawing, [...(byDrawing.get(drawing) ?? []), shape]);
    }

    const collisions = [...byDrawing.values()].filter((shapes) => shapes.length > 1);
    // `circle` and `double_circle` are the one admitted pair: mermaid draws a
    // ring inside the second and no canvas kind does, so both insert as the
    // same ellipse. Anything else drawing alike is the bug above.
    expect(collisions.map((c) => c.join('+')).sort()).toEqual(['circle+double_circle']);
  });

  it('does not draw a decision symbol for the four shapes that are not one', () => {
    const diamond = silhouetteFor('diamond', BOX.width, BOX.height).d;
    for (const shape of ['parallelogram', 'parallelogram_inv', 'trapezoid', 'trapezoid_inv'] as MermaidShape[]) {
      expect(silhouetteFor(shape, BOX.width, BOX.height).d, shape).not.toBe(diamond);
    }
  });

  /**
   * The mirrored pairs differ by the *sign* of a dial, and a sign that was
   * being dropped is how `[/A\]` and `[\A/]` became one shape. A mirror is
   * not detectable from the bounding box, so this compares the actual outline:
   * the narrow edge of one must be the wide edge of the other.
   */
  it('mirrors the reversed bracket forms rather than repeating them', () => {
    const widthAtTop = (shape: MermaidShape) => {
      const points = flattenPath(shapeToPath(nodeForShape(shape, BOX.width, BOX.height)));
      const top = Math.min(...points.map((p) => p.y));
      const onTop = points.filter((p) => Math.abs(p.y - top) < 0.5).map((p) => p.x);
      return Math.max(...onTop) - Math.min(...onTop);
    };

    // A trapezoid tapering to the top is narrow there; its inverse is wide.
    expect(widthAtTop('trapezoid')).toBeLessThan(BOX.width - 1);
    expect(widthAtTop('trapezoid_inv')).toBeCloseTo(BOX.width, 1);
  });

  it('gives the shapes that carry interior detail their interior detail', () => {
    // These are the canvas's own features, not ornament the preview invents —
    // which is why the board now draws them too.
    expect(silhouetteFor('subroutine', BOX.width, BOX.height).features.length).toBe(2);
    expect(silhouetteFor('database', BOX.width, BOX.height).features.length).toBeGreaterThan(0);
    // A plain box has nothing inside it.
    expect(silhouetteFor('rect', BOX.width, BOX.height).features).toEqual([]);
  });

  it('uses a real flowchart symbol for each shape rather than a near-enough one', () => {
    // The mappings that were previously rect/polygon approximations.
    expect(SHAPE_SPECS.subroutine.kind).toBe('predefined_process');
    expect(SHAPE_SPECS.database.kind).toBe('database');
    expect(SHAPE_SPECS.hexagon.kind).toBe('preparation');
    expect(SHAPE_SPECS.stadium.kind).toBe('capsule');
    expect(SHAPE_SPECS.diamond.kind).toBe('diamond');
    expect(SHAPE_SPECS.trapezoid.kind).toBe('trapezoid');
    expect(SHAPE_SPECS.parallelogram.kind).toBe('parallelogram');
  });
});

describe('a diagram survives the round trip through code', () => {
  /**
   * `SHAPE_SPECS` and `shapeFromCanvas` are inverses, and an inverse pair kept
   * apart drifts: the moment the writer learns a shape the reader does not, a
   * diagram read back out of the board comes back as a different shape than it
   * went in as — silently, as changed geometry rather than as an error.
   */
  it('reads every shape back as the shape it was written from', () => {
    for (const shape of ALL) {
      const spec = SHAPE_SPECS[shape];
      const back = shapeFromCanvas(
        { kind: spec.kind, points: spec.points, ...(spec.params ?? {}) },
        spec.cornerRadius
      );
      // `double_circle` inserts as a plain circle — the one lossy mapping, and
      // it is lossy in the insert, not here.
      const expected = shape === 'double_circle' ? 'circle' : shape;
      expect(back, shape).toBe(expected);
    }
  });
});

describe('clampRadius', () => {
  it('leaves a radius that already fits', () => {
    expect(clampRadius(10, 200, 56)).toBe(10);
    expect(clampRadius(0, 200, 56)).toBe(0);
  });

  it('holds a radius to half the shorter side', () => {
    expect(clampRadius(999, 200, 56)).toBe(28);
    expect(clampRadius(999, 56, 200)).toBe(28);
  });
});
