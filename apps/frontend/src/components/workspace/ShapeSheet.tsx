import React from 'react';
import { ShapeIcon } from './shapeIcons';
import { SHAPE_BY_PRESET, SHAPE_CATEGORIES, type ShapePreset } from './shapeCatalog';
import { DockSheet, type SheetSection } from './DockSheet';

/**
 * The Shape seat's sheet: every shape once, icon-only, eight across.
 *
 * What it replaces is a `KindPicker` with six category tabs, a search, a
 * recent row, group headings inside each tab and 74px labelled tiles -- four
 * ways to navigate forty-odd pictures. See `DockSheet` for the layout.
 *
 * Each shape appears **once**, under the first family that lists it. The
 * catalogue cross-lists (a diamond is Basic *and* Flowchart), which made
 * sense behind tabs; on one scroll it only means meeting the diamond twice.
 *
 * Recent shapes are not here: they are on the shelf while a shape is armed,
 * one step closer than a row inside a menu.
 */
const SECTIONS: SheetSection<ShapePreset>[] = (() => {
  const seen = new Set<ShapePreset>();
  return SHAPE_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.name,
    items: category.groups
      .flatMap((group) => group.presets)
      .filter((preset) => {
        if (seen.has(preset)) return false;
        seen.add(preset);
        return true;
      })
      .map((preset) => ({
        id: preset,
        label: SHAPE_BY_PRESET[preset].label,
        hint: SHAPE_BY_PRESET[preset].hint,
        keywords: SHAPE_BY_PRESET[preset].keywords,
        icon: <ShapeIcon kind={preset} size={20} />,
      })),
  })).filter((section) => section.items.length > 0);
})();

const TOTAL = SECTIONS.reduce((n, section) => n + section.items.length, 0);

export const ShapeSheet: React.FC<{
  value: ShapePreset | null;
  onPick: (preset: ShapePreset) => void;
  focusSearch?: boolean;
}> = ({ value, onPick, focusSearch }) => (
  <DockSheet
    variant="icon"
    columns={8}
    width={318}
    height={300}
    searchPlaceholder={`Search ${TOTAL} shapes`}
    sections={SECTIONS}
    value={value}
    onPick={onPick}
    focusSearch={focusSearch}
    idle="Click the board to place one, or drag to size it"
  />
);
