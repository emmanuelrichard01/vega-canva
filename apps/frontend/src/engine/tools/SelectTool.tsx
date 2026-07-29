import { Rect } from 'react-konva';
import type {  Tool, ToolContext  } from './Tool';

export class SelectTool implements Tool {
  id = 'select';
  cursor = 'default';

  private isMarquee = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private additive = false;

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target.getStage();
    // Only start marquee if clicking on the background (the Stage)
    if (e.target === stage) {
      this.isMarquee = true;
      this.additive = !!e.evt?.shiftKey;
      const pos = this.getPointerPos(ctx, e);
      this.startX = pos.x;
      this.startY = pos.y;
      this.currentX = pos.x;
      this.currentY = pos.y;
      ctx.setOverlayState?.({ type: 'marquee', startX: this.startX, startY: this.startY, currentX: this.currentX, currentY: this.currentY });
    }
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (this.isMarquee) {
      const pos = this.getPointerPos(ctx, e);
      this.currentX = pos.x;
      this.currentY = pos.y;
      ctx.setOverlayState?.({ type: 'marquee', startX: this.startX, startY: this.startY, currentX: this.currentX, currentY: this.currentY });
    }
  }

  onPointerUp(ctx: ToolContext) {
    if (this.isMarquee) {
      this.isMarquee = false;
      ctx.setOverlayState?.(null);
      
      const width = Math.abs(this.currentX - this.startX);
      const height = Math.abs(this.currentY - this.startY);
      
      if (width < 5 && height < 5) {
        // Just a click on empty background. A plain click clears the
        // selection; a shift+click on empty space is a no-op (nothing to
        // add or remove from the selection).
        if (!this.additive) {
          document.dispatchEvent(new CustomEvent('requestSelectNode', { detail: { id: null } }));
        }
        return;
      }

      const minX = Math.min(this.startX, this.currentX);
      const maxX = Math.max(this.startX, this.currentX);
      const minY = Math.min(this.startY, this.currentY);
      const maxY = Math.max(this.startY, this.currentY);

      // Collect every object under the marquee box; Canvas.tsx's
      // marqueeSelect listener resolves ids to the actual selection, either
      // replacing it or merging into it depending on `additive`.
      document.dispatchEvent(new CustomEvent('marqueeSelect', {
        detail: { minX, minY, maxX, maxY, additive: this.additive }
      }));
    }
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type === 'marquee') {
      
      return (
        <Rect
          x={Math.min(overlayState.startX, overlayState.currentX)}
          y={Math.min(overlayState.startY, overlayState.currentY)}
          width={Math.abs(overlayState.currentX - overlayState.startX)}
          height={Math.abs(overlayState.currentY - overlayState.startY)}
          fill="rgba(59, 130, 246, 0.1)"
          stroke="#3B82F6"
          strokeWidth={1}
          listening={false}
        />
      );
    }
    return null;
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    return {
      x: (pos.x - ctx.camera.x) / ctx.camera.zoom,
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom
    };
  }
}
