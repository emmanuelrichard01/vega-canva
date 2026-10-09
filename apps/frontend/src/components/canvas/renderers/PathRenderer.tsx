import React from 'react';
import { Path } from 'react-konva';
import type { PathNode } from '../../../engine/model/schema';
import { DEFAULT_INK } from '../../../engine/model/schema';
import { contourData } from '../../../engine/model/pathGeometry';
import { roughPencil } from '../../../engine/model/roughNodes';
import { loopPath } from '../../../engine/model/freehandLoop';
import { strokeColor, strokeDashProps, strokeWidth } from './shared';
import { DropShadow, type ShadowSilhouette } from './ShapeEffects';
import { strokeReach } from './shadowInk';
import { castsShadow, inkOf, needsKnockout } from '../../../engine/model/dropShadow';
import { useFillProps } from './useFillProps';
import { useDarkTheme } from './useDarkTheme';
import { brushPaint } from '../../../engine/tools/brushes';

interface Props {
  node: PathNode;
}

export const PathRenderer: React.FC<Props> = React.memo(({ node }) => {
  // Before the branch, because it is a hook: a freehand stroke and a bezier
  // path take the same fill, and a conditional hook is not a thing React
  // permits even when the condition never changes for a given node.
  const pathFill = useFillProps(node.appearance, { x: 0, y: 0, width: node.width, height: node.height }, DEFAULT_INK);
  // Cast once from everything the path inks — the interior and the line
  // together — by `DropShadow`. A pen path with no fill is all line, and used
  // to cast nothing at all, because Konva skips a stroke's shadow by default.
  const shadowSpec = node.appearance?.shadow;
  const dropShadow = castsShadow(shadowSpec) ? shadowSpec : undefined;
  /** `filled` is whether an interior is actually drawn: a pencil stroke's fill is only used by a closed loop. */
  const castBy = (silhouette: ShadowSilhouette, pad: number, filled: boolean) => {
    if (!dropShadow) return null;
    const ink = inkOf(node.appearance, { absentFill: false, stroked: true });
    return (
      <DropShadow
        shadow={dropShadow}
        box={{ x: -pad, y: -pad, width: node.width + pad * 2, height: node.height + pad * 2 }}
        silhouette={silhouette}
        knockout={needsKnockout(filled ? ink : { ...ink, filled: false, fillOpaque: false })}
      />
    );
  };
  const dark = useDarkTheme();

  /**
   * Sketching applies to freehand strokes only (pen paths have no centreline),
   * and only when the stroke itself asks for it. A pencil stroke is already
   * drawn by hand, so the board's sketch mode leaves it, and its pressure
   * taper, alone.
   */
  const sketchLevel = node.appearance?.sketch;
  const freehand = node.geometry.kind === 'freehand' ? node.geometry : null;
  const sketchSeed = node.appearance?.sketchSeed;
  const pencil = React.useMemo(
    () =>
      sketchLevel && freehand && freehand.points.length > 1
        ? roughPencil({ id: node.id, appearance: { sketchSeed }, geometry: freehand }, sketchLevel)
        : null,
    [sketchLevel, freehand, node.id, sketchSeed]
  );

  if (node.geometry.kind === 'freehand') {
    // perfect-freehand produces a filled outline polygon, not a stroked line,
    // so the stroke *weight* is irrelevant here — the nib decided it when the
    // pen lifted — and so is the dash pattern.
    // Dashing this shape would chop up the *outline* of the stroke rather than
    // the stroke itself, which looks like a rendering fault, not a dashed
    // pencil line. Deliberately not forwarded.
    /**
     * Sketch mode for the pencil.
     *
     * A pencil stroke is stored twice: the filled outline that perfect-freehand
     * produced, and the **centreline** that produced it. The outline is what
     * gives an ordinary stroke its pressure taper, and roughening it would
     * wobble the *edges* of the stroke rather than the stroke — a fat line with
     * a frayed border, which is not what a hand-drawn line looks like.
     *
     * So a sketched pencil stroke is drawn from the centreline instead, as a
     * run through the same sketcher every shape uses: two passes at heavier
     * levels, each wandering slightly wide and coming back. That is a drawn
     * line — a hand goes over a line twice and never lands on the same place —
     * and it is why this is a genuine second way to draw rather than a filter
     * over the first.
     *
     * The taper is given up in exchange, which is the honest trade: a hand
     * drawing over its own line does not taper either.
     */
    /**
     * The ink is the **stroke** colour, and `fill` is the interior.
     *
     * ## What this used to be, and why it was wrong
     *
     * `perfect-freehand` emits a filled outline polygon rather than a stroked
     * line, and the renderer took that literally: the polygon was painted with
     * `appearance.fill`, so a pencil stroke's `fill` *was* its ink and its
     * `stroke` was ignored. The comment above still says the stroke colour is
     * irrelevant here, and for the outline it is — that is not the same as
     * `fill` being the right field for it.
     *
     * It made the pencil the one node type in the app where `fill` does not
     * mean the interior. A bezier path's fill is its interior; a shape's fill
     * is its interior; a pencil stroke's fill was its outline. So a closed
     * pencil loop — a ring you drew by coming back to where you started — had
     * no way to be filled at all, because the field that would have held the
     * colour was already spoken for.
     *
     * ## Why the change is safe on documents that already exist
     *
     * `PenTool` has always written the same colour to **both** `fill` and
     * `stroke`, so every pencil stroke ever drawn already carries its ink in
     * the field this now reads. Nothing on any board changes appearance. What
     * changes is which control edits it: the Stroke colour, which is where a
     * line's colour belongs and which the panel was previously withholding
     * from freehand strokes entirely.
     */
    const ink = strokeColor(node.appearance) ?? DEFAULT_INK;
    // A closed loop is filled only when it has a fill. Without one the
    // fallback is the ink, which would turn every drawn circle into a disc.
    const interior =
      node.geometry.closed && node.geometry.points.length > 2 && node.appearance?.fill?.length
        ? loopPath(node.geometry.points)
        : '';

    const interiorInk = interior ? [{ path: new Path2D(interior) }] : [];
    const stretch = node.geometry.strokeSize + 4;

    if (pencil) {
      return (
        <>
          {castBy(
            { fills: interiorInk, strokes: [{ path: new Path2D(pencil.d), width: pencil.nib, cap: 'round', join: 'round' }] },
            stretch,
            Boolean(interior)
          )}
          {interior && <Path data={interior} {...pathFill} listening={false} />}
          <Path
            data={pencil.d}
            stroke={ink}
            strokeWidth={pencil.nib}
            lineCap="round"
            lineJoin="round"
            hitStrokeWidth={Math.max(20, node.geometry.strokeSize)}
            perfectDrawEnabled={false}
          />
        </>
      );
    }

    return (
      <>
        {castBy({ fills: [...interiorInk, { path: new Path2D(node.geometry.svgPath) }] }, stretch, Boolean(interior))}
        {/*
          The area the loop encloses, under the ink.

          Drawn from the *centreline* rather than the outline: the outline is
          the edge of the ink, so filling it would paint the stroke's own body.
          The two differ by half the nib all the way round, and that overlap is
          what makes the fill meet the ink with no seam between them.

          The shadow is cast above from the region and the ink together, so
          the loop casts one shadow and not a ring inside a disc.
        */}
        {interior && <Path data={interior} {...pathFill} listening={false} />}
        <Path
          data={node.geometry.svgPath}
          fill={ink}
          {...brushPaint(node.geometry.brush, dark)}
          hitStrokeWidth={Math.max(20, node.geometry.strokeSize)}
        />
      </>
    );
  }

  const hasFill = Boolean(node.appearance?.fill?.length);
  const explicitSw = strokeWidth(node.appearance);
  const explicitColor = strokeColor(node.appearance);
  const sw = explicitSw > 0 ? explicitSw : hasFill ? 0 : 2;
  const stroke = sw > 0 ? (explicitColor ?? DEFAULT_INK) : undefined;

  const dash = strokeDashProps(node.appearance);
  const contour = contourData(node.geometry);
  const evenOdd = node.geometry.kind === 'compound';

  const body = (
    <Path
      data={contour}
      // No fill means no fill: the paint fallback is the ink, which would
      // flood the area under every open pen path.
      {...(hasFill ? pathFill : { fillEnabled: false })}
      stroke={stroke}
      strokeWidth={sw}
      {...dash}
      lineJoin={dash.lineJoin}
      // Several contours filled as one: the inner ones are holes, and only the
      // even-odd rule says so regardless of which way they happen to wind.
      fillRule={evenOdd ? 'evenodd' : undefined}
      hitStrokeWidth={Math.max(20, sw || 1)}
    />
  );
  if (!dropShadow) return body;

  const outline = new Path2D(contour);
  return (
    <>
      {castBy(
        {
          fills: hasFill ? [{ path: outline, rule: evenOdd ? 'evenodd' : 'nonzero' }] : [],
          strokes: stroke
            ? [{ path: outline, width: sw, cap: dash.lineCap, join: dash.lineJoin, miterLimit: dash.miterLimit, dash: dash.dash }]
            : [],
        },
        strokeReach(sw, 'center', dash.lineJoin ?? 'miter', dash.miterLimit) + 4,
        hasFill
      )}
      {body}
    </>
  );
});

PathRenderer.displayName = 'PathRenderer';
