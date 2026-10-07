import React from 'react';
import { MousePointerSquareDashed, PenTool } from 'lucide-react';
import { doc } from '../../../engine/document';
import { flattenToPath } from '../../../engine/document/vectorOps';
import { isOpenShape, type AnyNode } from '../../../engine/model/schema';
import type { MenuEntry, MenuItemEntry, MenuSubmenuEntry } from '../../menu/menuModel';

/**
 * What the rail's `⋯` adds to the right-click menu for a multiple selection.
 *
 * The `⋯` is the context menu; these are the few rows a selection of several
 * needs that the menu does not yet carry for one. Each is added only when the
 * menu has no row with the same id, so the day the menu grows its own, the
 * rail's copy steps aside instead of doubling it.
 */

const I = 14;

/** Closed shapes that can become pen paths, beside paths that already are. */
export function convertibleToPath(nodes: readonly AnyNode[]): string[] {
  const shapes = nodes.filter((n) => n.type === 'shape' && !isOpenShape(n.geometry.kind) && !n.locked);
  const rest = nodes.filter((n) => !shapes.includes(n));
  // Only when the whole selection would end up as editable paths.
  if (shapes.length === 0 || !rest.every((n) => n.type === 'path' && n.geometry.kind !== 'freehand')) return [];
  return shapes.map((n) => n.id);
}

/** Every closed shape in the selection to a pen path, as one undo step, keeping the selection. */
export function convertSelectionToPaths(nodes: readonly AnyNode[]): void {
  const ids = convertibleToPath(nodes);
  if (ids.length === 0) return;
  const made: string[] = [];
  doc.transact(() => {
    for (const id of ids) {
      const next = flattenToPath(id);
      if (next) made.push(next);
    }
  });
  const kept = nodes.filter((n) => !ids.includes(n.id)).map((n) => n.id);
  window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [...kept, ...made] } }));
}

export type SimilarKey = 'fill' | 'stroke' | 'type' | 'font';

const SIMILAR: { key: SimilarKey; label: string }[] = [
  { key: 'fill', label: 'Same fill' },
  { key: 'stroke', label: 'Same stroke' },
  { key: 'type', label: 'Same type' },
  { key: 'font', label: 'Same font' },
];

/** Widen the selection to everything sharing one property with it. */
export function requestSelectSimilar(key: SimilarKey): void {
  window.dispatchEvent(new CustomEvent('requestSelectSimilar', { detail: { key } }));
}

function hasId(entries: readonly MenuEntry[], id: string): boolean {
  return entries.some(
    (e) =>
      e.id === id ||
      (e.kind === 'submenu' && Array.isArray(e.entries) && hasId(e.entries, id)) ||
      (e.kind === 'strip' && e.items.some((item) => item.id === id))
  );
}

/** The menu for a multiple selection, with the rail's additions folded in where they belong. */
export function withMultiSelectExtras(entries: MenuEntry[], nodes: readonly AnyNode[]): MenuEntry[] {
  const out = [...entries];

  const similar: MenuItemEntry[] = SIMILAR.filter(({ key }) => !hasId(out, `select-same-${key}`)).map(
    ({ key, label }) => ({
      kind: 'item',
      id: `select-same-${key}`,
      label,
      icon: <MousePointerSquareDashed size={I} />,
      onSelect: () => requestSelectSimilar(key),
    })
  );
  if (similar.length > 0) {
    const at = out.findIndex((e) => e.kind === 'submenu' && e.id === 'select');
    if (at >= 0) {
      const select = out[at] as MenuSubmenuEntry;
      out[at] = { ...select, entries: [...similar, ...(select.entries ?? [])] };
    } else {
      out.push({ kind: 'submenu', id: 'select', label: 'Select', icon: <MousePointerSquareDashed size={I} />, entries: similar });
    }
  }

  if (convertibleToPath(nodes).length > 0 && !hasId(out, 'to-path')) {
    const convert: MenuItemEntry = {
      kind: 'item',
      id: 'to-path',
      label: 'Convert to path',
      detail: 'Turns the shapes into pen paths, so their points can be edited',
      icon: <PenTool size={I} />,
      onSelect: () => convertSelectionToPaths(nodes),
    };
    const at = out.findIndex((e) => e.kind === 'submenu' && e.id === 'vector');
    if (at >= 0) {
      const vector = out[at] as MenuSubmenuEntry;
      out[at] = { ...vector, entries: [convert, ...(vector.entries ?? [])] };
    } else {
      // With the selection-specific rows at the top, above their rule.
      const rule = out.findIndex((e) => e.id === 'sep-specific');
      if (rule >= 0) out.splice(rule, 0, convert);
      else out.unshift(convert, { kind: 'separator', id: 'sep-specific' });
    }
  }
  return out;
}
