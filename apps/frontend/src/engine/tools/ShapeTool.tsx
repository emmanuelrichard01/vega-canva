import { Group, Path } from 'react-konva';
import { nanoid } from 'nanoid';
import { ThemeService } from '../ThemeService';
import type { Tool, ToolContext } from './Tool';
import type { EditorAPI } from '../api/EditorAPI';
import { finishCreation } from './toolModes';
import type { ShapeGeometry } from '../model/schema';
import {
  boxAt,
  placedSize,
  presetGeometry,
  shapeEntry,
  type ShapePreset,
} from '../../components/workspace/shapeCatalog';
import { gridSnap } from '../interaction/gridSnap';
import { hud } from '../ui/hud';
import { contourData } from '../model/pathGeometry';
import { shapeToPath } from '../model/shapeToPath';
import { shapeFeaturePaths } from '../model/shapeOutline';
import * as React from 'react';
import { recordRecentShape } from './recentShapes';
import { LineTool } from './LineTool';

/**
 * How a new closed shape looks: the theme's fill and ink, and a corner radius
 * only when the preset's whole promise is the corner.
 *
 * A rectangle is a rectangle. The radius is a control in the panel and on the
 * rail, and the default is the shape's own geometry; rounding is what you add.
 * The one exception is a tile like "Rounded rectangle", which seeds a radius
 * proportional to the size it is placed at. From then on it is an ordinary
 * stored value, so resizing does not reshape a corner somebody has adjusted.
 */
function newShapeAppearance(preset: ShapePreset, width: number, height: number) {
  const ratio = shapeEntry(preset).cornerRadiusRatio;
  return {
    fill: [{ type: 'solid' as const, color: ThemeService.getDefaultShapeFill(), opacity: 1 }],
    stroke: { color: ThemeService.getDefaultStrokeColor(), width: 2 },
    cornerRadius: ratio ? Math.round(Math.min(width, height) * ratio) : 0,
  };
}

/**
 * Place a closed preset centred on a board point, at its natural size, and
 * select it: what a click on the board with the tool armed does, for callers
 * outside the tool. The shape library uses it for a tile dragged onto the
 * board and for Enter on a tile.
 *
 * Writes through `editor.createNode`, the same command path the tool takes, so
 * it is one undo step and passes the document's role gate.
 */
export function placeShapeAt(
  editor: Pick<EditorAPI, 'createNode' | 'select'>,
  preset: ShapePreset,
  at: { x: number; y: number }
): string {
  let { x, y, width, height } = boxAt(preset, at);
  if (gridSnap.shouldSnap()) {
    const snapped = gridSnap.snapPoint(x, y);
    x = snapped.x;
    y = snapped.y;
  }
  const id = nanoid();
  recordRecentShape(preset);
  editor.createNode({
    id,
    type: 'shape',
    x,
    y,
    width,
    height,
    geometry: presetGeometry(preset),
    appearance: newShapeAppearance(preset, width, height),
  });
  editor.select(id);
  return id;
}

/** Minimum drag before a shape is sized by the drag rather than dropped at its own proportions. */
const MIN_DRAG = 5;

export class ShapeTool implements Tool {
  id = 'shape';
  cursor = 'crosshair';

  private isDragging = false;
  /**
   * The line and arrow presets are their own tool.
   *
   * A line is drawn by a different gesture (drag for a segment, click for a
   * run of corners), snaps and binds to objects, and previews its heads —
   * none of which a closed shape shares. `LineTool` holds all of it, and this
   * class hands every event straight over for those two presets.
   */
  private line: LineTool | null = null;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  /**
   * The modifiers, held rather than read from the last pointer event, and
   * refreshed on key events too, so the preview answers Shift or Alt the
   * moment it is pressed rather than on the next pointer move.
   */
  private shift = false;
  private alt = false;
  private preset: ShapePreset;

  /**
   * The box the drag currently describes, with every modifier applied.
   *
   * One place, used by the preview, the commit and the readout — so what you
   * see while dragging is by construction what you get on release. These were
   * three separate calculations before, and the third (the commit) silently
   * did not know about Alt.
   */
  private box() {
    let ax = this.startX;
    let ay = this.startY;
    let bx = this.currentX;
    let by = this.currentY;

    if (this.shift) {
      // Square/circle: the shorter axis wins, so the shape stays inside the
      // gesture rather than growing past where the pointer has reached.
      const size = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      bx = ax + Math.sign(bx - ax || 1) * size;
      by = ay + Math.sign(by - ay || 1) * size;
    }

    if (this.alt) {
      // Draw from the centre: the anchor becomes the middle and the pointer
      // describes one corner, so the shape grows in both directions at once.
      const dx = bx - ax;
      const dy = by - ay;
      ax = this.startX - dx;
      ay = this.startY - dy;
    }

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

  constructor(preset: ShapePreset = 'rect') {
    this.id = `shape-${preset}`;
    this.preset = preset;
    if (preset === 'line' || preset === 'arrow') this.line = new LineTool(preset);
  }

  /**
   * The geometry this preset creates.
   *
   * The recipe comes from the catalogue whole rather than being rebuilt here
   * from a kind and a side count. The dock offers named counts — triangle,
   * pentagon, octagon — because nobody wants to draw a rectangle and then type
   * "5", and the document stores one `polygon` kind with a number, which is
   * what makes the count editable afterwards rather than frozen into the
   * shape's identity. The same is true of a star's depth and a bubble's tail:
   * they are part of what the tile promises, and the tile is where they are
   * written down.
   */
  private geometry(): ShapeGeometry {
    return presetGeometry(this.preset);
  }

  onPointerDown(ctx: ToolContext, e: any) {
    if (this.line) return this.line.onPointerDown(ctx, e);
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.shift = Boolean(e.evt?.shiftKey);
    this.alt = Boolean(e.evt?.altKey);

    this.isDragging = true;
    this.startX = pos.x;
    this.startY = pos.y;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.pushOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (this.line) return this.line.onPointerMove(ctx, e);
    if (!this.isDragging) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.shift = Boolean(e.evt?.shiftKey);
    this.alt = Boolean(e.evt?.altKey);
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext, e?: any) {
    if (this.line) return this.line.onPointerUp(ctx, e);
    if (!this.isDragging) return;
    this.isDragging = false;
    this.commit(ctx);
  }

  /** Create the node the current gesture describes, and hand back to Select. */
  private commit(ctx: ToolContext) {
    this.clearOverlay(ctx);

    let { x, y, width, height } = this.box();

    // A click that sized nothing drops the shape at its natural size.
    if (width <= MIN_DRAG || height <= MIN_DRAG) {
      // At the shape's own proportions, not a square — see `placedSize`. A
      // capsule in a square box is a circle, and that is what clicking the
      // board with the Capsule tool armed used to produce.
      const natural = placedSize(this.preset);
      width = natural.width;
      height = natural.height;
      x = this.startX - width / 2;
      y = this.startY - height / 2;
      if (gridSnap.shouldSnap()) {
        const snapped = gridSnap.snapPoint(x, y);
        x = snapped.x;
        y = snapped.y;
      }
    }

    const geometry = this.geometry();

    const nodeId = nanoid();
    recordRecentShape(this.preset);
    ctx.editor.createNode({
      id: nodeId,
      type: 'shape',
      x,
      y,
      // width/height on the base node are the only record of size; `geometry`
      // describes the form alone.
      width,
      height,
      geometry,
      appearance: newShapeAppearance(this.preset, width, height),
    });

    ctx.editor.select(nodeId);
    finishCreation();
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (this.line) return this.line.onKeyDown(ctx, e);
    // Escape cancels an in-progress drag, matching every other tool.
    if (e.key === 'Escape' && this.isDragging) {
      this.isDragging = false;
      this.clearOverlay(ctx);
      return;
    }
    this.syncModifiers(ctx, e);
  }

  onKeyUp(ctx: ToolContext, e: KeyboardEvent) {
    if (this.line) return this.line.onKeyUp(ctx, e);
    this.syncModifiers(ctx, e);
  }

  /** Repaint the preview the moment a modifier changes, held still or not. */
  private syncModifiers(ctx: ToolContext, e: KeyboardEvent) {
    if (!this.isDragging) return;
    const shift = e.shiftKey;
    const alt = e.altKey;
    if (shift === this.shift && alt === this.alt) return;
    this.shift = shift;
    this.alt = alt;
    this.pushOverlay(ctx);
  }

  onDeactivate(ctx: ToolContext) {
    if (this.line) return this.line.onDeactivate(ctx);
    // A keyboard tool-switch mid-drag never fires onPointerUp, which would
    // otherwise leave the ghost size preview stuck on screen forever.
    this.isDragging = false;
    this.clearOverlay(ctx);
  }

  private pushOverlay(ctx: ToolContext) {
    const box = this.box();
    ctx.setOverlayState?.({ active: true, box, kind: this.preset });
    /**
     * What you are about to make, in numbers, through the board's one HUD:
     * under the box being drawn, flipping above it near the bottom edge, with
     * a tick while Shift holds the proportions. A ghost outline says where;
     * the readout says how big, which is most of what a deliberate drag is
     * trying to control. Nothing until the drag is past a click.
     */
    if (box.width > MIN_DRAG && box.height > MIN_DRAG) {
      hud.show({
        source: 'shape',
        kind: 'size',
        value: { width: box.width, height: box.height },
        at: { x: this.currentX, y: this.currentY },
        box,
        snapped: this.shift,
      });
    } else {
      hud.hide('shape');
    }
  }

  /** The gesture is over, committed or not: the overlay and the readout go. */
  private clearOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({ active: false });
    hud.hide('shape');
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (this.line) return this.line.renderOverlay(ctx, overlayState);
    if (!overlayState?.active || !overlayState.box) return null;

    const { x, y, width, height } = overlayState.box;

    const fill = 'rgba(59, 130, 246, 0.25)';
    const stroke = '#3B82F6';

    /**
     * Every closed shape previews through its own outline.
     *
     * There used to be four Konva-primitive branches above this one —
     * rectangle, ellipse, star and the regular polygons — each rebuilding the
     * shape a second way so the preview could use a cheaper node. They were
     * kept in step by hand, and the comment on the rectangle's branch records
     * what that cost the last time they fell out of step: it drew a rounded
     * preview and committed a square one.
     *
     * One branch cannot disagree with itself. `shapeToPath` is what the canvas
     * renders and what the exporter writes, so the outline under the pointer
     * *is* the object that lands on release, including the corner radius the
     * tile seeds and the box-filling normalisation the polygons now take.
     */
    const dummyNode = {
      geometry: this.geometry(),
      width,
      height,
      appearance: { cornerRadius: newShapeAppearance(this.preset, width, height).cornerRadius },
    };
    const pathD = contourData(shapeToPath(dummyNode as any));
    const featurePaths = shapeFeaturePaths(dummyNode as any, 0, 0);
    return (
      <Group x={x} y={y} listening={false}>
        <Path
          data={pathD}
          fillRule="evenodd"
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          listening={false}
        />
        {featurePaths.map((featD, i) => (
          <Path
            key={`feat-${i}`}
            data={featD}
            stroke={stroke}
            strokeWidth={1.5}
            listening={false}
          />
        ))}
      </Group>
    );
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return ctx.camera.screenToWorld(pos.x, pos.y);
  }
}
