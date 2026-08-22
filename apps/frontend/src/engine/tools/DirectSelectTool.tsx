import { Rect } from 'react-konva';
import type { Tool, ToolContext } from './Tool';
import { pathEdit } from '../interaction/pathEdit';
import { useStore } from '../../hooks/useStore';
import { anchorsInRect, mergeAnchors } from '../model/pathEditing';

/**
 * Direct selection — the white arrow.
 *
 * ## Features:
 * - Click path / shape: opens it for anchor editing (auto-flattens shapes).
 * - Click, hold & drag: marquee selects multiple anchor points across the path.
 * - Shift+Click / Ctrl+Click / Cmd+Click: multi-selects and adds more points.
 * - Click empty board: exits path editing mode and clears selection.
 */
export class DirectSelectTool implements Tool {
  id = 'direct-select';
  cursor = 'crosshair';

  private isDown = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private isMarquee = false;
  private isAdditive = false;

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e?.target?.getStage?.();
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    return {
      x: (pos.x - ctx.camera.x) / ctx.camera.zoom,
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom,
    };
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    if (e.target === stage) {
      this.isDown = true;
      const pos = this.getPointerPos(ctx, e);
      this.startX = pos.x;
      this.startY = pos.y;
      this.currentX = pos.x;
      this.currentY = pos.y;
      this.isMarquee = false;
      this.isAdditive = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);
    }
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDown) return;
    const pos = this.getPointerPos(ctx, e);
    this.currentX = pos.x;
    this.currentY = pos.y;

    const dist = Math.hypot(this.currentX - this.startX, this.currentY - this.startY);
    if (dist > 3) {
      this.isMarquee = true;
      ctx.setOverlayState?.({
        type: 'marquee',
        startX: this.startX,
        startY: this.startY,
        currentX: this.currentX,
        currentY: this.currentY,
      });

      // If no path is currently active, look for any path or shape that intersects the marquee
      let activeSnapshot = pathEdit.getSnapshot();
      if (!activeSnapshot) {
        const objects = useStore.getState().objects;
        const x1 = Math.min(this.startX, this.currentX);
        const x2 = Math.max(this.startX, this.currentX);
        const y1 = Math.min(this.startY, this.currentY);
        const y2 = Math.max(this.startY, this.currentY);
        const marqueeBox = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };

        for (const obj of Object.values(objects)) {
          if (!obj || obj.locked) continue;
          if (obj.type === 'path' && obj.geometry.kind !== 'freehand') {
            const found = anchorsInRect(obj.geometry, {
              x: marqueeBox.x - obj.x,
              y: marqueeBox.y - obj.y,
              width: marqueeBox.width,
              height: marqueeBox.height,
            });
            if (found.length > 0) {
              pathEdit.enter(obj.id);
              pathEdit.select(found);
              ctx.editor.select(obj.id);
              activeSnapshot = pathEdit.getSnapshot();
              break;
            }
          }
        }
      }

      if (activeSnapshot) {
        const node = useStore.getState().objects[activeSnapshot.nodeId];
        if (node && node.type === 'path' && node.geometry.kind !== 'freehand') {
          const x1 = Math.min(this.startX, this.currentX) - node.x;
          const x2 = Math.max(this.startX, this.currentX) - node.x;
          const y1 = Math.min(this.startY, this.currentY) - node.y;
          const y2 = Math.max(this.startY, this.currentY) - node.y;
          const found = anchorsInRect(node.geometry, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
          pathEdit.select(this.isAdditive ? mergeAnchors(activeSnapshot.anchors, found) : found);
        }
      }
    }
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDown) return;
    this.isDown = false;

    if (!this.isMarquee) {
      // Bare click on empty canvas with no drag: deselect and leave edit mode
      pathEdit.exit();
      ctx.editor.select(null);
    } else {
      ctx.setOverlayState?.(null);
      const activeSnapshot = pathEdit.getSnapshot();
      if (!activeSnapshot) {
        const box = {
          x: Math.min(this.startX, this.currentX),
          y: Math.min(this.startY, this.currentY),
          width: Math.abs(this.currentX - this.startX),
          height: Math.abs(this.currentY - this.startY),
        };
        document.dispatchEvent(new CustomEvent('marqueeSelect', {
          detail: { box, additive: this.isAdditive }
        }));
      }
    }

    this.startX = 0;
    this.startY = 0;
    this.isMarquee = false;
    this.isAdditive = false;
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type === 'marquee') {
      const zoom = ctx.camera?.zoom || 1;
      const x = Math.min(overlayState.startX, overlayState.currentX);
      const y = Math.min(overlayState.startY, overlayState.currentY);
      const width = Math.abs(overlayState.currentX - overlayState.startX);
      const height = Math.abs(overlayState.currentY - overlayState.startY);

      return (
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="rgba(37, 99, 235, 0.12)"
          stroke="#2563EB"
          strokeWidth={1 / zoom}
          cornerRadius={2 / zoom}
          dash={[4 / zoom, 3 / zoom]}
          listening={false}
        />
      );
    }
    return null;
  }

  /**
   * Open whatever path (or shape) was clicked for anchor/handle editing.
   * If a shape was clicked, prompt confirmation before flattening.
   */
  static open(id: string): string | null {
    const node = useStore.getState().objects[id];
    if (!node) return null;

    if (node.type === 'shape') {
      useStore.getState().setFlattenConfirmNodeId(id);
      return null;
    }

    if (node.type === 'path' && node.geometry.kind !== 'freehand') {
      pathEdit.enter(id);
      return id;
    }

    return null;
  }
}
