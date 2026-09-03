import React from 'react';
import { Path } from 'react-konva';
import type { PathNode } from '../../../engine/model/schema';
import { DEFAULT_INK } from '../../../engine/model/schema';
import { contourData } from '../../../engine/model/pathGeometry';
import { roughLoop, seedFor } from '../../../engine/model/rough';
import { loopPath } from '../../../engine/model/freehandLoop';
import { shadowProps, strokeColor, strokeDashProps, strokeWidth } from './shared';
import { useFillProps } from './useFillProps';

interface Props {
  node: PathNode;
}

export const PathRenderer: React.FC<Props> = React.memo(({ node }) => {
  // Before the branch, because it is a hook: a freehand stroke and a bezier
  // path take the same fill, and a conditional hook is not a thing React
  // permits even when the condition never changes for a given node.
  const pathFill = useFillProps(node.appearance, { x: 0, y: 0, width: node.width, height: node.height }, DEFAULT_INK);
  // No spread here: the grown-silhouette trick strokes the path, and a
  // freehand blob is already a filled outline while a pen path is already
  // stroked — in both cases a second stroke changes the shape rather than the
  // shadow. `supportsShadowSpread` is therefore false for paths.
  const shadow = shadowProps(node.appearance);

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
    if (node.appearance?.sketch && node.geometry.points.length > 1) {
      // The width the sketch is actually drawn at, so the wander is scaled to
      // the nib rather than to the outline weight the pencil no longer uses.
      const nib = Math.max(1, node.geometry.strokeSize * 0.66);
      return (
        <Path
          data={roughLoop(node.geometry.points, {
            seed: seedFor(node.id, node.appearance?.sketchSeed),
            level: node.appearance.sketch,
            width: nib,
            closed: false,
          })}
          stroke={strokeColor(node.appearance) ?? DEFAULT_INK}
          // The stored stroke size is the *width of the outline*, so a sketched
          // run at that weight would be far heavier than the stroke it
          // replaces. Two thirds lands it about where the pencil looked.
          strokeWidth={nib}
          lineCap="round"
          lineJoin="round"
          {...shadow}
          hitStrokeWidth={Math.max(20, node.geometry.strokeSize)}
        />
      );
    }

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
    const interior =
      node.geometry.closed && node.geometry.points.length > 2
        ? loopPath(node.geometry.points)
        : '';

    return (
      <>
        {/*
          The area the loop encloses, under the ink.

          Drawn from the *centreline* rather than the outline: the outline is
          the edge of the ink, so filling it would paint the stroke's own body.
          The two differ by half the nib all the way round, and that overlap is
          what makes the fill meet the ink with no seam between them.

          It takes the shadow, and the outline above it does not — a closed
          stroke's silhouette is the filled region, and casting from the ring
          alone would put a shadow inside the shape as well as outside it.
        */}
        {interior && <Path data={interior} {...pathFill} {...shadow} listening={false} />}
        <Path
          data={node.geometry.svgPath}
          fill={ink}
          {...(interior ? null : shadow)}
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

  return (
    <Path
      data={contourData(node.geometry)}
      {...pathFill}
      {...shadow}
      stroke={stroke}
      strokeWidth={sw}
      {...dash}
      lineJoin={dash.lineJoin}
      // Several contours filled as one: the inner ones are holes, and only the
      // even-odd rule says so regardless of which way they happen to wind.
      fillRule={node.geometry.kind === 'compound' ? 'evenodd' : undefined}
      hitStrokeWidth={Math.max(20, sw || 1)}
    />
  );
});

PathRenderer.displayName = 'PathRenderer';
