import React from 'react';
import { RefreshCw } from 'lucide-react';
import { recipeCells, variantsOf, VARIANT_LABELS, VARIANT_MODES, type GridRecipe, type VariantMode } from '../../engine/grid/gridBuild';
import { gridBounds } from '../../engine/grid/gridLayout';

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
 * ## Why the thumbnails are drawn here rather than rendered by the canvas
 *
 * `recipeCells` is pure arithmetic over a dozen numbers, so five thumbnails
 * cost about as much as one layout pass. Going through the real renderer would
 * mean five off-screen Konva stages to draw thirty rectangles apiece, which is
 * three orders of magnitude more work for a picture 56 pixels wide.
 */

const THUMB_W = 62;
const THUMB_H = 44;

/** One candidate, drawn small. */
const GridThumb: React.FC<{ recipe: GridRecipe }> = ({ recipe }) => {
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
      {cells.map((cell, i) => {
        const w = Math.max(0.6, cell.width * scale);
        const h = Math.max(0.6, cell.height * scale);
        return (
          <rect
            key={i}
            x={(cell.x - box.x) * scale + ox}
            y={(cell.y - box.y) * scale + oy}
            width={w}
            height={h}
            // An ellipse reads as a circle at this size and a rounded rect does
            // not, so the one shape that changes the tile's character is drawn
            // as itself. The rest are close enough to a rectangle that telling
            // them apart at 62px would be a lie about the resolution.
            rx={cell.shape === 'ellipse' ? Math.min(w, h) / 2 : Math.min(cell.radius * scale, Math.min(w, h) / 3)}
            fill={cell.fill}
          />
        );
      })}
    </svg>
  );
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

  const variants = React.useMemo(
    () => variantsOf(recipe, mode, salt),
    [recipe, mode, salt]
  );

  return (
    <div className="grid-variations">
      <div className="grid-variations__head">
        <span className="grid-section__label">Try another</span>
        <button
          type="button"
          className="grid-variations__refresh"
          data-tooltip="Show five more"
          aria-label="Show five more variations"
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
            onClick={() => setMode(m)}
          >
            {VARIANT_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="grid-variations__strip">
        {variants.map((variant, i) => (
          <button
            key={i}
            type="button"
            className="grid-variations__tile"
            aria-label={`Use variation ${i + 1}`}
            onClick={() => onPick(variant)}
          >
            <GridThumb recipe={variant} />
          </button>
        ))}
      </div>
    </div>
  );
};
