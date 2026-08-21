import React, { useSyncExternalStore } from 'react';
import type Konva from 'konva';
import { Circle, Group, Line, Path, Rect } from 'react-konva';
import { deleteNode, updateNode } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { pathEdit } from '../../engine/interaction/pathEdit';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  anchorMode,
  contourData,
  insertAnchor,
  nearestPointOnPath,
  reframePath,
  subpathsOf,
  type Anchor,
  type ContourGeometry,
} from '../../engine/model/pathGeometry';
import {
  alignAnchors,
  anchorBounds,
  anchorKey,
  anchorsInRect,
  contours,
  deleteAnchors,
  dragHandle,
  moveAnchors,
  setAnchorsMode,
  toggleAnchor,
  type AlignEdge,
  type AnchorRef,
} from '../../engine/model/pathEditing';

interface Props {
  /** Stage zoom, so every handle stays the same size on screen. */
  stageScale: number;
}

const ACCENT = '#2563EB';
/** Anchor square, in screen pixels. Matches the transformer's handles. */
const ANCHOR_SIZE = 7;
const HANDLE_RADIUS = 3.5;
/** How near the outline a click has to land to insert an anchor there, in screen pixels. */
const INSERT_SLOP = 8;
/** Pointer travel, in screen px, before a press counts as a drag rather than a click. */
const DRAG_SLOP = 3;

/**
 * Direct selection: reshaping part of a path rather than all of it.
 *
 * ## What this replaces
 *
 * The pen tool could always place anchors and drag out handles *while* drawing.
 * What did not exist was any way to touch one afterwards, so every correction
 * meant deleting the path and drawing it again. Closing that for a single
 * anchor on a single contour turned out to be two limits rather than one
 * convenience: reshaping a box's top edge means moving two corners *together*,
 * and a bare index cannot name a point on a compound path at all — so every
 * result of the boolean tools was permanently uneditable.
 *
 * ## Why one pointer session, and not Konva drags
 *
 * The first version made every anchor and handle `draggable` and wrote geometry
 * from Konva's reported position. Three separate faults came out of that, and
 * they compounded:
 *
 *  - **The origin moved under the drag.** Every frame called `reframePath`,
 *    which re-origins the geometry and shifts `node.x/y` to compensate. The
 *    next frame then measured its delta against a coordinate space that had
 *    just moved, so the path crept away from the pointer.
 *  - **React state lagged the pointer.** `moveAnchors` read the `geometry`
 *    prop, which only updates on re-render. Two moves inside one frame both
 *    read the same stale geometry, and the second overwrote the first.
 *  - **Konva and React fought over position.** Konva sets the shape's `x/y` as
 *    you drag; React sets it back from the geometry. Which won depended on
 *    frame timing.
 *
 * So there are no draggable shapes here. One press starts a session, a working
 * copy of the geometry is advanced synchronously on every move, and the reframe
 * happens exactly once on release — where a moving origin cannot affect a delta
 * that has already been applied.
 */
export const PathEditor: React.FC<Props> = ({ stageScale }) => {
  const selection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  const node = useStore((s) => (selection ? s.objects[selection.nodeId] : undefined));
  const [marquee, setMarquee] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);

  /**
   * The live drag, if there is one.
   *
   * A ref rather than state: it is read and written inside pointer handlers
   * that must see the value from the move a millisecond ago, not the value
   * React last rendered with.
   */
  const session = React.useRef<{
    kind: 'anchor' | 'handle' | 'marquee';
    ref?: AnchorRef;
    side?: 'in' | 'out';
    /** The geometry as of this frame, ahead of anything React has rendered. */
    working: ContourGeometry;
    /** Node origin at the moment the drag began. Fixed for its whole duration. */
    origin: { x: number; y: number };
    start: { x: number; y: number };
    last: { x: number; y: number };
    moved: boolean;
    anchors: AnchorRef[];
  } | null>(null);

  if (!selection || !node || node.type !== 'path') return null;
  // A freehand blob has an outline rather than anchors — its `svgPath` *is* the
  // shape of its own stroke, so there is nothing to grab. Bezier and compound
  // paths both have contours, and both are editable here.
  if (node.geometry.kind === 'freehand') return null;

  const geometry: ContourGeometry = node.geometry;
  const rings = contours(geometry);
  const scale = 1 / stageScale;
  const picked = new Set(selection.anchors.map(anchorKey));

  /**
   * Write geometry back.
   *
   * @param reframe Whether to re-origin the path and move the node to
   *   compensate. **False for every frame of a drag and true once on release**
   *   — re-origining mid-drag moves the coordinate space the next delta is
   *   measured in, which is what made the path creep away from the pointer.
   */
  const commit = (next: ContourGeometry | null, reframe = true) => {
    if (!next) {
      // Fewer than two anchors left: there is no path, so there is no node.
      deleteNode(node.id);
      pathEdit.exit();
      return;
    }
    if (!reframe) {
      updateNode(node.id, { geometry: next });
      return;
    }
    const framed = reframePath(next);
    updateNode(node.id, {
      geometry: framed.geometry,
      x: node.x + framed.dx,
      y: node.y + framed.dy,
      width: framed.width,
      height: framed.height,
    });
  };

  /** Pointer position in world coordinates. */
  const worldPointer = (stage: Konva.Stage | null): { x: number; y: number } | null =>
    stage?.getRelativePointerPosition() ?? null;

  /** Pointer position in the node's own coordinates. */
  const localPointer = (e: Konva.KonvaEventObject<unknown>): { x: number; y: number } | null => {
    const p = worldPointer(e.target.getStage());
    return p ? { x: p.x - node.x, y: p.y - node.y } : null;
  };

  /**
   * Run a session to completion, on the stage and on the window.
   *
   * The stage carries the moves, because `getRelativePointerPosition` is the
   * only thing that knows the camera's transform. The window carries the
   * release, because a drag that ends off the canvas — over the properties
   * panel, or outside the browser — still has to end, and a session left open
   * would keep reshaping the path on the next unrelated mouse move.
   */
  const beginSession = (
    stage: Konva.Stage | null,
    kind: 'anchor' | 'handle' | 'marquee',
    at: { x: number; y: number },
    extra: { ref?: AnchorRef; side?: 'in' | 'out'; anchors?: AnchorRef[] } = {}
  ) => {
    if (!stage) return;
    session.current = {
      kind,
      working: geometry,
      origin: { x: node.x, y: node.y },
      start: at,
      last: at,
      moved: false,
      anchors: extra.anchors ?? [],
      ref: extra.ref,
      side: extra.side,
    };

    const onMove = () => {
      const s = session.current;
      const p = worldPointer(stage);
      if (!s || !p) return;

      if (!s.moved && Math.hypot(p.x - s.start.x, p.y - s.start.y) * stageScale < DRAG_SLOP) return;
      s.moved = true;

      if (s.kind === 'marquee') {
        setMarquee({
          x: s.start.x - s.origin.x,
          y: s.start.y - s.origin.y,
          w: p.x - s.start.x,
          h: p.y - s.start.y,
        });
        return;
      }

      if (s.kind === 'handle' && s.ref && s.side) {
        // Handles take an absolute destination, so no working copy is needed —
        // but it is kept current anyway so a release reframes what is on screen.
        s.working = dragHandle(
          s.working,
          { ...s.ref, side: s.side },
          { x: p.x - s.origin.x, y: p.y - s.origin.y },
          { break: altHeld.current }
        );
      } else {
        // The delta is measured against the *previous move*, and applied to the
        // working copy — never to the `geometry` prop, which is one render
        // behind and would lose every move that happened inside a frame.
        s.working = moveAnchors(s.working, s.anchors, p.x - s.last.x, p.y - s.last.y);
      }

      s.last = p;
      commit(s.working, false);
    };

    const onUp = () => {
      const s = session.current;
      session.current = null;
      stage.off('mousemove.patheditor');
      window.removeEventListener('mouseup', onUp);
      if (!s) return;

      if (s.kind === 'marquee') {
        finishMarquee(s.moved);
        return;
      }
      // One reframe, at the end, so the node's box describes what it draws
      // again without any delta having been measured across the move.
      if (s.moved) commit(s.working, true);
    };

    stage.on('mousemove.patheditor', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** Whether Alt is down, sampled on the press and kept current by the canvas. */
  const altHeld = React.useRef(false);

  const finishMarquee = (moved: boolean) => {
    setMarquee((box) => {
      if (!moved || !box) {
        // A click on empty space inside the path clears the anchor selection.
        // It must not clear it on a *drag* that selected nothing, though —
        // that is the same gesture and would undo itself.
        if (!moved) pathEdit.select([]);
        return null;
      }
      const found = anchorsInRect(geometry, { x: box.x, y: box.y, width: box.w, height: box.h });
      pathEdit.select(marqueeAdditive.current ? mergeAnchors(selection.anchors, found) : found);
      return null;
    });
  };

  const marqueeAdditive = React.useRef(false);

  const handleLine = (a: Anchor, hx: number, hy: number, ref: AnchorRef, which: 'in' | 'out') => (
    <React.Fragment key={`${which}-${anchorKey(ref)}`}>
      <Line
        points={[a.x, a.y, hx, hy]}
        stroke={ACCENT}
        strokeWidth={scale}
        opacity={0.6}
        listening={false}
        perfectDrawEnabled={false}
      />
      <Circle
        x={hx}
        y={hy}
        radius={HANDLE_RADIUS * scale}
        // A hit radius wider than the dot, because a 3.5px target is a target
        // you miss — and missing a handle grabs the anchor behind it, which
        // moves the whole point instead of bending the curve.
        hitStrokeWidth={HANDLE_RADIUS * 4 * scale}
        fill="#FFFFFF"
        stroke={ACCENT}
        strokeWidth={scale}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          altHeld.current = Boolean((e.evt as MouseEvent).altKey);
          const p = worldPointer(e.target.getStage());
          if (p) beginSession(e.target.getStage(), 'handle', p, { ref, side: which });
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'grab';
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'default';
        }}
        perfectDrawEnabled={false}
      />
    </React.Fragment>
  );

  return (
    <Group x={node.x} y={node.y} name={EXPORT_CHROME}>
      {/**
        * The marquee catcher, **underneath everything**.
        *
        * It was above the outline, which meant the click that inserts an anchor
        * never reached it — the one gesture on the outline, permanently
        * swallowed by a transparent rectangle. Bottom of the stack it catches
        * only what nothing else wanted: a press on empty space inside the
        * path's box, which is exactly what a marquee is.
        */}
      <Rect
        x={-INSERT_SLOP * scale}
        y={-INSERT_SLOP * scale}
        width={(node.width || 0) + INSERT_SLOP * 2 * scale}
        height={(node.height || 0) + INSERT_SLOP * 2 * scale}
        fill="transparent"
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage();
          const p = worldPointer(stage);
          if (!p) return;
          marqueeAdditive.current = Boolean((e.evt as MouseEvent).shiftKey);
          beginSession(stage, 'marquee', p);
        }}
        perfectDrawEnabled={false}
      />

      {/* The outline, redrawn on top of the path itself. It is the click
          target for inserting an anchor, and it keeps the path visible when it
          is behind something else — which, while you are editing it, it
          routinely is. */}
      <Path
        data={contourData(geometry)}
        stroke={ACCENT}
        strokeWidth={scale}
        fillEnabled={false}
        hitStrokeWidth={INSERT_SLOP * 2 * scale}
        onClick={(e) => {
          const p = localPointer(e);
          if (!p) return;
          /**
           * Insert on whichever contour the click actually landed on.
           *
           * `nearestPointOnPath` reads one contour, so a compound path is
           * searched ring by ring and the nearest wins. Running it on
           * `subpaths[0]` alone — which is what a single-contour API forces —
           * would insert an anchor into the outer ring of a donut when you
           * clicked the inner one.
           */
          const subs = subpathsOf(geometry);
          type Best = { sub: number; hit: NonNullable<ReturnType<typeof nearestPointOnPath>> };
          let best: Best | null = null;
          subs.forEach((sub, i) => {
            const hit = nearestPointOnPath(sub, p);
            if (hit && (best === null || hit.distance < best.hit.distance)) best = { sub: i, hit };
          });
          const found = best as Best | null;
          if (!found || found.hit.distance > INSERT_SLOP * scale) return;
          e.cancelBubble = true;

          const edited = insertAnchor(subs[found.sub], found.hit);
          const next: ContourGeometry =
            geometry.kind === 'compound'
              ? { kind: 'compound', subpaths: subs.map((s, i) => (i === found.sub ? edited : s)) }
              : edited;
          commit(next);
          pathEdit.select([{ sub: found.sub, index: found.hit.curve + 1 }]);
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'copy';
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'default';
        }}
        perfectDrawEnabled={false}
      />

      {/* Every anchor. Drawn before the handles so a handle lying over a
          neighbouring anchor is still the thing you grab — the handle is the
          finer control and the harder target, so it wins the overlap. */}
      {rings.map((ring) =>
        ring.anchors.map((a, index) => {
          const ref: AnchorRef = { sub: ring.sub, index };
          const isPicked = picked.has(anchorKey(ref));
          const sub = subpathsOf(geometry)[ring.sub];
          return (
            <Rect
              key={anchorKey(ref)}
              x={a.x - (ANCHOR_SIZE * scale) / 2}
              y={a.y - (ANCHOR_SIZE * scale) / 2}
              width={ANCHOR_SIZE * scale}
              height={ANCHOR_SIZE * scale}
              // A hit area half again as wide as the mark, for the same reason
              // the handles have one: seven screen pixels is not a target.
              hitStrokeWidth={ANCHOR_SIZE * scale}
              // Filled when picked, hollow when not: the same language the
              // rest of the app uses for selected versus available.
              fill={isPicked ? ACCENT : '#FFFFFF'}
              stroke={ACCENT}
              strokeWidth={scale}
              // A smooth anchor is drawn round and a corner square, so the
              // distinction is visible without clicking anything.
              cornerRadius={anchorMode(sub, index) === 'corner' ? 0 : ANCHOR_SIZE * scale}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                const stage = e.target.getStage();
                const p = worldPointer(stage);
                if (!p) return;
                const additive = Boolean((e.evt as MouseEvent).shiftKey);

                /**
                 * Pressing an anchor that is *already picked* keeps the whole
                 * selection, so a drag beginning on one of five chosen anchors
                 * moves all five. Replacing it here would make a multi-anchor
                 * drag impossible to start.
                 */
                const next = !additive && isPicked
                  ? selection.anchors
                  : toggleAnchor(selection.anchors, ref, additive);
                pathEdit.select(next);

                // Dragging acts on what is now selected, including this anchor
                // even when a shift-click has just removed it — releasing
                // without moving is what deselects, not the press.
                const moving = next.some((r) => anchorKey(r) === anchorKey(ref)) ? next : [ref];
                beginSession(stage, 'anchor', p, { anchors: moving });
              }}
              onDblClick={(e) => {
                e.cancelBubble = true;
                const to = anchorMode(sub, index) === 'corner' ? 'smooth' : 'corner';
                commit(setAnchorsMode(geometry, isPicked ? selection.anchors : [ref], to));
              }}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = 'pointer';
              }}
              onMouseLeave={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = 'default';
              }}
              perfectDrawEnabled={false}
            />
          );
        })
      )}

      {/* Handles, above every anchor. Only on picked anchors: every handle at
          once turns a path of thirty anchors into a thicket you cannot find
          the outline in. */}
      {rings.map((ring) =>
        ring.anchors.map((a, index) => {
          const ref: AnchorRef = { sub: ring.sub, index };
          if (!picked.has(anchorKey(ref))) return null;
          return (
            <React.Fragment key={`h-${anchorKey(ref)}`}>
              {a.inX !== undefined && handleLine(a, a.inX, a.inY!, ref, 'in')}
              {a.outX !== undefined && handleLine(a, a.outX, a.outY!, ref, 'out')}
            </React.Fragment>
          );
        })
      )}

      {/**
        * The marquee, drawn last so it is never hidden by the anchors it is
        * about to catch.
        */}
      {marquee && (
        <Rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          stroke={ACCENT}
          strokeWidth={scale}
          dash={[4 * scale, 3 * scale]}
          fill={`${ACCENT}18`}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
};

/** Union of two anchor lists, without duplicates. */
function mergeAnchors(a: readonly AnchorRef[], b: readonly AnchorRef[]): AnchorRef[] {
  const seen = new Set(a.map(anchorKey));
  return [...a, ...b.filter((r) => !seen.has(anchorKey(r)))];
}

/** The path currently open for editing, and its geometry, or `null`. */
function editing(): { id: string; node: { x: number; y: number }; geometry: ContourGeometry; anchors: AnchorRef[] } | null {
  const selection = pathEdit.getSnapshot();
  if (!selection) return null;
  const node = useStore.getState().objects[selection.nodeId];
  if (!node || node.type !== 'path' || node.geometry.kind === 'freehand') return null;
  return { id: node.id, node, geometry: node.geometry, anchors: selection.anchors };
}

/** Write an edited geometry back from outside the component. */
function write(id: string, node: { x: number; y: number }, next: ContourGeometry | null) {
  if (!next) {
    deleteNode(id);
    pathEdit.exit();
    return;
  }
  const framed = reframePath(next);
  updateNode(id, {
    geometry: framed.geometry,
    x: node.x + framed.dx,
    y: node.y + framed.dy,
    width: framed.width,
    height: framed.height,
  });
}

/**
 * Delete every picked anchor, if any are picked.
 *
 * Lives here rather than in the component because the key that triggers it is
 * handled at the canvas level, where Delete otherwise removes the whole node —
 * which, while a path is open for editing, is emphatically not what Delete
 * means. Returns whether it took the key.
 */
export function deletePickedAnchor(): boolean {
  const state = editing();
  if (!state || state.anchors.length === 0) return false;

  const { geometry, selection } = deleteAnchors(state.geometry, state.anchors);
  write(state.id, state.node, geometry);
  if (geometry) pathEdit.select(selection);
  return true;
}

/**
 * Nudge the picked anchors, if any are picked.
 *
 * The arrow keys move the whole node otherwise, which while a path is open is
 * the opposite of what direct selection is for. Returns whether it took the key.
 */
export function nudgePickedAnchors(dx: number, dy: number): boolean {
  const state = editing();
  if (!state || state.anchors.length === 0) return false;
  write(state.id, state.node, moveAnchors(state.geometry, state.anchors, dx, dy));
  return true;
}

/** Straighten or round the picked anchors. Returns whether anything happened. */
export function setPickedAnchorMode(mode: 'corner' | 'smooth'): boolean {
  const state = editing();
  if (!state || state.anchors.length === 0) return false;
  write(state.id, state.node, setAnchorsMode(state.geometry, state.anchors, mode));
  return true;
}

/** Line the picked anchors up. Returns whether anything happened. */
export function alignPickedAnchors(edge: AlignEdge): boolean {
  const state = editing();
  if (!state || state.anchors.length < 2) return false;
  write(state.id, state.node, alignAnchors(state.geometry, state.anchors, edge));
  return true;
}

/** How many anchors are picked, and the box they occupy. For the toolbar. */
export function pickedAnchorSummary(): { count: number; width: number; height: number } | null {
  const state = editing();
  if (!state) return null;
  const box = anchorBounds(state.geometry, state.anchors);
  return { count: state.anchors.length, width: box?.width ?? 0, height: box?.height ?? 0 };
}

/** Select every anchor on the open path. */
export function selectAllAnchors(): boolean {
  const state = editing();
  if (!state) return false;
  pathEdit.select(contours(state.geometry).flatMap((c) => c.anchors.map((_, index) => ({ sub: c.sub, index }))));
  return true;
}
