import * as React from 'react';
import { Rect } from 'react-konva';
import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import { finishCreation } from './toolModes';
import { ThemeService } from '../ThemeService';
import { DEFAULT_TYPOGRAPHY } from '../model/schema';
import { requestEditOnMount } from '../interaction/pendingEdit';
import { gridSnap } from '../interaction/gridSnap';
import { typographyForNextText } from './TextToolStyles';
import { hud } from '../ui/hud';

/** Below this, a gesture was a click asking for an auto-width caret. */
const MIN_DRAG = 8;
/**
 * What an auto-width box starts at before the first character is measured.
 *
 * Matches the floor `NodeEditor` clamps a growing box to, so the caret does
 * not appear in a box narrower than the editor will ever allow — and so the
 * placeholder has somewhere to sit.
 */
/**
 * Wide enough for the placeholder to actually fit.
 *
 * This was 40, under a comment saying the seed exists "so the placeholder has
 * somewhere to sit" — but "Type something…" needs roughly three times that, so
 * the hint was clipped mid-word in the box that was sized to hold it.
 *
 * Costs nothing to be generous: an auto-width box takes its real width from
 * the first thing typed, and an empty one is discarded rather than left on the
 * board, so this size is only ever seen while the box is empty.
 */
const SEED_WIDTH = 150;
const SEED_HEIGHT = 40;

/**
 * The seed width for a size: room for the placeholder at that size, so a
 * Title's hint is not clipped in a box measured for Body.
 */
export function seedWidth(fontSize: number): number {
  return Math.max(SEED_WIDTH, Math.ceil(fontSize * 6.25));
}

/**
 * Placing text.
 *
 * ## Two gestures, two kinds of text box
 *
 * Click and you get a box that **grows with what you type** — no wrapping, no
 * decision to make, which is what you want when you are labelling something.
 * Drag and you get a box **of the width you drew**, wrapping and growing
 * downward, which is what you want when you are writing a paragraph into a
 * layout.
 *
 * This tool only ever did the second, at a hardcoded 240×40 regardless of the
 * gesture — so every label began life as a fixed-width block that wrapped at a
 * width nobody chose, and the three-way `resize` control existed with no way
 * to arrive at two of its states except by changing it afterwards.
 *
 * ## Why the caret arrives by latch
 *
 * The old implementation created the node, then fired `requestEditNode` inside
 * a `setTimeout(…, 50)`. That is the race `pendingEdit.ts` exists to remove:
 * the renderer has not mounted, nothing is listening, and fifty milliseconds
 * is a guess that fails exactly when the board is busy. The latch is claimed
 * before the node exists and consumed by the renderer during its own first
 * render, which has no window to miss.
 */
export class TextTool implements Tool {
  id = 'text';
  cursor = 'text';

  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

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
    hud.hide('text');

    const box = this.box();
    const dragged = box.width > MIN_DRAG && box.height > MIN_DRAG;

    const typography = typographyForNextText({
      ...DEFAULT_TYPOGRAPHY,
      color: ThemeService.getDefaultTextColor(),
    });

    const id = nanoid();
    // Claimed before the node exists — see the note above.
    requestEditOnMount(id);

    ctx.editor.createNode({
      id,
      type: 'text',
      x: dragged ? box.x : this.startX,
      y: dragged ? box.y : this.startY,
      // An auto-width box is seeded narrow and takes its real width from the
      // first thing typed into it; giving it 240 up front would make an empty
      // caret sit in the middle of a box that is not there. Its height is one
      // line of the style it is made in, so a Title's caret is a Title's
      // height from the first frame rather than growing on the first key.
      width: dragged ? box.width : seedWidth(typography.fontSize),
      height: dragged ? box.height : Math.max(SEED_HEIGHT, Math.ceil(typography.fontSize * typography.lineHeight)),
      text: '',
      // The gesture chooses the behaviour, which is the whole point of having
      // two of them.
      resize: dragged ? 'height' : 'width',
      // In the style and face last chosen: see `TextToolStyles`.
      typography,
    });

    ctx.editor.select(id);
    finishCreation();
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'Escape' && this.isDragging) {
      this.isDragging = false;
      ctx.setOverlayState?.({ active: false });
      hud.hide('text');
    }
  }

  onDeactivate(ctx: ToolContext) {
    // Switching tool mid-drag never fires `onPointerUp`, which would leave the
    // preview stranded on the board.
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });
    hud.hide('text');
  }

  renderOverlay(_ctx: ToolContext, overlayState: any) {
    if (!overlayState?.active || !overlayState.box) return null;
    const { x, y, width, height } = overlayState.box;
    if (width <= MIN_DRAG || height <= MIN_DRAG) return null;
    return (
      // Dashed with subtle tint, showing the column and area the words will flow into.
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        stroke="#2563EB"
        strokeWidth={1.5}
        dash={[5, 4]}
        fill="rgba(37, 99, 235, 0.06)"
        cornerRadius={2}
        listening={false}
      />
    );
  }

  private box() {
    let ax = this.startX;
    let ay = this.startY;
    let bx = this.currentX;
    let by = this.currentY;
    if (gridSnap.shouldSnap()) {
      const a = gridSnap.snapPoint(ax, ay);
      const b = gridSnap.snapPoint(bx, by);
      ax = a.x; ay = a.y; bx = b.x; by = b.y;
    }
    return {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
    };
  }

  private pushOverlay(ctx: ToolContext) {
    const box = this.box();
    ctx.setOverlayState?.({ active: true, box });
    // A drag is a fixed-width box: its width is the decision, so the HUD says
    // it. A click is auto width, which has no size to show yet.
    if (box.width > MIN_DRAG && box.height > MIN_DRAG) {
      hud.show({
        source: 'text',
        kind: 'size',
        value: { width: box.width, height: box.height },
        at: { x: this.currentX, y: this.currentY },
        box,
      });
    } else {
      hud.hide('text');
    }
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return ctx.camera.screenToWorld(pos.x, pos.y);
  }
}
