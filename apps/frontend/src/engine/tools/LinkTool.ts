import type { Tool, ToolContext } from './Tool';
import { finishCreation } from './toolModes';
import { useStore } from '../../hooks/useStore';

/**
 * The link tool: click where the link should go, then paste or type it.
 *
 * Most links arrive by paste and never touch this tool. It exists for the
 * other case — you know where the reference belongs before you have it on the
 * clipboard — and so what it opens is a single field at the spot you clicked,
 * with the clipboard's link offered if there is one.
 */
export class LinkTool implements Tool {
  id = 'link';
  cursor = 'crosshair';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const p = stage?.getRelativePointerPosition?.() ?? ctx.camera?.screenToWorld?.(e.evt?.clientX ?? 0, e.evt?.clientY ?? 0);
    if (!p) return;
    useStore.getState().setLinkComposer({
      clientX: e.evt?.clientX ?? window.innerWidth / 2,
      clientY: e.evt?.clientY ?? window.innerHeight / 2,
      x: p.x,
      y: p.y,
    });
    finishCreation();
  }

  onPointerMove() {}

  onPointerUp() {}
}
