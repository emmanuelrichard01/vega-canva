import React, { useSyncExternalStore } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import useImage from 'use-image';
import { updateNode } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { cropMode } from '../../engine/interaction/cropMode';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  CROP_ASPECTS,
  CROP_HANDLES,
  canCrop,
  cropToAspect,
  dragCropHandle,
  dragCropHandleLocked,
  resolveCropAspect,
  packCrop,
  panCropWindow,
  readCrop,
  sourceBoxInWorld,
  type CropHandle,
  type CropState,
} from '../../engine/model/imageCrop';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { useCameraZoom } from '../../engine/useCameraZoom';

const PLATE = 'rgba(17, 19, 22, 0.82)';
const CHIP_ON = '#FFFFFF';
const INK_ON_CHIP = '#16181B';
const INK = '#FFFFFF';

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
  const aspectId = useSyncExternalStore(cropMode.subscribe, cropMode.getAspectId, cropMode.getAspectId);
  const zoom = useCameraZoom() || 1;
  const px = (n: number) => n / zoom;

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
  const preset = CROP_ASPECTS.find((a) => a.id === aspectId) ?? CROP_ASPECTS[0];
  const lockedAspect = resolveCropAspect(preset.ratio, natural);

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
    const delta = { x: target.x() - homeX, y: target.y() - homeY };
    apply(
      lockedAspect
        ? dragCropHandleLocked(state, natural, handle, delta, lockedAspect)
        : dragCropHandle(state, natural, handle, delta)
    );
    target.position({ x: homeX, y: homeY });
  };

  const handlePan = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;
    apply(panCropWindow(state, natural, { x: target.x() - state.node.x, y: target.y() - state.node.y }));
    target.position({ x: state.node.x, y: state.node.y });
  };

  // Through the claim store, so the drawn pointer stands down in the same
  // tick rather than discovering the change through a watcher.
  const setCursor = (cursor: string) => () => claimCursor('crop', cursor || null);

  // Thirds, the standard framing aid. Drawn inside the kept region only.
  const thirds = [1, 2].flatMap((i) => [
    { points: [state.node.x + (state.node.width * i) / 3, state.node.y, state.node.x + (state.node.width * i) / 3, state.node.y + state.node.height] },
    { points: [state.node.x, state.node.y + (state.node.height * i) / 3, state.node.x + state.node.width, state.node.y + (state.node.height * i) / 3] },
  ]);

  return (
    /* Named as chrome so PNG export, which captures the live stage, does not
       bake the dimmed cut-away and the handles into the image. */
    <Group name={EXPORT_CHROME}>
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
        <Line key={i} points={line.points} stroke="rgba(255,255,255,0.5)" strokeWidth={px(1)} listening={false} />
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
        strokeWidth={px(3)}
        listening={false}
      />
      <Rect
        x={state.node.x}
        y={state.node.y}
        width={state.node.width}
        height={state.node.height}
        stroke="#FFFFFF"
        strokeWidth={px(1.5)}
        listening={false}
      />

      {CROP_HANDLES.map((handle) => {
        const at = HANDLE_AT[handle];
        return (
          <Circle
            key={handle}
            x={state.node.x + state.node.width * at.fx}
            y={state.node.y + state.node.height * at.fy}
            radius={px(6)}
            fill="#FFFFFF"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={px(1)}
            /* The hit area is larger than the dot. A 6px target is unusable
               with a mouse and impossible with a finger. */
            hitStrokeWidth={px(18)}
            draggable
            onDragMove={handleDrag(handle)}
            onDragEnd={handleDrag(handle)}
            onMouseEnter={setCursor(CURSOR_FOR[handle])}
            onMouseLeave={setCursor('')}
          />
        );
      })}

      <CropAspectBar
        x={state.node.x + state.node.width / 2}
        y={state.node.y - px(14)}
        px={px}
        activeId={preset.id}
        onPick={(id) => {
          cropMode.setAspectId(id);
          const chosen = CROP_ASPECTS.find((a) => a.id === id);
          const ratio = chosen ? resolveCropAspect(chosen.ratio, natural) : null;
          if (ratio) apply(cropToAspect(state, natural, ratio));
        }}
      />
    </Group>
  );
};

/**
 * Aspect presets, as a row of chips centred above the crop window and drawn
 * at a constant screen size. Picking one reframes at once and locks the
 * handles to that shape; Free releases them.
 */
const CropAspectBar: React.FC<{
  x: number;
  y: number;
  px: (n: number) => number;
  activeId: string;
  onPick: (id: string) => void;
}> = ({ x, y, px, activeId, onPick }) => {
  const fontSize = px(12);
  const chipH = px(24);
  const gap = px(2);
  const pad = px(3);
  const widths = CROP_ASPECTS.map((a) => a.label.length * fontSize * 0.6 + px(16));
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1) + pad * 2;
  let cursor = pad;
  return (
    <Group x={x - total / 2} y={y - chipH - pad * 2}>
      {/* The hairline is what separates the plate from a dark board; on a light
          one it disappears into the plate, which is the intent. */}
      <Rect
        width={total}
        height={chipH + pad * 2}
        cornerRadius={(chipH + pad * 2) / 2}
        fill={PLATE}
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={px(1)}
      />
      {CROP_ASPECTS.map((a, i) => {
        const at = cursor;
        cursor += widths[i] + gap;
        const on = a.id === activeId;
        return (
          <Group
            key={a.id}
            x={at}
            y={pad}
            onClick={(e) => {
              e.cancelBubble = true;
              onPick(a.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onPick(a.id);
            }}
            onMouseEnter={() => claimCursor('crop-aspect', 'pointer')}
            onMouseLeave={() => claimCursor('crop-aspect', null)}
          >
            <Rect
              width={widths[i]}
              height={chipH}
              cornerRadius={chipH / 2}
              fill={on ? CHIP_ON : 'rgba(255,255,255,0.001)'}
            />
            <Text
              width={widths[i]}
              height={chipH}
              align="center"
              verticalAlign="middle"
              text={a.label}
              fontSize={fontSize}
              fontFamily="Inter, system-ui, sans-serif"
              fontStyle={on ? '600' : '500'}
              fill={on ? INK_ON_CHIP : INK}
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
};
