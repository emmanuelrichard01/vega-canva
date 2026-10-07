import { Group, Rect } from 'react-konva';
import type { Tool, ToolContext } from './Tool';
import { marqueeModeFor, type MarqueeMode } from '../interaction/marquee';
import { canvasChromeContrast } from '../ui/contrast';
import { chromeSurfaceColor, HALO_PX } from '../interaction/chromeHalo';

/** Below this drag, in screen pixels, a press on the board is a click, not a marquee. */
const CLICK_SLOP = 4;

export class SelectTool implements Tool {
  id = 'select';
  cursor = 'default';

  private isMarquee = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  /**
   * What the marquee does with what it catches. Read on every move, so a
   * modifier pressed mid-drag changes the outcome, as it does in Figma.
   */
  private mode: MarqueeMode = 'replace';

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target.getStage?.() ?? e.target;
    // A marquee starts only from the board itself, never from an object.
    if (e.target === stage) {
      this.isMarquee = true;
      this.mode = marqueeModeFor(e.evt);
      const pos = this.getPointerPos(ctx, e);
      this.startX = pos.x;
      this.startY = pos.y;
      this.currentX = pos.x;
      this.currentY = pos.y;
      this.publish(ctx);
    }
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (this.isMarquee) {
      const pos = this.getPointerPos(ctx, e);
      this.currentX = pos.x;
      this.currentY = pos.y;
      this.mode = marqueeModeFor(e.evt);
      this.publish(ctx);
    }
  }

  onPointerUp(ctx: ToolContext) {
    if (this.isMarquee) {
      this.isMarquee = false;
      ctx.setOverlayState?.(null);

      const zoom = ctx.camera.zoom || 1;
      const width = Math.abs(this.currentX - this.startX) * zoom;
      const height = Math.abs(this.currentY - this.startY) * zoom;

      if (width < CLICK_SLOP && height < CLICK_SLOP) {
        // A plain click on the board clears the selection; a modified click
        // on empty space changes nothing.
        if (this.mode === 'replace') {
          document.dispatchEvent(new CustomEvent('requestSelectNode', { detail: { id: null } }));
        }
        return;
      }

      const minX = Math.min(this.startX, this.currentX);
      const maxX = Math.max(this.startX, this.currentX);
      const minY = Math.min(this.startY, this.currentY);
      const maxY = Math.max(this.startY, this.currentY);

      // `useCanvasSelection` resolves the box to ids and combines them with
      // the selection by `mode`. `additive` stays for listeners without modes.
      document.dispatchEvent(new CustomEvent('marqueeSelect', {
        detail: { minX, minY, maxX, maxY, mode: this.mode, additive: this.mode === 'add' }
      }));
    }
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type === 'marquee') {
      const zoom = ctx.camera.zoom || 1;
      const x = Math.min(overlayState.startX, overlayState.currentX);
      const y = Math.min(overlayState.startY, overlayState.currentY);
      const width = Math.abs(overlayState.currentX - overlayState.startX);
      const height = Math.abs(overlayState.currentY - overlayState.startY);
      // Subtracting draws dashed, so the gesture says it removes before release.
      const subtracting = overlayState.mode === 'subtract' || overlayState.mode === 'intersect';

      // Read per draw: the overlay re-renders on every pointer move, so a
      // contrast change shows on the next one.
      const { strokeScale, halo } = canvasChromeContrast();
      const line = strokeScale / zoom;

      return (
        <Group listening={false}>
          {halo && (
            <Rect
              x={x}
              y={y}
              width={width}
              height={height}
              stroke={chromeSurfaceColor()}
              strokeWidth={line + (2 * HALO_PX) / zoom}
              cornerRadius={2 / zoom}
              listening={false}
            />
          )}
          <Rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill="rgba(59, 130, 246, 0.08)"
            stroke="#3B82F6"
            strokeWidth={line}
            dash={subtracting ? [4 / zoom, 3 / zoom] : undefined}
            cornerRadius={2 / zoom}
            listening={false}
          />
        </Group>
      );
    }
    return null;
  }

  private publish(ctx: ToolContext) {
    ctx.setOverlayState?.({
      type: 'marquee',
      startX: this.startX,
      startY: this.startY,
      currentX: this.currentX,
      currentY: this.currentY,
      mode: this.mode,
    });
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target.getStage?.() ?? e.target;
    const pos = stage?.getPointerPosition?.() ?? { x: 0, y: 0 };
    return {
      x: (pos.x - ctx.camera.x) / ctx.camera.zoom,
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom
    };
  }
}
