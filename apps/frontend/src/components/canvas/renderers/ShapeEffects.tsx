import React from 'react';
import { Shape } from 'react-konva';
import type Konva from 'konva';
import { withAlpha } from '../../../engine/model/paint';
import type { Shadow, StrokeAlign } from '../../../engine/model/schema';
import { inversePath } from './shapePath2D';

/**
 * The two effects that a Konva primitive cannot express.
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
      ctx.lineWidth = strokeWidth * 2;
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
}

/**
 * A shadow cast inward, as though the shape were a hole.
 *
 * The construction is: clip to the shape, then fill *everything except* the
 * shape with the shadow switched on. The fill itself lands entirely outside
 * the clip and so paints nothing; only its shadow, which falls inward across
 * the edge, survives. This is how a canvas has always drawn an inner shadow,
 * and it is why the effect needs a path rather than a property.
 *
 * `spread` grows the hole inward by stroking the same edge, which thickens the
 * region casting the shadow — the same trick the drop shadow's spread uses,
 * pointed the other way. Unlike the fill, that stroke *does* paint inside the
 * clip, so it is drawn in the shadow's own colour rather than in the throwaway
 * black the fill uses: the half of it that lands inside is the solid core of
 * the shadow, and painting it black was a black band with no shadow in it.
 */
export const InnerShadow: React.FC<InnerShadowProps> = ({ path, width, height, shadow }) => (
  <Shape
    listening={false}
    perfectDrawEnabled={false}
    sceneFunc={(context: Konva.Context) => {
      const ctx = context._context;
      ctx.save();
      ctx.clip(path);

      ctx.shadowColor = withAlpha(shadow.color, shadow.opacity);
      ctx.shadowBlur = Math.max(0, shadow.blur);
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
      // Any opaque colour: this fill is outside the clip and never appears.
      // Only its shadow does, and a shadow takes its colour from the context.
      ctx.fillStyle = '#000000';
      ctx.fill(inversePath(path, width, height), 'evenodd');

      if (shadow.spread && shadow.spread > 0) {
        /**
         * The spread band is drawn in the shadow's own colour, not in black.
         *
         * ## The bug
         *
         * This was `strokeStyle = '#000000'`, on the same reasoning as the
         * fill two lines above: *any opaque colour will do, because the ink
         * lands outside the clip and only its shadow shows.* That is true of
         * the fill, which is the inverse path and lies entirely outside the
         * shape. It is false of a **stroke**, which straddles the edge it is
         * drawn on — so the inner half of a `spread * 2` wide line landed
         * inside the clip and was painted solid black.
         *
         * The symptom was a thick black band hugging the inside of the
         * outline, with the actual shadow colour nowhere in it, the moment
         * spread went above zero.
         *
         * ## Why the stroke stays rather than being removed
         *
         * That inner half is not a mistake to delete — it is exactly where a
         * spread inner shadow is at full strength. A spread of *n* means the
         * shadow is solid for *n* units before the blur starts softening it,
         * which is a band of shadow colour hugging the edge. Painting the band
         * in `shadow.color` at `shadow.opacity` makes the stroke draw the very
         * thing it was supposed to be casting, and the blur beyond it comes
         * from the shadow this same stroke throws further in.
         *
         * So the fix is the colour, and the geometry was right all along.
         */
        ctx.lineWidth = shadow.spread * 2;
        ctx.strokeStyle = withAlpha(shadow.color, shadow.opacity);
        ctx.stroke(path);
      }

      ctx.restore();
    }}
  />
);
