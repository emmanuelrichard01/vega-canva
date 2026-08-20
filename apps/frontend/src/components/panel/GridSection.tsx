import React from 'react';
import { Dices, Shuffle, Sparkles } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { GridKindIcon } from '../workspace/gridIcons';
import { NumberStepper } from '../ui/NumberStepper';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Slider } from '../ui/Slider';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { gridRecipe, refitGrid, relayoutGrid } from '../../engine/grid/gridApply';
import { reroll, withSpec, withStyle, type GridRecipe } from '../../engine/grid/gridBuild';
import { GRID_HINTS, GRID_KINDS, GRID_LABELS, type GridKind } from '../../engine/grid/gridLayout';
import {
  CELL_SHAPES,
  COLOR_MODES,
  COLOR_MODE_LABELS,
  GRID_PALETTES,
  SHAPE_LABELS,
  type CellShape,
  type ColorMode,
} from '../../engine/grid/gridStyle';

/**
 * Editing a grid after it exists.
 *
 * ## Why this is a panel section and not a dialog
 *
 * Nobody chooses a grid; they *try* grids. The questions are all comparative —
 * is four columns better than three, does this palette carry the hierarchy —
 * and every one of them is answered by looking at the board, not at a preview
 * inside a modal that covers it. A section in the panel that is already open
 * puts every control one click from the thing it changes.
 *
 * ## Why every control re-lays rather than regenerates
 *
 * `relayoutGrid` reconciles: nodes are matched by cell index, so one more
 * column updates what is there and adds three. Regenerating would break
 * connectors bound to those ids, drop anything placed inside a cell, and put
 * thirty deletions in the history for one adjustment.
 *
 * ## The seed, and why there are two of them
 *
 * Layout randomness and colour randomness re-roll separately. A single "give me
 * another" that moved both would make it impossible to keep an arrangement you
 * liked while trying colours against it, which is most of what anyone does with
 * a generator.
 */

interface Props {
  /** The group under the selection, if the selection is a whole grid. */
  groupId: string;
}

export const GridSection: React.FC<Props> = ({ groupId }) => {
  const recipe = useStore((s) => s.groups[groupId]?.grid ?? null);
  if (!recipe) return null;

  /**
   * Every change re-reads the grid's box from where it actually sits.
   *
   * The transformer scales the *nodes*, so after a resize the recipe still
   * describes the box the grid used to occupy — and the next gutter change
   * would snap everything back to it. Refitting first is what keeps one
   * adjustment from silently undoing another.
   */
  const apply = (next: GridRecipe) => {
    const fitted = refitGrid(groupId);
    relayoutGrid(groupId, fitted ? { ...next, spec: { ...next.spec, ...boxOf(fitted) } } : next);
  };

  const patchSpec = (patch: Parameters<typeof withSpec>[1]) => apply(withSpec(recipe, patch));
  const patchStyle = (patch: Parameters<typeof withStyle>[1]) => apply(withStyle(recipe, patch));

  /** Which kinds care about rows, and which about columns. A control that does nothing is worse than none. */
  const usesRows = !['columns', 'manuscript'].includes(recipe.spec.kind);
  const usesColumns = !['manuscript', 'baseline'].includes(recipe.spec.kind);
  const usesVariation = !['columns', 'modular'].includes(recipe.spec.kind);

  return (
    <div className="grid-section">
      {/* The system. Ten miniatures rather than a dropdown of ten words,
          because a grid system is a picture and the words mean nothing until
          you have seen one. */}
      <div className="grid-section__kinds" role="radiogroup" aria-label="Grid system">
        {GRID_KINDS.map((kind: GridKind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={recipe.spec.kind === kind}
            className="grid-kind"
            data-active={recipe.spec.kind === kind || undefined}
            data-tooltip={`${GRID_LABELS[kind]} — ${GRID_HINTS[kind]}`}
            onClick={() => patchSpec({ kind })}
          >
            <GridKindIcon kind={kind} size={22} />
            <span className="grid-kind__label">{GRID_LABELS[kind]}</span>
          </button>
        ))}
      </div>

      <p className="grid-section__hint">{GRID_HINTS[recipe.spec.kind]}</p>

      {/* Tracks. */}
      <div className="grid-section__row">
        {usesRows && (
          <label className="grid-field">
            <span>Rows</span>
            <NumberStepper value={recipe.spec.rows} min={1} max={24} onChange={(rows) => patchSpec({ rows })} />
          </label>
        )}
        {usesColumns && (
          <label className="grid-field">
            <span>Columns</span>
            <NumberStepper value={recipe.spec.columns} min={1} max={24} onChange={(columns) => patchSpec({ columns })} />
          </label>
        )}
      </div>

      {/* Gutters, separately per axis, because they are read separately: a
          wide horizontal gutter with a tight vertical one is a real layout and
          one number could not express it. */}
      <div className="grid-section__row">
        <label className="grid-field">
          <span>Gap across</span>
          <NumberStepper value={recipe.spec.gutterX} min={0} max={200} onChange={(gutterX) => patchSpec({ gutterX })} />
        </label>
        <label className="grid-field">
          <span>Gap down</span>
          <NumberStepper value={recipe.spec.gutterY} min={0} max={200} onChange={(gutterY) => patchSpec({ gutterY })} />
        </label>
      </div>

      <div className="grid-section__row">
        <label className="grid-field">
          <span>Margin</span>
          <NumberStepper value={recipe.spec.margin} min={0} max={400} onChange={(margin) => patchSpec({ margin })} />
        </label>
        <button
          type="button"
          className="grid-link"
          data-tooltip="Match the gaps to each other"
          onClick={() => patchSpec({ gutterY: recipe.spec.gutterX })}
        >
          Match gaps
        </button>
      </div>

      {usesVariation && (
        <label className="grid-field grid-field--wide">
          <span>Variation</span>
          <Slider
            label="Variation"
            value={Math.round(recipe.spec.variation * 100)}
            min={0}
            max={100}
            onChange={(v) => patchSpec({ variation: v / 100 })}
          />
        </label>
      )}

      {/* Shapes. */}
      <div className="grid-section__label">Cells</div>
      <SegmentedControl
        ariaLabel="Shape mode"
        value={recipe.style.shapeMode}
        onChange={(shapeMode) => patchStyle({ shapeMode: shapeMode as 'uniform' | 'mixed' })}
        segments={[
          { value: 'uniform', label: 'One shape', hint: 'Every cell the same' },
          { value: 'mixed', label: 'Mixed', hint: 'Drawn from the shapes you pick' },
        ]}
      />

      <div className="grid-section__shapes" role="group" aria-label="Cell shapes">
        {CELL_SHAPES.map((shape: CellShape) => {
          const on = recipe.style.shapes.includes(shape);
          return (
            <button
              key={shape}
              type="button"
              className="grid-shape"
              data-active={on || undefined}
              aria-pressed={on}
              data-tooltip={SHAPE_LABELS[shape]}
              onClick={() => {
                /**
                 * In uniform mode a click *replaces*; in mixed mode it toggles.
                 *
                 * One control, two readings, because the mode above already
                 * said which question is being asked — and a separate picker
                 * per mode would be two lists to keep in step.
                 */
                if (recipe.style.shapeMode === 'uniform') {
                  patchStyle({ shapes: [shape] });
                  return;
                }
                const next = on
                  ? recipe.style.shapes.filter((s) => s !== shape)
                  : [...recipe.style.shapes, shape];
                // Never empty: a grid of nothing is not a state worth reaching.
                patchStyle({ shapes: next.length > 0 ? next : [shape] });
              }}
            >
              <ShapeGlyph shape={shape} />
            </button>
          );
        })}
      </div>

      <div className="grid-section__row">
        <label className="grid-field">
          <span>Corners</span>
          <NumberStepper value={recipe.style.radius} min={0} max={200} onChange={(radius) => patchStyle({ radius })} />
        </label>
        <label className="grid-field">
          <span>Stroke</span>
          <NumberStepper
            value={recipe.style.strokeWidth}
            min={0}
            max={40}
            onChange={(strokeWidth) => patchStyle({ strokeWidth })}
          />
        </label>
      </div>

      {recipe.style.strokeWidth > 0 && (
        <label className="grid-field grid-field--wide">
          <span>Stroke colour</span>
          <ColorPickerPopover
            color={recipe.style.strokeColor}
            onChange={(strokeColor) => patchStyle({ strokeColor })}
          />
        </label>
      )}

      <label className="grid-field grid-field--wide">
        <span>Opacity</span>
        <Slider
          label="Opacity"
          value={Math.round(recipe.style.opacity * 100)}
          min={0}
          max={100}
          onChange={(v) => patchStyle({ opacity: v / 100 })}
        />
      </label>

      {/* Colour. */}
      <div className="grid-section__label">Colour</div>
      <div className="grid-section__palettes" role="radiogroup" aria-label="Palette">
        {GRID_PALETTES.map((palette) => {
          const on = palette.colors.join() === recipe.style.palette.join();
          return (
            <button
              key={palette.id}
              type="button"
              role="radio"
              aria-checked={on}
              className="grid-palette"
              data-active={on || undefined}
              data-tooltip={palette.name}
              onClick={() => patchStyle({ palette: palette.colors })}
            >
              {palette.colors.map((c) => (
                <span key={c} className="grid-palette__chip" style={{ background: c }} />
              ))}
            </button>
          );
        })}
      </div>

      {/* Swatch-level editing, so a shipped palette is a starting point rather
          than the only answer. */}
      <div className="grid-section__swatches">
        {recipe.style.palette.map((color, i) => (
          <ColorPickerPopover
            key={i}
            color={color}
            onChange={(next) => {
              const palette = [...recipe.style.palette];
              palette[i] = next;
              patchStyle({ palette });
            }}
          />
        ))}
      </div>

      <label className="grid-field grid-field--wide">
        <span>Assignment</span>
        <select
          className="grid-select"
          value={recipe.style.colorMode}
          onChange={(e) => patchStyle({ colorMode: e.target.value as ColorMode })}
        >
          {COLOR_MODES.map((mode) => (
            <option key={mode} value={mode}>{COLOR_MODE_LABELS[mode]}</option>
          ))}
        </select>
      </label>

      {/* Two dice, not one. See the note at the top of this file. */}
      <div className="grid-section__rolls">
        <button type="button" className="grid-roll" onClick={() => apply(reroll(recipe, 'layout'))}>
          <Shuffle size={14} /> Arrangement
        </button>
        <button type="button" className="grid-roll" onClick={() => apply(reroll(recipe, 'colour'))}>
          <Sparkles size={14} /> Colour
        </button>
        <button type="button" className="grid-roll" onClick={() => apply(reroll(recipe, 'both'))}>
          <Dices size={14} /> Both
        </button>
      </div>
    </div>
  );
};

/** The recipe's own box, for carrying a refit forward. */
function boxOf(recipe: GridRecipe) {
  const { x, y, width, height } = recipe.spec;
  return { x, y, width, height };
}

/** A cell shape at swatch size, drawn rather than named. */
const ShapeGlyph: React.FC<{ shape: CellShape }> = ({ shape }) => {
  const d: Record<CellShape, React.ReactNode> = {
    rect: <rect x={2} y={2} width={14} height={14} rx={3} />,
    ellipse: <circle cx={9} cy={9} r={7} />,
    triangle: <polygon points="9,2 16,16 2,16" />,
    diamond: <polygon points="9,1 17,9 9,17 1,9" />,
    hexagon: <polygon points="9,1 16,5 16,13 9,17 2,13 2,5" />,
    star: <polygon points="9,1 11,7 17,7 12,11 14,17 9,13 4,17 6,11 1,7 7,7" />,
  };
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" fill="currentColor" aria-hidden>
      {d[shape]}
    </svg>
  );
};

/**
 * Whether a selection is exactly one grid, and which.
 *
 * Exported so the properties panel can ask without importing the whole grid
 * engine, and so the answer is written once — the section, the context toolbar
 * and anything else that wants to offer a grid control all need the same test.
 */
export function gridGroupFor(selectedIds: readonly string[]): string | null {
  const { objects, groups } = useStore.getState();
  if (selectedIds.length === 0) return null;
  const parent = objects[selectedIds[0]]?.parentId;
  if (!parent || !groups[parent]?.grid) return null;
  // Every selected node must belong to it, or the controls would re-lay cells
  // the user has not selected — which is a bulk edit nobody asked for.
  return selectedIds.every((id) => objects[id]?.parentId === parent) ? parent : null;
}

/** The live recipe for a group, for callers outside React. */
export { gridRecipe };
