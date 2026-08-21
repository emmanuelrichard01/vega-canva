import { Group, Rect, Text } from 'react-konva';
import * as React from 'react';
import type { Tool, ToolContext } from './Tool';
import { createGrid } from '../grid/gridApply';
import { defaultSpec, layoutGrid } from '../grid/gridLayout';
import { defaultStyle, GRID_PALETTES, styleCells } from '../grid/gridStyle';
import { gridDefaults } from '../grid/gridDefaults';

/** A drag smaller than this is a click, and gets a sensible default grid. */
const CLICK_SIZE = { width: 480, height: 360 };

/**
 * Drawing a grid.
 *
 * ## Why the preview draws the actual cells
 *
 * Every other box-drag tool in the app previews an outline, because an outline
 * is what it makes. This one makes twelve or thirty things, and the arrangement
 * is the entire point of the tool — so a preview showing only the bounding box
 * would hide the one thing you are deciding while you drag. The cells are laid
 * out on every move with the same function that will make them, which is
 * affordable precisely because that function is pure arithmetic over a handful
 * of numbers.
 *
 * ## Why the last settings are remembered
 *
 * A generator that resets to three grey squares every time is a generator you
 * configure once per use. `gridDefaults` carries the last recipe forward, so
 * drawing a second grid gives you the one you just tuned — and the panel is for
 * changing it, not for rebuilding it.
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
    // A click rather than a drag still means "put a grid here" — refusing it
    // would make the tool feel broken for the most impatient way to use it.
    const box = drawn.width < 24 || drawn.height < 24
      ? { x: this.startX, y: this.startY, ...CLICK_SIZE }
      : drawn;

    const recipe = gridDefaults.forBox(box);
    const made = createGrid(recipe);
    if (made) {
      gridDefaults.remember(recipe);
      /**
       * Select what was just drawn.
       *
       * Without this the tool produced a grid and left nothing selected, so the
       * panel that exists to adjust it never opened — you had to guess that
       * clicking a cell would reveal it. Selecting the members (rather than the
       * group, which is not a node) is what every other creation tool does.
       */
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
    // A keyboard tool-switch mid-drag never fires onPointerUp, which would
    // leave the preview stuck on screen.
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });
  }

  private pushOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({ type: 'grid', kind: 'grid', active: true, ...this.box() });
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (!overlayState?.active || overlayState.kind !== 'grid') return null;
    const scale = (ctx.camera as { zoom?: number })?.zoom ?? 1;
    return <GridPreview {...this.box()} scale={scale} />;
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const p = stage?.getRelativePointerPosition?.();
    return p ?? ctx.camera?.screenToWorld?.(e.evt?.clientX ?? 0, e.evt?.clientY ?? 0) ?? null;
  }
}

/**
 * The preview: the cells themselves, at a whisper.
 *
 * Drawn from the same layout the tool will commit, so what you release on is
 * what you get. Held to a low opacity and a single accent so it reads as a
 * proposal rather than as objects already placed — the moment a preview looks
 * finished, people stop dragging and start wondering why they cannot click it.
 */
export const GridPreview: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}> = ({ x, y, width, height, scale }) => {
  if (width < 4 || height < 4) return null;
  const recipe = gridDefaults.forBox({ x, y, width, height });
  const cells = styleCells(layoutGrid(recipe.spec), recipe.style);

  return (
    <Group listening={false}>
      {cells.map((cell, i) => (
        <Rect
          key={i}
          x={cell.x}
          y={cell.y}
          width={cell.width}
          height={cell.height}
          fill={cell.fill}
          opacity={0.5}
          cornerRadius={cell.radius}
          perfectDrawEnabled={false}
        />
      ))}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        stroke="#F97316"
        strokeWidth={1 / scale}
        dash={[6 / scale, 4 / scale]}
        perfectDrawEnabled={false}
      />
      {/* The count, because "how many modules is this" is the question the
          numbers on a size readout cannot answer and the one being decided. */}
      <Text
        x={x}
        y={y - 20 / scale}
        text={`${cells.length} · ${Math.round(width)} × ${Math.round(height)}`}
        fontSize={12 / scale}
        fontStyle="600"
        fill="#F97316"
        perfectDrawEnabled={false}
      />
    </Group>
  );
};

/** Palette swatches for the tool's own flyout, so a grid can be aimed before it is drawn. */
export const GRID_TOOL_PALETTES = GRID_PALETTES;
export { defaultSpec, defaultStyle };
