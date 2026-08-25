import React, { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Group, Rect, Text, Transformer } from 'react-konva';
import { applyNodePatches } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { useStore } from '../../hooks/useStore';
import { cursorForAnchor } from '../../engine/interaction/resizeCursor';
import { scalePathGeometry } from '../../engine/model/pathGeometry';
import { isLineLike } from '../../engine/model/lineEnds';
import { liveTransformStore } from '../../engine/model/liveTransformStore';
import { syncConnectedConnectors } from '../../engine/model/connectorTargets';
import { layoutText } from '../../engine/text/layout';
import { measurerFor } from '../../engine/text/measure';
import { applyTextCase } from '../../engine/model/textCase';
import type { AnyNode, TextNode } from '../../engine/model/schema';

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

/** The two edge handles that set the measure a paragraph wraps inside. */
const HORIZONTAL_EDGES = new Set(['middle-left', 'middle-right', 'left-center', 'right-center']);

/**
 * Where a text box goes when a side handle changes how wide it is.
 *
 * ## Why this cannot use `computePinnedBox`
 *
 * That function pins the edge opposite the one you grabbed, which is right for
 * every object whose height you are also setting. Text's height is not set by
 * the drag -- it *falls out* of the re-wrap, and a narrower measure means more
 * lines. `computePinnedBox` pins the vertical **centre** for a side handle, so
 * that extra height was split between the top and the bottom and the paragraph
 * grew upwards into the layout above it as well as down.
 *
 * A paragraph grows downwards. The first line stays where it was put, which is
 * what every text engine does and what anyone dragging the right edge of a
 * column expects -- the top of the column is a decision they already made.
 *
 * The horizontal edge is still pinned the ordinary way: dragging the left
 * handle must keep the right edge still.
 */
function pinTextBox(
  anchor: string,
  start: { x: number; y: number; width: number },
  newW: number
): { x: number; y: number } {
  const keepsRightEdge = anchor === 'middle-left' || anchor === 'left-center';
  return {
    x: keepsRightEdge ? start.x + start.width - newW : start.x,
    y: start.y,
  };
}

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
  /** Whether the gesture in flight is a rotation, so the pivot can be shown. */
  const [isRotatingNow, setIsRotatingNow] = useState(false);

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
    tr.update();
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

function rotatePoint(x: number, y: number, rad: number): { x: number; y: number } {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

/**
 * Given the handle being dragged, the starting node geometry, and new width/height,
 * computes the new top-left coordinates so that the opposite edge/corner stays strictly pinned in world space.
 */
function computePinnedBox(
  anchor: string,
  start: { x: number; y: number; width: number; height: number; rotation?: number },
  newW: number,
  newH: number
): { x: number; y: number; cx: number; cy: number } {
  const rad = ((start.rotation ?? 0) * Math.PI) / 180;
  const w0 = start.width;
  const h0 = start.height;
  const cx0 = start.x + w0 / 2;
  const cy0 = start.y + h0 / 2;

  let localPinnedX = 0;
  let localPinnedY = 0;
  let newLocalPinnedX = 0;
  let newLocalPinnedY = 0;

  switch (anchor) {
    case 'middle-right':
    case 'right-center':
      localPinnedX = -w0 / 2;
      localPinnedY = 0;
      newLocalPinnedX = -newW / 2;
      newLocalPinnedY = 0;
      break;

    case 'middle-left':
    case 'left-center':
      localPinnedX = w0 / 2;
      localPinnedY = 0;
      newLocalPinnedX = newW / 2;
      newLocalPinnedY = 0;
      break;

    case 'top-center':
    case 'top-middle':
      localPinnedX = 0;
      localPinnedY = h0 / 2;
      newLocalPinnedX = 0;
      newLocalPinnedY = newH / 2;
      break;

    case 'bottom-center':
    case 'bottom-middle':
      localPinnedX = 0;
      localPinnedY = -h0 / 2;
      newLocalPinnedX = 0;
      newLocalPinnedY = -newH / 2;
      break;

    case 'top-left':
      localPinnedX = w0 / 2;
      localPinnedY = h0 / 2;
      newLocalPinnedX = newW / 2;
      newLocalPinnedY = newH / 2;
      break;

    case 'top-right':
      localPinnedX = -w0 / 2;
      localPinnedY = h0 / 2;
      newLocalPinnedX = -newW / 2;
      newLocalPinnedY = newH / 2;
      break;

    case 'bottom-left':
      localPinnedX = w0 / 2;
      localPinnedY = -h0 / 2;
      newLocalPinnedX = newW / 2;
      newLocalPinnedY = -newH / 2;
      break;

    case 'bottom-right':
      localPinnedX = -w0 / 2;
      localPinnedY = -h0 / 2;
      newLocalPinnedX = -newW / 2;
      newLocalPinnedY = -newH / 2;
      break;

    default:
      return {
        x: cx0 - newW / 2,
        y: cy0 - newH / 2,
        cx: cx0,
        cy: cy0,
      };
  }

  const pinnedWorldRotated = rotatePoint(localPinnedX, localPinnedY, rad);
  const pinnedWorldX = cx0 + pinnedWorldRotated.x;
  const pinnedWorldY = cy0 + pinnedWorldRotated.y;

  const newPinnedWorldRotated = rotatePoint(newLocalPinnedX, newLocalPinnedY, rad);
  const cxNew = pinnedWorldX - newPinnedWorldRotated.x;
  const cyNew = pinnedWorldY - newPinnedWorldRotated.y;

  return {
    x: cxNew - newW / 2,
    y: cyNew - newH / 2,
    cx: cxNew,
    cy: cyNew,
  };
}

  /** Every selected node exactly as it was when the gesture began. */
  const initialNodesMap = useRef<Record<string, AnyNode>>({});

  /**
   * Which handle is being dragged, captured while Konva still knows.
   *
   * `getActiveAnchor()` is only valid *during* the gesture. By the time
   * `transformend` fires, Konva has cleared it and the call returns an empty
   * string -- so every check at commit time was comparing against `''`.
   *
   * That is not a cosmetic problem. `anchor !== 'rotater'` was the guard
   * keeping a rotation out of the text-resize branch, and at commit it was
   * always true, so turning a paragraph re-wrapped it: a 399 x 154 box came out
   * of one rotation as 228 x 407. The live pass got the right answer and the
   * commit overwrote it with the wrong one.
   *
   * Read once per `transform` event, where it is reliable, and used by both
   * halves. A ref because it must survive the renders a live gesture causes.
   */
  const activeAnchor = useRef('');

  /**
   * The geometry the live pass computed for each text node, for the commit.
   *
   * ## Why the commit cannot re-derive it
   *
   * A text box must never carry a scale -- scaling glyphs stretches them, which
   * is the one thing type may not do -- so `handleTransform` folds the scale
   * into a re-layout and immediately resets the Konva node to `scaleX = 1`.
   *
   * `handleTransformEnd` then read that same scale back to work out the final
   * size, and read the **1** the live pass had just written. So every text
   * resize committed `startNode.width * 1`: the box reflowed correctly under
   * the pointer for the whole drag and snapped back to its original width the
   * instant you let go.
   *
   * The two halves have to be connected rather than each deriving the answer
   * independently, because after the reset the scale is no longer a record of
   * anything. The live pass already did the work; the commit uses it.
   */
  const liveTextGeometry = useRef<Record<string, {
    width: number;
    height: number;
    x: number;
    y: number;
    typography: TextNode['typography'];
    resize: TextNode['resize'];
  }>>({});

  const handleTransformStart = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-start'));
    setTransforming(true);

    const before = useStore.getState().objects;
    const ids = (trRef.current?.nodes() ?? []).map((n: Konva.Node) => n.id());
    const boxes = ids.map((id: string) => before[id]).filter(Boolean) as AnyNode[];

    const startMap: Record<string, AnyNode> = {};
    boxes.forEach((n: AnyNode) => {
      startMap[n.id] = { ...n };
    });
    initialNodesMap.current = startMap;
    liveTextGeometry.current = {};
  };

  const handleTransform = () => {
    const tr = trRef.current;
    if (!tr) return;
    const anchor = (tr.getActiveAnchor() || '').split(' ')[0];
    // Recorded for the commit, which runs after Konva has forgotten it.
    if (anchor) activeAnchor.current = anchor;
    const isRotating = anchor === 'rotater';
    const deg = Math.round(((tr.rotation() % 360) + 360) % 360);

    const store = useStore.getState().objects;
    let singleBadgeW = 0;
    let singleBadgeH = 0;

    tr.nodes().forEach((konvaNode: Konva.Node) => {
      const id = konvaNode.id();
      const node = store[id];
      const startNode = initialNodesMap.current[id] || node;
      if (!node || !startNode) return;
      const scaleX = konvaNode.scaleX();
      const scaleY = konvaNode.scaleY();

      /**
       * Turning a paragraph is not resizing it.
       *
       * The branch below sorts the eight resize handles into corner, vertical
       * edge and "everything else" -- and `rotater` is none of the first two, so
       * it fell into the horizontal-edge case and **re-wrapped the text on every
       * frame of a rotation**. The box came out of a rotate gesture at a
       * completely different size from the one it went in at: 389 x 120 became
       * 335 x 380 on a single turn.
       *
       * A rotation changes one number and no others. Excluding it here lets the
       * generic path below carry the angle through, which is all it has ever
       * needed to do.
       */
      if (node.type === 'text' && startNode.type === 'text' && anchor !== 'rotater') {
        /**
         * The scale is **not** reset here any more.
         *
         * It used to be, to keep glyphs from stretching -- and it was the other
         * half of the feedback loop described in `ObjectRenderer`. Konva's
         * `Transformer` derives each frame's transform from the scale it finds
         * on the node, so zeroing it mid-gesture left the widget solving
         * against a node that had been changed underneath it, every frame.
         *
         * Glyphs stay unstretched by a different route now: `TextRenderer` reads
         * the live width out of the store and re-wraps at it, so the text is
         * laid out at the size the drag is asking for rather than drawn small
         * and scaled up. The scale is folded into `width`/`height` once, at the
         * commit, where nothing is competing for the node.
         */

        let width = startNode.width;
        let height = startNode.height;
        let typo = startNode.typography;
        const draggedCorner = CORNERS.has(anchor);

        if (draggedCorner && uniformDrag(scaleX, scaleY)) {
          // Corner scaling: scales font size proportionally and reflows box
          const factor = Math.abs(scaleX);
          const newFontSize = Math.round(Math.max(4, Math.min(400, startNode.typography.fontSize * factor)));
          typo = { ...startNode.typography, fontSize: newFontSize };
          const layout = layoutText({
            text: applyTextCase(node.text, typo.textCase),
            wrap: startNode.resize === 'width' ? 'none' : 'word',
            width: startNode.width * factor,
            fontSize: newFontSize,
            lineHeight: typo.lineHeight,
            letterSpacing: typo.letterSpacing,
            paragraphSpacing: typo.paragraphSpacing,
            align: typo.align,
            verticalAlign: typo.verticalAlign,
            measure: measurerFor(typo),
          });
          width = Math.max(MIN_SIZE, Math.ceil(layout.width));
          height = Math.max(MIN_SIZE, Math.ceil(layout.height));
        } else if (!draggedCorner && VERTICAL_EDGES.has(anchor)) {
          // Vertical edge drag (top-center, bottom-center)
          width = startNode.width;
          height = Math.max(MIN_SIZE, startNode.height * Math.abs(scaleY));
        } else {
          // Horizontal edge drag (middle-left, middle-right): width changes and text wraps live!
          width = Math.max(MIN_SIZE, startNode.width * Math.abs(scaleX));
          const layout = layoutText({
            text: applyTextCase(node.text, startNode.typography.textCase),
            wrap: 'word',
            width,
            fontSize: startNode.typography.fontSize,
            lineHeight: startNode.typography.lineHeight,
            letterSpacing: startNode.typography.letterSpacing,
            paragraphSpacing: startNode.typography.paragraphSpacing,
            align: startNode.typography.align,
            verticalAlign: startNode.typography.verticalAlign,
            measure: measurerFor(startNode.typography),
          });
          height = Math.max(MIN_SIZE, Math.ceil(layout.height));
        }

        // A side handle sets the measure and the height follows, so the top
        // stays put -- see `pinTextBox`. Any other handle is an ordinary resize.
        const pinned = HORIZONTAL_EDGES.has(anchor)
          ? pinTextBox(anchor, startNode, width)
          : computePinnedBox(anchor, startNode, width, height);
        // Handed to the commit -- see `liveTextGeometry`. Recorded for every
        // branch above, because each one is a different answer and the commit
        // must not have to work out which ran.
        liveTextGeometry.current[id] = {
          width,
          height,
          x: pinned.x,
          y: pinned.y,
          typography: typo,
          resize: !draggedCorner && VERTICAL_EDGES.has(anchor) ? 'fixed' : 'height',
        };

        /**
         * Nothing here writes to the Konva node's own box, and it must not.
         *
         * A previous version set `width`/`height` on the group and called
         * `forceUpdate` to make the selection frame follow the re-wrap live
         * instead of snapping on release. It made **every** gesture on **every**
         * object type throw the object off the screen.
         *
         * The group is positioned as `x + cx` with `offsetX: cx`, where `cx` is
         * half the width React last rendered. Writing a new width straight onto
         * the Konva node changes what the transformer measures while `offsetX`
         * still holds the old half-width, so the next `_fitNodesInto` solves for
         * a position against a box that no longer matches its own origin. The
         * error is re-fed on the following frame and compounds -- which is
         * exactly what flying off screen looks like. `forceUpdate` inside the
         * `transform` handler made it worse by forcing that measurement to
         * happen again mid-event.
         *
         * The frame lagging the re-wrap by one commit is a cosmetic fault. This
         * was a functional one, and the trade is not close.
         */
        singleBadgeW = width;
        singleBadgeH = height;
        liveTransformStore.set(id, {
          fromTransform: true,
          x: pinned.x,
          y: pinned.y,
          width,
          height,
          rotation: konvaNode.rotation(),
          typography: typo,
          resize: 'height',
        });
        // Handed to the commit, which cannot recover it from a scale this pass
        // has just zeroed -- see `liveTextGeometry`.
        liveTextGeometry.current[id] = {
          width, height, x: pinned.x, y: pinned.y, typography: typo, resize: 'height',
        };
        return;
      }

      const width = Math.max(MIN_SIZE, startNode.width * Math.abs(scaleX));
      const height = Math.max(MIN_SIZE, startNode.height * Math.abs(scaleY));
      singleBadgeW = width;
      singleBadgeH = height;
      const pinned = computePinnedBox(anchor, startNode, width, height);
      liveTransformStore.set(id, {
        fromTransform: true,
        x: pinned.x,
        y: pinned.y,
        width,
        height,
        rotation: konvaNode.rotation(),
      });
    });

    const w = singleBadgeW || Math.round(tr.width());
    const h = singleBadgeH || Math.round(tr.height());
    const text = isRotating ? `${deg}°` : `${Math.round(w)} × ${Math.round(h)}`;
    setIsRotatingNow(isRotating);
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
    setIsRotatingNow(false);
    const tr = trRef.current;
    if (!tr) return;

    // Batch-clear all live transforms before CRDT commit so the connector
    // writeback effect doesn't see stale transient data.
    liveTransformStore.deleteBatch(tr.nodes().map((n: Konva.Node) => n.id()));

    const store = useStore.getState().objects;
    /**
     * Which handle was dragged, so a corner and an edge can mean different
     * things — which for text they must.
     */
    // From the ref, not from Konva: see `activeAnchor`. Asking the transformer
    // here returns an empty string, which silently reclassified every gesture.
    const anchor = activeAnchor.current;
    activeAnchor.current = '';
    const draggedCorner = CORNERS.has(anchor);

    const nodePatches: Array<{ id: string; changes: Record<string, unknown> }> = [];
    const updatedObjects: Record<string, AnyNode> = { ...store };
    const modifiedIds: string[] = [];

    tr.nodes().forEach((konvaNode: Konva.Node) => {
      const id = konvaNode.id();
      const node = store[id];
      const startNode = initialNodesMap.current[id] || node;
      if (!node || !startNode) return;

      const scaleX = konvaNode.scaleX();
      const scaleY = konvaNode.scaleY();

      // Reset scale on Konva node
      konvaNode.scaleX(1);
      konvaNode.scaleY(1);

      /**
       * A text box commits what the live pass measured, not a scale.
       *
       * See `liveTextGeometry`. The branches below re-derive the same three
       * answers from `scaleX`/`scaleY`, which the live pass zeroes the instant
       * it runs -- so they were computing `startNode.width * 1` and every text
       * resize snapped back on release. They are kept only for the case where
       * no live pass ran at all, which is a transform so short it produced no
       * `transform` event.
       */
      // A rotation never records live geometry -- see the guard in the live
      // pass -- so this is `undefined` for one and the generic path runs.
      const live = node.type === 'text' ? liveTextGeometry.current[id] : undefined;
      let finalW = live ? live.width : Math.max(MIN_SIZE, startNode.width * Math.abs(scaleX));
      let finalH = live ? live.height : Math.max(MIN_SIZE, startNode.height * Math.abs(scaleY));

      /**
       * Resizing a text box changes what kind of box it is.
       */
      const textMode: Record<string, unknown> = {};
      if (live) {
        textMode.typography = live.typography;
        textMode.resize = live.resize;
      }
      // `rotater` excluded here for the same reason as in the live pass: this
      // branch sorts handles into corner / vertical edge / everything else, and
      // a rotation is none of them -- so it fell into the horizontal-edge case
      // and re-wrapped the paragraph as part of turning it.
      if (!live && node.type === 'text' && startNode.type === 'text' && anchor !== 'rotater') {
        if (draggedCorner && uniformDrag(scaleX, scaleY)) {
          const factor = Math.abs(scaleX);
          const newFontSize = Math.round(Math.max(4, Math.min(400, startNode.typography.fontSize * factor)));
          const tempTypo = { ...startNode.typography, fontSize: newFontSize };
          const layout = layoutText({
            text: applyTextCase(node.text, tempTypo.textCase),
            wrap: startNode.resize === 'width' ? 'none' : 'word',
            width: startNode.width * factor,
            fontSize: newFontSize,
            lineHeight: tempTypo.lineHeight,
            letterSpacing: tempTypo.letterSpacing,
            paragraphSpacing: tempTypo.paragraphSpacing,
            align: tempTypo.align,
            verticalAlign: tempTypo.verticalAlign,
            measure: measurerFor(tempTypo),
          });
          textMode.typography = tempTypo;
          finalW = Math.max(MIN_SIZE, Math.ceil(layout.width));
          finalH = Math.max(MIN_SIZE, Math.ceil(layout.height));
        } else if (!draggedCorner && VERTICAL_EDGES.has(anchor)) {
          textMode.resize = 'fixed';
          finalW = startNode.width;
          finalH = Math.max(MIN_SIZE, startNode.height * Math.abs(scaleY));
        } else {
          // Horizontal resize or box stretch: auto-wrap paragraph text
          finalW = Math.max(MIN_SIZE, startNode.width * Math.abs(scaleX));
          const layout = layoutText({
            text: applyTextCase(node.text, startNode.typography.textCase),
            wrap: 'word',
            width: finalW,
            fontSize: startNode.typography.fontSize,
            lineHeight: startNode.typography.lineHeight,
            letterSpacing: startNode.typography.letterSpacing,
            paragraphSpacing: startNode.typography.paragraphSpacing,
            align: startNode.typography.align,
            verticalAlign: startNode.typography.verticalAlign,
            measure: measurerFor(startNode.typography),
          });
          textMode.resize = 'height';
          finalH = Math.max(MIN_SIZE, Math.ceil(layout.height));
        }
      }

      /**
       * A path has to resize its own outline; nothing else describes its size.
       */
      const pathMode: Record<string, unknown> = {};
      if (node.type === 'path') {
        const scaled = scalePathGeometry(node.geometry, Math.abs(scaleX), Math.abs(scaleY));
        if (scaled !== node.geometry) pathMode.geometry = scaled;
      }

      const pinned = computePinnedBox(anchor, startNode, finalW, finalH);

      /**
       * The rotation comes off the Konva node, not off the node we started with.
       *
       * This read `startNode.rotation ?? node.rotation` — the angle from
       * *before* the gesture — so every rotation was computed, drawn live, and
       * then thrown away on release. The handle turned the object, the commit
       * wrote the old angle back, and the next render put it upright: the
       * "snaps back on its own" that grids show and every other type shares.
       *
       * Konva's own value is the right source because the Transformer is what
       * performed the rotation, including its 45-degree snaps — deriving the
       * angle again from pointer positions would be a second answer to a
       * question the widget has already answered exactly.
       */
      const rotation = konvaNode.rotation();

      /**
       * A rotation moves the node; a resize pins an edge. They cannot share a
       * box.
       *
       * `computePinnedBox` answers "where does the top-left go so the opposite
       * edge stays put", which is the resize question. Rotating about the
       * selection's pivot moves the node's centre along an arc, and the only
       * thing that knows where it ended up is the Konva node — so for the
       * rotater the position is read back rather than derived.
       */
      const rotating = anchor === 'rotater';
      const box = rotating
        ? { x: konvaNode.x() - finalW / 2, y: konvaNode.y() - finalH / 2 }
        // Text commits the position the live pass pinned, for the reason
        // `pinTextBox` gives: a paragraph grows downwards, and re-deriving it
        // here would centre the growth again.
        : live
          ? { x: live.x, y: live.y }
          : { x: pinned.x, y: pinned.y };

      const changes = {
        ...textMode,
        ...pathMode,
        x: box.x,
        y: box.y,
        width: finalW,
        height: finalH,
        rotation,
        scaleX: 1,
        scaleY: 1,
      };

      nodePatches.push({ id, changes });
      updatedObjects[id] = { ...node, ...changes } as AnyNode;
      modifiedIds.push(id);

    });

    initialNodesMap.current = {};
    liveTextGeometry.current = {};
    const connectorPatches = syncConnectedConnectors(modifiedIds, updatedObjects);
    applyNodePatches([...nodePatches, ...connectorPatches]);

    /**
     * Nothing here special-cases a grid any more.
     *
     * The loop above folds the scale into `width`/`height` and resets
     * `scaleX`/`scaleY` to one, which is exactly what a grid node wants: its
     * modules are derived from its own box, so re-laying at the new size falls
     * out of the ordinary resize with no extra write. Gutters and corner radii
     * stay the absolute measurements they were chosen as, and a grid dragged
     * wider gains room rather than a 26px gutter.
     *
     * What stood here measured the selection before the gesture, accumulated
     * where it landed, divided one box by the other to recover a scale the
     * transformer had already applied, and pushed the result into a recipe held
     * on a group. Three versions of it shipped and none held, because the
     * arithmetic was never the problem -- the second copy of the box was.
     */
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
  /**
   * The pivot, shown only while turning something.
   *
   * ## Why it used to be noise
   *
   * It was drawn on **every selection** — a small blue cross sitting in the
   * middle of whatever you had clicked, permanently, over the artwork. A mark
   * that is always present says nothing, and this one had a real job it was
   * being prevented from doing: it is the point a rotation turns about, which
   * is worth knowing at exactly one moment and is clutter at every other.
   *
   * Scoped to the rotate gesture, it becomes an answer to a question you are
   * actually asking. Drawn as a ring with a gap rather than a solid cross, so
   * it reads as a *centre* rather than as a small object someone has added to
   * the board.
   */
  const centre = isRotatingNow && box ? (
    <Group
      x={box.x + box.width / 2}
      y={box.y + box.height / 2}
      listening={false}
      name={EXPORT_CHROME}
    >
      <Circle radius={7} stroke={ACCENT} strokeWidth={1} opacity={0.55} />
      <Circle radius={1.5} fill={ACCENT} />
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
   * The readout, while a handle is being dragged.
   *
   * ## What was wrong with it
   *
   * A near-black pill with a white hairline, a hard shadow and bold 11px type,
   * on a canvas whose entire chrome is one hairline blue. It was the heaviest
   * element on the screen and it appeared *because* you were busy looking at
   * something else — so the thing competing hardest for attention was the thing
   * least entitled to it. It also carried a fixed 88px width, so "45°" sat in
   * the middle of a pill sized for "1920 × 1080".
   *
   * It is chrome now, in the same blue as the frame it belongs to: it reads as
   * part of the selection rather than as a notification about it. The width
   * follows the text, the numbers are tabular so they do not jitter as they
   * count, and the ✕ between two dimensions is a proper multiplication sign
   * rather than the letter.
   *
   * Rendered at a fixed pixel size regardless of zoom, because it is a label
   * about the board and not a thing on it -- at 4x a zoomed readout would be
   * enormous, and at 0.2x unreadable.
   */
  const hudBadge = transforming && liveBadge ? (() => {
    const scale = 1 / (stageRef.current?.scaleX() || 1);
    // Measured from the string rather than fixed, so a short value gets a short
    // pill. `6.4` is Inter's advance at 11px for the digits and the separator,
    // which is all this ever shows.
    const width = Math.max(46, liveBadge.text.length * 6.4 + 18);
    return (
      <Group
        x={liveBadge.x}
        y={liveBadge.y}
        scaleX={scale}
        scaleY={scale}
        listening={false}
        name={EXPORT_CHROME}
      >
        <Rect
          x={-width / 2}
          y={-11}
          width={width}
          height={22}
          cornerRadius={11}
          fill={ACCENT}
          shadowColor="rgba(15, 23, 42, 0.28)"
          shadowBlur={6}
          shadowOffsetY={2}
        />
        <Text
          x={-width / 2}
          y={-4.5}
          width={width}
          text={liveBadge.text}
          fontSize={11}
          fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
          fontStyle="500"
          fill="#FFFFFF"
          align="center"
          letterSpacing={0.2}
        />
      </Group>
    );
  })() : null;

  return (
    <>
      {transformer}
      {centre}
      {hudBadge}
    </>
  );
};
