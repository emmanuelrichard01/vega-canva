import React from 'react';
import { Ellipse, Group, Rect, RegularPolygon, Star, Text } from 'react-konva';
import type { ShapeNode } from '../../../engine/model/schema';
import { fillColor, konvaFontStyle, konvaTextDecoration, strokeColor, strokeDashProps, strokeWidth } from './shared';

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
  const fill = fillColor(node.appearance, '#4F46E5');
  const stroke = strokeColor(node.appearance);
  const sw = strokeWidth(node.appearance);
  const radius = node.appearance?.cornerRadius ?? 0;
  // Dash pattern and the cap that goes with it. Spread rather than passed as
  // two props, because a dotted pattern draws nothing without its round cap.
  const dashProps = strokeDashProps(node.appearance);

  let shape: React.ReactNode;

  if (node.geometry.kind === 'rect') {
    shape = <Rect width={w} height={h} fill={fill} stroke={stroke} strokeWidth={sw} {...dashProps} cornerRadius={Math.max(0, radius)} />;
  } else if (node.geometry.kind === 'ellipse') {
    // Independent radii, so a non-square ellipse stays elliptical.
    shape = <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} {...dashProps} />;
  } else {
    // Konva's polygon primitives take one radius. Build on the smaller
    // dimension and stretch the node itself to fill the w x h box.
    // `strokeScaleEnabled={false}` keeps the outline an even weight despite
    // that non-uniform stretch, which would otherwise make the vertical edges
    // of a widened hexagon visibly thicker than the horizontal ones.
    const base = Math.min(w, h) || 1;
    const scaleX = w / base;
    const scaleY = h / base;
    const common = {
      x: w / 2,
      y: h / 2,
      scaleX,
      scaleY,
      fill,
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
