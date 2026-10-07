import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Frame as FrameIcon } from 'lucide-react';
import { cameraSystem } from '../../engine/CameraSystem';
import { nodeLabel } from '../../engine/model/nodeLabel';
import { nodeBounds } from '../../engine/model/selection';
import type { AnyNode } from '../../engine/model/schema';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { WorkspaceCover } from '../WorkspaceCover';
import { Emoji } from '../emoji/Emoji';
import { framePreview, orderedSlides, reorderSlides } from '../canvas/FramePresenterThumbs';
import { layerHover } from '../../engine/interaction/layerHover';
import { fitPose, framesInReadingOrder, stepFrame } from './framesOrder';

/**
 * Every frame's contents, nested frames included, in one pass over the board:
 * each object walks up its own chain of owners (stopping at a cycle) and is
 * listed under each frame on the way.
 */
export function framesContents(all: readonly AnyNode[], objects: Record<string, AnyNode>): Map<string, AnyNode[]> {
  const map = new Map<string, AnyNode[]>();
  for (const node of all) {
    const seen = new Set<string>([node.id]);
    let owner = node.frameId;
    while (owner && !seen.has(owner)) {
      const frame = objects[owner];
      if (!frame || frame.type !== 'frame') break;
      seen.add(owner);
      const list = map.get(owner);
      if (list) list.push(node);
      else map.set(owner, [node]);
      owner = frame.frameId;
    }
  }
  return map;
}

/** The frame last flown to, shared by the list and the Alt+arrow keys. */
let lastFrame: string | null = null;
/** The selected frame when the keys last stepped, to tell a new selection from a stale one. */
let selectedAtStep: string | null = null;

function flyTo(frame: AnyNode) {
  lastFrame = frame.id;
  const pose = fitPose(nodeBounds(frame), { width: cameraSystem.width, height: cameraSystem.height }, cameraSystem.zoomLimits);
  window.dispatchEvent(new CustomEvent('navigateViewport', { detail: pose }));
}

/** Surfaces that own Alt+arrows themselves: the table and code editors, and comments. */
const OWN_ALT_ARROWS = '[class*="tbled"], [class*="cded"], .cmt-layer, .cmt-card, [contenteditable="true"], input, textarea, select';

/**
 * Alt+↓ and Alt+↑ step the camera through the board's frames in reading
 * order, from the selected frame when there is one.
 *
 * Only while the Layers panel has focus or is showing Frames, and never when
 * the key was meant for something that steps through its own list (a comment
 * thread, a table, code). Handled on the document in the bubble phase, after
 * those surfaces have had their turn, and stopped there so the board does not
 * also nudge the selection.
 */
export function useFrameStepping(objects: Record<string, AnyNode>, selectedIds: string[], framesMode: boolean): void {
  const latest = useRef({ objects, selectedIds, framesMode });
  latest.current = { objects, selectedIds, framesMode };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.altKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(OWN_ALT_ARROWS)) return;
      // An open comment thread steps through its replies with the same keys.
      if (document.querySelector('.cmt-card')) return;
      const { objects: objs, selectedIds: ids, framesMode: frames } = latest.current;
      const panelFocused = Boolean(document.activeElement?.closest('.layers-panel'));
      if (!frames && !panelFocused) return;
      const order = framesInReadingOrder(Object.values(objs));
      const selected = ids.find((id) => objs[id]?.type === 'frame') ?? null;
      // A frame selected since the last step is where stepping starts;
      // otherwise it continues from the last frame flown to.
      const from = selected && selected !== selectedAtStep ? selected : lastFrame ?? selected;
      selectedAtStep = selected;
      const next = stepFrame(order, from, e.key === 'ArrowDown' ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      flyTo(next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * A frame's contents as a picture, drawn from the document by the same
 * component as the presenter's slide strip, so a slide looks the same in both.
 */
const FrameThumb: React.FC<{ frame: AnyNode; objects: Record<string, AnyNode> }> = ({ frame, objects }) => {
  const preview = useMemo(() => framePreview(frame.id, objects), [frame.id, objects]);
  return (
    <span className="frame-thumb" aria-hidden="true">
      <WorkspaceCover workspaceId={`slide:${frame.id}`} name={nodeLabel(frame)} preview={preview} />
    </span>
  );
};

interface FramesOutlineProps {
  objects: Record<string, AnyNode>;
  selectedIds: string[];
  onSelect: (id: string) => void;
}

/**
 * Frames as a jump list, in reading order.
 *
 * Clicking a frame selects it and flies the camera to fit it.
 */
export const FramesOutline: React.FC<FramesOutlineProps> = ({ objects, selectedIds, onSelect }) => {
  // Deferred, so a busy board updates this list after the edit rather than during it.
  const deferredObjects = useDeferredValue(objects);
  const all = useMemo(() => Object.values(deferredObjects), [deferredObjects]);
  const frames = useMemo(() => framesInReadingOrder(all), [all]);
  const childrenOf = useMemo(() => framesContents(all, deferredObjects), [all, deferredObjects]);
  // The slides' own order is the one the presenter plays; only they can be rearranged.
  const slideIds = useMemo(() => orderedSlides(deferredObjects).map((f) => f.id), [deferredObjects]);
  const { canEdit } = useRoomPermissions();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  if (frames.length === 0) {
    return (
      <div className="frames-empty">
        <p className="frames-empty__title">No frames yet</p>
        <p className="frames-empty__hint">Draw one with the Frame tool (F). Frames listed here can be walked with Alt+↑ and Alt+↓.</p>
      </div>
    );
  }

  return (
    <ol className="frames-list custom-scrollbar" aria-label="Frames">
      {frames.map((frame, i) => {
        const children = childrenOf.get(frame.id) ?? [];
        const selected = selectedIds.includes(frame.id);
        const slide = slideIds.indexOf(frame.id);
        const draggable = canEdit && slide >= 0 && slideIds.length > 1;
        return (
          <li
            key={frame.id}
            draggable={draggable}
            data-drop={dropAt === slide && dragFrom !== null && dragFrom !== slide ? (dragFrom < slide ? 'after' : 'before') : undefined}
            onDragStart={(e) => {
              setDragFrom(slide);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(slide));
            }}
            onDragOver={(e) => {
              if (dragFrom === null || slide < 0) return;
              e.preventDefault();
              setDropAt(slide);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && slide >= 0) reorderSlides(deferredObjects, dragFrom, slide);
              setDragFrom(null);
              setDropAt(null);
            }}
          >
            <button
              type="button"
              className="frames-row"
              aria-current={selected || undefined}
              onClick={() => {
                onSelect(frame.id);
                flyTo(frame);
              }}
              onMouseEnter={() => layerHover.set(frame.id)}
              onMouseLeave={() => layerHover.clearPanel()}
              onFocus={() => layerHover.set(frame.id)}
              onBlur={() => layerHover.clearPanel()}
            >
              <span className="frames-row__index" aria-hidden="true">{i + 1}</span>
              <FrameThumb frame={frame} objects={deferredObjects} />
              <span className="frames-row__name">
                {frame.type === 'frame' && frame.icon && <Emoji native={frame.icon} size={13} />}
                <span className="frames-row__text">{nodeLabel(frame)}</span>
              </span>
              <span className="frames-row__count" aria-label={`${children.length} object${children.length === 1 ? '' : 's'}`}>
                {children.length}
              </span>
            </button>
          </li>
        );
      })}
      <li className="frames-list__foot" aria-hidden="true">
        <FrameIcon size={12} /> Alt+↑ / Alt+↓ steps through frames
      </li>
    </ol>
  );
};
