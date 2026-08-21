import React from 'react';
import { Dices, Link2, Shuffle, Sparkles, Unlink2, Wand2 } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { GridKindIcon } from '../workspace/gridIcons';
import { NumberStepper } from '../ui/NumberStepper';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Slider } from '../ui/Slider';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { gridRecipe, refitGrid, relayoutGrid } from '../../engine/grid/gridApply';
import {
  randomiseRecipe,
  reroll,
  switchKind,
  withSpec,
  withStyle,
  type GridRecipe,
} from '../../engine/grid/gridBuild';
import {
  GRID_HINTS,
  GRID_KINDS,
  GRID_LABELS,
  VARIATION_LABELS,
  type GridKind,
} from '../../engine/grid/gridLayout';
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
  /**
   * Whether the two gaps move together.
   *
   * Local rather than stored: it is a way of *editing*, not a property of the
   * grid, and a collaborator who unlinks their gaps has not changed the board.
   * Starts on, because a grid with matching gaps is what almost everyone wants
   * and the link is easier to notice when breaking it is the deliberate act.
   */
  const [linked, setLinked] = React.useState(true);
  // Subscribed to, not merely read: the section has to re-render when a peer
  // re-lays the grid, and when this client's own relayout lands.
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
    /**
     * Carry any move or resize into the box before re-laying.
     *
     * `refitGrid` compares where the recipe says its cells should be against
     * where they are, so an untouched grid returns unchanged and a dragged one
     * returns the same transform applied to its box. Skipping this would make
     * the first panel edit after a resize snap the grid back to where it used
     * to be; measuring the members' bounds instead would shrink it a little on
     * every edit, for every layout that leaves slack inside its box.
     */
    const fitted = refitGrid(groupId);
    relayoutGrid(groupId, fitted ? { ...next, spec: { ...next.spec, ...boxOf(fitted) } } : next);
  };

  const patchSpec = (patch: Parameters<typeof withSpec>[1]) => apply(withSpec(recipe, patch));
  const patchStyle = (patch: Parameters<typeof withStyle>[1]) => apply(withStyle(recipe, patch));

  /** Which kinds care about rows, and which about columns. A control that does nothing is worse than none. */
  const usesRows = !['columns', 'manuscript'].includes(recipe.spec.kind);
  const usesColumns = !['manuscript', 'baseline'].includes(recipe.spec.kind);
  /**
   * What the dial is called here, which is different in every kind.
   *
   * It opens a hole in the dial, mixes the compartments in a bento box, sizes
   * the hero of a hierarchy and shears a cascade. One word for four controls
   * meant the only way to learn which was to drag it and watch. `golden` has no
   * notion of it and gets no slider, rather than a slider that does nothing.
   */
  const variationLabel = VARIATION_LABELS[recipe.spec.kind];

  return (
    <div className="grid-section">
      {/* The system. Ten miniatures rather than a dropdown of ten words,
          because a grid system is a picture and the words mean nothing until
          you have seen one. */}
      {/* Switching kind brings that kind's own track counts with it -- see
          `KIND_DEFAULTS`. The same two fields mean twelve spokes to a dial and
          three modules to a modular grid, so carrying the old numbers across
          would show most kinds at their worst. */}
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
            onClick={() => apply(switchKind(recipe, kind))}
          >
            {/* No label under the tile.
                Five across a 260px panel leaves about forty pixels a word, so
                "Hierarchical" and "Manuscript" both arrived as "Hier..." --
                which identifies nothing and takes a line to do it. The caption
                below names whichever is chosen, in full, and the tooltip names
                the rest. */}
            <GridKindIcon kind={kind} size={24} />
          </button>
        ))}
      </div>

      {/* The caption carries the name the tiles no longer show, and the one
          line explaining what the system is *for*. Both belong to the current
          choice, so they sit under the picker rather than inside it. */}
      <p className="grid-section__hint">
        <strong>{GRID_LABELS[recipe.spec.kind]}</strong>
        {' '}
        {GRID_HINTS[recipe.spec.kind]}
      </p>

      {/* Tracks. */}
      <div className="grid-section__row">
        {usesRows && (
          <label className="grid-field">
            <span>{recipe.spec.kind === 'radial' ? 'Rings' : 'Rows'}</span>
            <NumberStepper value={recipe.spec.rows} min={1} max={24} onChange={(rows) => patchSpec({ rows })} />
          </label>
        )}
        {usesColumns && (
          <label className="grid-field">
            {/* A dial is divided into spokes and a spiral into steps. Calling
                both "columns" is the same failure as calling four different
                controls "variation". */}
            <span>
              {recipe.spec.kind === 'radial' ? 'Spokes'
                : recipe.spec.kind === 'golden' ? 'Steps'
                : 'Columns'}
            </span>
            <NumberStepper value={recipe.spec.columns} min={1} max={24} onChange={(columns) => patchSpec({ columns })} />
          </label>
        )}
      </div>

      {/**
        * Two gaps with a link between them, not two gaps and a button.
        *
        * "Match gaps" was a labelled button sitting beside Margin, which put a
        * control for the row above inside the row below and made it read as
        * something Margin did. A chain between the two fields is the pattern
        * every inspector uses for a locked pair -- including the width and
        * height a few sections up -- and it says which two things it binds by
        * being between them.
        */}
      <div className="grid-section__gaps">
        <label className="grid-field">
          <span>Gap across</span>
          <NumberStepper
            value={recipe.spec.gutterX}
            min={0}
            max={200}
            onChange={(gutterX) => patchSpec(linked ? { gutterX, gutterY: gutterX } : { gutterX })}
          />
        </label>
        <button
          type="button"
          className="grid-lock"
          data-active={linked || undefined}
          aria-pressed={linked}
          data-tooltip={linked ? 'Gaps are linked' : 'Link the gaps'}
          aria-label={linked ? 'Unlink the gaps' : 'Link the gaps'}
          onClick={() => {
            const next = !linked;
            setLinked(next);
            if (next) patchSpec({ gutterY: recipe.spec.gutterX });
          }}
        >
          {linked ? <Link2 size={13} /> : <Unlink2 size={13} />}
        </button>
        <label className="grid-field">
          <span>Gap down</span>
          <NumberStepper
            value={recipe.spec.gutterY}
            min={0}
            max={200}
            onChange={(gutterY) => patchSpec(linked ? { gutterX: gutterY, gutterY } : { gutterY })}
          />
        </label>
      </div>

      <div className="grid-section__row">
        <label className="grid-field">
          <span>Margin</span>
          <NumberStepper value={recipe.spec.margin} min={0} max={400} onChange={(margin) => patchSpec({ margin })} />
        </label>
      </div>

      {variationLabel && (
        <label className="grid-field grid-field--wide">
          <span>{variationLabel}</span>
          <Slider
            label={variationLabel}
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

      <span className="grid-section__caption">
        {recipe.style.shapeMode === 'uniform' ? 'Pick a shape' : 'Pick two or more to mix'}
      </span>
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
      {/* Two rows of swatches sat here with nothing to tell them apart: a
          column of ramps to pick from, then a row of the current ramp's own
          colours to edit. Identical shapes, opposite meanings. */}
      <span className="grid-section__caption">Pick a palette</span>
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
      <span className="grid-section__caption">Or edit these colours</span>
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
        <span>How colours are used</span>
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

      {/**
        * Three dice and a wand.
        *
        * The dice re-roll an arrangement *of the same system*, which is the
        * right tool once you have decided what you are making. Before that the
        * useful question is broader -- what would this look like as a dial, or
        * a cascade, or a card wall -- and answering it by hand is four
        * decisions to see one idea. `randomiseRecipe` makes all four at once,
        * staying inside the ranges that look deliberate.
        */}
      <div className="grid-section__rolls">
        <button
          type="button"
          className="grid-roll grid-roll--wide"
          data-tooltip="A different system, tracks, spacing and palette"
          onClick={() => apply(randomiseRecipe(recipe, Date.now() & 0xffff))}
        >
          <Wand2 size={14} /> Surprise me
        </button>
      </div>

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
