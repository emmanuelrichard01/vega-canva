import React from 'react';
import { Ellipse, Group, Rect, RegularPolygon, Star, Text } from 'react-konva';
import type { ShapeNode } from '../../../engine/model/schema';
import { konvaFontStyle, konvaTextDecoration, strokeColor, strokeDashProps, strokeWidth } from './shared';
import { useFillProps } from './useFillProps';

interface Props {
  node: ShapeNode;
  /** Hidden while the DOM textarea overlay is active, to avoid double text. */
  showLabel: boolean;
}

/**
 * Shapes.
 *
 * Size comes exclusively from `node.width`/`node.height`; `geometry` says only
 * what form to draw. Previously `<Circle radius={w/2}>` was used for ellipses
 * and a single-radius `RegularPolygon`/`Star` for the rest, so height was
 * ignored outright — a wide ellipse snapped to a circle the moment the drag
 * committed, and resizing a hexagon on one axis did nothing at all.
 */
export const ShapeRenderer: React.FC<Props> = React.memo(({ node, showLabel }) => {
  const w = node.width;
  const h = node.height;
  // Gradient geometry is unit-space against the shape's *own* box, and the
  // three primitives here do not share an origin: a Rect is drawn from its
  // top-left, an Ellipse and a RegularPolygon from their centre. Passing the
  // right box per branch is what keeps a top-to-bottom gradient running
  // top-to-bottom on all three rather than starting halfway down the ellipse.
  // Konva's polygon primitives take a single radius, so they are built on a
  // square of the smaller dimension and stretched to the box; their gradient
  // is measured against that square and stretched with them.
  const base = Math.min(w, h) || 1;
  const rectFill = useFillProps(node.appearance, { x: 0, y: 0, width: w, height: h }, '#4F46E5');
  const ellipseFill = useFillProps(node.appearance, { x: -w / 2, y: -h / 2, width: w, height: h }, '#4F46E5');
  const polygonFill = useFillProps(node.appearance, { x: -base / 2, y: -base / 2, width: base, height: base }, '#4F46E5');
  const stroke = strokeColor(node.appearance);
  const sw = strokeWidth(node.appearance);
  const radius = node.appearance?.cornerRadius ?? 0;
  // Dash pattern and the cap that goes with it. Spread rather than passed as
  // two props, because a dotted pattern draws nothing without its round cap.
  const dashProps = strokeDashProps(node.appearance);

  let shape: React.ReactNode;

  if (node.geometry.kind === 'rect') {
    shape = <Rect width={w} height={h} {...rectFill} stroke={stroke} strokeWidth={sw} {...dashProps} cornerRadius={Math.max(0, radius)} />;
  } else if (node.geometry.kind === 'ellipse') {
    // Independent radii, so a non-square ellipse stays elliptical.
    shape = <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...ellipseFill} stroke={stroke} strokeWidth={sw} {...dashProps} />;
  } else {
    // Build on the smaller dimension and stretch the node itself to fill the
    // w x h box. `strokeScaleEnabled={false}` keeps the outline an even weight
    // despite that non-uniform stretch, which would otherwise make the
    // vertical edges of a widened hexagon visibly thicker than the horizontal
    // ones.
    const scaleX = w / base;
    const scaleY = h / base;
    const common = {
      x: w / 2,
      y: h / 2,
      scaleX,
      scaleY,
      ...polygonFill,
      stroke,
      strokeWidth: sw,
      strokeScaleEnabled: false,
      ...dashProps,
    };

    shape =
      node.geometry.kind === 'star' ? (
        <Star
          {...common}
          numPoints={node.geometry.points ?? 5}
          innerRadius={(base / 2) * (node.geometry.innerRatio ?? 0.5)}
          outerRadius={base / 2}
        />
      ) : (
        <RegularPolygon {...common} sides={node.geometry.kind === 'hexagon' ? 6 : 3} radius={base / 2} />
      );
  }

  return (
    <Group>
      {shape}
      {showLabel && node.text && node.typography && (
        <Text
          width={w}
          height={h}
          text={node.text}
          fontSize={node.typography.fontSize}
          fontFamily={node.typography.fontFamily}
          fontStyle={konvaFontStyle(node.typography)}
          textDecoration={konvaTextDecoration(node.typography)}
          fill={node.typography.color}
          align={node.typography.align}
          verticalAlign={node.typography.verticalAlign}
          lineHeight={node.typography.lineHeight}
          letterSpacing={node.typography.letterSpacing}
          listening={false}
        />
      )}
    </Group>
  );
});

ShapeRenderer.displayName = 'ShapeRenderer';
