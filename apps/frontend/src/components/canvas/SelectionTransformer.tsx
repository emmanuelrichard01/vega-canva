import React, { useEffect, useRef } from 'react';
import { Transformer } from 'react-konva';
import Konva from 'konva';
import { updateNode } from '../../engine/document';
import { useStore } from '../../hooks/useStore';

interface Props {
  selectedIds: string[];
  stageRef: React.RefObject<Konva.Stage | null>;
}

const MIN_SIZE = 10;

/**
 * The canvas' single resize/rotate handle set.
 *
 * Previously every `ObjectRenderer` mounted its own `<Transformer>`, so a
 * canvas with 100 objects carried 100 transformer instances — 99 of them
 * attached to nothing. One instance re-pointed at the current selection does
 * the same job, and gains multi-object resize for free.
 */
export const SelectionTransformer: React.FC<Props> = ({ selectedIds, stageRef }) => {
  const trRef = useRef<Konva.Transformer>(null);

  // The handles must re-fit when a *selected* node's geometry changes from
  // elsewhere (the Properties panel, a remote peer). Subscribing to the whole
  // `objects` map to get that re-ran this effect on every document change
  // anywhere on the canvas. Deriving a signature from just the selection costs
  // O(selection) to compute and only changes identity when the selection's
  // geometry actually moves, so unrelated edits are skipped entirely.
  const selectionGeometry = useStore((state) =>
    selectedIds
      .map((id) => {
        const n = state.objects[id];
        return n ? `${n.x},${n.y},${n.width},${n.height},${n.rotation},${n.scaleX},${n.scaleY}` : '';
      })
      .join('|')
  );

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;

    const nodes = selectedIds
      .map((id) => stage.findOne('#' + id))
      .filter((n): n is Konva.Node => Boolean(n));

    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, selectionGeometry, stageRef]);

  const handleTransformStart = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-start'));
  };

  const handleTransformEnd = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-end'));
    const tr = trRef.current;
    if (!tr) return;

    const store = useStore.getState().objects;

    tr.nodes().forEach((konvaNode) => {
      const id = konvaNode.id();
      const node = store[id];
      if (!node) return;

      const scaleX = konvaNode.scaleX();
      const scaleY = konvaNode.scaleY();

      // Fold the transient scale into real dimensions rather than persisting a
      // scale factor — otherwise stroke widths, corner radii and text would
      // all inherit the distortion.
      const width = Math.max(MIN_SIZE, node.width * Math.abs(scaleX));
      const height = Math.max(MIN_SIZE, node.height * Math.abs(scaleY));

      // The group is positioned at the object's centre, so recover the
      // top-left from the new half-extents.
      updateNode(id, {
        x: konvaNode.x() - width / 2,
        y: konvaNode.y() - height / 2,
        width,
        height,
        rotation: konvaNode.rotation(),
        // A negative scale is a flip; preserve the sign, drop the magnitude.
        scaleX: Math.sign(scaleX) || 1,
        scaleY: Math.sign(scaleY) || 1,
      });

      konvaNode.scaleX(Math.sign(scaleX) || 1);
      konvaNode.scaleY(Math.sign(scaleY) || 1);
    });
  };

  return (
    <Transformer
      ref={trRef}
      onTransformStart={handleTransformStart}
      onTransformEnd={handleTransformEnd}
      boundBoxFunc={(oldBox, newBox) => (newBox.width < MIN_SIZE || newBox.height < MIN_SIZE ? oldBox : newBox)}
      borderStroke="#0ea5e9"
      borderStrokeWidth={2}
      anchorStroke="#0ea5e9"
      anchorStrokeWidth={2}
      anchorFill="#FFFFFF"
      anchorSize={10}
      anchorCornerRadius={2}
      padding={4}
      rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
      ignoreStroke
    />
  );
};
