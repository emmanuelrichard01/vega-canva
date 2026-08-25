import * as Y from 'yjs';
import { normalizeRecipe } from './gridNode';

/**
 * Fold grids that were stored as groups into single grid nodes.
 *
 * ## Why this runs rather than being left as a second code path
 *
 * Grids shipped first as a `GroupRecord` carrying a recipe plus N loose shape
 * nodes carrying their own coordinates, and that model is the entire reason the
 * gaps drifted on every move: there was no single answer to where the grid was,
 * so seven separate gestures each had to keep the recipe and the members in
 * step, and each of them was a place to get it wrong.
 *
 * Keeping both models alive would keep the bug alive on every board that
 * already has a grid on it, and would double the surface of every grid feature
 * from here on. So the old shape is converted on load, once, and then does not
 * exist.
 *
 * The conversion is **lossy on purpose**: the members are deleted and the grid
 * is redrawn from its recipe. That is exactly what a recipe is for, and it is
 * also honest -- the recipe was always the source of the composition, and any
 * per-member edit made through the properties panel was already being
 * overwritten by the next gutter change.
 *
 * Written against plain `Y.Map`s rather than the document singletons in
 * `./doc`, for the same reason `migrateDoc` is: those construct a websocket
 * provider at module scope and cannot be reached from a test runner.
 *
 * @returns how many grids were converted.
 */
export function migrateGridGroups(
  target: Y.Doc,
  nodes: Y.Map<Y.Map<unknown>>,
  groups: Y.Map<Record<string, unknown>>
): number {
  /** Every group that carries a recipe, with the members it owns. */
  const gridGroups = new Map<string, { recipe: unknown; members: string[] }>();

  groups.forEach((record, id) => {
    const raw = record as { grid?: unknown };
    if (raw?.grid) gridGroups.set(id, { recipe: raw.grid, members: [] });
  });
  if (gridGroups.size === 0) return 0;

  nodes.forEach((ymap, id) => {
    const parent = ymap.get('parentId');
    if (typeof parent === 'string' && gridGroups.has(parent)) {
      gridGroups.get(parent)!.members.push(id);
    }
  });

  let converted = 0;

  target.transact(() => {
    gridGroups.forEach((group, groupId) => {
      /**
       * The box comes from the members, not from the recipe's own spec.
       *
       * Those two disagreeing is the condition being migrated away from, and
       * where they disagree the members are the truth: they are what is on the
       * screen. A recipe whose box had drifted would move the grid on load,
       * which is the one thing a migration must not do.
       */
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let zIndex = 0;
      let parentId: string | undefined;
      let frameId: string | undefined;

      for (const id of group.members) {
        const m = nodes.get(id);
        if (!m) continue;
        const x = Number(m.get('x')) || 0;
        const y = Number(m.get('y')) || 0;
        const w = Number(m.get('width')) || 0;
        const h = Number(m.get('height')) || 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        zIndex = Math.max(zIndex, Number(m.get('zIndex')) || 0);
        // The grid inherits whatever containment its members shared. A group
        // nested inside another group is the case this preserves.
        const gp = groups.get(groupId) as { parentId?: string } | undefined;
        parentId = gp?.parentId;
        const f = m.get('frameId');
        if (typeof f === 'string') frameId = f;
      }

      // Nothing measurable to convert -- an empty grid group, which is a
      // leftover rather than a grid. Removing it is the whole fix.
      if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
        group.members.forEach((id) => nodes.delete(id));
        groups.delete(groupId);
        return;
      }

      const width = maxX - minX;
      const height = maxY - minY;

      // The group's own id becomes the node's. Anything still pointing at the
      // grid -- a selection restored from session state, a connector bound to
      // it -- keeps pointing at a grid rather than at nothing.
      const node = new Y.Map<unknown>();
      const fields: Record<string, unknown> = {
        id: groupId,
        type: 'grid',
        x: minX,
        y: minY,
        width,
        height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex,
        locked: false,
        hidden: false,
        createdBy: 'unknown',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(parentId ? { parentId } : null),
        ...(frameId ? { frameId } : null),
        grid: normalizeRecipe(group.recipe, width, height),
      };
      Object.entries(fields).forEach(([k, v]) => node.set(k, v));

      group.members.forEach((id) => nodes.delete(id));
      groups.delete(groupId);
      nodes.set(groupId, node as Y.Map<unknown> as never);
      converted++;
    });
  });

  return converted;
}
