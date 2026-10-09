import { Group, Rect, Text } from 'react-konva';
import type { Tool, ToolContext } from './Tool';
import { marqueeActivity, marqueeModeFor, type MarqueeMode } from '../interaction/marquee';
import { isDeepSelect } from '../interaction/deepSelect';
import { canvasChromeContrast } from '../ui/contrast';
import { chromeSurfaceColor, chromeToken, HALO_PX } from '../interaction/chromeHalo';
import '../../components/canvas/selectChrome.css';

/** What each combining mode shows beside the cursor. Replace shows nothing. */
const MODE_GLYPH: Partial<Record<MarqueeMode, string>> = { add: '+', subtract: '−', intersect: '×' };

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
  /** Ctrl/Cmd held: the marquee catches objects, not whole groups. */
  private deep = false;

  onPointerDown(ctx: ToolContext, e: any) {
    const stage = e.target.getStage?.() ?? e.target;
    // A marquee starts only from the board itself, never from an object.
    if (e.target === stage) {
      this.isMarquee = true;
      this.mode = marqueeModeFor(e.evt);
      this.deep = isDeepSelect(e.evt);
      marqueeActivity.set(true);
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
      this.deep = isDeepSelect(e.evt);
      this.publish(ctx);
    }
  }

  onPointerUp(ctx: ToolContext) {
    if (this.isMarquee) {
      this.isMarquee = false;
      marqueeActivity.set(false);
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
        detail: { minX, minY, maxX, maxY, mode: this.mode, additive: this.mode === 'add', deep: this.deep }
      }));
    }
  }

  onDeactivate() {
    this.isMarquee = false;
    marqueeActivity.set(false);
  }

  /** A marquee interrupted by a pinch or a long-press selects nothing. */
  onCancel(ctx: ToolContext) {
    if (!this.isMarquee) return;
    this.isMarquee = false;
    marqueeActivity.set(false);
    ctx.setOverlayState?.(null);
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type === 'marquee') {
      const zoom = ctx.camera.zoom || 1;
      const x = Math.min(overlayState.startX, overlayState.currentX);
      const y = Math.min(overlayState.startY, overlayState.currentY);
      const width = Math.abs(overlayState.currentX - overlayState.startX);
      const height = Math.abs(overlayState.currentY - overlayState.startY);
      const mode: MarqueeMode = overlayState.mode;
      const glyph = MODE_GLYPH[mode];

      // Read per draw: the overlay re-renders on every pointer move, so a
      // contrast or theme change shows on the next one.
      const { strokeScale, halo } = canvasChromeContrast();
      const line = strokeScale / zoom;
      const colour = chromeToken('--canvas-marquee', '#3B82F6');
      // Each removing mode has its own line: subtract is dashed, intersect is
      // dotted and heavier, so the two read apart before release.
      const dash =
        mode === 'subtract' ? [4 / zoom, 3 / zoom] : mode === 'intersect' ? [1 / zoom, 3 / zoom] : undefined;
      const stroke = mode === 'intersect' ? line * 1.75 : line;

      const px = 1 / zoom;
      const pill = 16 * px;
      const gx = overlayState.currentX + 14 * px;
      const gy = overlayState.currentY + 14 * px;

      return (
        <Group listening={false}>
          {halo && (
            <Rect
              x={x}
              y={y}
              width={width}
              height={height}
              stroke={chromeSurfaceColor()}
              strokeWidth={stroke + (2 * HALO_PX) / zoom}
              cornerRadius={2 / zoom}
              listening={false}
            />
          )}
          <Rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill={chromeToken('--canvas-marquee-fill', 'rgba(59, 130, 246, 0.08)')}
            stroke={colour}
            strokeWidth={stroke}
            dash={dash}
            lineCap={mode === 'intersect' ? 'round' : undefined}
            cornerRadius={2 / zoom}
            listening={false}
          />
          {glyph && (
            <>
              <Rect
                x={gx}
                y={gy}
                width={pill}
                height={pill}
                cornerRadius={4 * px}
                fill={chromeToken('--canvas-marquee-glyph', '#18181B')}
                listening={false}
              />
              <Text
                x={gx}
                y={gy}
                width={pill}
                height={pill}
                align="center"
                verticalAlign="middle"
                text={glyph}
                fontSize={13 * px}
                fontStyle="600"
                fontFamily="Inter, sans-serif"
                fill={chromeToken('--canvas-marquee-glyph-ink', '#FFFFFF')}
                listening={false}
                perfectDrawEnabled={false}
              />
            </>
          )}
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
      deep: this.deep,
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
