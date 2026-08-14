import React, { useEffect, useRef, useState } from 'react';
import { Group, Line, Transformer } from 'react-konva';
import Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { useStore } from '../../hooks/useStore';
import { cursorForAnchor } from '../../engine/interaction/resizeCursor';

interface Props {
  selectedIds: string[];
  stageRef: React.RefObject<Konva.Stage | null>;
}

const MIN_SIZE = 10;

/**
 * The eight vertices, named the way Konva names them.
 *
 * Four corners scale both axes; four edge midpoints scale one. Stated
 * explicitly rather than left to the default so the set is a decision in the
 * source rather than a library default that could change under us.
 */
const ANCHORS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

const CORNERS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

/** Ink and paper for the handles, matching the hover ring the canvas already draws. */
const ACCENT = '#3B82F6';
const HANDLE_FILL = '#FFFFFF';


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
  /** True only while a handle is actually being dragged. */
  const [transforming, setTransforming] = useState(false);

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

    /**
     * Rotation-aware cursors on every handle.
     *
     * Konva assigns a fixed cursor per anchor, so on a rotated selection the
     * arrow points across the drag rather than along it. Rebinding on each
     * attach costs nothing — the anchors are recreated anyway — and reading
     * the rotation at *hover* time rather than closing over it means the
     * cursor stays correct while the object is being turned.
     */
    const bound: Array<{ node: Konva.Node; enter: () => void; leave: () => void }> = [];
    for (const name of [...ANCHORS, 'rotater']) {
      const anchor = tr.findOne(`.${name}`);
      if (!anchor) continue;
      const enter = () => {
        stage.container().style.cursor = cursorForAnchor(name, tr.rotation());
      };
      const leave = () => {
        stage.container().style.cursor = '';
      };
      anchor.on('mouseenter', enter);
      anchor.on('mouseleave', leave);
      bound.push({ node: anchor, enter, leave });
    }

    return () => {
      bound.forEach(({ node, enter, leave }) => {
        node.off('mouseenter', enter);
        node.off('mouseleave', leave);
      });
    };
  }, [selectedIds, selectionGeometry, stageRef]);

  const handleTransformStart = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-start'));
    setTransforming(true);
  };

  const handleTransformEnd = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-end'));
    setTransforming(false);
    const tr = trRef.current;
    if (!tr) return;

    const store = useStore.getState().objects;
    /**
     * Which handle was dragged, so a corner and an edge can mean different
     * things — which for text they must.
     */
    const anchor = (tr.getActiveAnchor() || '').split(' ')[0];
    const draggedCorner = CORNERS.has(anchor);

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

      /**
       * Resizing a text box changes what kind of box it is.
       *
       * An auto-width text node takes its width from its own content — the
       * renderer gives Konva no width at all — so writing a new width does
       * nothing to it, and the derived-bounds sync then measures the content
       * and writes the old number straight back. From the user's side the
       * handles simply did not work on text.
       *
       * The fix is the one every vector editor uses, because it is the only
       * one that makes both gestures meaningful:
       *
       *  - **An edge** sets a width and the text wraps inside it. The box
       *    stops being auto-width and becomes auto-height, which is exactly
       *    what "I want it this wide" means.
       *  - **A corner** scales the type itself. Stretching letterforms is
       *    almost never what someone wants from a corner drag, and a text box
       *    with no interior has nothing else for a corner to do.
       */
      const textMode: Record<string, unknown> = {};
      if (node.type === 'text') {
        if (draggedCorner) {
          const factor = Math.abs(scaleX);
          textMode.typography = {
            ...node.typography,
            // Clamped so a fast drag cannot produce sub-pixel or absurd type.
            fontSize: Math.max(4, Math.min(400, node.typography.fontSize * factor)),
          };
          // The height follows the type, so it is left to be re-derived.
        } else if (node.resize === 'width') {
          textMode.resize = 'height';
        }
      }

      // The group is positioned at the object's centre, so recover the
      // top-left from the new half-extents.
      updateNode(id, {
        ...textMode,
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

  /**
   * Drawn from the transformer's own box, so it follows the live drag rather
   * than the committed geometry — which does not update until the drag ends.
   */
  // Konva's Transformer keeps its own x/y/width/height in the layer's space,
  // which is exactly the frame the mark is drawn in — no client-rect
  // conversion needed, and no shadow inflation to compensate for.
  const tr = trRef.current;
  const box = tr && tr.nodes().length > 0
    ? { x: tr.x(), y: tr.y(), width: tr.width(), height: tr.height() }
    : null;
  const centreMark = box ? (
    <Group
      x={box.x + box.width / 2}
      y={box.y + box.height / 2}
      listening={false}
      name={EXPORT_CHROME}
    >
      <Line points={[-5, 0, 5, 0]} stroke={ACCENT} strokeWidth={1} />
      <Line points={[0, -5, 0, 5]} stroke={ACCENT} strokeWidth={1} />
    </Group>
  ) : null;

  const transformer = (
    <Transformer
      ref={trRef}
      // Interface, not document: PNG export captures the live stage, so
      // without this the blue handles are baked into the image.
      name={EXPORT_CHROME}
      onTransformStart={handleTransformStart}
      onTransformEnd={handleTransformEnd}
      boundBoxFunc={(oldBox, newBox) => (newBox.width < MIN_SIZE || newBox.height < MIN_SIZE ? oldBox : newBox)}
      /**
       * Eight vertices: four corners and four edge midpoints.
       *
       * The rotate handle above them stays — it is the ninth *control* but not
       * a ninth vertex, and removing it would take rotation away entirely.
       */
      enabledAnchors={ANCHORS}
      // A hairline, and the same blue the hover ring uses, so selecting
      // something is a continuation of hovering it rather than a new colour
      // appearing. The old 2px sky was heavier than the objects it framed.
      borderStroke={ACCENT}
      borderStrokeWidth={1}
      anchorStroke={ACCENT}
      anchorStrokeWidth={1}
      anchorFill={HANDLE_FILL}
      anchorSize={9}
      /**
       * Corners and edges are drawn differently, because they *do* different
       * things: a corner scales both axes, an edge scales one. Making them
       * identical asks the user to remember which is which; shaping each one
       * like its job means they do not have to.
       */
      anchorStyleFunc={(anchor) => {
        const name = anchor.name().split(' ')[0];
        if (name === 'rotater') {
          // Round, because rotation is continuous and has no axis — and a
          // little further out, so it is never confused with the corner it
          // sits above.
          anchor.cornerRadius(anchor.width() / 2);
          return;
        }
        if (CORNERS.has(name)) {
          anchor.cornerRadius(2.5);
          return;
        }
        // Edge midpoints: a short bar lying along the edge it belongs to, so
        // its shape states the one axis it will move.
        const horizontal = name === 'top-center' || name === 'bottom-center';
        anchor.width(horizontal ? 16 : 6);
        anchor.height(horizontal ? 6 : 16);
        anchor.offsetX(anchor.width() / 2);
        anchor.offsetY(anchor.height() / 2);
        anchor.cornerRadius(3);
      }}
      padding={4}
      rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
      ignoreStroke
    />
  );

  /**
   * The transform origin, marked while you are dragging a handle.
   *
   * ## Why a centre mark rather than a ninth handle
   *
   * A grabbable centre anchor is a third meaning for a click inside the box —
   * on top of "select" and "drag" — and the thing it would do (move the
   * object) is already what dragging the body does. So the centre earns a
   * *readout* rather than a control: it says where the rotation and the
   * scaling are happening from, which is the one thing about a transform you
   * cannot otherwise see.
   *
   * Only while transforming. A permanent crosshair in the middle of every
   * selection is a mark sitting on top of the artwork for no reason the rest
   * of the time.
   */
  const centre = transforming ? centreMark : null;

  return (
    <>
      {transformer}
      {centre}
    </>
  );
};
