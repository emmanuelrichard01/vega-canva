/**
 * The node types that can sit in a grid module.
 *
 * Kept free of imports so the document's read boundary can ask without pulling
 * the layout engine in. Connectors, comments and frames are excluded because
 * their geometry is not a box: a connector is derived from its ends, a comment
 * is a pin, a frame owns children that would have to move with it. Grids are
 * excluded so a grid cannot contain itself. `isSlottable` in `gridReflow.ts`
 * also excludes open shapes (lines, arrows).
 */
export const SLOTTABLE_TYPES: ReadonlySet<string> = new Set([
  'image',
  'text',
  'shape',
  'sticky',
  'chart',
  'table',
  'code',
  'link',
  'audio',
]);
