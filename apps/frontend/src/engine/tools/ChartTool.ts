import type { Tool, ToolContext } from './Tool';
import {
  CHART_DEFAULT_SIZE,
  CHART_MIN_SIZE,
  createChart,
} from '../chart/chartApply';
import { defaultChartSpec, type ChartKind } from '../chart/chartTypes';

/**
 * Drawing a chart.
 *
 * Drag to size it, click for a sensible default — the same two gestures as the
 * frame and grid tools, and deliberately no mode or modifier separating them,
 * because the pointer has already said which is which: a drag is a press and a
 * move, a click is a press and a release in one place.
 *
 * A drag smaller than a chart can legibly be is treated as a click rather than
 * honoured. Honouring it produces a chart whose axis labels overlap its own
 * bars, which reads as a broken feature rather than as a small chart — and the
 * layout refuses to draw below that size anyway, so the alternative is an
 * empty rectangle that the user has to guess how to fix.
 */
export class ChartTool implements Tool {
  id = 'chart';
  cursor = 'crosshair';

  /**
   * Which kind the next chart will be.
   *
   * On the tool rather than in the store, because it is a property of the
   * gesture about to happen and not a document fact. The dock's flyout sets
   * it, the same way the shape tool carries its kind.
   */
  static kind: ChartKind = 'bar';

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
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDragging) return;
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });

    const drawn = this.box();
    const tooSmall = drawn.width < CHART_MIN_SIZE.width || drawn.height < CHART_MIN_SIZE.height;
    const box = tooSmall ? { x: this.startX, y: this.startY, ...CHART_DEFAULT_SIZE } : drawn;

    const id = createChart(box, defaultChartSpec(ChartTool.kind));
    if (id) {
      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [id] } }));
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
    ctx.setOverlayState?.({ type: 'chart', kind: 'chart', active: true, ...this.box() });
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const p = stage?.getRelativePointerPosition?.();
    return p ?? ctx.camera?.screenToWorld?.(e.evt?.clientX ?? 0, e.evt?.clientY ?? 0) ?? null;
  }
}
