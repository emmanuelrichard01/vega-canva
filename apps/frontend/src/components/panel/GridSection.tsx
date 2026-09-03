import React from 'react';
import { Link2, Unlink2 } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { GridKindIcon } from '../workspace/gridIcons';
import { NumberStepper } from '../ui/NumberStepper';
import { GRID_PRESETS, gridPresetMatching } from '../../engine/grid/gridPresets';
import { Slider } from '../ui/Slider';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { setGridRecipe } from '../../engine/grid/gridApply';
import { gridContent } from '../../engine/grid/gridSlotApply';
import { recipeCells, switchKind, withSpec, withStyle, type GridRecipe } from '../../engine/grid/gridBuild';
import { GridThumb, GridVariations } from './GridVariations';
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

/**
 * One labelled band of controls.
 *
 * ## Why the section needed banding at all
 *
 * Fourteen controls ran down this panel in one column with two headings
 * between them — "Cells" and "Colour" — so the eight controls above the first
 * heading belonged to nothing, and the two questions they actually answer
 * (which system, and how big are its parts) were told apart only by reading
 * every label. In a 260px column that is a scroll you navigate by memory.
 *
 * Four bands, one header treatment, and each header carries the one fact that
 * band is judged by: the module count for Layout, a specimen module for Cells.
 * Those two facts were already on screen, each in its own bespoke row — this
 * puts them where they were always trying to be, and takes two rows back.
 */
const Band: React.FC<{
  title: string;
  /** The one thing this band is judged by, shown in its header. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, aside, children }) => (
  <section className="grid-band">
    <header className="grid-band__head">
      <span className="grid-section__label">{title}</span>
      {aside}
    </header>
    {children}
  </section>
);

interface Props {
  /** The selected grid node. */
  nodeId: string;
}

export const GridSection: React.FC<Props> = ({ nodeId }) => {
  /**
   * Subscribed to the node, not merely read once.
   *
   * A peer re-laying the grid, this client's own write landing, and an undo all
   * arrive the same way, and every control here shows a value that has to
   * follow them.
   */
  const node = useStore((s) => s.objects[nodeId]);
  const recipe = node?.type === 'grid' ? node.grid : null;
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
   * Wanting to mix shapes, before there is a mix to see.
   *
   * The same arrangement as `linkWanted` and for the same reason. The grid
   * stores a list of shapes, and how many there are *is* whether they mix, so
   * there is no mode left to store -- but turning the switch on is something
   * you do *before* picking the second shape, and a switch derived purely from
   * the list would spring back off in the moment between the two.
   *
   * So it is wanted-or-already-true: the row becomes multi-select the instant
   * you ask for it, and stays that way for as long as the grid says so.
   */
  const [mixWanted, setMixWanted] = React.useState(false);
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
   * What is in the grid.
   *
   * Read from the objects table rather than from the grid node, because content
   * lives in *other* nodes: a picture dropped into a module changes the
   * picture, not the grid, so subscribing to the grid alone would leave this
   * showing a stale count until something happened to touch the grid itself.
   *
   * `gridContent` takes the table rather than reaching into the store, which is
   * what makes the dependency here a real one instead of a hint to the linter.
   */
  const objects = useStore((s) => s.objects);
  const content = React.useMemo(() => gridContent(objects, nodeId), [objects, nodeId]);
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
   * One write, whatever changed.
   *
   * ## What this used to have to do
   *
   * Three statements: measure where the grid's nodes had drifted to, divide
   * that by where the recipe claimed they should be to recover the transform
   * somebody had applied since the last edit, splice the corrected box into the
   * new recipe, then reconcile thirty nodes against it. Skipping any part of it
   * made the first panel edit after a resize snap the grid back to where it used
   * to be.
   *
   * None of that is needed now, because none of it was ever about the edit. It
   * was about a recipe and a set of nodes holding two copies of one box between
   * them. The box is the node's, the modules are derived from it, and changing
   * the recipe cannot move the grid.
   */
  const apply = (next: GridRecipe) => setGridRecipe(nodeId, next);

  const patchSpec = (patch: Parameters<typeof withSpec>[1]) => apply(withSpec(recipe, patch));
  const patchStyle = (patch: Parameters<typeof withStyle>[1]) => apply(withStyle(recipe, patch));

  /** Which kinds care about rows, and which about columns. A control that does nothing is worse than none. */
  const usesRows = !['columns', 'manuscript'].includes(recipe.spec.kind);
  /**
   * A merged ring has one module, so its spoke count controls nothing.
   *
   * Leaving the stepper there would be the same failure as a variation slider
   * on a kind with no notion of it: a control you can turn that does not turn
   * anything, and the only way to learn that is to try.
   */
  const merged = recipe.spec.kind === 'radial' && recipe.spec.merged === true;
  const usesColumns = !['manuscript', 'baseline'].includes(recipe.spec.kind) && !merged;
  /** The two kinds built out of rings, and so the two with rings to turn. */
  const hasRings = recipe.spec.kind === 'radial' || recipe.spec.kind === 'orbit';
  /**
   * What the dial is called here, which is different in every kind.
   *
   * It opens a hole in the dial, mixes the compartments in a bento box, sizes
   * the hero of a hierarchy and shears a cascade. One word for four controls
   * meant the only way to learn which was to drag it and watch. `golden` has no
   * notion of it and gets no slider, rather than a slider that does nothing.
   */
  const variationLabel = VARIATION_LABELS[recipe.spec.kind];
  /** More than one shape chosen, or a request to choose one. */
  const mixing = mixWanted || recipe.style.shapes.length > 1;

  const activePreset = gridPresetMatching(recipe.spec);

  return (
    <div className="grid-section">
      <Band title="System">
      {/*
        The grids people ask for by name.

        The eleven systems below answer *arrangement*, and each arrives at
        `KIND_DEFAULTS` — chosen to show that kind at its best, which is the
        right default and is not a configuration. Proportion is the other half,
        and it is where the named grids live: a twelve-column, 24-gutter web
        grid is four separate edits away, and every one of them is a number
        somebody has to already know.

        A row of words rather than miniatures, deliberately, where the systems
        below get pictures. A system is a shape and the word means nothing
        until you have seen one; a preset is a *name for numbers*, and "Twelve
        column" says more than any thumbnail of twelve slivers could. Putting
        pictures on both would also make two adjacent rows of tiles that mean
        different kinds of thing.

        "Custom" is shown rather than nothing when the spec matches no preset,
        because a grid arriving at a kind's defaults has not been configured —
        and a row that simply had nothing selected would read as a control that
        failed to notice.
      */}
      <span className="grid-section__caption">
        Preset
        <strong>{activePreset?.label ?? 'Custom'}</strong>
      </span>
      <div className="grid-presets" role="radiogroup" aria-label="Grid preset">
        {GRID_PRESETS.map((preset) => {
          const on = activePreset?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={on}
              className="grid-preset"
              data-active={on || undefined}
              data-tooltip={preset.hint}
              data-tooltip-pos="left"
              onClick={() => {
                /*
                  The kind first, then the numbers.

                  `switchKind` brings that kind's own defaults with it, which is
                  right for the picker below and is exactly what the preset is
                  overriding — so the patch has to land after it, not before.
                */
                apply(withSpec(switchKind(recipe, preset.kind), preset.patch));
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

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
            data-tooltip={`${GRID_LABELS[kind]}: ${GRID_HINTS[kind]}`}
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
      </Band>

      {/**
        * How many modules this makes, said in the header of the band that sets
        * it — the one fact this whole group is judged by.
        *
        * Rows and columns multiply, and most kinds do not multiply them the way
        * you would guess: bento merges compartments, masonry derives its own
        * count per column, radial multiplies rings by spokes. So "4 x 4" is not
        * a number anyone can compute from the two steppers, and the count is
        * exactly what decides whether a grid is a layout or a texture.
        */}
      <Band
        title="Layout"
        aside={
          <span className="grid-section__count">
            {cellCount} {cellCount === 1 ? 'module' : 'modules'}
          </span>
        }
      >
      {/**
        * And what is *in* those modules.
        *
        * The panel that owns grids said nothing about their contents, so a grid
        * holding six photographs read from here as an empty scaffold. The
        * waiting count is the important half: content with no module in the
        * current arrangement is sitting in a strip below the grid, and the
        * strip cannot explain itself.
        */}
      {content.filled + content.parked > 0 && (
        <p className="grid-section__content">
          {content.filled} of {content.modules} filled
          {content.parked > 0 && (
            <>
              {' · '}
              <strong
                data-tooltip={`${content.parked} ${content.parked === 1 ? 'item has' : 'items have'} no module in this arrangement. They are waiting below the grid and will return when there is room.`}
              >
                {content.parked} waiting
              </strong>
            </>
          )}
        </p>
      )}
      <div className="grid-section__row">
        {usesRows && (
          <label className="grid-field">
            <span>{hasRings ? 'Rings' : 'Rows'}</span>
            <NumberStepper value={recipe.spec.rows} min={1} max={24} onChange={(rows) => patchSpec({ rows })} />
          </label>
        )}
        {usesColumns && (
          <label className="grid-field">
            {/* A dial is divided into spokes and a spiral into steps. Calling
                both "columns" is the same failure as calling four different
                controls "variation". */}
            <span>
              {hasRings ? 'Spokes'
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

      {recipe.spec.kind === 'radial' && (
        /**
         * One ring, or several pieces of one.
         *
         * A toggle rather than a gutter of zero, which is what people reach for
         * first and is not the same thing: butted sectors are still separate
         * modules, so they take separate colours, separate strokes and separate
         * corner radii, and every one of those turns the seams back on. What the
         * shape wants to be is one closed band, and only one module can be that.
         */
        <label className="grid-field grid-field--wide grid-toggle-field">
          <span>Continuous ring</span>
          <button
            type="button"
            role="switch"
            aria-checked={merged}
            className="grid-switch"
            data-active={merged || undefined}
            data-tooltip={merged ? 'Split the ring into sectors' : 'Fuse the sectors into one band'}
            onClick={() => patchSpec({ merged: !merged })}
          >
            <span className="grid-switch__dot" />
          </button>
        </label>
      )}

      {hasRings && recipe.spec.rows > 1 && !merged && (
        /**
         * Turning each ring past the one inside it.
         *
         * Rings that share their spokes read as a single wheel -- symmetrical,
         * correct, and completely still. Offsetting them drops one ring's joins
         * into the middle of the next one's modules, and the arrangement starts
         * reading as layers rather than as a diagram. Only offered with more
         * than one ring, because with one there is nothing to offset it against.
         *
         * Measured in modules rather than degrees so the effect survives a
         * change of spoke count: half a module is half a module at six spokes
         * and at twenty.
         */
        <div className="grid-field grid-field--wide">
          <span>Ring offset</span>
          <Slider
            label="Ring offset"
            labelHidden
            value={Math.round((recipe.spec.stagger ?? 0) * 100)}
            min={0}
            max={100}
            onChange={(v) => patchSpec({ stagger: v / 100 })}
          />
        </div>
      )}

      {variationLabel && (
        <div className="grid-field grid-field--wide">
          <span>{variationLabel}</span>
          <Slider
            label={variationLabel}
            labelHidden
            value={Math.round(recipe.spec.variation * 100)}
            min={0}
            max={100}
            onChange={(v) => patchSpec({ variation: v / 100 })}
          />
        </div>
      )}

      </Band>

      {/**
        * The header carries a specimen of the module itself.
        *
        * Shape, corner radius, stroke and opacity are four controls whose only
        * meaningful output is one picture, and that picture was only available
        * on the board -- so setting a radius meant adjusting, looking away,
        * and coming back. One 30px tile answers all four at once, and it sits
        * in the band header for the same reason the module count does: it is
        * the thing this group is judged by.
        */}
      <Band
        title="Cells"
        aside={
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
        }
      >
      {/**
        * The shape of a module, and whether there is more than one of them.
        *
        * ## Why the mode control went
        *
        * A two-segment "One shape / Mixed" `SegmentedControl` sat above this
        * row, and it was wrong three ways at once.
        *
        * It looked wrong: that component sizes each segment to its own content
        * and never stretches -- it is built for a row of 20px specimen icons --
        * so two short words sat at the left end of a full-width grey track with
        * most of it empty. Nothing else in the panel has that silhouette.
        *
        * It said nothing the row below did not already say. A list of shapes
        * *is* the answer to "one or several", and keeping both meant they could
        * disagree; see `GridStyle.shapes` for the two ways they did.
        *
        * And it silently changed what a click here *meant* -- replace in one
        * mode, toggle in the other -- with nothing on screen to say so, which
        * is the one thing a control must never do quietly.
        *
        * What replaces it is a switch that describes its effect on this row in
        * two words, built from the same `grid-switch` as the continuous-ring
        * toggle in the band above: a binary choice that looks like the other
        * binary choice in this panel rather than like a tab strip. It sits
        * *under* the row it governs for the same reason that one does -- the
        * picture is the control, and the qualifier follows it.
        */}
      <span className="grid-section__caption">
        Shape
        {/* Named in full here, which the icon-only row cannot do -- the same
            arrangement the palette and colour-mode captions already use. */}
        <strong>
          {mixing
            ? `Mixing ${recipe.style.shapes.length} of ${CELL_SHAPES.length}`
            : SHAPE_LABELS[recipe.style.shapes[0] ?? 'rect']}
        </strong>
      </span>
      {/* A radio group when one shape is chosen, a set of toggles when several
          are -- announced as whichever it currently is, rather than as toggles
          that happen to behave like radios most of the time. */}
      <div
        className="grid-section__shapes"
        role={mixing ? 'group' : 'radiogroup'}
        aria-label={mixing ? 'Shapes in the mix' : 'Cell shape'}
      >
        {CELL_SHAPES.map((shape: CellShape) => {
          const on = recipe.style.shapes.includes(shape);
          return (
            <button
              key={shape}
              type="button"
              className="grid-shape"
              role={mixing ? undefined : 'radio'}
              {...(mixing ? { 'aria-pressed': on } : { 'aria-checked': on })}
              data-active={on || undefined}
              aria-label={SHAPE_LABELS[shape]}
              data-tooltip={
                mixing
                  ? on
                    ? `Take ${SHAPE_LABELS[shape].toLowerCase()} out of the mix`
                    : `Add ${SHAPE_LABELS[shape].toLowerCase()} to the mix`
                  : SHAPE_LABELS[shape]
              }
              onClick={() => {
                // The list is the state, so a click either sets it or edits it.
                if (!mixing) {
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

      <label className="grid-field grid-field--wide grid-toggle-field">
        <span>Mix shapes</span>
        <button
          type="button"
          role="switch"
          aria-checked={mixing}
          className="grid-switch"
          data-active={mixing || undefined}
          data-tooltip={mixing ? 'Use one shape for every module' : 'Draw each module from the shapes you pick'}
          onClick={() => {
            if (!mixing) {
              setMixWanted(true);
              return;
            }
            setMixWanted(false);
            /**
             * Turning it off has to write, because the list is the state.
             * Leaving three shapes selected under a switch that reads "off"
             * would be the switch telling you something the grid disagrees
             * with -- and the first one is what this band's header already
             * shows as the specimen.
             */
            if (recipe.style.shapes.length > 1) patchStyle({ shapes: [recipe.style.shapes[0]] });
          }}
        >
          <span className="grid-switch__dot" />
        </button>
      </label>

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

      <div className="grid-field grid-field--wide">
        <span>Opacity</span>
        <Slider
          label="Opacity"
          labelHidden
          value={Math.round(recipe.style.opacity * 100)}
          min={0}
          max={100}
          onChange={(v) => patchStyle({ opacity: v / 100 })}
        />
      </div>

      </Band>

      <Band title="Colour">
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

      {/**
        * How the palette is spent, shown rather than named.
        *
        * This was a native `<select>` of six sentences — the only raw select in
        * the section, in a panel whose every other visual choice is a picture.
        * `gridStyle.ts` renamed these options from how they work to what you
        * get ("Biggest cells darkest" rather than "By size") precisely because
        * *"a menu is read once, at the moment of choosing, with no way to try
        * each option but to try each option."* Renaming was the best a menu
        * could do; it does not fix the problem, it apologises for it.
        *
        * Six tiles fix it. Each is the **current grid** with only this one
        * field changed, drawn by the same `GridThumb` the variations picker
        * uses — so a tile cannot promise a composition the board would decline
        * to produce, and what differs between the tiles is exactly what the
        * control changes. The caption names the chosen one in full, which is
        * the same arrangement the system picker above already uses.
        */}
      <span className="grid-section__caption">
        How colours are used
        <strong>{COLOR_MODE_LABELS[recipe.style.colorMode]}</strong>
      </span>
      <div className="grid-section__modes" role="radiogroup" aria-label="How colours are used">
        {COLOR_MODES.map((mode: ColorMode) => {
          const on = recipe.style.colorMode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              className="grid-mode"
              data-active={on || undefined}
              data-tooltip={COLOR_MODE_LABELS[mode]}
              aria-label={COLOR_MODE_LABELS[mode]}
              onClick={() => patchStyle({ colorMode: mode })}
            >
              <GridThumb recipe={withStyle(recipe, { colorMode: mode })} />
            </button>
          );
        })}
      </div>

      </Band>

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
