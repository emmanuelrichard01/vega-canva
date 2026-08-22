import { gridRecipe } from './gridApply';

/**
 * The grid group record that owns this selection, or null when the selection
 * is not a single grid.
 */
export function gridGroupOf(
  nodes: readonly { id: string; parentId?: string }[],
  groups: Readonly<Record<string, { grid?: unknown }>>
): string | null {
  if (nodes.length === 0) return null;
  const parent = nodes[0].parentId;
  if (!parent || !groups[parent]?.grid) return null;
  return nodes.every((n) => n.parentId === parent) ? parent : null;
}

export { gridRecipe };
