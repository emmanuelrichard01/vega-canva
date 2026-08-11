import { useMemo } from 'react';
import { konvaFillProps, needsPattern, paintColor, withAlpha, type PaintBox } from '../../../engine/model/paint';
import { paintPattern } from '../../../engine/model/paintPattern';
import type { Appearance } from '../../../engine/model/schema';

/**
 * The Konva fill props for a node's first fill.
 *
 * One hook rather than each renderer switching on the paint kind, because
 * there are five kinds and six renderers, and thirty places to forget
 * `fillPriority` is thirty ways for a shape to keep painting the gradient it
 * used to have.
 *
 * ## `fillPriority` is always set
 *
 * Konva chooses a fill by priority and leaves every other fill property in
 * place. React does not unset props it stops passing, so a shape that was a
 * radial gradient and is now solid still has its radial props on the node —
 * and paints the gradient — unless the priority explicitly says otherwise.
 * Every branch here returns a priority for exactly that reason.
 *
 * ## The pattern is memoised on the numbers, not the object
 *
 * A conic or diamond fill costs a canvas and a few hundred fills to build. The
 * dependency is a string of everything the bitmap depends on, so dragging a
 * shape — which changes its position and nothing else — reuses the bitmap,
 * while resizing it rebuilds one.
 */
export function useFillProps(
  appearance: Appearance | undefined,
  box: PaintBox,
  fallback: string
): Record<string, unknown> {
  const paint = appearance?.fill?.[0];

  // Cheap and pure: solid, linear and radial are just numbers handed to Konva.
  const direct = konvaFillProps(paint, box, fallback);

  const patternKey =
    paint && needsPattern(paint)
      ? JSON.stringify([paint, Math.round(box.width), Math.round(box.height)])
      : null;

  const pattern = useMemo(() => {
    if (!patternKey || !paint || !needsPattern(paint)) return null;
    return paintPattern(paint, box.width, box.height);
    // The key is the whole dependency: it contains the paint and the size, and
    // depending on `paint` itself would rebuild on every render because the
    // store hands back a fresh object for a node whose fill has not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternKey]);

  if (direct) return direct;

  if (!pattern) {
    // A pattern that could not be built — a zero-sized shape mid-drag, or no
    // DOM — falls back to the gradient's first colour rather than to nothing.
    // An unfilled shape reads as a deleted one.
    return { fill: withAlpha(paintColor(paint, fallback), paint?.opacity), fillPriority: 'color' };
  }

  return {
    fillPriority: 'pattern',
    fillPatternImage: pattern.image,
    // The bitmap is capped below the shape's size, so it has to be stretched
    // back over it. Without this the gradient occupies the top-left corner and
    // Konva tiles the rest of the shape with copies of it.
    fillPatternScaleX: pattern.scaleX,
    fillPatternScaleY: pattern.scaleY,
    fillPatternX: box.x,
    fillPatternY: box.y,
    fillPatternRepeat: 'no-repeat',
  };
}
