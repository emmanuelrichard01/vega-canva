import React from 'react';

/**
 * A shape's glyph, drawn by the same code that draws the shape.
 *
 * ## Why there is no artwork in this file any more
 *
 * There were forty hand-drawn SVG paths here, one per shape, maintained beside
 * the geometry they were pictures of. Five of them derived from the real
 * outline and the other thirty-five did not, so the set could only drift — and
 * it had:
 *
 *   - the **Database** glyph drew a stack of three disks; the tile created a
 *     plain cylinder;
 *   - the **Seal** glyph was a smooth rosette; the board drew a jagged
 *     sunburst, because the outline used a straight-sided fallback the icon
 *     did not;
 *   - the **Key** glyph had a round bow with a hole in it; the board drew a
 *     diamond with a comb attached;
 *   - the **Ring** glyph showed two concentric circles; the board drew a
 *     lens.
 *
 * Every one of those is the same defect: a picture of a shape is not a fact
 * about the shape, it is a *second* fact, and the two were free to disagree. A
 * user cannot find that out except by drawing the thing and being surprised.
 *
 * So the glyph is now the shape. `shapeToPath` gives the outline the canvas
 * fills and the exporter writes; `shapeFeaturePaths` gives the interior lines.
 * The tile draws them at 24 units instead of 240, and that is the only
 * difference between the picture and the object.
 *
 * ## What that costs, and what it buys
 *
 * It costs a path evaluation per glyph instead of a literal, which for a set of
 * fifty tiles is nothing and is memoised anyway. It buys three things that were
 * previously impossible: a new shape needs no icon, a change to a shape cannot
 * leave its icon behind, and the details each shape draws — a rack's bays, a
 * chip's pins, a browser's address bar — simplify by themselves at glyph size,
 * because every one of them is a share of the box held between a floor and a
 * ceiling.
 */

import { shapeToPath } from '../../engine/model/shapeToPath';
import { shapeFeaturePaths } from '../../engine/model/shapeOutline';
import { contourData } from '../../engine/model/pathGeometry';
import type { ShapeKind, ShapeNode } from '../../engine/model/schema';
import {
  SHAPE_BY_PRESET,
  presetForKind,
  type ShapePreset,
} from './shapeCatalog';

interface ShapeIconProps {
  /**
   * A preset, or a bare kind.
   *
   * The dock is keyed by preset — a pentagon and a hexagon are two tiles and
   * one kind. The properties panel and the swapper are keyed by kind, because
   * they describe a node that already exists and no longer remembers which
   * tile placed it. Both arrive here, and a kind is resolved to the first
   * preset that makes it.
   */
  kind: ShapePreset | ShapeKind;
  size?: number;
}

/**
 * The glyph is drawn at board size and scaled down by the browser.
 *
 * ## Why 96 units and not 24
 *
 * `shapeFeaturePaths` sizes every interior detail as a share of the box held
 * between a floor and a ceiling, and the floors are in world units because
 * that is the only thing they can be: a rack's indicator lamp must not vanish
 * on a 60-unit shape. Drawing the glyph in a 21-unit box put every one of
 * those floors in charge — a browser's title bar is `max(h × 0.2, 12)`, which
 * at 21 units is **more than half the shape**, and a terminal's prompt started
 * past its own centre line.
 *
 * So the glyph is drawn at a size a real shape is drawn at, and the `<svg>`
 * scales the result to 18 or 24 CSS pixels. Nothing about the drawing changes;
 * only the viewport does. That is stronger parity than the small viewbox ever
 * had — the tile is now a photograph of the object at a distance rather than a
 * separate small drawing of it — and it removes a whole class of defect that
 * could only ever appear in the toolbar.
 */
const VIEWBOX = 96;
/** How much of it the artwork may use, leaving room for the stroke's own width. */
const CONTENT = 84;

/**
 * Two weights, not one.
 *
 * The silhouette carries the identity and the interior lines qualify it, so
 * they are not peers: a rack drawn with its bays at the same weight as its
 * chassis reads as a grid, and a chip reads as a waffle. The ratio is the same
 * one the canvas produces naturally at size, which is why a glyph and the
 * object it places look like the same drawing.
 */
const SCALE = VIEWBOX / 24;
const OUTLINE_STROKE = 1.75 * SCALE;
const FEATURE_STROKE = 1.35 * SCALE;

/** An open run has no interior, and its head is drawn by the renderer, not the outline. */
const RUNS: ReadonlySet<string> = new Set(['line', 'arrow']);

interface Glyph {
  outline: string;
  features: readonly string[];
}

const cache = new Map<ShapePreset, Glyph>();

function glyphFor(preset: ShapePreset): Glyph {
  const cached = cache.get(preset);
  if (cached) return cached;

  const entry = SHAPE_BY_PRESET[preset];
  const [gw, gh] = entry.glyph ?? [20, 20];
  // The artwork's own proportions, scaled to fill the content square and
  // centred in the viewbox. A capsule stays a capsule and a phone stays a
  // phone; nothing is squashed into a square to make the grid tidy.
  const scale = CONTENT / Math.max(gw, gh);
  const w = gw * scale;
  const h = gh * scale;
  const ox = (VIEWBOX - w) / 2;
  const oy = (VIEWBOX - h) / 2;

  const node = {
    geometry: entry.geometry,
    width: w,
    height: h,
    // The same ratio the tool seeds a real one with, applied to the glyph's
    // own shorter side — so the corner in the tile is the corner you get.
    appearance: entry.cornerRadiusRatio
      ? { cornerRadius: Math.min(w, h) * entry.cornerRadiusRatio }
      : undefined,
  } as Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>;

  const glyph: Glyph = {
    outline: translate(contourData(shapeToPath(node)), ox, oy),
    features: shapeFeaturePaths(node, ox, oy),
  };
  cache.set(preset, glyph);
  return glyph;
}

/**
 * Move a path by an offset.
 *
 * `shapeToPath` works in the node's own box, which starts at its corner —
 * everything downstream of it draws inside a group that has already been moved
 * there. A glyph has no group, so the numbers are shifted here. Every command
 * this produces is `M`/`C`/`Z` with absolute coordinate pairs, which is why a
 * pairwise walk is enough and no path parser is needed.
 */
function translate(d: string, dx: number, dy: number): string {
  let index = 0;
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => {
    const shifted = parseFloat(n) + (index++ % 2 === 0 ? dx : dy);
    return shifted.toFixed(3);
  });
}

/** The two open runs, which have no interior and no silhouette to draw. */
const RUN_GLYPHS: Record<string, React.ReactNode> = {
  line: <path d="M14 82 L82 14" />,
  arrow: <path d="M14 82 L82 14 M82 14 L54.4 18.8 M82 14 L77.2 41.6" />,
};

export const ShapeIcon: React.FC<ShapeIconProps> = ({ kind, size = 18 }) => {
  const preset: ShapePreset =
    kind in SHAPE_BY_PRESET ? (kind as ShapePreset) : presetForKind(kind as ShapeKind);

  const body = RUNS.has(preset) ? (
    RUN_GLYPHS[preset]
  ) : (
    <ShapeGlyph preset={preset} />
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={OUTLINE_STROKE}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  );
};

const ShapeGlyph: React.FC<{ preset: ShapePreset }> = ({ preset }) => {
  const glyph = React.useMemo(() => glyphFor(preset), [preset]);
  return (
    <>
      {/*
        `evenodd`, so a ring, a gear's bore and a key's pierced bow read as
        holes rather than as a second outline sitting inside the first. It
        matters even with no fill: a shape whose hole is not declared is a
        shape whose hole is not there once somebody fills the tile.
      */}
      <path d={glyph.outline} fillRule="evenodd" />
      {glyph.features.map((d, i) => (
        <path key={i} d={d} strokeWidth={FEATURE_STROKE} />
      ))}
    </>
  );
};
