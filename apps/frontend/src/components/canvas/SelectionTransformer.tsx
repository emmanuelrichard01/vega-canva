import React, { useEffect, useRef, useState } from 'react';
import { Group, Line, Rect, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { useStore } from '../../hooks/useStore';
import { resizeGridTo } from '../../engine/grid/gridApply';
import { gridGroupOf } from '../../engine/grid/gridGroupUtils';
import type { Box } from '../../engine/grid/gridBuild';
import { cursorForAnchor } from '../../engine/interaction/resizeCursor';
import { scalePathGeometry } from '../../engine/model/pathGeometry';
import { isLineLike } from '../../engine/model/lineEnds';

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

/**
 * The two edge handles that change a box's height rather than its width.
 *
 * Named because text treats the two axes differently: a horizontal edge sets
 * the width the words wrap inside, while a vertical edge imposes a height —
 * which is a different statement about the box and switches it to `fixed`.
 */
const VERTICAL_EDGES = new Set(['top-center', 'bottom-center']);

/**
 * Whether a drag kept the object's proportions.
 *
 * A tenth of a percent, which is well inside what a hand can hold on a corner
 * handle and well outside what Konva's `keepRatio` produces — so a shift-drag
 * reads as uniform and a deliberate stretch never does.
 */
const uniformDrag = (sx: number, sy: number): boolean =>
  Math.abs(Math.abs(sx) - Math.abs(sy)) < 0.001;

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
  /** Live dimensions (e.g. 240 × 180) or angle (e.g. 45°) HUD badge while transforming. */
  const [liveBadge, setLiveBadge] = useState<{ text: string; x: number; y: number } | null>(null);

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

    /**
     * A single selected line is edited at its ends, not by its box.
     *
     * `LineEditor` takes over for that case, so the transformer must not also
     * attach — two sets of handles on one object is ambiguous, and the box's
     * handles are the ones that do the wrong thing. A line in a *multi*
     * selection keeps the box, because moving several objects together is a
     * box operation and there is no single pair of ends to offer.
     */
    const store = useStore.getState().objects;
    const solo = selectedIds.length === 1 ? store[selectedIds[0]] : undefined;
    /**
     * A connector is the same case, and a worse one.
     *
     * Its `width`/`height` are *derived* from whatever its two ends resolve
     * to, so the eight handles here were not just the wrong affordance — they
     * were inert. A drag wrote a box that the next render recomputed from the
     * bindings and discarded, which made an arrow look adjustable and refuse
     * to be adjusted. `ConnectorEditor` owns it now.
     */
    const soloLine =
      Boolean(solo) && (isLineLike(solo ?? { type: '' }) || solo!.type === 'connector');

    const nodes = soloLine
      ? []
      : selectedIds
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

  /**
   * The selection's bounds when the gesture began.
   *
   * Read from the store before anything moves, so it is a *measurement* rather
   * than a prediction — see `resizeGridTo` for why that distinction is the
   * whole bug. A ref, because it must survive the renders a live transform
   * causes and is never read during one.
   */
  const gestureStart = useRef<{ ids: string[]; box: Box } | null>(null);

  const handleTransformStart = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-start'));
    setTransforming(true);

    const before = useStore.getState().objects;
    const ids = (trRef.current?.nodes() ?? []).map((n) => n.id());
    const boxes = ids.map((id) => before[id]).filter(Boolean);
    gestureStart.current = boxes.length === 0 ? null : {
      ids,
      box: {
        x: Math.min(...boxes.map((n) => n.x)),
        y: Math.min(...boxes.map((n) => n.y)),
        width: Math.max(...boxes.map((n) => n.x + n.width)) - Math.min(...boxes.map((n) => n.x)),
        height: Math.max(...boxes.map((n) => n.y + n.height)) - Math.min(...boxes.map((n) => n.y)),
      },
    };
  };

  const handleTransform = () => {
    const tr = trRef.current;
    if (!tr) return;
    const anchor = (tr.getActiveAnchor() || '').split(' ')[0];
    const isRotating = anchor === 'rotater';
    const w = Math.round(tr.width());
    const h = Math.round(tr.height());
    const deg = Math.round(((tr.rotation() % 360) + 360) % 360);

    const text = isRotating ? `${deg}°` : `${w} × ${h}`;
    setLiveBadge({
      text,
      x: tr.x() + tr.width() / 2,
      y: tr.y() + tr.height() + 18,
    });
  };

  const handleTransformEnd = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-end'));
    setTransforming(false);
    setLiveBadge(null);
    const tr = trRef.current;
    if (!tr) return;

    const store = useStore.getState().objects;
    /** Where the selection lands, accumulated from the values being written. */
    const landing = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
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
        if (draggedCorner && uniformDrag(scaleX, scaleY)) {
          // A corner drag that kept the proportions is "make this bigger", and
          // the honest way to do that with type is to set a larger size rather
          // than magnify the letterforms. A drag that *changed* the proportions
          // is a distortion and is handled below, by keeping the scale.
          const factor = Math.abs(scaleX);
          textMode.typography = {
            ...node.typography,
            /**
             * Rounded to a whole point, and clamped.
             *
             * A drag produces an arbitrary real factor, so `40 * 1.0083…` was
             * stored verbatim and the size field then read `40.33333333333333`.
             * Nobody sets type in thirty-thirds of a point, no renderer resolves
             * one, and a control showing sixteen digits reads as broken software
             * — the number is the only part of this the user ever sees.
             */
            fontSize: Math.round(Math.max(4, Math.min(400, node.typography.fontSize * factor))),
          };
          // The height follows the type, so it is left to be re-derived.
        } else if (!draggedCorner && VERTICAL_EDGES.has(anchor)) {
          /**
           * A vertical edge imposes a height, and imposing a height *is* what
           * `fixed` means.
           *
           * Without this the top and bottom handles did nothing at all, and
           * did it invisibly: the drag wrote a height, and `TextRenderer`'s
           * derived-bounds effect measured the content a moment later and
           * wrote the old one straight back over it. The box sprang back a
           * frame after release, which reads as the handle being broken
           * rather than as the box being auto-height.
           *
           * Switching the mode is the same move the horizontal edge already
           * makes for auto-width, and for the same reason: dragging the edge
           * of a box that derives that dimension is a statement that you want
           * to control it.
           */
          textMode.resize = 'fixed';
        } else if (node.resize === 'width') {
          // A horizontal edge sets the wrap width, so an auto-width box — which
          // has no width of its own to set — becomes an auto-height one.
          textMode.resize = 'height';
        }
      }

      /**
       * A path has to resize its own outline; nothing else describes its size.
       *
       * Every other type derives what it draws from `width`/`height` — a rect
       * is drawn at the box, an ellipse takes its radii from it, a polygon is
       * stretched to it. A path's shape lives in `geometry`, in coordinates
       * relative to the node origin, and the renderer draws those numbers
       * verbatim. So writing a new box and stopping left a resized path
       * **drawing at exactly its old size** while the layers panel, the radar,
       * the marquee and the snapping all reported the new one — the object was
       * genuinely resized everywhere except on the canvas.
       *
       * `fitPathToBox` measures the geometry rather than applying the drag's
       * scale factor, which makes it idempotent and lets it repair a path that
       * an earlier resize already left behind. It returns null when the
       * geometry already fits, so an ordinary move writes no outline.
       */
      const pathMode: Record<string, unknown> = {};
      if (node.type === 'path') {
        /**
         * Scaled by the factors the drag actually applied, not fitted to a box.
         *
         * `fitPathToBox` was the first attempt and it is the more elegant idea —
         * measure the geometry, divide into the target — but it only works while
         * `node.width` and the geometry's own extent agree, and for a freehand
         * stroke they never did: `PenTool` frames the node by the centreline
         * padded by a whole nib, while the stored outline extends about half a
         * nib. Every freehand resize therefore scaled by the ratio of two
         * different measurements and the stroke jumped.
         *
         * Multiplying by the drag's own `scaleX`/`scaleY` cannot mismatch,
         * because it never consults the box at all. The geometry and the box are
         * then both scaled by the same pair of numbers, which is what keeps them
         * describing the same object.
         */
        const scaled = scalePathGeometry(node.geometry, Math.abs(scaleX), Math.abs(scaleY));
        if (scaled !== node.geometry) pathMode.geometry = scaled;
      }

      /**
       * Text keeps a non-uniform scale rather than folding it away.
       *
       * Every other type folds the drag's scale into `width`/`height` and resets
       * to a bare sign, because a persisted scale would distort strokes, corner
       * radii and type along with the box. For text that reasoning inverts:
       * distorting the type **is** the gesture. Illustrator shears and stretches
       * type with its bounding box and Photoshop's Free Transform does the same;
       * a text box that silently snapped back to its own proportions on release
       * is the thing being reported here.
       *
       * A *uniform* corner drag still scales the font instead, because that is
       * what people mean by making text bigger, and it keeps the type honest at
       * its new size rather than magnifying a bitmap. Only a drag that changes
       * the aspect is treated as a distortion, and it is kept as `scaleX`/
       * `scaleY` on the node — non-destructive, so setting them back to 1
       * restores the original letterforms exactly.
       */
      /**
       * When a text node keeps its distortion instead of folding it away.
       *
       * **Not on a corner drag**, which was the first attempt and could never
       * have worked: Konva's Transformer sets `keepRatio` on corner anchors by
       * default, so a corner always reports `scaleX === scaleY` and the
       * "non-uniform" branch was unreachable. That is why this kept reading as
       * unfixed — the code was correct and the gesture could not reach it.
       *
       * The gate is the box mode instead, which is both reachable and
       * meaningful. `width` and `height` derive their dimension from the text,
       * so distorting them is a contradiction — but `fixed` means "I control
       * both dimensions", and once both are imposed there is nothing left for a
       * drag to mean *except* filling the box you gave it. Edge handles supply
       * the one-axis scale that actually distorts; a corner still comes through
       * uniform and is handled above as a font-size change, which keeps type
       * crisp rather than magnifying it.
       */
      const stretched = node.type === 'text' && node.resize === 'fixed' && !uniformDrag(scaleX, scaleY);
      const finalScaleX = stretched ? scaleX : Math.sign(scaleX) || 1;
      const finalScaleY = stretched ? scaleY : Math.sign(scaleY) || 1;
      // A distorted text node keeps its own box; the scale is what changed.
      const boxW = stretched ? node.width : width;
      const boxH = stretched ? node.height : height;

      /**
       * The group's visual centre, back to an unscaled top-left.
       *
       * Halved **without** the scale. `ObjectRenderer` sets `offsetX` to
       * `width / 2` and Konva applies an offset after scaling, so the point the
       * group is positioned by is the centre of the *unscaled* box — multiplying
       * by the scale here moved every distorted node by half its own growth,
       * which is the small position shift that came with a stretch.
       */
      updateNode(id, {
        ...textMode,
        ...pathMode,
        x: konvaNode.x() - boxW / 2,
        y: konvaNode.y() - boxH / 2,
        width: boxW,
        height: boxH,
        rotation: konvaNode.rotation(),
        // A negative scale is a flip; the sign is preserved either way, and the
        // magnitude survives only where it is the point of the gesture.
        scaleX: finalScaleX,
        scaleY: finalScaleY,
      });

      landing.minX = Math.min(landing.minX, konvaNode.x() - boxW / 2);
      landing.minY = Math.min(landing.minY, konvaNode.y() - boxH / 2);
      landing.maxX = Math.max(landing.maxX, konvaNode.x() + boxW / 2);
      landing.maxY = Math.max(landing.maxY, konvaNode.y() + boxH / 2);

      konvaNode.scaleX(finalScaleX);
      konvaNode.scaleY(finalScaleY);
    });

    /**
     * A grid re-lays itself rather than staying scaled.
     *
     * The loop above folds the scale into each node, which is right for a
     * rectangle and wrong for a grid: gutters and corner radii are absolute
     * measurements chosen against the page, not proportions of the modules, so
     * a drag to 1.6x takes a 16px gutter to 26px. The one property the person
     * actually set is the one the gesture would destroy, a little more on every
     * resize.
     *
     * Both boxes are **measured**: one from the store before anything moved,
     * one from the values this loop has just written. Two earlier versions took
     * the box the recipe *predicted* its cells would occupy as the "before",
     * and that only matches the document when the recipe is exactly in step
     * with it -- never true after a drag, and never true at all for a layout
     * whose cells do not fill their box. The gap between a prediction and a
     * measurement came out as a scale nobody had applied.
     */
    const started = gestureStart.current;
    gestureStart.current = null;
    if (started && Number.isFinite(landing.minX)) {
      const group = gridGroupOf(
        started.ids.map((id) => store[id]).filter(Boolean),
        useStore.getState().groups
      );
      if (group) {
        resizeGridTo(group, started.box, {
          x: landing.minX,
          y: landing.minY,
          width: landing.maxX - landing.minX,
          height: landing.maxY - landing.minY,
        });
      }
    }
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
      onTransform={handleTransform}
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

  /**
   * Live transform HUD badge showing realtime dimensions (e.g. 320 × 240) or rotation angle (e.g. 45°).
   */
  const hudBadge = transforming && liveBadge ? (
    <Group
      x={liveBadge.x}
      y={liveBadge.y}
      listening={false}
      name={EXPORT_CHROME}
    >
      <Rect
        x={-44}
        y={-12}
        width={88}
        height={24}
        cornerRadius={6}
        fill="#090d16"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
        shadowColor="rgba(0,0,0,0.4)"
        shadowBlur={8}
        shadowOffsetY={3}
      />
      <Text
        x={-44}
        y={-6}
        width={88}
        text={liveBadge.text}
        fontSize={11}
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        fontStyle="bold"
        fill="#f8fafc"
        align="center"
      />
    </Group>
  ) : null;

  return (
    <>
      {transformer}
      {centre}
      {hudBadge}
    </>
  );
};
