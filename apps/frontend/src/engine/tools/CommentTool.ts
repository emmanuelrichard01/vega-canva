import type { Tool, ToolContext } from './Tool';
import { engineEvents } from '../EventBus';

/**
 * CommentTool — places a new comment thread on the canvas.
 *
 * Previously the Comment button only changed the cursor: `addComment()` existed in
 * useComments but nothing anywhere called it, so no thread could ever be created.
 * This tool closes that gap. It doesn't create the thread directly — it emits the
 * world-space point so CommentsOverlay can open a composer there, which means an
 * empty thread is never written to the doc if the user changes their mind.
 */
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

    engineEvents.emit('CommentDraftRequested', { x, y });
  }

  onPointerMove() {}
  onPointerUp() {}
}
