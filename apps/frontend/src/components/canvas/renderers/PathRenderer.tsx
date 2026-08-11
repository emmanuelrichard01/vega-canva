import React from 'react';
import { Path } from 'react-konva';
import type { PathNode } from '../../../engine/model/schema';
import { strokeColor, strokeDashProps, strokeWidth } from './shared';
import { useFillProps } from './useFillProps';

interface Props {
  node: PathNode;
}

/** Build an SVG `d` string from stored bezier segments. */
function segmentsToPathData(node: PathNode): string {
  if (node.geometry.kind !== 'bezier') return '';
  const { segments, closed } = node.geometry;
  if (segments.length === 0) return '';

  let d = `M ${segments[0].x} ${segments[0].y}`;
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i];
    // An anchor placed without dragging has no handles; degenerate the curve
    // to the endpoints so it renders as a straight segment.
    const c1x = s.cp1x ?? segments[i - 1].x;
    const c1y = s.cp1y ?? segments[i - 1].y;
    const c2x = s.cp2x ?? s.x;
    const c2y = s.cp2y ?? s.y;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${s.x} ${s.y}`;
  }
  if (closed) d += ' Z';
  return d;
}

export const PathRenderer: React.FC<Props> = React.memo(({ node }) => {
  // Before the branch, because it is a hook: a freehand stroke and a bezier
  // path take the same fill, and a conditional hook is not a thing React
  // permits even when the condition never changes for a given node.
  const pathFill = useFillProps(node.appearance, { x: 0, y: 0, width: node.width, height: node.height }, '#1F2937');

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
        hitStrokeWidth={Math.max(20, node.geometry.strokeSize)}
      />
    );
  }

  const stroke = strokeColor(node.appearance) ?? '#1F2937';
  const sw = strokeWidth(node.appearance) || 2;

  return (
    <Path
      data={segmentsToPathData(node)}
      {...pathFill}
      stroke={stroke}
      strokeWidth={sw}
      {...strokeDashProps(node.appearance, 'round')}
      lineJoin="round"
      hitStrokeWidth={Math.max(20, sw)}
    />
  );
});

PathRenderer.displayName = 'PathRenderer';
