import React from 'react';
import { RefreshCw } from 'lucide-react';
import {
  cellGeometry,
  describeRecipe,
  recipeCells,
  variantsOf,
  VARIANT_LABELS,
  VARIANT_MODES,
  type GridRecipe,
  type VariantMode,
} from '../../engine/grid/gridBuild';
import type { StyledCell } from '../../engine/grid/gridStyle';
import { pointsAttribute, shapeOutline } from '../../engine/model/shapeOutline';
import { contourData } from '../../engine/model/pathGeometry';
import type { ShapeNode } from '../../engine/model/schema';
import { gridBounds, roundPolygon } from '../../engine/grid/gridLayout';

/**
 * Choosing a grid by looking at it.
 *
 * ## What this replaces
 *
 * Four buttons — Arrangement, Colour, Both, Surprise me — each of which
 * committed a change you could not see until it had happened. That is a slot
 * machine, and it fails the way slot machines fail: press twice and the
 * arrangement you liked is gone, with nothing but undo to get it back.
 *
 * A grid is a *visual* decision and it takes a second to evaluate, so the right
 * control shows several and lets you point. The one you are on stays on screen
 * while you compare, nothing is written until you pick, and the mode buttons
 * become self-explaining: what differs between the tiles is exactly what the
 * mode changes, which no label on a button could have said as clearly.
 *
 * ## Why they are all on screen, rather than in a strip you scroll
 *
 * They were in a strip: nine tiles side by side, a fade at each live edge and a
 * nudge button on the fade, all of it measured by a `ResizeObserver` so a
 * marker never promised content that was not there. It was careful work in
 * service of the wrong shape.
 *
 * Three and a half tiles were visible at once in a 260px panel. That is not a
 * comparison, it is a carousel — and this project has already written down what
 * is wrong with it, twice, about the palette list in this same section: *"a
 * picker you have to scroll to see the options in is a dropdown with extra
 * steps"*. Comparing is the entire purpose of the control. Anything that puts
 * two candidates on opposite sides of a scroll has taken the purpose away and
 * left the mechanism.
 *
 * Three columns of three fit the panel exactly, and the answer to "is any of
 * these better than what I have" is one look rather than a rummage. It also
 * deleted the overflow hook, both nudge buttons, both fades and their state —
 * about eighty lines whose only job was to apologise for the strip.
 *
 * ## Why every tile carries a sentence
 *
 * Nine grids at sixty pixels are *distinguishable* but not *identifiable*. You
 * can see that one is denser and one is rounder; you cannot see that it is a
 * bento wall rather than a modular grid, or that the palette is Ember rather
 * than Dusk — and those are the facts that decide whether you want it. So
 * `describeRecipe` names each one, in the tooltip and as the accessible name.
 * The previous name was "Use variation 3", which is nine buttons that differ
 * by an ordinal: unusable without sight, and no help with it.
 *
 * ## Why the thumbnails are drawn here rather than rendered by the canvas
 *
 * `recipeCells` is pure arithmetic over a dozen numbers, so nine thumbnails
 * cost about as much as one layout pass. Going through the real renderer would
 * mean nine off-screen Konva stages to draw thirty rectangles apiece, which is
 * three orders of magnitude more work for a picture 62 pixels wide.
 */

const THUMB_W = 62;
const THUMB_H = 44;

/**
 * Eight candidates plus the one you already have: three rows of three.
 *
 * The count is chosen by the layout rather than the other way round, and that
 * is the right way round here — a picker whose last row is one tile and two
 * gaps reads as having run out rather than as being complete.
 */
const VARIANT_COUNT = 8;

/**
 * One cell, drawn exactly as the board will draw it.
 *
 * ## Why this goes through `shapeOutline`
 *
 * The first version drew every cell as a rectangle and special-cased the
 * ellipse, so a grid of hexagons previewed as a grid of squares. The picker was
 * then offering compositions the canvas would decline to produce, which is a
 * worse failure than an ugly preview: you choose the tile you like and get
 * something else, and the control has lied about the one thing it exists to do.
 *
 * `shapeOutline` is the same geometry the SVG exporter draws from, so a
 * thumbnail and a rendered board cannot disagree about what a star is. It
 * returns outlines in the cell's own coordinates, which is why each is wrapped
 * in its own transform rather than having the maths inlined per shape.
 */
const CellPreview: React.FC<{
  cell: StyledCell;
  scale: number;
  ox: number;
  oy: number;
  box: { x: number; y: number };
}> = ({ cell, scale, ox, oy, box }) => {
  const outline = shapeOutline({
    geometry: cellGeometry(cell) as ShapeNode['geometry'],
    width: cell.width,
    height: cell.height,
    appearance: { cornerRadius: cell.radius },
  });

  const inner = (() => {
    // A sector carries its own silhouette, and a thumbnail that fell back to
    // the bounding box would show a ring of rectangles -- offering an
    // arrangement the canvas then declines to produce, which is the exact
    // failure this preview was rebuilt to stop making.
    if (cell.outline) {
      return <polygon points={pointsAttribute(roundPolygon(cell.outline, cell.radius))} fill={cell.fill} />;
    }
    switch (outline.kind) {
      case 'rect':
        return <rect x={0} y={0} width={outline.width} height={outline.height} rx={outline.radius} fill={cell.fill} />;
      case 'ellipse':
        return <ellipse cx={outline.cx} cy={outline.cy} rx={outline.rx} ry={outline.ry} fill={cell.fill} />;
      case 'polygon':
        return <polygon points={pointsAttribute(outline.points)} fill={cell.fill} />;
      case 'bezier':
        return <path d={contourData(outline.geometry)} fill={cell.fill} />;
      default:
        // An open run has no interior, so there is nothing to fill. No grid
        // kind produces one today; drawing nothing beats drawing a rectangle
        // that is not there.
        return null;
    }
  })();

  return (
    <g transform={`translate(${(cell.x - box.x) * scale + ox} ${(cell.y - box.y) * scale + oy}) scale(${scale})`}>
      {inner}
    </g>
  );
};

/**
 * A recipe, drawn small.
 *
 * Exported because the colour-mode picker needs exactly this and must not grow
 * a second one: a preview that draws cells its own way is a preview that can
 * disagree with the board, which is the failure this component's own header
 * records having already made once with hexagons.
 *
 * The width and height attributes are a fallback, not the size. Both callers
 * let CSS drive it — `width: 100%; height: auto` against a fixed `viewBox` —
 * so a tile can be whatever the column it sits in turns out to be, and the
 * drawing scales with it rather than sitting at 62px in a 74px box.
 */
export const GridThumb: React.FC<{ recipe: GridRecipe }> = ({ recipe }) => {
  const cells = React.useMemo(() => recipeCells(recipe), [recipe]);
  const box = React.useMemo(() => gridBounds(cells), [cells]);
  if (!box || box.width <= 0 || box.height <= 0) return null;

  // Contained, not stretched: a bento wall and a manuscript block have very
  // different proportions, and squashing each into the tile would make them
  // look like layouts they are not.
  const scale = Math.min(THUMB_W / box.width, THUMB_H / box.height);
  const ox = (THUMB_W - box.width * scale) / 2;
  const oy = (THUMB_H - box.height * scale) / 2;

  return (
    <svg width={THUMB_W} height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} aria-hidden focusable="false">
      {cells.map((cell, i) => (
        <CellPreview key={i} cell={cell} scale={scale} ox={ox} oy={oy} box={box} />
      ))}
    </svg>
  );
};

/**
 * Whether two recipes would draw the same grid.
 *
 * A structural compare rather than a reference one: the store hands back a new
 * object on every change, so identity would say "different" for a grid nobody
 * has touched and the baseline tile would never read as current.
 */
function sameRecipe(a: GridRecipe, b: GridRecipe): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What each mode holds still.
 *
 * The three words on the buttons say what may change; this says what will not,
 * and that is the half people actually choose on. "Colour" does not tell you
 * that your arrangement is safe, which is the only reason you would press it
 * rather than Anything.
 */
const MODE_HINTS: Record<VariantMode, string> = {
  arrangement: 'Same system and colours. A different arrangement of them',
  colour: 'Same arrangement exactly. A different palette over it',
  everything: 'A different system altogether, colours and all',
};

interface Props {
  recipe: GridRecipe;
  onPick: (next: GridRecipe) => void;
}

export const GridVariations: React.FC<Props> = ({ recipe, onPick }) => {
  const [mode, setMode] = React.useState<VariantMode>('arrangement');
  /**
   * Re-drawn only when asked.
   *
   * Regenerating on every render would mean the tiles changed underneath the
   * pointer each time an unrelated control moved — you would go to click the
   * third one and click something else. The salt is the only thing that moves
   * them, and only the refresh button moves it.
   */
  const [salt, setSalt] = React.useState(1);

  /**
   * The grid as it was when this set was drawn.
   *
   * ## Why the strip carries its own starting point
   *
   * Comparing eight candidates against each other is the easy half; the
   * question that actually matters is whether any of them beats what you
   * already have, and that was off screen behind the panel. Worse, once you
   * picked one the original was gone — recoverable only through undo, which on
   * a thirty-cell grid means undoing a re-lay rather than a choice.
   *
   * Held in a ref and refreshed only when the set is, so picking a tile does
   * not quietly move the baseline to whatever you last tried. The thing you are
   * measuring against has to hold still or it is not a measurement.
   */
  const baseline = React.useRef(recipe);
  React.useEffect(() => {
    baseline.current = recipe;
    // Only when a new set is drawn: `recipe` changing because a tile was picked
    // must not adopt that tile as the new "before".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salt, mode]);

  const variants = React.useMemo(
    () => variantsOf(recipe, mode, salt, VARIANT_COUNT),
    [recipe, mode, salt]
  );

  /**
   * Whether the live grid is one of the tiles on screen.
   *
   * Picking used to be a write with no receipt: the board changed, and the
   * strip you were reading gave no sign of which tile had done it — so the next
   * question, "was that the third one or the fourth", could only be answered by
   * clicking around. Marking it costs one structural compare per tile over
   * nine tiles of about thirty numbers each, which is nothing beside the layout
   * pass each thumbnail already runs.
   */
  const currentIndex = React.useMemo(
    () => variants.findIndex((v) => sameRecipe(v, recipe)),
    [variants, recipe]
  );
  const onBaseline = sameRecipe(recipe, baseline.current);

  return (
    <div className="grid-variations">
      <div className="grid-variations__head">
        <span className="grid-section__label">Try another</span>
        <button
          type="button"
          className="grid-variations__refresh"
          // It draws eight. It said five, from back when it drew five -- a
          // label that survived the change it described, which is invariant 6
          // in miniature: never say a thing the code does not do.
          data-tooltip={`Draw ${VARIANT_COUNT} new ones`}
          aria-label={`Draw ${VARIANT_COUNT} new variations`}
          onClick={() => setSalt((n) => n + 1)}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* The mode says what may differ between the tiles. Naming it in a
          segmented control rather than in three separate buttons keeps the
          answer visible while you look at the results of it. */}
      <div className="grid-variations__modes" role="radiogroup" aria-label="What may change">
        {VARIANT_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className="grid-variations__mode"
            data-active={mode === m || undefined}
            data-tooltip={MODE_HINTS[m]}
            aria-label={`${VARIANT_LABELS[m]}. ${MODE_HINTS[m]}`}
            onClick={() => setMode(m)}
          >
            {VARIANT_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="grid-variations__grid">
        {/* Where you started, first and marked. Clicking it puts the grid
            back, which is a way out of a comparison that does not depend on
            the history stack knowing a re-lay was a decision. */}
        <button
          type="button"
          className="grid-variations__tile grid-variations__tile--baseline"
          data-current={onBaseline || undefined}
          data-tooltip={`Back to ${describeRecipe(baseline.current, mode)}`}
          aria-label={`Back to where you started. ${describeRecipe(baseline.current, mode)}`}
          onClick={() => onPick(baseline.current)}
        >
          <GridThumb recipe={baseline.current} />
          <span className="grid-variations__badge">Now</span>
        </button>

        {variants.map((variant, i) => {
          const description = describeRecipe(variant, mode);
          return (
            <button
              key={i}
              type="button"
              className="grid-variations__tile"
              // Never both: landing on a variant identical to the baseline is
              // possible, and two tiles claiming to be the current grid is a
              // worse answer than the earlier one being right.
              data-current={(!onBaseline && currentIndex === i) || undefined}
              data-tooltip={description}
              aria-label={description}
              onClick={() => onPick(variant)}
            >
              <GridThumb recipe={variant} />
            </button>
          );
        })}
      </div>
    </div>
  );
};
