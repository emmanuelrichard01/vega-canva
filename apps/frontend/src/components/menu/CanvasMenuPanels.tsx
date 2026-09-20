import React, { useState } from 'react';
import { KindPicker } from '../workspace/KindPicker';
import {
  SHAPE_FACETS,
  SHAPE_GLYPH,
  SHAPE_TILE,
  shapeGroups,
} from '../workspace/shapePicker';
import type { ShapePreset } from '../workspace/shapeCatalog';

/** The swatch beside Paste style: what is on the style clipboard, as a colour. */
export const StyleSwatch: React.FC<{ color: string | null }> = ({ color }) =>
  color ? <span className="menu__swatch" style={{ background: color }} aria-hidden="true" /> : null;

/**
 * The shape swapper, as the dock's own picker.
 *
 * The menu used to lay every shape out inline — sixty glyphs, most of the
 * menu's height, for a choice most right-clicks are not about. Behind a
 * submenu it costs one row, and it gains the dock's categories and search.
 */
export const ShapeSwapPanel: React.FC<{
  value: ShapePreset | null;
  onPick: (preset: ShapePreset) => void;
}> = ({ value, onPick }) => {
  const [facet, setFacet] = useState(() =>
    value ? SHAPE_FACETS.find((f) => shapeGroups(f.id).some((g) => g.options.some((o) => o.id === value)))?.id ?? 'basic' : 'basic'
  );
  return (
    <div className="menu__picker">
      <KindPicker
        columns={5}
        tile={SHAPE_TILE - 8}
        search
        searchPlaceholder="Search shapes"
        groups={shapeGroups(facet, SHAPE_GLYPH - 2)}
        facets={SHAPE_FACETS}
        activeFacet={facet}
        onFacet={setFacet}
        value={value}
        onPick={onPick}
      />
    </div>
  );
};

/** The picker behind "Add shape here": the dock's own sheet, placing where you clicked. */
export const AddShapePanel: React.FC<{ onPick: (preset: ShapePreset) => void }> = ({ onPick }) => {
  const [facet, setFacet] = useState('basic');
  return (
    <div className="menu__picker">
      <KindPicker
        columns={5}
        tile={SHAPE_TILE - 8}
        search
        searchPlaceholder="Search shapes"
        groups={shapeGroups(facet, SHAPE_GLYPH - 2)}
        facets={SHAPE_FACETS}
        activeFacet={facet}
        onFacet={setFacet}
        value={null}
        onPick={onPick}
      />
    </div>
  );
};
