import React, { useSyncExternalStore } from 'react';
import Konva from 'konva';
import { Group, Image as KonvaImage, Line, Rect } from 'react-konva';
import useImage from 'use-image';
import { useStore } from '../../hooks/useStore';
import { slotReframe } from '../../engine/interaction/slotReframe';
import { setSlotFit, slotFrame } from '../../engine/grid/gridSlotApply';
import { clampZoom, nudgeFocus, zoomAtPoint } from '../../engine/grid/gridSlot';
import { EXPORT_CHROME } from '../../engine/export/chrome';

/**
 * Reframing a picture inside the module that holds it.
 *
 * ## What this is for
 *
 * A picture in a grid module is covered: scaled to fill and centre cropped, so
 * a portrait in a landscape module loses its top and bottom. Which part it
 * loses is the only question anybody has about it, and until now the answer was
 * a slider in a popover and four arrow keys nobody could discover. Both are
 * still there and both are precise. Neither is how a person reaches for a
 * photograph.
 *
 * So this is the direct version: drag the picture, turn the wheel over the part
 * you care about, and the module holds still while its contents move. That is
 * the gesture every photo tool has trained everyone to expect, and it is the
 * one the arrow keys were already imitating.
 *
 * ## Why what is cut away is drawn
 *
 * The whole photograph is painted underneath at low opacity, registered exactly
 * with the part on show. Without it there is nothing to aim at: framing is a
 * judgement about what sits one step outside the module, and a UI that shows
 * only the surviving rectangle has hidden the entire question. `CropOverlay`
 * makes the same argument at more length; `sourceBoxForSlot` is the arithmetic
 * that makes the two layers register, and it is pure and tested because if it
 * is off by anything at all the misalignment is visible and the expression
 * still reads as correct in source.
 *
 * ## Why there are no handles
 *
 * Cropping a loose image drags the frame. Here the frame belongs to the module:
 * `planGridReflow` writes the box back on every pass, so a resize handle would
 * be a control the document quietly undoes a frame later. Invariant 6 -- never
 * offer a capability nothing honours. The module is drawn as a boundary rather
 * than as something to grab, and everything you can do to it is done to the
 * picture inside.
 *
 * ## Why it writes on every frame
 *
 * A framing you cannot see until you let go is not a framing tool. `slotReframe`
 * holds the snapshot that makes Escape mean "put back what I started with" --
 * undo cannot do that job, because one drag is many writes and a person thinks
 * of the whole gesture as one action.
 */

/** How much one wheel notch changes the zoom. */
const WHEEL_STEP = 1.12;

export const SlotReframeOverlay: React.FC = () => {
  const snapshot = useSyncExternalStore(
    slotReframe.subscribe,
    slotReframe.getSnapshot,
    slotReframe.getSnapshot
  );
  /**
   * Subscribed to the node, not read once.
   *
   * The overlay has to follow its own writes -- every drag frame goes through
   * the document and comes back -- and it has to follow the grid being re-laid
   * underneath the gesture by a collaborator or by the panel.
   */
  const node = useStore((s) => (snapshot ? s.objects[snapshot.nodeId] : undefined));
  const src = node?.type === 'image' ? node.src : '';
  const [image] = useImage(src, 'anonymous');

  if (!snapshot || node?.type !== 'image') return null;
  const frame = slotFrame(snapshot.nodeId);
  if (!frame || !frame.window || !frame.source) return null;

  const { box, cell, natural, source } = frame;
  const zoom = clampZoom(frame.fit?.zoom);

  /**
   * The drag, in the module's own axes.
   *
   * A turned grid holds turned pictures, so a drag to the right of the screen
   * is not a drag to the right of the module. Konva reports the proxy's
   * absolute position and the group it sits in is already rotated, so the
   * delta arrives in module space for free -- which is the reason the proxy is
   * a child of the rotated group rather than a rectangle positioned in world
   * coordinates.
   */
  const pan = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;
    const focus = nudgeFocus(cell, natural, frame.fit, target.x(), target.y());
    if (focus) setSlotFit(snapshot.nodeId, { focus, zoom });
    // Put the proxy back. Letting Konva keep where it moved to would double
    // every drag: the picture also moves, and the two would compound.
    target.position({ x: 0, y: 0 });
  };

  /**
   * The wheel, anchored where the pointer is.
   *
   * Zooming about the centre is the easy version and the wrong one: the reason
   * anyone zooms in is to make a particular part of the picture fill the
   * module, and a centre zoom pushes that part away as it grows. See
   * `zoomAtPoint`.
   */
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    // Stopped here rather than allowed through: the stage's own wheel handler
    // zooms the camera, and a wheel over a picture being reframed means the
    // picture. Letting both run would pull the board out from under the
    // gesture at the same moment it changes the framing.
    e.cancelBubble = true;

    const local = e.target.getRelativePointerPosition();
    const anchor = local
      ? { x: local.x / cell.width, y: local.y / cell.height }
      : { x: 0.5, y: 0.5 };

    const next = zoomAtPoint(
      cell,
      natural,
      frame.fit,
      e.evt.deltaY < 0 ? zoom * WHEEL_STEP : zoom / WHEEL_STEP,
      anchor
    );
    if (next) setSlotFit(snapshot.nodeId, next);
  };

  const setCursor = (cursor: string) => (e: Konva.KonvaEventObject<PointerEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };

  // Thirds, the standard framing aid, drawn inside the module only.
  const thirds = [1, 2].flatMap((i) => [
    [(cell.width * i) / 3, 0, (cell.width * i) / 3, cell.height],
    [0, (cell.height * i) / 3, cell.width, (cell.height * i) / 3],
  ]);

  return (
    /* Named as chrome so a PNG export, which captures the live stage, does not
       bake the dimmed surround and the thirds into the picture. */
    <Group name={EXPORT_CHROME}>
      {/* The part of the photograph the module is not showing. Placed in world
          space and turned about the module's centre, because the ghost has to
          register with a module that may be part of a rotated grid.
          Non-interactive: every gesture belongs to the module. */}
      {image && (
        <Group
          x={box.x + box.width / 2}
          y={box.y + box.height / 2}
          rotation={box.rotation}
          listening={false}
        >
          <KonvaImage
            image={image}
            x={source.x - (box.x + box.width / 2)}
            y={source.y - (box.y + box.height / 2)}
            width={source.width}
            height={source.height}
            opacity={0.24}
          />
        </Group>
      )}

      {/* Everything interactive, in the module's own frame: placed at its
          centre, turned with it, and offset back so a child at 0,0 sits at the
          module's top-left corner. Konva then reports drags in module axes and
          nothing downstream has to learn about rotation. */}
      <Group
        x={box.x + box.width / 2}
        y={box.y + box.height / 2}
        rotation={box.rotation}
        offsetX={box.width / 2}
        offsetY={box.height / 2}
      >
        {thirds.map((points, i) => (
          <Line key={i} points={points} stroke="rgba(255,255,255,0.45)" strokeWidth={1} listening={false} />
        ))}

        {/* The boundary, in two passes: a dark hairline under a light one, so
            it reads against both a pale and a dark photograph. A single stroke
            in either colour disappears against half the images it is drawn
            on. */}
        <Rect width={cell.width} height={cell.height} stroke="rgba(0,0,0,0.55)" strokeWidth={3} listening={false} />
        <Rect width={cell.width} height={cell.height} stroke="#FFFFFF" strokeWidth={1.5} listening={false} />

        {/**
          * The drag proxy.
          *
          * A `fill` is what puts a shape in Konva's hit graph: a transparent
          * one still counts and an absent one does not, which is a trap this
          * codebase has fallen into twice. It carries the wheel handler too,
          * so a turn anywhere over the module reframes rather than zooming the
          * camera out from under the gesture.
          */}
        <Rect
          width={cell.width}
          height={cell.height}
          fill="rgba(0,0,0,0.001)"
          draggable
          onDragMove={pan}
          onDragEnd={pan}
          onWheel={onWheel}
          onMouseEnter={setCursor('move')}
          onMouseLeave={setCursor('')}
        />
      </Group>
    </Group>
  );
};
