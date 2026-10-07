import type { Tool, ToolContext } from './Tool';
import { engineEvents } from '../EventBus';
import { spatialIndex } from '../SpatialIndex';
import { compareStacking } from '../model/stacking';
import { anchorFor } from '../comments/threads';
import type { AnyNode } from '../model/schema';

/**
 * Drops a comment where the board is clicked.
 *
 * A click on an object attaches the thread to that object, at the spot that
 * was clicked, so the pin travels with it. A click on empty board leaves a
 * free-standing pin at that point. The composer itself lives in
 * `CommentsOverlay`, which listens for `CommentDraftRequested`.
 */

/** Types a comment attaches to. Lines and connectors are too thin to aim at. */
const ANCHORABLE = (node: AnyNode) => node.type !== 'connector' && node.type !== 'comment' && !node.hidden;

/** The topmost anchorable object under a world point, preferring content over frames. */
export function commentTargetAt(x: number, y: number): AnyNode | null {
  const hits = spatialIndex
    .query({ minX: x, minY: y, maxX: x, maxY: y })
    .filter(ANCHORABLE)
    .sort(compareStacking);
  if (hits.length === 0) return null;
  const content = hits.filter((n) => n.type !== 'frame');
  return (content.length ? content : hits)[(content.length ? content : hits).length - 1];
}

export class CommentTool implements Tool {
  id = 'comment';
  cursor = 'crosshair';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const x = (pos.x - ctx.camera.x) / ctx.camera.zoom;
    const y = (pos.y - ctx.camera.y) / ctx.camera.zoom;
    if (isNaN(x) || isNaN(y)) return;

    const target = commentTargetAt(x, y);
    if (target) {
      engineEvents.emit('CommentDraftRequested', {
        x,
        y,
        objectId: target.id,
        anchor: anchorFor({ x, y }, target),
      });
      return;
    }
    engineEvents.emit('CommentDraftRequested', { x, y });
  }

  onPointerMove() {}
  onPointerUp() {}
}
