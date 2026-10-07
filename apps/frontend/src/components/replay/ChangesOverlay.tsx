import React, { useEffect, useMemo, useState } from 'react';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { nodeBounds } from '../../engine/SceneGraph';
import { normalizeNode } from '../../engine/document/normalize';
import { nodeLabel } from '../../engine/model/nodeLabel';
import type { FrameDiff } from '../../engine/history/diff';
import type { Frame, ObjectJson } from '../../engine/history/frames';

interface Props {
  diff: FrameDiff;
  /** The frame on screen: added and modified objects are read from it. */
  frame: Frame;
  /** The frame compared against: removed objects are read from it. */
  base: Frame;
}

interface Box {
  id: string;
  kind: 'added' | 'removed' | 'modified';
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  label: string;
}

/** Bounds and names, memoised per object entry: entries are immutable. */
const measured = new WeakMap<ObjectJson, { box: ReturnType<typeof nodeBounds>; label: string } | null>();

function measure(json: ObjectJson | undefined, id: string) {
  if (!json) return null;
  if (measured.has(json)) return measured.get(json)!;
  let result: { box: ReturnType<typeof nodeBounds>; label: string } | null = null;
  try {
    const node = normalizeNode(json as Record<string, unknown>, id);
    if (node && node.type !== 'comment') result = { box: nodeBounds(node), label: nodeLabel(node) };
  } catch {
    result = null;
  }
  measured.set(json, result);
  return result;
}

/** Past this, outlines stop being a reading aid and become a texture. */
const MAX_BOXES = 400;

/**
 * Change highlighting over the canvas: added objects in green, removed ones
 * ghosted in red with their name, modified ones in ink.
 *
 * Plain SVG in screen space, redrawn when the camera moves. The removed
 * objects themselves are drawn by the canvas as faded ghosts (see the timeline
 * component); this adds the outline and the name that say what they are.
 */
export const ChangesOverlay: React.FC<Props> = ({ diff, frame, base }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    let raf: number | null = null;
    const onCamera = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        setTick((t) => t + 1);
      });
    };
    engineEvents.on('CameraChanged', onCamera);
    return () => {
      engineEvents.off('CameraChanged', onCamera);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  const boxes = useMemo(() => {
    const out: Box[] = [];
    const push = (id: string, kind: Box['kind'], json: ObjectJson | undefined) => {
      if (out.length >= MAX_BOXES) return;
      const m = measure(json, id);
      if (!m) return;
      out.push({ id, kind, ...m.box, label: m.label });
    };
    diff.removed.forEach((id) => push(id, 'removed', base[id]));
    diff.added.forEach((id) => push(id, 'added', frame[id]));
    diff.modified.forEach((id) => push(id, 'modified', frame[id]));
    return out;
  }, [diff, frame, base]);

  if (boxes.length === 0) return null;

  const { x: cx, y: cy, zoom } = cameraSystem;
  const pad = 4;

  return (
    <svg className="replay-changes" aria-hidden="true">
      {boxes.map((b) => {
        const x = b.minX * zoom + cx - pad;
        const y = b.minY * zoom + cy - pad;
        const w = Math.max(2, (b.maxX - b.minX) * zoom + pad * 2);
        const h = Math.max(2, (b.maxY - b.minY) * zoom + pad * 2);
        return (
          <g key={`${b.kind}:${b.id}`} className={`replay-changes__item replay-changes__item--${b.kind}`}>
            <rect x={x} y={y} width={w} height={h} rx={4} />
            {b.kind === 'removed' && w > 48 && (
              <text x={x + 6} y={y - 6}>
                Removed · {b.label.length > 32 ? `${b.label.slice(0, 31)}…` : b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};
