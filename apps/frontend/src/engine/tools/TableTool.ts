import type { Tool, ToolContext } from './Tool';
import { createTable, tableSizeFor, TABLE_MIN_SIZE, TABLE_ROW_H } from '../table/tableApply';
import { defaultTableSpec, type TableSpec } from '../table/tableTypes';
import { tableExampleById } from '../table/tableExamples';
import { useStore } from '../../hooks/useStore';

/**
 * Drawing a table.
 *
 * The same two gestures as the chart and grid tools: drag to size it, click
 * for a table at its natural size. The number of rows follows the drag — a
 * tall drag is a long table — so the grid that lands already has room for
 * what the person was about to type, at a comfortable row height.
 *
 * The cells open for editing the moment it lands, because the only reason to
 * make an empty table is to fill it.
 *
 * ## Presets
 *
 * The dock's flyout arms the tool with an example (`tableExamples.ts`), the
 * way the chart flyout arms a kind — a choice about the next drag, remembered
 * until another is made, rather than twenty tools. An example keeps its own
 * rows: a drag sets its width, and its height stays whole rows at a readable
 * height, because squeezing an eight-row tracker into a short drag makes
 * every row unreadable. A filled table lands selected rather than open — the
 * point of starting from one is to look at it first.
 */
export class TableTool implements Tool {
  /** `'blank'`, or the id of a table example. */
  static preset = 'blank';

  id = 'table';
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
    this.startX = this.currentX = pos.x;
    this.startY = this.currentY = pos.y;
    this.pushOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDragging) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDragging) return;
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });

    const drawn = this.box();
    const tooSmall = drawn.width < TABLE_MIN_SIZE.width || drawn.height < TABLE_MIN_SIZE.height;
    // Rows follow the drag at a readable height; a click gets four.
    const rows = tooSmall ? 4 : Math.max(2, Math.min(40, Math.round(drawn.height / 36)));
    const cols = tooSmall ? 4 : Math.max(1, Math.min(12, Math.round(drawn.width / 150)));
    const example = tableExampleById(TableTool.preset);
    const spec: TableSpec = example ? (JSON.parse(JSON.stringify(example.spec)) as TableSpec) : defaultTableSpec(rows, cols);
    const natural = tableSizeFor(spec);
    const box = tooSmall
      ? { x: this.startX, y: this.startY, ...natural }
      : example
        ? { ...drawn, height: spec.cells.length * TABLE_ROW_H }
        : drawn;

    const id = createTable(box, spec);
    if (id) {
      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [id] } }));
      if (!example) useStore.getState().setTableEditNodeId(id);
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
    // The chart tool's overlay: a sized box is a sized box.
    ctx.setOverlayState?.({ type: 'chart', kind: 'table', active: true, ...this.box() });
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const p = stage?.getRelativePointerPosition?.();
    return p ?? ctx.camera?.screenToWorld?.(e.evt?.clientX ?? 0, e.evt?.clientY ?? 0) ?? null;
  }
}
