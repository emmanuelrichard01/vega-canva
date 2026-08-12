import React from 'react';
import { Path } from 'react-konva';
import type { PathNode } from '../../../engine/model/schema';
import { contourData } from '../../../engine/model/pathGeometry';
import { shadowProps, strokeColor, strokeDashProps, strokeWidth } from './shared';
import { useFillProps } from './useFillProps';

interface Props {
  node: PathNode;
}

export const PathRenderer: React.FC<Props> = React.memo(({ node }) => {
  // Before the branch, because it is a hook: a freehand stroke and a bezier
  // path take the same fill, and a conditional hook is not a thing React
  // permits even when the condition never changes for a given node.
  const pathFill = useFillProps(node.appearance, { x: 0, y: 0, width: node.width, height: node.height }, '#1F2937');
  // No spread here: the grown-silhouette trick strokes the path, and a
  // freehand blob is already a filled outline while a pen path is already
  // stroked — in both cases a second stroke changes the shape rather than the
  // shadow. `supportsShadowSpread` is therefore false for paths.
  const shadow = shadowProps(node.appearance);

  if (node.geometry.kind === 'freehand') {
    // perfect-freehand produces a filled outline polygon, not a stroked line,
    // so the stroke colour is irrelevant here — and so is the dash pattern.
    // Dashing this shape would chop up the *outline* of the stroke rather than
    // the stroke itself, which looks like a rendering fault, not a dashed
    // pencil line. Deliberately not forwarded.
    return (
      <Path
        data={node.geometry.svgPath}
        {...pathFill}
        {...shadow}
        hitStrokeWidth={Math.max(20, node.geometry.strokeSize)}
      />
    );
  }

  const stroke = strokeColor(node.appearance) ?? '#1F2937';
  const sw = strokeWidth(node.appearance) || 2;
  const dash = strokeDashProps(node.appearance, 'round');

  return (
    <Path
      data={contourData(node.geometry)}
      {...pathFill}
      {...shadow}
      stroke={stroke}
      strokeWidth={sw}
      {...dash}
      // Round unless the document says otherwise. A pen path used to be
      // hard-wired round, which was a reasonable default and a dead end — the
      // join is a control now, and a control the renderer overrides is worse
      // than one that does not exist.
      lineJoin={dash.lineJoin ?? 'round'}
      // Several contours filled as one: the inner ones are holes, and only the
      // even-odd rule says so regardless of which way they happen to wind.
      fillRule={node.geometry.kind === 'compound' ? 'evenodd' : undefined}
      hitStrokeWidth={Math.max(20, sw)}
    />
  );
});

PathRenderer.displayName = 'PathRenderer';
