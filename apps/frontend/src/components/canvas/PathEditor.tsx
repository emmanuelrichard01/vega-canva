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

/**
 * Direct selection: reshaping part of a path rather than all of it.
 *
 * ## What this replaces
 *
 * The pen tool could always place anchors and drag out handles *while* drawing.
 * What did not exist was any way to touch one afterwards, so every correction
 * meant deleting the path and drawing it again. The first version of this
 * closed that gap for a single anchor on a single contour, which turned out to
 * be two limits rather than one convenience:
 *
 *  - **One anchor.** Reshaping the top edge of a box means moving two corners
 *    *together*. One at a time is not a slower route to the same place — the
 *    intermediate state is a shape you did not ask for, and it is the state any
 *    constraint or snap would apply to.
 *  - **One contour.** Anything a boolean produced, and any glyph with a hole,
 *    is a compound path. It has several contours and a bare index cannot say
 *    which — so every result of the boolean tools was permanently uneditable.
 *
 * Both are gone. Anchors are addressed as `{ sub, index }` across every
 * contour, selection is a list, marquee and shift-click build it, and drags,
 * nudges, aligns and deletes all act on the whole of it.
 *
 * ## Everything writes immediately
 *
 * Each drag writes the whole geometry on every move, like the crop overlay and
 * for the same reason: a curve you cannot see until you let go is not an
 * editor. The UndoManager's capture window folds the run into one step.
 *
 * ## The node moves when the path does
 *
 * Path geometry is stored relative to the node origin, and dragging an anchor
 * outside the old bounds would otherwise leave a node whose `width`/`height` no
 * longer describe what it draws — a selection box standing off the shape and a
 * hit area in the wrong place. Every edit therefore ends in `reframePath`,
 * which re-origins the geometry and reports how far the node has to move to
 * keep the drawing still.
 */
export const PathEditor: React.FC<Props> = ({ stageScale }) => {
  const selection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  const node = useStore((s) => (selection ? s.objects[selection.nodeId] : undefined));
  const [marquee, setMarquee] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);

  if (!selection || !node || node.type !== 'path') return null;
  // A freehand blob has an outline rather than anchors — its `svgPath` *is* the
  // shape of its own stroke, so there is nothing to grab. Bezier and compound
  // paths both have contours, and both are editable here.
  if (node.geometry.kind === 'freehand') return null;

  const geometry: ContourGeometry = node.geometry;
  const rings = contours(geometry);
  const scale = 1 / stageScale;
  const picked = new Set(selection.anchors.map(anchorKey));

  /** Write an edited geometry back, moving the node so the drawing stays put. */
  const commit = (next: ContourGeometry | null) => {
    if (!next) {
      // Fewer than two anchors left: there is no path, so there is no node.
      deleteNode(node.id);
      pathEdit.exit();
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

  /** Pointer position in the node's own coordinates. */
  const localPointer = (e: Konva.KonvaEventObject<unknown>): { x: number; y: number } | null => {
    const stage = e.target.getStage();
    const p = stage?.getRelativePointerPosition();
    return p ? { x: p.x - node.x, y: p.y - node.y } : null;
  };

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
        fill="#FFFFFF"
        stroke={ACCENT}
        strokeWidth={scale}
        draggable
        onDragMove={(e) => {
          const p = { x: e.target.x(), y: e.target.y() };
          // Alt breaks the pair, which is how a smooth anchor becomes a corner
          // — the same modifier every other editor uses for it, and the reason
          // the mode is derived from the handles rather than stored: breaking
          // one is an edit to the geometry, not to a flag beside it.
          const broke = (e.evt as MouseEvent).altKey;
          commit(dragHandle(geometry, { ...ref, side: which }, p, { break: broke }));
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

  /**
   * Where a multi-anchor drag started, in node-local space.
   *
   * Konva reports the dragged shape's own position, which is where *one* anchor
   * went. Everything else in the selection has to move by the same delta, and a
   * delta needs a previous position to subtract — recomputing it from the
   * geometry each frame would use a geometry that has already been written to.
   */
  const dragFrom = React.useRef<{ x: number; y: number } | null>(null);

  return (
    <Group x={node.x} y={node.y} name={EXPORT_CHROME}>
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

      {/**
        * The marquee, drawn in node-local space.
        *
        * Anchors are the only thing a direct-selection marquee can catch, and
        * the alternative — shift-clicking each one — is what makes reshaping a
        * long edge tedious enough that people redraw instead.
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

      {/**
        * A transparent sheet over the path's own box, to catch marquee drags.
        *
        * Without it a drag that starts on empty space inside the shape reaches
        * the node beneath and moves the whole path — which is the one thing
        * direct selection exists not to do.
        */}
      <Rect
        x={-INSERT_SLOP * scale}
        y={-INSERT_SLOP * scale}
        width={(node.width || 0) + INSERT_SLOP * 2 * scale}
        height={(node.height || 0) + INSERT_SLOP * 2 * scale}
        fill="transparent"
        onMouseDown={(e) => {
          const p = localPointer(e);
          if (!p) return;
          e.cancelBubble = true;
          dragFrom.current = p;
          setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onMouseMove={(e) => {
          if (!dragFrom.current || !marquee) return;
          const p = localPointer(e);
          if (!p) return;
          setMarquee({
            x: dragFrom.current.x,
            y: dragFrom.current.y,
            w: p.x - dragFrom.current.x,
            h: p.y - dragFrom.current.y,
          });
        }}
        onMouseUp={(e) => {
          if (!marquee) return;
          const additive = (e.evt as MouseEvent).shiftKey;
          const found = anchorsInRect(geometry, {
            x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h,
          });
          const keys = new Set(selection.anchors.map(anchorKey));
          pathEdit.select(
            additive
              ? [...selection.anchors, ...found.filter((r) => !keys.has(anchorKey(r)))]
              : found
          );
          dragFrom.current = null;
          setMarquee(null);
        }}
        perfectDrawEnabled={false}
      />

      {rings.map((ring) =>
        ring.anchors.map((a, index) => {
          const ref: AnchorRef = { sub: ring.sub, index };
          const isPicked = picked.has(anchorKey(ref));
          const sub = subpathsOf(geometry)[ring.sub];
          return (
            <React.Fragment key={anchorKey(ref)}>
              {/* Handles only on picked anchors. Every handle at once turns a
                  path of thirty anchors into a thicket you cannot find the
                  outline in. */}
              {isPicked && a.inX !== undefined && handleLine(a, a.inX, a.inY!, ref, 'in')}
              {isPicked && a.outX !== undefined && handleLine(a, a.outX, a.outY!, ref, 'out')}
              <Rect
                x={a.x - (ANCHOR_SIZE * scale) / 2}
                y={a.y - (ANCHOR_SIZE * scale) / 2}
                width={ANCHOR_SIZE * scale}
                height={ANCHOR_SIZE * scale}
                // Filled when picked, hollow when not: the same language the
                // rest of the app uses for selected versus available.
                fill={isPicked ? ACCENT : '#FFFFFF'}
                stroke={ACCENT}
                strokeWidth={scale}
                // A smooth anchor is drawn round and a corner square, so the
                // distinction is visible without clicking anything.
                cornerRadius={anchorMode(sub, index) === 'corner' ? 0 : ANCHOR_SIZE * scale}
                draggable
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                  const additive = (e.evt as MouseEvent).shiftKey;
                  /**
                   * Clicking a *already picked* anchor without a modifier keeps
                   * the selection, so a drag that begins on one of five chosen
                   * anchors moves all five. Replacing it here would make a
                   * multi-anchor drag impossible to start.
                   */
                  if (!additive && isPicked) return;
                  pathEdit.select(toggleAnchor(selection.anchors, ref, additive));
                }}
                onDragStart={() => {
                  dragFrom.current = { x: a.x, y: a.y };
                }}
                onDragMove={(e) => {
                  const from = dragFrom.current;
                  if (!from) return;
                  // The rect is drawn centred on the anchor, so its own origin
                  // is half a handle up and to the left of it.
                  const half = (ANCHOR_SIZE * scale) / 2;
                  const to = { x: e.target.x() + half, y: e.target.y() + half };
                  const moving = picked.has(anchorKey(ref)) ? selection.anchors : [ref];
                  commit(moveAnchors(geometry, moving, to.x - from.x, to.y - from.y));
                  dragFrom.current = to;
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
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
            </React.Fragment>
          );
        })
      )}
    </Group>
  );
};

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
