import React from 'react';
import { Shape } from 'react-konva';
import type Konva from 'konva';
import type { Shadow, StrokeAlign } from '../../../engine/model/schema';
import { castRegions, deviceBox, innerCastRegions, shadowReach } from '../../../engine/model/dropShadow';
import { inversePath } from './shapePath2D';
import { flooredLineWidth } from './hairline';

/**
 * The effects that a Konva primitive cannot express: an inside or outside
 * stroke, an inner shadow, a backdrop blur, and a drop shadow cast once by a
 * whole silhouette (`DropShadow`, at the end of this file).
 *
 * Konva strokes are always centred on the path, and Konva has no inner shadow
 * at all. Both are ordinary requirements of a design tool and both come down
 * to the same missing capability: drawing something and then keeping only the
 * part of it that falls inside — or outside — a shape.
 *
 * That is a clip, and a clip needs the path. So these are `<Shape>` nodes with
 * a `sceneFunc`, handed the same `Path2D` the shape itself is drawn from —
 * rather than a second description of a hexagon that could disagree with the
 * first.
 *
 * ## Why they are separate nodes rather than props
 *
 * The base primitive stays a real `Rect`/`Ellipse`/`Star`, so the common case —
 * a shape with a centred stroke and no inner shadow — costs nothing and keeps
 * Konva's own hit detection, caching and perfect-draw handling. These layers
 * mount only when the effect is actually asked for.
 *
 * ## `context._context`
 *
 * Konva's `Context` wrapper forwards the 2D API but does not take a fill rule,
 * and both effects need `evenodd` to describe "everything except this shape".
 * The raw context is reached for exactly that, and for nothing else.
 */

interface Props {
  path: Path2D;
  width: number;
  height: number;
}

interface StrokeProps extends Props {
  align: Exclude<StrokeAlign, 'center'>;
  color: string;
  strokeWidth: number;
  dash?: number[];
  cap?: CanvasLineCap;
  /**
   * The corner treatment, which this path used to ignore.
   *
   * `ctx.lineJoin` was hardcoded to `'round'` here, so the Join control in the
   * Properties panel silently did nothing the moment stroke alignment was set
   * to inside or outside — a control that works in one state of a *neighbouring*
   * control and not in another, with nothing on screen to say so. The miter
   * limit never reached this path at all.
   */
  join?: CanvasLineJoin;
  miterLimit?: number;
}

/**
 * A stroke that sits wholly inside or wholly outside the path.
 *
 * Drawn at twice the requested weight and clipped to the half that should
 * survive. That is the standard construction, and it is exact rather than an
 * approximation: a centred stroke of `2w` puts exactly `w` on each side of the
 * path, so clipping away one side leaves exactly the requested weight on the
 * other. The alternative — offsetting the path itself — is a genuinely hard
 * geometry problem that goes wrong at concave corners, which is every star.
 */
export const AlignedStroke: React.FC<StrokeProps> = ({
  path,
  width,
  height,
  align,
  color,
  strokeWidth,
  dash,
  cap,
  join,
  miterLimit,
}) => (
  <Shape
    listening={false}
    perfectDrawEnabled={false}
    sceneFunc={(context: Konva.Context) => {
      const ctx = context._context;
      ctx.save();
      if (align === 'inside') {
        ctx.clip(path);
      } else {
        // Everything except the shape. `evenodd` is what turns an outer
        // rectangle containing the shape into a ring around it.
        ctx.clip(inversePath(path, width, height), 'evenodd');
      }
      // Doubled and clipped, so the floor applies to the half that survives.
      const m = ctx.getTransform();
      ctx.lineWidth = flooredLineWidth(strokeWidth, Math.hypot(m.a, m.b)) * 2;
      ctx.strokeStyle = color;
      // Canvas2D's own default is `miter`, which is also the document's absent
      // case — so an unset join needs no branch and draws what the schema says
      // it should.
      ctx.lineJoin = join ?? 'miter';
      if (miterLimit !== undefined) ctx.miterLimit = miterLimit;
      if (cap) ctx.lineCap = cap;
      if (dash && dash.length) ctx.setLineDash(dash);
      ctx.stroke(path);
      ctx.restore();
    }}
  />
);

/**
 * Scratch canvases, reused across every backdrop blur on every frame.
 *
 * Two of them, because the sample and the blurred copy cannot be the same
 * bitmap — `drawImage` from a canvas onto itself with a filter set reads
 * partly-written pixels. Allocating a pair per node per frame is a new
 * multi-megabyte buffer sixty times a second.
 */
let samplePad: HTMLCanvasElement | null = null;
let blurPad: HTMLCanvasElement | null = null;

function scratch(which: 'sample' | 'blur', w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const existing = which === 'sample' ? samplePad : blurPad;
  const canvas = existing ?? document.createElement('canvas');
  // Grown, never shrunk: a pass that only ever enlarges the buffer avoids
  // reallocating every time a shape is resized down and back up again.
  if (canvas.width < w) canvas.width = w;
  if (canvas.height < h) canvas.height = h;
  if (which === 'sample') samplePad = canvas;
  else blurPad = canvas;
  return canvas;
}

interface BackdropProps extends Props {
  radius: number;
}

/**
 * Frosted glass: what is behind the shape, blurred, seen through it.
 *
 * The trick is that this needs no scene re-render. Konva draws one layer in
 * z-order, so at the moment this node's `sceneFunc` runs, the layer's canvas
 * *already contains everything below it and nothing above it* — which is
 * exactly the definition of "backdrop". Sampling it is a `drawImage`, not a
 * second pass over the document.
 *
 * The sampled region is padded by three sigma. Without that, the blur near the
 * shape's edge averages against the transparent black outside the sample and
 * the result darkens toward its own boundary — a vignette nobody asked for.
 *
 * Drawn back with the transform reset to identity, because the sample is in
 * device pixels. The clip is taken *before* the reset, so it is still the
 * shape's own outline; a clip is fixed in the coordinates it was set in.
 *
 * Two honest limits, both recorded in the spec: a browser without Canvas2D
 * `filter` gets nothing rather than an unblurred copy, and combining this with
 * a layer blur on the same object samples that object's own cache instead of
 * the board, because a cached node is drawn onto a canvas of its own.
 */
export const BackdropBlur: React.FC<BackdropProps> = ({ path, width, height, radius }) => (
  <Shape
    listening={false}
    perfectDrawEnabled={false}
    sceneFunc={(context: Konva.Context) => {
      const ctx = context._context;
      const source = ctx.canvas;
      if (!source || radius <= 0) return;

      const transform = ctx.getTransform();
      // Device-space corners of the node's box. All four, not just two: the
      // node can be rotated, and a bounding box taken from opposite corners
      // alone would miss most of a shape turned 45 degrees.
      const corners = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ].map(([x, y]) => ({
        x: transform.a * x + transform.c * y + transform.e,
        y: transform.b * x + transform.d * y + transform.f,
      }));

      const scale = Math.hypot(transform.a, transform.b) || 1;
      const pad = Math.ceil(radius * scale * 3);
      const left = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x)) - pad));
      const top = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y)) - pad));
      const right = Math.min(source.width, Math.ceil(Math.max(...corners.map((c) => c.x)) + pad));
      const bottom = Math.min(source.height, Math.ceil(Math.max(...corners.map((c) => c.y)) + pad));
      const w = right - left;
      const h = bottom - top;
      if (w <= 0 || h <= 0) return;

      const sample = scratch('sample', w, h);
      const blurred = scratch('blur', w, h);
      const sampleCtx = sample?.getContext('2d');
      const blurCtx = blurred?.getContext('2d');
      if (!sample || !blurred || !sampleCtx || !blurCtx) return;
      // A browser with no Canvas2D filter draws nothing rather than an
      // unblurred copy of the background, which would read as a bug in the
      // fill rather than as a missing feature.
      if (!('filter' in blurCtx)) return;

      sampleCtx.clearRect(0, 0, w, h);
      sampleCtx.drawImage(source, left, top, w, h, 0, 0, w, h);

      blurCtx.clearRect(0, 0, w, h);
      blurCtx.filter = `blur(${radius * scale}px)`;
      blurCtx.drawImage(sample, 0, 0, w, h, 0, 0, w, h);
      blurCtx.filter = 'none';

      ctx.save();
      ctx.clip(path);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(blurred, 0, 0, w, h, left, top, w, h);
      ctx.restore();
    }}
  />
);

interface InnerShadowProps extends Props {
  shadow: Shadow;
  /** How far inside the outline the shadow starts: the stroke's inner reach. See `innerShadowInset`. */
  inset?: number;
  /** The outline's fill rule, so a shape with holes casts into its body, not its holes. */
  rule?: CanvasFillRule;
}

/**
 * A shadow cast inward, as though the shape were a hole.
 *
 * The shadow is cast by everything *outside* the shape, grown inward by the
 * spread and by the stroke's inner reach, then offset, blurred, and kept only
 * where it falls inside the shape and inside its stroke. That is CSS's inset
 * `box-shadow` and Figma's inner shadow: the shadow follows every corner the
 * outline has, because the hole is the outline, and it sits under the stroke
 * rather than over it.
 *
 * Built in device pixels on the drop shadow's scratch pads, for the same
 * reasons: blur, offset and spread scale with the zoom and the pixel ratio
 * (a context's `shadowBlur` ignores its transform), and the offset falls in
 * the screen's frame, so a rotated card's inner shadow still comes from above.
 *
 * 1. The `ink` pad is filled, the shape is cut out of it, and the edge is
 *    grown inward (a stroke) or pulled back (an erasing stroke) by
 *    `inset + spread`. That is the region casting the shadow.
 * 2. Its shadow alone is cast onto the `cast` pad, by drawing it far away.
 * 3. The cast is cut to the shape, and the stroke's inner band is cut out.
 * 4. The result is laid on the board at the shadow's opacity.
 */
export const InnerShadow: React.FC<InnerShadowProps> = ({ path, width, height, shadow, inset = 0, rule = 'nonzero' }) => (
  <Shape
    listening={false}
    perfectDrawEnabled={false}
    sceneFunc={(context: Konva.Context) => {
      const ctx = context._context;
      const target = ctx.canvas;
      if (!target) return;
      const m = ctx.getTransform();
      const sx = Math.hypot(m.a, m.b);
      const sy = Math.hypot(m.c, m.d);
      const blurPx = Math.max(0, shadow.blur) * Math.min(sx, sy);
      const offset = { x: shadow.offsetX * sx, y: shadow.offsetY * sy };
      const regions = innerCastRegions(deviceBox(m, { x: 0, y: 0, width, height }), target, blurPx, offset);
      if (!regions) return;
      const { ink, out } = regions;

      const inkCtx = pad('ink', ink.width, ink.height);
      if (!inkCtx) return;
      inkCtx.fillStyle = '#000000';
      inkCtx.strokeStyle = '#000000';
      inkCtx.fillRect(0, 0, ink.width, ink.height);
      inkCtx.setTransform(m.a, m.b, m.c, m.d, m.e - ink.x, m.f - ink.y);
      inkCtx.globalCompositeOperation = 'destination-out';
      inkCtx.fill(path, rule);
      const grow = inset + (shadow.spread ?? 0);
      if (grow !== 0) {
        // A stroke of twice the growth moves the edge by exactly the growth:
        // inward when it paints, outward when it erases.
        inkCtx.globalCompositeOperation = grow > 0 ? 'source-over' : 'destination-out';
        inkCtx.lineWidth = Math.abs(grow) * 2;
        inkCtx.lineJoin = 'round';
        inkCtx.stroke(path);
      }
      inkCtx.globalCompositeOperation = 'source-over';
      inkCtx.setTransform(1, 0, 0, 1, 0, 0);

      const castCtx = pad('cast', out.width, out.height);
      if (!castCtx) return;
      const far = out.width + ink.width + 64;
      castCtx.shadowColor = shadow.color;
      castCtx.shadowBlur = blurPx;
      castCtx.shadowOffsetX = offset.x + far;
      castCtx.shadowOffsetY = offset.y;
      castCtx.drawImage(pads.ink!, 0, 0, ink.width, ink.height, ink.x - out.x - far, ink.y - out.y, ink.width, ink.height);
      castCtx.shadowColor = 'rgba(0, 0, 0, 0)';

      // Inside the shape, and off the stroke that borders it.
      castCtx.setTransform(m.a, m.b, m.c, m.d, m.e - out.x, m.f - out.y);
      castCtx.globalCompositeOperation = 'destination-in';
      castCtx.fill(path, rule);
      if (inset > 0) {
        castCtx.globalCompositeOperation = 'destination-out';
        castCtx.lineWidth = inset * 2;
        castCtx.lineJoin = 'round';
        castCtx.stroke(path);
      }
      castCtx.globalCompositeOperation = 'source-over';
      castCtx.setTransform(1, 0, 0, 1, 0, 0);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha *= Math.min(1, Math.max(0, shadow.opacity ?? 1));
      ctx.drawImage(pads.cast!, 0, 0, out.width, out.height, out.x, out.y, out.width, out.height);
      ctx.restore();
    }}
  />
);

/** One line of the silhouette: a path stroked as the object strokes it. */
export interface ShadowStroke {
  path: Path2D;
  width: number;
  cap?: CanvasLineCap;
  join?: CanvasLineJoin;
  miterLimit?: number;
  dash?: number[];
  /** An inside or outside stroke: drawn doubled and clipped, as `AlignedStroke` draws it. */
  side?: 'inside' | 'outside';
}

/**
 * Everything an object inks, as the shadow sees it: filled regions, stroked
 * lines, and raster art whose alpha is its own silhouette (a picture).
 */
export interface ShadowSilhouette {
  /** `join` is how spread grows the region's corners; round when absent. */
  fills?: ReadonlyArray<{ path: Path2D; rule?: CanvasFillRule; join?: CanvasLineJoin }>;
  strokes?: ReadonlyArray<ShadowStroke>;
  /** Paints raster ink in the group's local units. Not grown by spread. */
  raster?: (ctx: CanvasRenderingContext2D) => void;
}

/** A local-space box. */
export interface LocalBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Paint the silhouette in opaque ink, grown by `grow` in every direction.
 *
 * Growing is stroking: a line of `2 * grow` centred on a region's edge puts
 * exactly `grow` outside it, whatever the region is, and a stroke widened by
 * `2 * grow` is that stroke dilated by `grow`. A fill grows with its own
 * `join`: mitred for a rectangle, so a square corner stays square and a
 * rounded one grows to `radius + grow`; round for everything else, which is
 * the true offset of a curve.
 *
 * A negative `grow` erodes: each region loses a band of `|grow|` along its
 * edge, and each line narrows by twice that.
 */
export function paintSilhouette(ctx: CanvasRenderingContext2D, ink: ShadowSilhouette, box: LocalBox, grow: number): void {
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  for (const f of ink.fills ?? []) {
    ctx.fill(f.path, f.rule ?? 'nonzero');
    if (grow !== 0) {
      ctx.save();
      if (grow < 0) ctx.globalCompositeOperation = 'destination-out';
      ctx.setLineDash([]);
      ctx.lineJoin = f.join ?? 'round';
      ctx.miterLimit = 10;
      ctx.lineWidth = Math.abs(grow) * 2;
      ctx.stroke(f.path);
      ctx.restore();
    }
  }
  for (const s of ink.strokes ?? []) {
    const width = (s.side ? s.width * 2 : s.width) + grow * 2;
    if (!(width > 0)) continue;
    ctx.save();
    if (s.side === 'inside') ctx.clip(s.path);
    else if (s.side === 'outside') ctx.clip(inversePath(s.path, box.x + box.width, box.y + box.height), 'evenodd');
    ctx.lineWidth = width;
    ctx.lineCap = s.cap ?? 'butt';
    ctx.lineJoin = s.join ?? 'miter';
    if (s.miterLimit !== undefined) ctx.miterLimit = s.miterLimit;
    ctx.setLineDash(s.dash && s.dash.length ? s.dash : []);
    ctx.stroke(s.path);
    ctx.restore();
  }
  ink.raster?.(ctx);
}

/**
 * Two scratch bitmaps shared by every drop shadow on the board, grown and
 * never shrunk, for the same reason the backdrop blur keeps its pair: a
 * buffer allocated per object per frame is megabytes a second of garbage.
 *
 * `ink` holds the silhouette; `cast` receives its shadow. They cannot be one
 * canvas, because the shadow is made by drawing the first onto the second.
 */
const pads: { ink: HTMLCanvasElement | null; cast: HTMLCanvasElement | null } = { ink: null, cast: null };

function pad(which: 'ink' | 'cast', w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = pads[which] ?? document.createElement('canvas');
  pads[which] = canvas;
  if (canvas.width < w) canvas.width = w;
  if (canvas.height < h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

interface DropShadowProps {
  shadow: Shadow;
  /** The ink's extent in the group's local units, strokes and arrowheads included. */
  box: LocalBox;
  silhouette: ShadowSilhouette;
  /** Cut the shadow away from under the ink, for translucent paint. See `needsKnockout`. */
  knockout?: boolean;
}

/**
 * A drop shadow cast by an object's whole silhouette, once.
 *
 * ## The construction
 *
 * 1. The silhouette (fill, stroke, arrowheads, grown by the spread) is
 *    painted in opaque black into the `ink` pad, in device pixels.
 * 2. That bitmap is drawn onto the `cast` pad with the shadow switched on and
 *    the bitmap itself placed far outside the pad, so only its shadow lands.
 *    This is the old canvas idiom for "the shadow and nothing else", and it is
 *    why the result is exactly one shadow: it is cast by one image, not by a
 *    fill and then again by the stroke on top of it.
 * 3. For translucent ink the object's own silhouette is cut out of the result,
 *    so the shadow is not seen through the paint (CSS and Figma both do this).
 * 4. The result is laid onto the board at the shadow's opacity.
 *
 * Everything is in device pixels, so blur and offset scale with zoom exactly
 * as Konva's own shadows do, and the pads are clipped to what is on screen.
 *
 * ## Bounds
 *
 * The node is placed over the box grown by the shadow's reach, so Konva's
 * client rect, which a layer-blur cache is sized from, includes the shadow
 * rather than clipping it flat at the object's edge.
 */
export const DropShadow: React.FC<DropShadowProps> = ({ shadow, box, silhouette, knockout = false }) => {
  const reach = shadowReach(shadow);
  const x = box.x - reach;
  const y = box.y - reach;
  return (
    <Shape
      x={x}
      y={y}
      width={box.width + reach * 2}
      height={box.height + reach * 2}
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(context: Konva.Context) => {
        const ctx = context._context;
        const target = ctx.canvas;
        if (!target) return;
        // The group's own space: this node sits `reach` up and left of it.
        const m = ctx.getTransform().translate(-x, -y);
        const sx = Math.hypot(m.a, m.b);
        const sy = Math.hypot(m.c, m.d);
        const spread = shadow.spread ?? 0;
        // A negative spread only shrinks the ink, so the box stays as it is.
        const outset = Math.max(0, spread);
        const grown = { x: box.x - outset, y: box.y - outset, width: box.width + outset * 2, height: box.height + outset * 2 };
        const inkBox = deviceBox(m, grown);
        if (inkBox.width < 0.5 && inkBox.height < 0.5) return;

        const blurPx = Math.max(0, shadow.blur) * Math.min(sx, sy);
        // In the screen's frame, as Konva's own shadows fall: a rotated or
        // flipped object still casts downwards.
        const offset = { x: shadow.offsetX * sx, y: shadow.offsetY * sy };
        const regions = castRegions(inkBox, target, blurPx, offset);
        if (!regions) return;
        const { ink, shadow: out } = regions;

        const inkCtx = pad('ink', ink.width, ink.height);
        if (!inkCtx) return;
        inkCtx.setTransform(m.a, m.b, m.c, m.d, m.e - ink.x, m.f - ink.y);
        paintSilhouette(inkCtx, silhouette, box, spread);
        inkCtx.setTransform(1, 0, 0, 1, 0, 0);

        const castCtx = pad('cast', out.width, out.height);
        if (!castCtx) return;
        // Far enough left that no part of the bitmap itself lands on the pad.
        const far = out.width + ink.width + 64;
        castCtx.shadowColor = shadow.color;
        castCtx.shadowBlur = blurPx;
        castCtx.shadowOffsetX = offset.x + far;
        castCtx.shadowOffsetY = offset.y;
        castCtx.drawImage(pads.ink!, 0, 0, ink.width, ink.height, ink.x - out.x - far, ink.y - out.y, ink.width, ink.height);
        castCtx.shadowColor = 'rgba(0, 0, 0, 0)';

        if (knockout) {
          castCtx.globalCompositeOperation = 'destination-out';
          castCtx.setTransform(m.a, m.b, m.c, m.d, m.e - out.x, m.f - out.y);
          paintSilhouette(castCtx, silhouette, box, 0);
          castCtx.setTransform(1, 0, 0, 1, 0, 0);
          castCtx.globalCompositeOperation = 'source-over';
        }

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // The colour's own alpha is in the shadow already; the opacity field
        // is applied on top, which works for any CSS colour, not only hex.
        ctx.globalAlpha *= Math.min(1, Math.max(0, shadow.opacity ?? 1));
        ctx.drawImage(pads.cast!, 0, 0, out.width, out.height, out.x, out.y, out.width, out.height);
        ctx.restore();
      }}
    />
  );
};

/** The silhouette's line for an object's stroke, or nothing when it draws none. */
export function strokeInk(
  path: Path2D,
  stroke: { width: number; cap?: string; join?: string; miterLimit?: number; dash?: number[]; align?: StrokeAlign } | undefined
): ShadowStroke[] {
  if (!stroke || !(stroke.width > 0)) return [];
  return [
    {
      path,
      width: stroke.width,
      cap: stroke.cap as CanvasLineCap | undefined,
      join: stroke.join as CanvasLineJoin | undefined,
      miterLimit: stroke.miterLimit,
      dash: stroke.dash,
      side: stroke.align && stroke.align !== 'center' ? stroke.align : undefined,
    },
  ];
}
