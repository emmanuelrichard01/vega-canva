import React, { useMemo } from 'react';
import { descendantsOfFrame } from '../../engine/model/frames';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { isPlaceholder } from '../../engine/slides/placeholderText';
import { solidFill } from '../../engine/slides/themes';

/**
 * A slide drawn from the document as a plan: the page in its own colour, text
 * as lines in its own ink, shapes as their fills. Cheap and synchronous, so it
 * stands in wherever the real picture is not worth taking or not yet taken.
 * Kept apart from `SlideThumb` so a surface on the board's first chunk can
 * draw slides without loading the capture path.
 */
export const SlidePlan: React.FC<{
  frame: FrameNode;
  objects: Record<string, AnyNode>;
  showPlaceholders?: boolean;
  /** Objects to leave out, such as the ones a transition preview draws itself. */
  hide?: ReadonlySet<string>;
}> = ({ frame, objects, showPlaceholders = false, hide }) => {
  const members = useMemo(() => {
    const ids = new Set(descendantsOfFrame(frame.id, Object.values(objects)));
    return Object.values(objects)
      .filter((n) => ids.has(n.id) && !n.hidden && !hide?.has(n.id) && (showPlaceholders || !isPlaceholder(n as never)))
      .sort((a, b) => a.zIndex - b.zIndex);
  }, [frame.id, objects, showPlaceholders, hide]);
  const page = solidFill(frame) ?? '#FFFFFF';

  return (
    <svg viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect width={frame.width} height={frame.height} fill={page} />
      {members.map((n) => {
        const x = n.x - frame.x;
        const y = n.y - frame.y;
        const node = n as AnyNode & { text?: string; typography?: { fontSize?: number; color?: string; lineHeight?: number } };
        if (n.type === 'text') {
          const size = node.typography?.fontSize ?? 24;
          const lh = size * (node.typography?.lineHeight ?? 1.3);
          const lines = Math.max(1, Math.min(8, Math.round(n.height / lh)));
          const ink = node.typography?.color ?? '#111827';
          const chars = (node.text ?? '').length;
          const firstWidth = Math.min(n.width, chars * size * 0.52);
          return (
            <g key={n.id} fill={ink} opacity={n.opacity ?? 1}>
              {Array.from({ length: lines }, (_, i) => (
                <rect
                  key={i}
                  x={x}
                  y={y + i * lh + lh * 0.22}
                  width={lines === 1 ? firstWidth : i === lines - 1 ? n.width * 0.6 : n.width}
                  height={size * 0.62}
                  rx={size * 0.12}
                />
              ))}
            </g>
          );
        }
        if (n.type === 'connector') return null;
        const fill = solidFill(n as never) ?? (n.type === 'chart' || n.type === 'table' ? '#94A3B833' : '#94A3B855');
        return <rect key={n.id} x={x} y={y} width={n.width} height={n.height} fill={fill} rx={8} opacity={n.opacity ?? 1} />;
      })}
    </svg>
  );
};
