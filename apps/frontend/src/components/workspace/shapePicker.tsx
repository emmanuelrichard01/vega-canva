import React from 'react';
import { ShapeIcon } from './shapeIcons';
import {
  SHAPE_BY_PRESET,
  SHAPE_CATEGORIES,
  SHAPE_PRESETS,
  presetForKind,
  type ShapePreset,
} from './shapeCatalog';
import type { KindFacet, KindGroup, KindOption } from './KindPicker';
import type { ShapeGeometry, ShapeKind } from '../../engine/model/schema';

/**
 * The shape picker's contents, for whichever surface is asking.
 *
 * ## Why this is shared
 *
 * Two surfaces ask "which shape": the dock, before you draw one, and the
 * contextual rail, to change one you have already drawn. `CanvasContextMenu`
 * asks a third time. All three had their own array, and its own docstring
 * warned about exactly what had happened to it:
 *
 * > a swapper that knew about a shape the toolbar did not — or the reverse —
 * > would make what you can turn a box into depend on where you asked.
 *
 * It did. The dock offered forty-two, the rail twenty-two and the menu
 * twenty-one, with different membership: no pentagon or octagon in the menu, no
 * hexagon in the rail's row where the menu had one. The same shape carried a
 * different name in two of them ("Capsule" and "Capsule (Pill)") and a
 * different *picture* in two of them — the menu drew a generic Lucide square
 * for a rectangle and a Lucide star for a star, while the rail drew the real
 * outline of both.
 *
 * One list, one name, one glyph, everywhere.
 */

/**
 * How wide one tile is, and how big the glyph inside it is.
 *
 * Both measured rather than chosen. At the picker's 62px default the tile came
 * out 56.5px wide, which is narrower than "Rounded rectangle" at 10px even
 * across two lines — so a third of the set was reading as clipped words. And
 * six category tabs need 403px of strip, which a 372px panel cannot show: the
 * last one, Symbols, was cut off mid-word with nothing to say it was there.
 *
 * 74 fixes both at once: the labels fit, and six columns make a panel wide
 * enough for the tabs above them. The glyph goes up with the tile — at 20px in
 * a 74px cell the picture is a third of its own tile, and a shape library whose
 * pictures are the smallest thing on it has the emphasis backwards.
 */
export const SHAPE_TILE = 74;
export const SHAPE_GLYPH = 24;

const option = (preset: ShapePreset, size: number): KindOption<ShapePreset> => {
  const entry = SHAPE_BY_PRESET[preset];
  return {
    id: preset,
    label: entry.label,
    hint: entry.hint,
    keywords: entry.keywords,
    icon: <ShapeIcon kind={preset} size={size} />,
  };
};

/** The tabs, in the order the catalogue declares them. */
export const SHAPE_FACETS: readonly KindFacet[] = SHAPE_CATEGORIES.map((c) => ({
  id: c.id,
  label: c.name,
}));

/** The named runs inside one category, as the picker wants them. */
export function shapeGroups(categoryId: string, size = 20): KindGroup<ShapePreset>[] {
  const category = SHAPE_CATEGORIES.find((c) => c.id === categoryId) ?? SHAPE_CATEGORIES[0];
  return category.groups.map((group) => ({
    id: `${category.id}:${group.name}`,
    label: group.name,
    options: group.presets.map((p) => option(p, size)),
  }));
}

/** Every closed shape as one flat run, for a surface with no room for tabs. */
export function allShapeOptions(size = 20): KindOption<ShapePreset>[] {
  return SHAPE_PRESETS.map((p) => option(p, size));
}

export const shapeOption = option;

/**
 * Which tile a node's geometry corresponds to.
 *
 * A preset carries a side count and a kind does not, so a hexagon and an
 * octagon are one kind and two tiles; the picker has to light the right one.
 * Falls back to the first preset for the kind, which is exact for every kind
 * that has only one.
 */
export function presetForGeometry(geometry: ShapeGeometry): ShapePreset {
  if (geometry.kind === 'polygon' || geometry.kind === 'star' || geometry.kind === 'badge') {
    const match = SHAPE_PRESETS.find(
      (p) =>
        SHAPE_BY_PRESET[p].geometry.kind === geometry.kind &&
        SHAPE_BY_PRESET[p].geometry.points === geometry.points
    );
    if (match) return match;
  }
  return presetForKind(geometry.kind as ShapeKind);
}
