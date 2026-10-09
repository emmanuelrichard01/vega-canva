import { isOpenShape, type AnyNode, type Appearance } from '../../../engine/model/schema';

/** What the renderers draw a line, arrow, connector or unfilled pen path at when no weight is stored. */
export const RUN_DEFAULT_WIDTH = 2;

/**
 * The stroke-weight scale, shared by the rail's stroke control and the
 * panel's Stroke section so the two offer the same numbers.
 *
 * Illustrator's steps: quarter-point hairlines at the bottom, whole units in
 * the middle, doubling at the top. Weights are px, the unit every other length
 * in the app is measured in, and are stored exactly as typed — 0.3 is a
 * legitimate weight, the presets are only the common ones.
 */
export const STROKE_WEIGHTS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
export const MIN_STROKE_WEIGHT = 0.25;
export const MAX_STROKE_WEIGHT = 100;
/** One arrow press or one scrub step. */
export const STROKE_WEIGHT_STEP = 0.25;
/** One Shift+arrow press: a whole unit, as Illustrator steps. */
export const STROKE_WEIGHT_COARSE_STEP = 1;
export const STROKE_WEIGHT_UNIT = 'px';

/** A weight as a person reads it: `0.25`, `1.5`, `2`, never `0.30000000000000004`. */
export function formatWeight(width: number): string {
  if (!Number.isFinite(width)) return '0';
  return String(Math.round(width * 100) / 100);
}

/** A typed or scrubbed weight, held to the scale's range and to two decimals. */
export function clampWeight(width: number): number {
  if (!Number.isFinite(width)) return MIN_STROKE_WEIGHT;
  return Math.round(Math.min(MAX_STROKE_WEIGHT, Math.max(MIN_STROKE_WEIGHT, width)) * 100) / 100;
}

/**
 * The stroke weight an object is actually drawn at.
 *
 * The same rule the renderers apply (`ShapeRenderer`, `ConnectorRenderer`,
 * `PathRenderer`): a run is never drawn with nothing, so an unset weight on a
 * line, a connector or an unfilled pen path draws at 2. A closed shape or a
 * pencil stroke draws its stored weight, where 0 means no outline.
 */
export function drawnStrokeWidth(node: AnyNode): number {
  const appearance = ('appearance' in node ? (node.appearance as Appearance | undefined) : undefined) ?? {};
  const stored = appearance.stroke?.width ?? 0;
  switch (node.type) {
    case 'connector':
      return stored || RUN_DEFAULT_WIDTH;
    case 'shape':
      return isOpenShape(node.geometry.kind) ? stored || RUN_DEFAULT_WIDTH : stored;
    case 'path':
      if (node.geometry.kind === 'freehand') return stored;
      return stored > 0 ? stored : appearance.fill?.length ? 0 : RUN_DEFAULT_WIDTH;
    default:
      return stored;
  }
}
