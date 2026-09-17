import type { Tool, ToolContext } from './Tool';
import { finishCreation } from './toolModes';
import { createCode } from '../code/codeApply';
import { useStore } from '../../hooks/useStore';

/**
 * The code block tool.
 *
 * A click places a block ready to type into; a drag sets its width, which is
 * the one dimension of a code block that is a choice — its height is its lines.
 * Either way the editor opens at once, because an empty code block has exactly
 * one next step.
 */
export class CodeTool implements Tool {
  /** The language a new block starts in: the last one chosen on this board. */
  static language = 'typescript';

  id = 'code';
  cursor = 'crosshair';

  private dragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

  onPointerDown(ctx: ToolContext, e: any) {
    const p = this.pointer(ctx, e);
    if (!p) return;
    this.dragging = true;
    this.startX = this.currentX = p.x;
    this.startY = this.currentY = p.y;
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.dragging) return;
    const p = this.pointer(ctx, e);
    if (!p) return;
    this.currentX = p.x;
    this.currentY = p.y;
    const width = Math.abs(this.currentX - this.startX);
    if (width > 24) {
      ctx.setOverlayState?.({
        type: 'chart',
        kind: 'table',
        active: true,
        x: Math.min(this.startX, this.currentX),
        y: this.startY,
        width,
        height: 160,
      });
    }
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.dragging) return;
    this.dragging = false;
    ctx.setOverlayState?.({ active: false });
    const width = Math.abs(this.currentX - this.startX);
    const dragged = width > 120;
    const id = createCode(
      dragged ? { x: Math.min(this.startX, this.currentX), y: this.startY } : { x: this.startX, y: this.startY },
      '',
      { language: CodeTool.language, centred: !dragged, width: dragged ? width : 520 }
    );
    window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [id] } }));
    useStore.getState().setCodeEditNodeId(id);
    finishCreation();
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'Escape' && this.dragging) {
      this.dragging = false;
      ctx.setOverlayState?.({ active: false });
    }
  }

  onDeactivate(ctx: ToolContext) {
    this.dragging = false;
    ctx.setOverlayState?.({ active: false });
  }

  private pointer(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const p = stage?.getRelativePointerPosition?.();
    return p ?? ctx.camera?.screenToWorld?.(e.evt?.clientX ?? 0, e.evt?.clientY ?? 0) ?? null;
  }
}
