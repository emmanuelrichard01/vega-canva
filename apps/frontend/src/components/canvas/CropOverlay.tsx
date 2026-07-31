import React, { useSyncExternalStore } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Line, Rect } from 'react-konva';
import useImage from 'use-image';
import { updateNode } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { cropMode } from '../../engine/interaction/cropMode';
import {
  CROP_HANDLES,
  canCrop,
  dragCropHandle,
  packCrop,
  panCropWindow,
  readCrop,
  sourceBoxInWorld,
  type CropHandle,
  type CropState,
} from '../../engine/model/imageCrop';

/** Where each handle sits on the crop rectangle, as a fraction of its box. */
const HANDLE_AT: Record<CropHandle, { fx: number; fy: number }> = {
  nw: { fx: 0, fy: 0 },
  n: { fx: 0.5, fy: 0 },
  ne: { fx: 1, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  se: { fx: 1, fy: 1 },
  s: { fx: 0.5, fy: 1 },
  sw: { fx: 0, fy: 1 },
  w: { fx: 0, fy: 0.5 },
};

const CURSOR_FOR: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/**
 * Cropping an image, on the canvas.
 *
 * Shows what is being cut away rather than only what is kept. A crop UI that
 * draws just the surviving rectangle gives you no way to judge the framing —
 * you cannot see what is one step outside it, which is the whole question you
 * are asking while you drag.
 *
 * So the full picture is drawn at low opacity underneath, positioned by
 * `sourceBoxInWorld` so it registers exactly with the kept region. That
 * arithmetic is why the module is pure and tested: if it is off by anything at
 * all the two layers visibly fail to line up, and it is the sort of expression
 * that reads as correct in source.
 *
 * Everything here writes straight to the document while dragging, because a
 * crop you cannot see until you release is not a crop tool. `cropMode` holds
 * the snapshot that makes Escape mean "put back what I started with" — undo
 * cannot do that job, since one drag is many writes and the user thinks of it
 * as one action.
 */
export const CropOverlay: React.FC = () => {
  const snapshot = useSyncExternalStore(cropMode.subscribe, cropMode.getSnapshot, cropMode.getSnapshot);
  const node = useStore((s) => (snapshot ? s.objects[snapshot.nodeId] : undefined));
  const src = node?.type === 'image' ? node.src : '';
  const [image] = useImage(src, 'anonymous');

  if (!snapshot || !node || node.type !== 'image') return null;

  const natural = {
    width: node.naturalWidth ?? image?.naturalWidth ?? 0,
    height: node.naturalHeight ?? image?.naturalHeight ?? 0,
  };
  const state: CropState = {
    node: { x: node.x, y: node.y, width: node.width, height: node.height },
    crop: readCrop(node.crop, natural),
  };
  if (!canCrop(state, natural)) return null;

  const source = sourceBoxInWorld(state, natural);

  /** Write a new state through the one write path, keeping the two in step. */
  const apply = (next: CropState) => {
    updateNode(node.id, {
      x: next.node.x,
      y: next.node.y,
      width: next.node.width,
      height: next.node.height,
      crop: packCrop(next.crop, natural),
    });
  };

  /**
   * Konva reports a dragged shape's absolute position, so the delta has to be
   * measured against where the shape *should* be and the shape then put back.
   * Letting Konva keep the position it moved to would double every drag: the
   * document also moves, and the two would compound.
   */
  const handleDrag = (handle: CropHandle) => (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;
    const at = HANDLE_AT[handle];
    const homeX = state.node.x + state.node.width * at.fx;
    const homeY = state.node.y + state.node.height * at.fy;
    apply(dragCropHandle(state, natural, handle, { x: target.x() - homeX, y: target.y() - homeY }));
    target.position({ x: homeX, y: homeY });
  };

  const handlePan = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;
    apply(panCropWindow(state, natural, { x: target.x() - state.node.x, y: target.y() - state.node.y }));
    target.position({ x: state.node.x, y: state.node.y });
  };

  const setCursor = (cursor: string) => (e: Konva.KonvaEventObject<PointerEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };

  // Thirds, the standard framing aid. Drawn inside the kept region only.
  const thirds = [1, 2].flatMap((i) => [
    { points: [state.node.x + (state.node.width * i) / 3, state.node.y, state.node.x + (state.node.width * i) / 3, state.node.y + state.node.height] },
    { points: [state.node.x, state.node.y + (state.node.height * i) / 3, state.node.x + state.node.width, state.node.y + (state.node.height * i) / 3] },
  ]);

  return (
    <Group>
      {/* What is being cut away. Non-interactive: every gesture here belongs
          to the kept region or to a handle, and a stray hit on this would
          start a drag that appears to come from nowhere. */}
      {image && (
        <KonvaImage
          image={image}
          x={source.x}
          y={source.y}
          width={source.width}
          height={source.height}
          opacity={0.28}
          listening={false}
        />
      )}

      {/* Drag the picture under a fixed window. A `fill` is what puts a shape
          in Konva's hit graph — a transparent one still counts, an absent one
          does not, which is the same trap the voice note hit. */}
      <Rect
        x={state.node.x}
        y={state.node.y}
        width={state.node.width}
        height={state.node.height}
        fill="rgba(0,0,0,0.001)"
        draggable
        onDragMove={handlePan}
        onDragEnd={handlePan}
        onMouseEnter={setCursor('move')}
        onMouseLeave={setCursor('')}
      />

      {thirds.map((line, i) => (
        <Line key={i} points={line.points} stroke="rgba(255,255,255,0.5)" strokeWidth={1} listening={false} />
      ))}

      {/* The boundary, in two passes: a dark hairline under a light one, so it
          reads against both a pale and a dark photograph. A single stroke in
          either colour disappears against half the images it is drawn on. */}
      <Rect
        x={state.node.x}
        y={state.node.y}
        width={state.node.width}
        height={state.node.height}
        stroke="rgba(0,0,0,0.55)"
        strokeWidth={3}
        listening={false}
      />
      <Rect
        x={state.node.x}
        y={state.node.y}
        width={state.node.width}
        height={state.node.height}
        stroke="#FFFFFF"
        strokeWidth={1.5}
        listening={false}
      />

      {CROP_HANDLES.map((handle) => {
        const at = HANDLE_AT[handle];
        return (
          <Circle
            key={handle}
            x={state.node.x + state.node.width * at.fx}
            y={state.node.y + state.node.height * at.fy}
            radius={6}
            fill="#FFFFFF"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={1}
            /* The hit area is larger than the dot. A 6px target is unusable
               with a mouse and impossible with a finger. */
            hitStrokeWidth={18}
            draggable
            onDragMove={handleDrag(handle)}
            onDragEnd={handleDrag(handle)}
            onMouseEnter={setCursor(CURSOR_FOR[handle])}
            onMouseLeave={setCursor('')}
          />
        );
      })}
    </Group>
  );
};
