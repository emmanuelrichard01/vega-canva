import React from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import {
  cellGeometry,
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
 * ## Why the thumbnails are drawn here rather than rendered by the canvas
 *
 * `recipeCells` is pure arithmetic over a dozen numbers, so five thumbnails
 * cost about as much as one layout pass. Going through the real renderer would
 * mean five off-screen Konva stages to draw thirty rectangles apiece, which is
 * three orders of magnitude more work for a picture 62 pixels wide.
 */

const THUMB_W = 62;
const THUMB_H = 44;

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

/** One candidate, drawn small. */
/**
 * A recipe, drawn small.
 *
 * Exported because the colour-mode picker needs exactly this and must not grow
 * a second one: a preview that draws cells its own way is a preview that can
 * disagree with the board, which is the failure this component's own header
 * records having already made once with hexagons.
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
 * Whether a scroller has more to show, and which way.
 *
 * ## Why this is measured rather than assumed
 *
 * Five tiles overflow a 260px panel today, so a permanent "there is more"
 * marker would be right today and a lie the moment the panel is widened or the
 * count changes. A fade with nothing behind it is worse than no fade: it
 * promises content that does not exist, and the reader who chases it learns to
 * distrust the next one.
 */
function useOverflow(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [edges, setEdges] = React.useState({ start: false, end: false });

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A pixel of slack: sub-pixel layout leaves `scrollWidth` a hair above
    // `clientWidth` on content that fits exactly, which would light the marker
    // permanently on a strip with nothing to scroll.
    setEdges({
      start: el.scrollLeft > 1,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, [ref]);

  React.useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    // The panel is resizable, and a strip that fits at 320px does not at 240.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { edges, measure };
}

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
   * Comparing five candidates against each other is the easy half; the question
   * that actually matters is whether any of them beats what you already have,
   * and that was off screen behind the panel. Worse, once you picked one the
   * original was gone — recoverable only through undo, which on a thirty-cell
   * grid means undoing a re-lay rather than a choice.
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
    // Eight rather than five. The strip scrolls, so the cost of more is a
    // scroll rather than a squeeze, and five was thin for a mode as broad as
    // Anything -- where two of them routinely land on the same system.
    () => variantsOf(recipe, mode, salt, 8),
    [recipe, mode, salt]
  );

  const stripRef = React.useRef<HTMLDivElement>(null);
  const { edges } = useOverflow(stripRef, [variants]);

  /** One tile plus its gap: a nudge should land on a tile edge, not between two. */
  const step = THUMB_W + 14;
  const slide = (dir: -1 | 1) => stripRef.current?.scrollBy({ left: dir * step * 2, behavior: 'smooth' });

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

      {/**
        * The strip, and two ways of knowing there is more of it.
        *
        * A fade alone says "this continues" but cannot be used; an arrow alone
        * is a button with no explanation of what it will reveal. Together the
        * fade shows content running under the edge and the arrow gives it
        * somewhere to go — and a trackpad or a touch drag still works, because
        * neither is doing the scrolling.
        */}
      <div className="grid-variations__viewport" data-more-start={edges.start || undefined} data-more-end={edges.end || undefined}>
        {edges.start && (
          <button
            type="button"
            className="grid-variations__nudge grid-variations__nudge--start"
            aria-label="Previous variations"
            onClick={() => slide(-1)}
          >
            <ChevronLeft size={13} />
          </button>
        )}

        <div className="grid-variations__strip" ref={stripRef}>
          {/* Where you started, first and marked. Clicking it puts the grid
              back, which is a way out of a comparison that does not depend on
              the history stack knowing a re-lay was a decision. */}
          <button
            type="button"
            className="grid-variations__tile grid-variations__tile--baseline"
            data-current={sameRecipe(recipe, baseline.current) || undefined}
            aria-label="Back to where you started"
            onClick={() => onPick(baseline.current)}
          >
            <GridThumb recipe={baseline.current} />
            <span className="grid-variations__badge">Now</span>
          </button>

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

        {edges.end && (
          <button
            type="button"
            className="grid-variations__nudge grid-variations__nudge--end"
            aria-label="More variations"
            onClick={() => slide(1)}
          >
            <ChevronRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
};
