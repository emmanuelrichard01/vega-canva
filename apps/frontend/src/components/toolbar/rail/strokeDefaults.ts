import { isOpenShape, type AnyNode, type Appearance } from '../../../engine/model/schema';

/** What the renderers draw a line, arrow, connector or unfilled pen path at when no weight is stored. */
export const RUN_DEFAULT_WIDTH = 2;

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
