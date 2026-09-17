import React from 'react';
import type { Tool, ToolContext } from './Tool';
import { finishCreation } from './toolModes';
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
  private isAlt = false;

  private box() {
    if (this.isAlt) {
      const halfW = Math.abs(this.currentX - this.startX);
      const halfH = Math.abs(this.currentY - this.startY);
      return {
        x: this.startX - halfW,
        y: this.startY - halfH,
        width: halfW * 2,
        height: halfH * 2,
      };
    }
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
    this.isAlt = Boolean(e.evt?.altKey);
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
    this.isAlt = Boolean(e.evt?.altKey);
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
    this.isAlt = false;
    ctx.setOverlayState?.({ active: false });

    const drawn = this.box();
    // A click rather than a drag still means "put a grid here"
    const box = drawn.width < 24 || drawn.height < 24
      ? { x: this.startX, y: this.startY, ...CLICK_SIZE }
      : drawn;

    const recipe = gridDefaults.forBox(box);
    // One node, selected as one thing. The group version selected N cells, so
    // the very first gesture after drawing a grid was a multi-select drag --
    // which is the gesture that scattered the gaps.
    const id = createGrid(box, recipe);
    if (id) {
      gridDefaults.remember(recipe);
      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [id] } }));
    }

    finishCreation();
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'Escape' && this.isDragging) {
      this.isDragging = false;
      this.isAlt = false;
      ctx.setOverlayState?.({ active: false });
      return;
    }

    // Dynamic track adjustment during live drag (like Illustrator / InDesign)
    if (this.isDragging) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.adjustRows(ctx, +1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.adjustRows(ctx, -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.adjustColumns(ctx, +1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.adjustColumns(ctx, -1);
      }
    }
  }

  private adjustColumns(ctx: ToolContext, delta: number) {
    const snap = gridDefaults.getSnapshot();
    const newCols = Math.max(1, Math.min(24, Math.round(snap.spec.columns + delta)));
    gridDefaults.remember({
      spec: { ...snap.spec, columns: newCols, x: 0, y: 0, width: 0, height: 0 },
      style: snap.style,
    });
    this.pushOverlay(ctx);
  }

  private adjustRows(ctx: ToolContext, delta: number) {
    const snap = gridDefaults.getSnapshot();
    const newRows = Math.max(1, Math.min(24, Math.round(snap.spec.rows + delta)));
    gridDefaults.remember({
      spec: { ...snap.spec, rows: newRows, x: 0, y: 0, width: 0, height: 0 },
      style: snap.style,
    });
    this.pushOverlay(ctx);
  }

  onDeactivate(ctx: ToolContext) {
    this.isDragging = false;
    this.isAlt = false;
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
