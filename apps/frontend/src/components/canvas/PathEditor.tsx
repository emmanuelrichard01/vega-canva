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
  moveAnchor,
  moveHandle,
  nearestPointOnPath,
  reframePath,
  removeAnchor,
  setAnchorMode,
  toAnchors,
  type Anchor,
} from '../../engine/model/pathGeometry';
import type { BezierGeometry } from '../../engine/model/schema';

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
 * Editing a path after it has been drawn.
 *
 * The pen tool could always place anchors and drag out handles *while*
 * drawing. What did not exist was any way to touch one afterwards — the
 * control points were stored, rendered, and then permanently out of reach, so
 * every correction meant deleting the path and drawing it again. That is the
 * gap this closes, and it is why anchor editing sits ahead of booleans in the
 * order of things worth having.
 *
 * ## Everything writes immediately
 *
 * Each drag writes the whole geometry on every move, like the crop overlay and
 * for the same reason: a curve you cannot see until you let go is not an
 * editor. One drag is therefore many undo steps, which is the accepted cost
 * here — the alternative is a snapshot mechanism whose only job is to collapse
 * them, and `pathEdit` deliberately has none.
 *
 * ## The node moves when the path does
 *
 * Path geometry is stored relative to the node origin, and dragging an anchor
 * outside the old bounds would otherwise leave a node whose `width`/`height`
 * no longer describe what it draws — a selection box standing off the shape
 * and a hit area in the wrong place. Every edit therefore ends in
 * `reframePath`, which re-origins the geometry and reports how far the node
 * has to move to keep the drawing still.
 */
export const PathEditor: React.FC<Props> = ({ stageScale }) => {
  const selection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  const node = useStore((s) => (selection ? s.objects[selection.nodeId] : undefined));

  if (!selection || !node || node.type !== 'path') return null;
  // A compound path has several contours and no single run of anchors to walk;
  // a freehand blob has an outline rather than anchors at all. Neither is
  // editable here yet, and offering handles that did nothing would be worse
  // than offering none.
  if (node.geometry.kind !== 'bezier') return null;

  const geometry: BezierGeometry = node.geometry;
  const anchors = toAnchors(geometry);
  const scale = 1 / stageScale;

  /** Write an edited geometry back, moving the node so the drawing stays put. */
  const commit = (next: BezierGeometry | null) => {
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

  const handleLine = (a: Anchor, hx: number, hy: number, key: string, which: 'in' | 'out', index: number) => (
    <React.Fragment key={key}>
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
          commit(moveHandle(geometry, index, which, p, { break: broke }));
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
          const hit = nearestPointOnPath(geometry, p);
          if (!hit || hit.distance > INSERT_SLOP * scale) return;
          e.cancelBubble = true;
          commit(insertAnchor(geometry, hit));
          pathEdit.select(hit.curve + 1);
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

      {anchors.map((a, i) => {
        const picked = selection.anchor === i;
        return (
          <React.Fragment key={i}>
            {/* Handles only on the picked anchor and its neighbours. Every
                handle at once turns a path of thirty anchors into a thicket
                you cannot find the outline in. */}
            {picked && a.inX !== undefined && handleLine(a, a.inX, a.inY!, `in-${i}`, 'in', i)}
            {picked && a.outX !== undefined && handleLine(a, a.outX, a.outY!, `out-${i}`, 'out', i)}
            <Rect
              x={a.x - (ANCHOR_SIZE * scale) / 2}
              y={a.y - (ANCHOR_SIZE * scale) / 2}
              width={ANCHOR_SIZE * scale}
              height={ANCHOR_SIZE * scale}
              // Filled when picked, hollow when not: the same language the
              // rest of the app uses for selected versus available.
              fill={picked ? ACCENT : '#FFFFFF'}
              stroke={ACCENT}
              strokeWidth={scale}
              // A smooth anchor is drawn round and a corner square, so the
              // distinction is visible without clicking anything.
              cornerRadius={anchorMode(geometry, i) === 'corner' ? 0 : ANCHOR_SIZE * scale}
              draggable
              onMouseDown={(e) => {
                e.cancelBubble = true;
                pathEdit.select(i);
              }}
              onDragMove={(e) => {
                // The rect is drawn centred on the anchor, so its own origin
                // is half a handle up and to the left of it.
                const half = (ANCHOR_SIZE * scale) / 2;
                commit(moveAnchor(geometry, i, { x: e.target.x() + half, y: e.target.y() + half }));
              }}
              onDblClick={(e) => {
                e.cancelBubble = true;
                commit(setAnchorMode(geometry, i, anchorMode(geometry, i) === 'corner' ? 'smooth' : 'corner'));
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
      })}
    </Group>
  );
};

/**
 * Delete the picked anchor, if there is one.
 *
 * Lives here rather than in the component because the key that triggers it is
 * handled at the canvas level, where Delete otherwise removes the whole node —
 * which, while a path is open for editing, is emphatically not what Delete
 * means. Returns whether it took the key.
 */
export function deletePickedAnchor(): boolean {
  const selection = pathEdit.getSnapshot();
  if (!selection || selection.anchor === null) return false;
  const node = useStore.getState().objects[selection.nodeId];
  if (!node || node.type !== 'path' || node.geometry.kind !== 'bezier') return false;

  const next = removeAnchor(node.geometry, selection.anchor);
  if (!next) {
    deleteNode(node.id);
    pathEdit.exit();
    return true;
  }
  const framed = reframePath(next);
  updateNode(node.id, {
    geometry: framed.geometry,
    x: node.x + framed.dx,
    y: node.y + framed.dy,
    width: framed.width,
    height: framed.height,
  });
  pathEdit.select(null);
  return true;
}
