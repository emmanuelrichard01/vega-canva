import { SceneContext } from 'konva/lib/Context';
import type { Shape } from 'konva/lib/Shape';

/**
 * Hairlines that never vanish.
 *
 * A stroke is stored in world units and drawn at `width × zoom × devicePixelRatio`
 * device pixels. Below a device pixel the browser draws it by coverage, so a
 * 0.25 line at 25% zoom on a 1× screen is a 6%-grey smear, and further out it
 * is nothing at all. Illustrator answers this by never drawing a stroke thinner
 * than the screen can show; this does the same, with a floor of half a device
 * pixel — enough to stay legible as a line, low enough that at 100% on a
 * retina screen every weight down to 0.25 still draws at its true width.
 *
 * Only the *drawn* width changes. The document keeps 0.25, the panel shows
 * 0.25, and a stroke above the floor is untouched, so weights stay in order:
 * a 0.5 line is never drawn lighter than a 0.25 one.
 *
 * ## Why at draw time
 *
 * The floor depends on the scale the pixels are actually drawn at, which is
 * not always the camera's: a PNG export re-scales the stage and draws it
 * synchronously, without a React render in between. A width computed in a
 * renderer from the live zoom would export a hairline drawn for the zoom the
 * person happened to be at. Computed here, from the stage's own scale at the
 * moment of drawing, the export is floored for the export's resolution and
 * the board for the board's.
 *
 * It is one wrap of Konva's scene-context stroke, installed once. Shapes that
 * opt out of stroke scaling (`strokeScaleEnabled: false` — selection chrome,
 * already drawn in screen pixels) are left alone, and the hit canvas is a
 * different context class and never sees it.
 */

/** The thinnest a stroke is ever drawn, in device pixels. */
export const MIN_DEVICE_STROKE = 0.5;

/**
 * The width to draw `width` at, given how many device pixels one unit of it
 * covers. Unchanged at or above the floor.
 */
export function flooredLineWidth(width: number, deviceScale: number, min = MIN_DEVICE_STROKE): number {
  if (!(width > 0) || !(deviceScale > 0) || !Number.isFinite(deviceScale)) return width;
  return width * deviceScale >= min ? width : min / deviceScale;
}

type StrokeFn = (this: SceneContext, shape: Shape) => void;

let installed = false;

/** Wrap Konva's scene stroke with the floor. Idempotent. */
export function installHairlineFloor(): void {
  if (installed) return;
  const proto = SceneContext.prototype as unknown as { _stroke?: StrokeFn };
  const original = proto._stroke;
  if (typeof original !== 'function') return;
  installed = true;

  proto._stroke = function hairlineStroke(this: SceneContext, shape: Shape) {
    const attrs = shape.attrs as { strokeWidth?: number; strokeScaleEnabled?: boolean };
    const width = attrs.strokeWidth;
    if (typeof width !== 'number' || !(width > 0) || attrs.strokeScaleEnabled === false) {
      original.call(this, shape);
      return;
    }
    // The stage's scale and the canvas's pixel ratio, both cached by Konva —
    // reading the context's transform instead would allocate a matrix per
    // stroke per frame on a board of thousands.
    const stage = shape.getStage();
    const scale = Math.abs(stage ? stage.scaleX() : 1) * (this.canvas?.getPixelRatio?.() ?? 1);
    const drawn = flooredLineWidth(width, scale);
    if (drawn === width) {
      original.call(this, shape);
      return;
    }
    // Swapped on the attrs object directly rather than through the setter, so
    // nothing hears a change: this is a property of one draw, not of the node.
    attrs.strokeWidth = drawn;
    try {
      original.call(this, shape);
    } finally {
      attrs.strokeWidth = width;
    }
  };
}

installHairlineFloor();
