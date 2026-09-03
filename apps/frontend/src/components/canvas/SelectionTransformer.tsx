import React, { useCallback, useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Rect, Text, Transformer } from 'react-konva';
import { applyNodePatches } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { useStore } from '../../hooks/useStore';
import { anchorAngle, cursorForAnchor } from '../../engine/interaction/resizeCursor';
import { cursorCss } from '../../engine/cursor/cursorCss';
import { resizeVisual } from '../../engine/cursor/cursorVisual';
import { fitPathToBox } from '../../engine/model/pathGeometry';
import { fitLineToBox, isLineLike } from '../../engine/model/lineEnds';
import { liveTransformStore } from '../../engine/model/liveTransformStore';
import { syncConnectedConnectors } from '../../engine/model/connectorTargets';
import { layoutText } from '../../engine/text/layout';
import { measurerFor } from '../../engine/text/measure';
import { applyTextCase } from '../../engine/model/textCase';
import type { AnyNode } from '../../engine/model/schema';
import {
  placeInBox,
  placeParagraph,
  selectionBox,
  type Box,
  type Placed,
} from '../../engine/interaction/selectionTransform';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { RotateZones } from './RotateZones';

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

/**
 * How far the readout sits below the selection, in screen pixels.
 *
 * Divided by the zoom at every use, so the badge keeps the same distance from
 * the box whatever the camera is doing — it is a label about the board, not a
 * thing on it. Named because two call sites need the identical number and
 * they had drifted apart: 22 in one and 26 in the other, which the badge
 * expressed as a small hop at the start and end of every gesture.
 */
const BADGE_DROP = 26;
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
  /** The invisible rectangle the handles actually drive -- see the attach effect. */
  const proxyRef = useRef<Konva.Rect>(null);
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

  /**
   * True while the handles are driving, mirrored into a ref.
   *
   * The live subscription below runs outside React, so it cannot read the state
   * variable without closing over a stale copy of it.
   */
  const transformingRef = useRef(false);

  /**
   * Put the proxy round whatever the selection is *right now*.
   *
   * ## Why it reads the live store as well as the document
   *
   * Dragging an object does not write to the document until the drop -- the
   * frames in between go to `liveTransformStore`, which is the whole reason a
   * sixty-frame drag is not sixty CRDT updates. The proxy was fitted from the
   * document alone, so while the transformer was attached to the real Konva
   * nodes the box followed the drag for free, and the moment it was attached to
   * a proxy instead it stopped: the handles sat where the object *had* been and
   * jumped to it on release.
   *
   * So the fit takes the live value where there is one and the stored value
   * otherwise, which is the same rule every renderer on the canvas follows.
   */
  /**
   * A single selected line is edited at its ends, not by its box.
   *
   * `LineEditor` takes over for that case, so the transformer must not also
   * attach — two sets of handles on one object is ambiguous, and the box's
   * handles are the ones that do the wrong thing. A line in a *multi* selection
   * keeps the box, because moving several objects together is a box operation
   * and there is no single pair of ends to offer.
   *
   * A connector is the same case and a worse one: its `width`/`height` are
   * *derived* from whatever its two ends resolve to, so the eight handles were
   * not just the wrong affordance, they were inert. A drag wrote a box the next
   * render recomputed from the bindings and discarded, which made an arrow look
   * adjustable and refuse to be adjusted. `ConnectorEditor` owns it.
   *
   * ## And why the widget holds a proxy at all
   *
   * Konva resizes by putting a scale on the node it is attached to, and a scale
   * is exactly what a document object must not carry: it stretches glyphs,
   * thickens strokes and swells corner radii. Undoing it each frame fights the
   * widget, which computes the next frame *from* the scale it finds; leaving it
   * alone is the distortion. There is no third option while the widget holds the
   * real node — so it holds an invisible rectangle, which may scale as freely as
   * Konva likes because nobody ever sees it.
   */
  const fitProxy = useCallback(() => {
    const tr = trRef.current;
    const proxy = proxyRef.current;
    if (!tr || !proxy) return;

    const store = useStore.getState().objects;
    const boxes = selectedIds
      .map((id) => {
        const node = store[id];
        if (!node) return null;
        const live = liveTransformStore.get(id);
        if (!live) return node;
        return {
          ...node,
          x: live.x ?? node.x,
          y: live.y ?? node.y,
          width: live.width ?? node.width,
          height: live.height ?? node.height,
          rotation: live.rotation ?? node.rotation,
        } as AnyNode;
      })
      .filter(Boolean) as AnyNode[];

    const solo = boxes.length === 1 ? boxes[0] : undefined;
    const soloLine = Boolean(solo) && (isLineLike(solo!) || solo!.type === 'connector');
    const bounds = soloLine ? null : selectionBox(boxes);

    if (bounds) {
      // Positioned by its centre, so Konva turns it about its middle -- which
      // is what makes a selection rotate as one rigid thing.
      proxy.position({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
      proxy.offset({ x: bounds.width / 2, y: bounds.height / 2 });
      proxy.size({ width: bounds.width, height: bounds.height });
      proxy.scale({ x: 1, y: 1 });
      // The angle of a single rotated object, so its handles sit square to it
      // rather than to the world. A mixed selection has no one angle to take.
      proxy.rotation(boxes.length === 1 ? boxes[0].rotation || 0 : 0);
    }

    tr.nodes(bounds ? [proxy] : []);
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [selectedIds]);

  /**
   * Follow a drag, without a React render per frame.
   *
   * Straight to the Konva node from the store's own notification: re-rendering
   * this component sixty times a second to move eight handles is the cost the
   * live store exists to avoid. Skipped while the handles themselves are
   * driving -- there the proxy is the *source* of the live values, and re-fitting
   * it from them would be a feedback loop.
   */
  useEffect(() => liveTransformStore.subscribeGlobal(() => {
    if (transformingRef.current) return;
    fitProxy();
  }), [fitProxy]);

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;

    fitProxy();

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
    for (const name of ANCHORS) {
      const anchor = tr.findOne(`.${name}`);
      if (!anchor) continue;
      // One claim id for the whole transformer: only one anchor can be under
      // the pointer at a time, and re-claiming as the object rotates has to
      // replace the previous shape rather than stack a second claim.
      const enter = () => {
        /**
         * Drawn, and turned to the *exact* angle rather than the nearest
         * eighth of a turn.
         *
         * `cursorForAnchor` snaps, because the OS only has eight resize
         * cursors; on an object rotated 20° every handle's arrow is then up
         * to 22.5° off the drag it describes. It is still what the `url()`
         * falls back to, so a browser that cannot use the image gets the
         * nearest real one.
         */
        const angle = anchorAngle(name, tr.rotation());
        const keyword = cursorForAnchor(name, tr.rotation());
        claimCursor(
          'transformer',
          angle === undefined ? keyword : cursorCss(resizeVisual(angle), keyword)
        );
      };
      const leave = () => claimCursor('transformer', null);
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
  }, [selectedIds, selectionGeometry, stageRef, fitProxy]);

/**
 * `rotatePoint` and `computePinnedBox` stood here -- about a hundred and thirty
 * lines working out where a box's top-left goes so the edge opposite the handle
 * stays still, per anchor, with a separate rule for text.
 *
 * The proxy answers all of it for free. Konva already pins the opposite edge
 * while it resizes the proxy, so the proxy's box *is* the pinned result and
 * `placeInBox` maps each object into it. The one case that genuinely differs --
 * a paragraph, whose height comes from the re-wrap rather than from the drag --
 * is `placeParagraph`, which is four lines.
 *
 * This arithmetic was also the source of several bugs it existed to prevent: it
 * centred a text box's growth, and it had to be told that a rotation was not a
 * resize. Deleting it is most of the value of this change.
 */

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
   * `liveTextGeometry` stood here.
   *
   * It was a hand-off: the live pass measured a paragraph and stashed the result
   * for the commit, because the commit could no longer recover it from a scale
   * the live pass had zeroed. `placeAll` makes it unnecessary -- both halves
   * call the same function and get the same answer, so there is nothing to pass
   * between them.
   */


  /**
   * The proxy's box, derived through its own transform.
   *
   * ## Why not `proxy.x() - width / 2`
   *
   * That was the first version, and it assumed `x()` is the centre of the
   * scaled box -- true only because the proxy's offset happens to be half its
   * size. Konva is free to describe the same rectangle with a different
   * combination of position, offset and scale, and while resizing from a
   * top-left handle it does exactly that: the box grew from its bottom-right
   * corner whichever handle you dragged, because the origin the arithmetic
   * assumed was not the one Konva had moved.
   *
   * Asking the node to map its own local centre removes the assumption. The
   * transform already contains the offset, the position and the scale, however
   * Konva chose to split them, so this is right for every anchor by
   * construction rather than by coincidence.
   *
   * The box returned is **unrotated**: the size, around the true centre. Any
   * turn is carried separately as `spin`, because `placeInBox` applies it about
   * that centre -- which is what makes a selection rotate as one rigid thing.
   */
  const proxyBox = (proxy: Konva.Rect): Box => {
    const centre = proxy.getTransform().point({
      x: proxy.width() / 2,
      y: proxy.height() / 2,
    });
    // Konva reports a negative dimension when a handle is pulled through the
    // far side. The box is still real, it is just described backwards.
    const width = Math.abs(proxy.width() * proxy.scaleX());
    const height = Math.abs(proxy.height() * proxy.scaleY());
    return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
  };

  /**
   * The selection's box when the gesture began, and each object inside it.
   *
   * Both are snapshots, because the proxy's transform is expressed *relative to
   * where it started* -- see `selectionTransform`. Reading them back off the
   * document mid-gesture would be reading values the gesture is in the middle
   * of changing, which is the mistake that produced most of the bugs this
   * rewrite replaces.
   */
  const startBox = useRef<Box | null>(null);
  /** The proxy's angle when the gesture began, so `spin` is a delta. */
  const startSpin = useRef(0);

  const handleTransformStart = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-start'));
    transformingRef.current = true;
    setTransforming(true);

    const before = useStore.getState().objects;
    const nodes = selectedIds.map((id) => before[id]).filter(Boolean) as AnyNode[];

    const startMap: Record<string, AnyNode> = {};
    nodes.forEach((n) => { startMap[n.id] = { ...n }; });
    initialNodesMap.current = startMap;

    /**
     * The reference box is read off the **proxy**, not recomputed from the
     * document.
     *
     * They have to be the same box, and they are not always: the proxy is
     * fitted by an effect, and anything that changes a node between that effect
     * and the gesture -- a text box settling its own height, a peer's edit --
     * leaves the two disagreeing. Measured live, the proxy read 389 wide while
     * the store said 209, so `to.width / from.width` came out at 1.86 and a
     * *pure rotation* scaled everything by nearly double.
     *
     * The proxy is what the handles move, so the proxy is the frame the gesture
     * is expressed in. Deriving `from` from anything else is the same "two
     * copies of one fact" mistake that this whole rewrite exists to remove.
     */
    const proxy = proxyRef.current;
    // The same derivation the live pass uses, so `from` and `to` cannot be
    // measured two different ways.
    startBox.current = proxy ? proxyBox(proxy) : selectionBox(nodes);
    // The proxy starts turned to the object's own angle, so its rotation is
    // only meaningful as a difference.
    startSpin.current = proxy ? proxy.rotation() : 0;
  };

  /**
   * What the gesture has done to the selection's box, read off the proxy.
   *
   * The proxy is the only thing Konva touches, so this is the one place its
   * scale is consulted -- and the last. Everything downstream works in sizes.
   */
  const readProxy = (): { to: Box; spin: number } | null => {
    const proxy = proxyRef.current;
    const from = startBox.current;
    if (!proxy || !from) return null;
    return { to: proxyBox(proxy), spin: proxy.rotation() - startSpin.current };
  };

  /**
   * Where every selected object lands, given the gesture so far.
   *
   * One function, called by the live preview and by the commit. They used to
   * work this out separately -- from a scale one of them had already modified --
   * and disagreed constantly: resizes that previewed correctly committed the
   * original width, rotations re-wrapped the paragraph they were turning. Two
   * derivations of one answer is the shape of that whole family of bugs.
   */
  const placeAll = (): Array<{ id: string; node: AnyNode; start: AnyNode; placed: Placed; extra: Record<string, unknown> }> => {
    const moved = readProxy();
    const from = startBox.current;
    if (!moved || !from) return [];

    const store = useStore.getState().objects;
    const anchor = activeAnchor.current;
    const rotating = anchor === 'rotater';
    const out: Array<{ id: string; node: AnyNode; start: AnyNode; placed: Placed; extra: Record<string, unknown> }> = [];

    for (const id of selectedIds) {
      const node = store[id];
      const start = initialNodesMap.current[id];
      if (!node || !start) continue;

      let placed = placeInBox(start, from, moved.to, moved.spin);
      placed = {
        ...placed,
        width: Math.max(MIN_SIZE, placed.width),
        height: Math.max(MIN_SIZE, placed.height),
      };
      const extra: Record<string, unknown> = {};

      /**
       * A paragraph is re-wrapped, not stretched.
       *
       * The whole reason the objects no longer carry a scale: type has to be
       * laid out at its real size to be undistorted, and the box the drag drew
       * is the *measure*, not the height. Excluded for a rotation, which sorts
       * into none of the resize cases and used to fall through to the
       * horizontal-edge branch -- so turning a paragraph re-wrapped it.
       */
      if (node.type === 'text' && start.type === 'text' && !rotating) {
        const scale = from.width > 0 ? moved.to.width / from.width : 1;
        const scaleY = from.height > 0 ? moved.to.height / from.height : 1;

        if (CORNERS.has(anchor) && uniformDrag(scale, scaleY)) {
          // A corner scales the type itself, which is the one gesture where the
          // font size is meant to change.
          const size = Math.round(Math.max(4, Math.min(400, start.typography.fontSize * Math.abs(scale))));
          const typo = { ...start.typography, fontSize: size };
          const laid = layoutText({
            text: applyTextCase(node.text, typo.textCase),
            wrap: start.resize === 'width' ? 'none' : 'word',
            width: Math.max(MIN_SIZE, start.width * Math.abs(scale)),
            fontSize: size,
            lineHeight: typo.lineHeight,
            letterSpacing: typo.letterSpacing,
            paragraphSpacing: typo.paragraphSpacing,
            align: typo.align,
            verticalAlign: typo.verticalAlign,
            measure: measurerFor(typo),
          });
          extra.typography = typo;
          placed = placeParagraph(placed, {
            width: Math.max(MIN_SIZE, Math.ceil(laid.width)),
            height: Math.max(MIN_SIZE, Math.ceil(laid.height)),
          });
        } else if (VERTICAL_EDGES.has(anchor)) {
          // A top or bottom handle states a height, which makes the box fixed.
          extra.resize = 'fixed';
          placed = { ...placed, width: start.width };
        } else {
          const laid = layoutText({
            text: applyTextCase(node.text, start.typography.textCase),
            wrap: 'word',
            width: placed.width,
            fontSize: start.typography.fontSize,
            lineHeight: start.typography.lineHeight,
            letterSpacing: start.typography.letterSpacing,
            paragraphSpacing: start.typography.paragraphSpacing,
            align: start.typography.align,
            verticalAlign: start.typography.verticalAlign,
            measure: measurerFor(start.typography),
          });
          extra.resize = 'height';
          placed = placeParagraph(placed, {
            width: placed.width,
            height: Math.max(MIN_SIZE, Math.ceil(laid.height)),
          });
        }
      }

      out.push({ id, node, start, placed, extra });
    }
    return out;
  };

  /**
   * A gesture that is ours rather than Konva's, announced as what it is.
   *
   * `handleTransform` learns which kind of transform is running from
   * `tr.getActiveAnchor()` — and during a rotation driven by `RotateZones`
   * Konva has no active anchor at all, so it read `''`. `activeAnchor` then
   * kept whatever the *last real resize* had left in it, and `placeAll`
   * treated a pure rotation as a resize from a stale handle: text nodes were
   * re-wrapped on every frame of the turn and the badge described the wrong
   * gesture. That is most of the "jerks and glitches".
   *
   * Naming the anchor here is the smallest honest fix: `handleTransform` only
   * overwrites it when Konva actually has one, so a value set here survives
   * the gesture, and `handleTransformEnd` already clears it.
   */
  const beginExternalGesture = (kind: 'rotate' | 'shear') => {
    activeAnchor.current = kind === 'rotate' ? 'rotater' : '';
    handleTransformStart();
  };

  const handleTransform = () => {
    const tr = trRef.current;
    const proxy = proxyRef.current;
    if (!tr || !proxy) return;

    const anchor = (tr.getActiveAnchor() || '').split(' ')[0];
    // Captured while Konva still knows it: by `transformend` it has been
    // cleared, and every check there was silently comparing against ''.
    if (anchor) activeAnchor.current = anchor;
    /**
     * Which gesture is running — asked of the *sticky* anchor, not the live one.
     *
     * Konva reports an active anchor only for a drag Konva itself started. A
     * rotation from `RotateZones` is ours, so `tr.getActiveAnchor()` is `''`
     * for every frame of it — and this line used to read the local `anchor`,
     * so the one gesture that most needs an angle readout was the one gesture
     * that could never get one. The badge counted width and height while the
     * object turned, which are the two numbers a rotation does not change:
     * it sat there showing `145 × 142` for the whole turn.
     *
     * `beginExternalGesture` writes `'rotater'` into `activeAnchor` precisely
     * so the rest of this component can tell what is happening. Reading it
     * here is the whole fix, and `handleTransformEnd` already clears it, so
     * the badge returns to dimensions the moment the turn ends.
     */
    const rotating = (anchor || activeAnchor.current) === 'rotater';

    const placements = placeAll();
    for (const { id, placed, extra } of placements) {
      liveTransformStore.set(id, {
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
        rotation: placed.rotation,
        ...(extra as { typography?: never; resize?: never }),
      });
    }

    const box = readProxy();
    if (box) {
      const deg = Math.round(((proxy.rotation() % 360) + 360) % 360);
      setLiveBadge({
        text: rotating
          ? `${deg}°`
          : `${Math.round(box.to.width)} × ${Math.round(box.to.height)}`,
        x: box.to.x + box.to.width / 2,
        // The same offset the resting badge uses, in the same units. These
        // were 22 world units here and 26 screen pixels there, so the badge
        // hopped a few pixels at the start of every gesture and back at the
        // end — a movement with no meaning, on the one element that is
        // supposed to be the fixed thing you read while everything else moves.
        y: box.to.y + box.to.height + BADGE_DROP / (stageRef.current?.scaleX() || 1),
      });
    }
  };

  const handleTransformEnd = () => {
    window.dispatchEvent(new CustomEvent('canvas-drag-end'));
    transformingRef.current = false;
    setTransforming(false);
    setLiveBadge(null);

    const placements = placeAll();
    liveTransformStore.deleteBatch(selectedIds);
    activeAnchor.current = '';

    const store = useStore.getState().objects;
    const updatedObjects: Record<string, AnyNode> = { ...store };
    const nodePatches: Array<{ id: string; changes: Record<string, unknown> }> = [];
    const modifiedIds: string[] = [];

    for (const { id, node, placed, extra } of placements) {
      /**
       * A path has to resize its own outline; nothing else describes its size.
       *
       * Measured against the box rather than multiplied by the gesture's ratio,
       * so this is the same call the live preview makes in `ObjectRenderer` --
       * and it lands in the same place whether it runs once or every frame. A
       * ratio would have to be accumulated, which drifts, and would disagree
       * with a preview that had already been applied.
       */
      const pathMode: Record<string, unknown> = {};
      if (node.type === 'path') {
        const fitted = fitPathToBox(node.geometry, placed.width, placed.height);
        if (fitted) pathMode.geometry = fitted;
      }
      /**
       * A line stores its own shape too, and had been left out of this.
       *
       * The transformer stands down for a *solo* line — it is edited at its
       * points instead — so nobody saw it. A line caught in a multi-object
       * selection got a new box and kept its old endpoints: everything else in
       * the selection grew and the line stayed exactly as long as it was,
       * inside a bounding box that no longer described it.
       */
      if (isLineLike(node)) {
        const fitted = fitLineToBox(
          (node as { geometry: import('../../engine/model/schema').ShapeGeometry }).geometry,
          { width: node.width, height: node.height },
          { width: placed.width, height: placed.height }
        );
        if (fitted) pathMode.geometry = fitted;
      }

      const changes = {
        ...extra,
        ...pathMode,
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
        rotation: placed.rotation,
        // Always one. The objects never carry a scale now -- that is the entire
        // point of the proxy.
        scaleX: 1,
        scaleY: 1,
      };

      nodePatches.push({ id, changes });
      updatedObjects[id] = { ...node, ...changes } as AnyNode;
      modifiedIds.push(id);
    }

    /**
     * The proxy goes back to being an unscaled box, ready to be re-fitted.
     *
     * **The rotation is deliberately not reset.** It used to be, and that was
     * a visible flash and a real bug. `fitProxy` always sets the angle
     * explicitly — `boxes.length === 1 ? boxes[0].rotation : 0` — so zeroing
     * it here is redundant, and it leaves the proxy claiming an angle of zero
     * for the window between this line and the refit that follows the document
     * write. In that window the selection box snaps square, and anything that
     * reads `proxy.rotation()` as a starting angle reads 0 for an object that
     * is plainly turned.
     *
     * That is what made a second rotation jump: `RotateZones` took its start
     * angle from the proxy, got 0, and turned the object from there. Scale has
     * no such problem — `fitProxy` sets it unconditionally too, but the
     * gesture reads it from nowhere.
     */
    const proxy = proxyRef.current;
    if (proxy) {
      proxy.scaleX(1);
      proxy.scaleY(1);
    }

    initialNodesMap.current = {};
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
   * There is no pivot marker any more.
   *
   * It began as a blue cross drawn on every selection, permanently, over the
   * artwork. Scoping it to the rotate gesture and redrawing it as a ring around
   * a dot made it quieter but did not make it *useful*, which is the test it
   * kept failing: the pivot cannot be moved here, so the mark reports a fact
   * nobody can act on. Figma draws nothing; Illustrator draws one only once the
   * pivot becomes draggable.
   *
   * The angle badge already answers the question a rotation actually raises --
   * how far have I turned -- so the marker was decoration on top of an answer.
   * Restyling a control twice without it earning its place is the signal to
   * remove it.
   */

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
  /**
   * The selection's bounds, for anything that needs them during *render*.
   *
   * `fitProxy` computes the same thing and writes it into the proxy, but it
   * runs in an effect and writes a Konva node — so a child that needs the box
   * cannot read it without inheriting two problems: the proxy is positioned by
   * its **centre** with an offset, so `proxy.x()` is not the corner; and child
   * effects run before parent effects, so on a new selection the proxy has not
   * been fitted yet.
   *
   * Keyed on `selectionGeometry`, which is the string that already changes
   * whenever any selected node's geometry does — so this recomputes exactly
   * when the box moves and never otherwise. `liveTransformStore` is not
   * consulted, unlike `fitProxy`: it only differs mid-gesture, and everything
   * reading this is hidden mid-gesture.
   */
  const selectionBounds = React.useMemo(() => {
    const store = useStore.getState().objects;
    const boxes = selectedIds.map((id) => store[id]).filter(Boolean) as AnyNode[];
    if (boxes.length === 0) return null;
    const solo = boxes.length === 1 ? boxes[0] : undefined;
    // A line has no box worth rotating from its corners — the same reading
    // `fitProxy` takes when it declines to give one a transformer at all.
    if (solo && (isLineLike(solo) || solo.type === 'connector')) return null;
    const bounds = selectionBox(boxes);
    if (!bounds) return null;
    return {
      bounds,
      rotation: boxes.length === 1 ? boxes[0].rotation || 0 : 0,
      // Shear is a field on a node, so it is offered for one and withheld for
      // many rather than offered and then quietly wrong.
      soloId: solo ? solo.id : null,
      soloSkew: { x: solo?.skewX ?? 0, y: solo?.skewY ?? 0 },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectionGeometry]);

  /**
   * The size readout, shown whenever there is a selection.
   *
   * It used to appear only *during* a transform, which is the moment it is
   * least needed — the object is visibly changing, so the number is confirming
   * something already on screen. The question it actually answers is "how big
   * is this", and that is asked while looking at a thing, not while dragging
   * it. Every reference for this selection box shows it under a resting
   * selection.
   *
   * The live text wins while a gesture is running, because that is a *changing*
   * number and the resting one would be stale for the length of the drag.
   * Otherwise it is derived from the same bounds the handles are placed from,
   * so it cannot disagree with the box it sits under.
   *
   * Suppressed for a multi-selection: a combined bounding box has a width and
   * a height, but they are not the size of anything the user selected, and a
   * number under a group of objects reads as a claim about each of them.
   */
  const restingBadge =
    !transforming && selectionBounds && selectedIds.length === 1
      ? {
          text: `${Math.round(selectionBounds.bounds.width)} × ${Math.round(selectionBounds.bounds.height)}`,
          x: selectionBounds.bounds.x + selectionBounds.bounds.width / 2,
          // Below the box, clear of the bottom handles and their padding.
          y: selectionBounds.bounds.y + selectionBounds.bounds.height + BADGE_DROP / (stageRef.current?.scaleX() || 1),
        }
      : null;

  const badge = transforming ? liveBadge : restingBadge;

  const hudBadge = badge ? (() => {
    const scale = 1 / (stageRef.current?.scaleX() || 1);
    // Measured from the string rather than fixed, so a short value gets a short
    // pill. `6.4` is Inter's advance at 11px for the digits and the separator,
    // which is all this ever shows.
    const width = Math.max(46, badge.text.length * 6.4 + 18);
    return (
      <Group
        x={badge.x}
        y={badge.y}
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
          text={badge.text}
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

  const transformerEl = (
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
       * Eight vertices: four corners and four edge midpoints, and nothing else.
       *
       * Konva's ninth control — a knob on a stalk above the top edge — is off.
       * It is a library default rather than a design: it is not part of the
       * object's geometry, it collides with whatever sits above the selection,
       * and on a small object it is larger than the thing it belongs to. Figma
       * and Illustrator both put rotation in the ring just outside each corner
       * instead, which is what `RotateZones` below does.
       *
       * Removing it is only safe *because* that shipped with a rotate cursor.
       * A stalk with a knob on it advertises itself and an invisible hot zone
       * does not; what makes it discoverable in those apps is that the pointer
       * changes the instant you enter it. The cursor is the affordance.
       */
      rotateEnabled={false}
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
      /**
       * Corners and edges are drawn differently, because they *do* different
       * things: a corner scales both axes, an edge scales one. Making them
       * identical asks the user to remember which is which; shaping each one
       * like its job means they do not have to.
       */
      anchorStyleFunc={(anchor) => {
        const name = anchor.name().split(' ')[0];
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
   * The proxy: sized to the selection, drawn as nothing.
   *
   * `listening={false}` because it must never take a click -- it sits over the
   * artwork and would otherwise swallow every selection attempt inside the
   * bounding box. Konva's handles are their own shapes and do not need it.
   */
  const proxy = <Rect ref={proxyRef} listening={false} name={EXPORT_CHROME} />;

  return (
    <>
      {proxy}
      {/*
        Under the transformer, deliberately.
        A rotate zone hangs off its corner and the resize anchor is drawn at the
        padded corner, so the two overlap by a few pixels. Konva hit-tests
        top-down, so rendered *after* the transformer these would take the hover
        that belongs to the anchor and the resize cursor would never appear on
        the corner handles. Underneath, the anchor wins where they overlap and
        the ring outside it rotates — which is the arbitration Figma and
        Illustrator have, and it needs no geometry to maintain.
      */}
      {selectionBounds && (
        <RotateZones
          box={selectionBounds.bounds}
          rotation={selectionBounds.rotation}
          proxyRef={proxyRef}
          onStart={beginExternalGesture}
          onMove={handleTransform}
          onEnd={handleTransformEnd}
          transforming={transforming}
        />
      )}
      {transformerEl}
      {hudBadge}
    </>
  );
};
