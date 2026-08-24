import React from 'react';
import type { Tool, ToolContext } from './Tool';
import { createGrid } from '../grid/gridApply';
import { gridDefaults } from '../grid/gridDefaults';
import { GridPreview } from './GridPreview';

/** A drag smaller than this is a click, and gets a sensible default grid. */
const CLICK_SIZE = { width: 480, height: 360 };

/**
 * Drawing a grid.
 */
export class GridTool implements Tool {
  id = 'grid';
  cursor = 'crosshair';

  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

  private box() {
    return {
      x: Math.min(this.startX, this.currentX),
      y: Math.min(this.startY, this.currentY),
      width: Math.abs(this.currentX - this.startX),
      height: Math.abs(this.currentY - this.startY),
    };
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.isDragging = true;
    this.startX = pos.x;
    this.startY = pos.y;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.pushOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDragging) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.currentX = pos.x;
    this.currentY = pos.y;

    // Shift constrains to a square, matching every other box-drag tool.
    if (e.evt?.shiftKey) {
      const dx = this.currentX - this.startX;
      const dy = this.currentY - this.startY;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      this.currentX = this.startX + Math.sign(dx) * size;
      this.currentY = this.startY + Math.sign(dy) * size;
    }
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDragging) return;
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });

    const drawn = this.box();
    // A click rather than a drag still means "put a grid here"
    const box = drawn.width < 24 || drawn.height < 24
      ? { x: this.startX, y: this.startY, ...CLICK_SIZE }
      : drawn;

    const recipe = gridDefaults.forBox(box);
    const made = createGrid(recipe);
    if (made) {
      gridDefaults.remember(recipe);
      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: made.ids } }));
    }

    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'Escape' && this.isDragging) {
      this.isDragging = false;
      ctx.setOverlayState?.({ active: false });
    }
  }

  onDeactivate(ctx: ToolContext) {
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });
  }

  private pushOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({ type: 'grid', kind: 'grid', active: true, ...this.box() });
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (!overlayState?.active || overlayState.kind !== 'grid') return null;
    const scale = (ctx.camera as { zoom?: number })?.zoom ?? 1;
    return React.createElement(GridPreview, { ...this.box(), scale });
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const p = stage?.getRelativePointerPosition?.();
    return p ?? ctx.camera?.screenToWorld?.(e.evt?.clientX ?? 0, e.evt?.clientY ?? 0) ?? null;
  }
}

export { GridPreview };
