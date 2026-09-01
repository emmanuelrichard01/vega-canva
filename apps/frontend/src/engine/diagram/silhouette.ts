import { SHAPE_SPECS, type MermaidShape } from './mermaid';

/**
 * The base outline for a mermaid shape, as both drawings agree on it.
 *
 * ## Why this is not just `SHAPE_SPECS`
 *
 * Two things draw a diagram: `build.ts` makes canvas nodes, and the preview in
 * `MermaidModal` makes SVG. They shared the geometry (`layoutGraph`) and the
 * sizes (`diagramNodeSizes`) but not the *silhouette* -- the preview carried
 * its own `switch (shape)` with a `case 'rect': default:` at the bottom. Three
 * of the fourteen shapes never had a case, so `trapezoid`, `trapezoid_inv` and
 * `flag` fell through: the board drew a polygon and the preview drew a
 * rectangle, for the same source, side by side.
 *
 * That is the failure a preview cannot have. Deriving the base from
 * `SHAPE_SPECS` means a shape added there cannot silently become a rectangle
 * here -- `silhouetteFor` is total over `MermaidShape`, and the test asserts
 * it.
 *
 * ## What still differs, deliberately
 *
 * The preview adds ornament the canvas has no vocabulary for: the ring inside
 * a double circle, the bars down a subroutine, the elliptical lid on a
 * database. `SHAPE_SPECS` can only say "ellipse" or "rect", so those are drawn
 * on top of the base rather than instead of it, and `ornament` names which.
 * They are additive: the outline underneath is the one the board draws.
 */
export type Silhouette =
  | { kind: 'ellipse'; ornament?: 'ring' }
  | { kind: 'polygon'; points: number }
  | { kind: 'rect'; cornerRadius: number; ornament?: 'bars' | 'cylinder' };

/** Ornaments the preview draws that the canvas has no geometry for. */
const ORNAMENTS: Partial<Record<MermaidShape, 'ring' | 'bars' | 'cylinder'>> = {
  double_circle: 'ring',
  subroutine: 'bars',
  database: 'cylinder',
};

export function silhouetteFor(shape: MermaidShape): Silhouette {
  const spec = SHAPE_SPECS[shape];
  const ornament = ORNAMENTS[shape];

  if (spec.kind === 'ellipse') {
    return { kind: 'ellipse', ...(ornament === 'ring' ? { ornament } : {}) };
  }
  if (spec.kind === 'polygon') {
    return { kind: 'polygon', points: spec.points ?? 4 };
  }
  return {
    kind: 'rect',
    // `999` is the stadium's deliberately absurd radius, which the canvas
    // renderer clamps to half the shorter side. The clamp lives here too, so
    // the two ends do not disagree about what "fully rounded" means.
    cornerRadius: spec.cornerRadius ?? 0,
    ...(ornament === 'bars' || ornament === 'cylinder' ? { ornament } : {}),
  };
}

/** The drawn radius, once the box is known. */
export function clampRadius(cornerRadius: number, width: number, height: number): number {
  return Math.min(cornerRadius, Math.min(width, height) / 2);
}
