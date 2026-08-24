import React from 'react';
import { Link2, Unlink2 } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { GridKindIcon } from '../workspace/gridIcons';
import { NumberStepper } from '../ui/NumberStepper';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Slider } from '../ui/Slider';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { refitGrid, relayoutGrid } from '../../engine/grid/gridApply';
import { recipeCells, switchKind, withSpec, withStyle, type GridRecipe } from '../../engine/grid/gridBuild';
import { GridVariations } from './GridVariations';
import { CellFace } from './CellFace';
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
  const [linkWanted, setLinkWanted] = React.useState(true);
  /**
   * Linked only when you want it **and** the two actually agree.
   *
   * Stored preference alone was wrong in both directions. It started on, so a
   * kind whose defaults are deliberately uneven -- baseline runs 0 across and
   * 12 down -- showed a closed chain over two different numbers, and the next
   * edit silently flattened one into the other. And switching kind changes the
   * gutters underneath the state, so the chain kept claiming a link that the
   * values had stopped honouring.
   *
   * Deriving it means the chain can only ever be closed over a pair that is
   * equal, which is the only state in which the chain is true rather than a
   * promise about the next edit.
   */
  const linked = linkWanted && recipe?.spec.gutterX === recipe?.spec.gutterY;
  /**
   * What the current settings actually produce.
   *
   * Laid out rather than multiplied, because most kinds do not multiply: bento
   * merges compartments, masonry derives a count per column, golden takes its
   * own number of steps. The layout is pure arithmetic over a dozen numbers, so
   * asking it is cheaper than any guess would be wrong.
   */
  const cellCount = React.useMemo(() => (recipe ? recipeCells(recipe).length : 0), [recipe]);
  /**
   * How big a module actually is, so a 22px swatch can round in proportion.
   *
   * A 12px radius is a soft corner on a 120px module and a pill on a swatch;
   * without the real size the preview would exaggerate every radius above
   * about six and stop being a preview.
   */
  const sampleCell = React.useMemo(() => {
    if (!recipe) return 0;
    const cells = recipeCells(recipe);
    if (cells.length === 0) return 0;
    return Math.min(...cells.map((c) => Math.min(c.width, c.height)));
  }, [recipe]);
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

      {/**
        * How many modules this makes, said as you set it.
        *
        * Rows and columns multiply, and most kinds do not multiply them the way
        * you would guess: bento merges compartments, masonry derives its own
        * count per column, radial multiplies rings by spokes. So "4 x 4" is not
        * a number anyone can compute from the two steppers, and the count is
        * exactly what decides whether a grid is a layout or a texture.
        */}
      <div className="grid-section__tracks">
        <span className="grid-section__caption">Tracks</span>
        <span className="grid-section__count">
          {cellCount} {cellCount === 1 ? 'module' : 'modules'}
        </span>
      </div>
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
            suffix="px"
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
            setLinkWanted(next);
            // Closing the chain over two different numbers has to pick one, and
            // cross\ is the one the eye reads first.
            if (next) patchSpec({ gutterY: recipe.spec.gutterX });
          }}
        >
          {linked ? <Link2 size={13} /> : <Unlink2 size={13} />}
        </button>
        <label className="grid-field">
          <span>Gap down</span>
          <NumberStepper
            suffix="px"
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
          <NumberStepper suffix="px" value={recipe.spec.margin} min={0} max={400} onChange={(margin) => patchSpec({ margin })} />
        </label>
      </div>

      {variationLabel && (
        <label className="grid-field grid-field--wide">
          <span>{variationLabel}</span>
          <Slider
            label={variationLabel}
            labelHidden
            value={Math.round(recipe.spec.variation * 100)}
            min={0}
            max={100}
            onChange={(v) => patchSpec({ variation: v / 100 })}
          />
        </label>
      )}

      {/**
        * The heading carries a specimen of the module itself.
        *
        * Shape, corner radius, stroke and opacity are four controls whose only
        * meaningful output is one picture, and that picture was only available
        * on the board -- so setting a radius meant adjusting, looking away,
        * and coming back. One 30px tile answers all four at once.
        */}
      <div className="grid-section__cells-head">
        <span className="grid-section__label">Cells</span>
        <span className="grid-section__specimen" data-tooltip="One module, as it will be drawn">
          <CellFace
            shape={recipe.style.shapes[0] ?? 'rect'}
            size={30}
            fill={recipe.style.palette[Math.floor(recipe.style.palette.length / 2)] ?? '#94A3B8'}
            radius={recipe.style.radius}
            cellSize={sampleCell}
            strokeColor={recipe.style.strokeColor}
            strokeWidth={recipe.style.strokeWidth}
            opacity={recipe.style.opacity}
          />
        </span>
      </div>
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
        {recipe.style.shapeMode === 'uniform'
          ? 'Pick a shape'
          : `Mixing ${recipe.style.shapes.length} of ${CELL_SHAPES.length}`}
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
              <CellFace
                shape={shape}
                size={22}
                fill="currentColor"
                radius={recipe.style.radius}
                cellSize={sampleCell}
              />
            </button>
          );
        })}
      </div>

      <div className="grid-section__row">
        <label className="grid-field">
          <span>Corners</span>
          <NumberStepper suffix="px" value={recipe.style.radius} min={0} max={200} onChange={(radius) => patchStyle({ radius })} />
        </label>
        <label className="grid-field">
          <span>Stroke</span>
          <NumberStepper
            suffix="px"
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
          labelHidden
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
      {/* The caption carries the current palette's name, which frees the tiles
          from carrying names of their own -- and a name per tile was what kept
          the list one column wide and mostly out of sight. */}
      <span className="grid-section__caption">
        Palette
        <strong>{GRID_PALETTES.find((p) => p.colors.join() === recipe.style.palette.join())?.name ?? 'Custom'}</strong>
      </span>
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
              <span className="grid-palette__ramp">
                {palette.colors.map((c) => (
                  <span key={c} className="grid-palette__chip" style={{ background: c }} />
                ))}
              </span>
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
        * Picking a grid by looking at it, rather than rolling for one.
        *
        * This was four buttons -- Arrangement, Colour, Both, Surprise me --
        * each committing a change you could not see until it had happened.
        * Press twice and the arrangement you liked was gone. `GridVariations`
        * shows five candidates and writes nothing until one is chosen.
        */}
      <GridVariations recipe={recipe} onPick={apply} />

    </div>
  );
};

/** The recipe's own box, for carrying a refit forward. */
function boxOf(recipe: GridRecipe) {
  const { x, y, width, height } = recipe.spec;
  return { x, y, width, height };
}
