import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { EXPORT_CHROME } from '../../../engine/export/chrome';
import { safeAreaBox } from '../../../engine/model/frames';
import { axisBands } from '../../../engine/model/layoutGuide';
import type { FrameNode } from '../../../engine/model/schema';
import { useFillProps } from './useFillProps';

interface Props {
  node: FrameNode;
  stageScale: number;
}

/**
 * A frame: its background, its name, and its safe-area guide.
 *
 * Lifted out of `ObjectRenderer`'s switch when the background became a paint
 * rather than a colour. A gradient fill is a hook, and a hook cannot live in a
 * `case` — but the more honest reason is that this is now three things with
 * three different rules about what exports and what does not, which is more
 * than a switch arm should be carrying.
 */
export const FrameRenderer: React.FC<Props> = React.memo(({ node, stageScale }) => {
  const fill = useFillProps(node.appearance, { x: 0, y: 0, width: node.width, height: node.height }, '#FFFFFF');

  // The frame's own box, origin-anchored, so `safeAreaBox` hands back the
  // guide in local coordinates and the clamping has one implementation.
  const safe = safeAreaBox({ x: 0, y: 0, width: node.width, height: node.height, safeArea: node.safeArea });

  // In the frame's own coordinates, like `safe` above, so the group's
  // transform places them and nothing here has to know where the frame is.
  const columns = axisBands(node.width, node.layoutGuide?.columns);
  const rows = axisBands(node.height, node.layoutGuide?.rows);

  return (
    <Group>
      {/* A frame is paper on a desk, and paper has an edge as well as a
          shadow.

          Shadow alone was enough in dark mode, where a white frame sits on a
          near-black board and separates itself. In light mode the default fill
          is `#FFFFFF` and the canvas is `#F9FAFB` — about one percent apart —
          so the only thing distinguishing a frame from the board behind it was
          a shadow at five percent opacity. It was, in practice, invisible.

          The hairline is a neutral at low alpha rather than a theme token,
          because it has to sit on the *frame's own fill*, which the user
          chooses and which may be anything at all. A mid grey at 20% darkens a
          white edge and lightens a black one, so it reads either way without
          knowing the theme. Drawn with `strokeScaleEnabled={false}` so it
          stays one screen pixel and never becomes a thick band at high zoom. */}
      <Rect
        width={node.width}
        height={node.height}
        {...fill}
        cornerRadius={node.appearance.cornerRadius ?? 0}
        stroke="rgba(115,115,115,0.2)"
        strokeWidth={1}
        strokeScaleEnabled={false}
        shadowColor="black"
        shadowBlur={22}
        // Doubled: at 0.05 the lift was theoretical. It still reads as a soft
        // ground shadow rather than as a drawn outline.
        shadowOpacity={0.1}
        shadowOffsetY={10}
      />

      {/* The name holds a constant size on screen instead of scaling with the
          board — at 10% zoom a world-space label is sub-pixel, which is
          exactly when you most need to tell one frame from another. Dividing
          by the stage scale is the same trick the selection ring uses.

          It is how you find the frame, not part of what the frame contains, so
          it carries the chrome name and never appears in an export. It sits
          above the frame's own box and so outside the export bounds anyway —
          but a frame nested inside another would put its label squarely inside
          the outer one's.

          A fixed grey rather than a token: Konva paints to a canvas and cannot
          resolve a CSS custom property, so `var(--text-tertiary)` would simply
          be an invalid colour. This mid grey holds up against both boards. */}
      <Text
        text={node.title ?? 'Frame'}
        name={EXPORT_CHROME}
        y={-18 / stageScale}
        fontSize={12 / stageScale}
        fill="#9CA3AF"
        fontFamily="Inter, sans-serif"
        perfectDrawEnabled={false}
        listening={false}
      />

      {/*
        The column measure.

        Chrome, like the name and the safe area: it draws nothing that exists,
        never exports, and cannot be selected. Unlike the safe area, things
        *do* snap to it — that is the whole point of a measure, and the reason
        it is not the same feature as the guide below.

        Bands rather than lines. A line marks a boundary and leaves you to work
        out which side is the column; a tinted band *is* the column, and a
        block spanning three of them is visibly spanning three. It is what
        every layout tool draws and it costs the same rectangle.

        Warm and faint, at an alpha low enough to read content through. The
        safe area is a cool dashed outline, so the two never read as the same
        kind of mark — one is a warning about the edges, the other a measure
        across the middle.
      */}
      {columns.map((band, i) => (
        <Rect
          key={`c${i}`}
          name={EXPORT_CHROME}
          x={band.start}
          y={0}
          width={band.size}
          height={node.height}
          fill="#F43F5E"
          opacity={0.08}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      {/*
        Rows, at a lower alpha than the columns.

        Where the two cross they add, and two bands at 0.08 come to 0.15 — a
        chequerboard whose intersections read as a third kind of mark. Dropping
        the rows to 0.05 keeps the crossings close enough to a column alone
        that the eye still sees two overlaid measures rather than a plaid.
      */}
      {rows.map((band, i) => (
        <Rect
          key={`r${i}`}
          name={EXPORT_CHROME}
          x={0}
          y={band.start}
          width={node.width}
          height={band.size}
          fill="#F43F5E"
          opacity={0.05}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}

      {/* The safe area, for the sizes where part of the rectangle is covered by
          something that is not yours: a story's reply bar, a grid thumbnail's
          crop, the margin a desktop printer cannot reach. A guide only —
          nothing clips or snaps to it, because a frame that promised a safe
          area and then quietly moved things into it would be worse than no
          guide at all. Chrome, and a hairline at every zoom. */}
      {safe && (
        <Rect
          name={EXPORT_CHROME}
          x={safe.x}
          y={safe.y}
          width={safe.width}
          height={safe.height}
          stroke="#38BDF8"
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[6, 5]}
          opacity={0.55}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
});

FrameRenderer.displayName = 'FrameRenderer';
